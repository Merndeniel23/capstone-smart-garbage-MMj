import { Router, type RequestHandler } from "express";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { db } from "../config/db.js";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";
import { CATEGORY_AMOUNTS } from "../config/paymentFees.js";
import { latestResidentViolationFine, paymentFeeInfo } from "./payments.js";
import { audit, DomainError, requiredText, revisionsEnabled, transaction } from "../services/sgms.js";

const router=Router();
function configured() {
  if (!revisionsEnabled() || process.env.XENDIT_ENABLED !== "true" || !process.env.XENDIT_SECRET_KEY || !process.env.XENDIT_CALLBACK_TOKEN) throw new DomainError("Online payments are not configured.",503);
}
function cents(value:unknown) {
  const amount=Number(value);
  if(!Number.isFinite(amount)||amount<=0||Math.abs(amount*100-Math.round(amount*100))>0.000001)throw new DomainError("Invalid payment amount.");
  return Math.round(amount*100);
}
async function invoiceApi(path:string,body?:any) {
  const response=await fetch(`https://api.xendit.co/v2/invoices${path}`,{method:body?"POST":"GET",headers:{Authorization:`Basic ${Buffer.from(`${process.env.XENDIT_SECRET_KEY}:`).toString("base64")}`,"Content-Type":"application/json"},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});
  const result=await response.json().catch(()=>null) as any;
  if(!response.ok||!result)throw new DomainError("The payment provider could not complete this request. Do not submit another payment until its status is reconciled.",502);
  return result;
}
const safe=(work:(req:AuthRequest,res:any)=>Promise<any>):RequestHandler=>async(req,res)=>{
  try{configured();await work(req as AuthRequest,res);}
  catch(error){res.status(error instanceof DomainError?error.status:503).json({message:error instanceof DomainError?error.message:"Payment provider temporarily unavailable. Check transaction history before trying again."});}
};
router.get("/",requireAuth,async(req:AuthRequest,res)=>{
  try {
    if(req.user!.role!=="resident")throw new DomainError("Resident access required.",403);
    const [attempts]=await db.query<any[]>("SELECT external_id,category,billing_period,amount,checkout_url,status,created_at,paid_at FROM online_payment_attempts WHERE resident_id = ? ORDER BY created_at DESC LIMIT 100",[req.user!.id]).catch(()=>[[]]);
    res.json({attempts, configured: Boolean(process.env.XENDIT_SECRET_KEY && process.env.XENDIT_CALLBACK_TOKEN)});
  } catch (error) {
    res.status(error instanceof DomainError ? error.status : 500).json({message: error instanceof DomainError ? error.message : "Unable to load online payments."});
  }
});
router.post("/",requireAuth,safe(async(req,res)=>{
  if(req.user!.role!=="resident")throw new DomainError("Only residents may create a checkout.",403);
  const category=requiredText(req.body.category,40),period=requiredText(req.body.billingPeriod,80);
  if(!Object.prototype.hasOwnProperty.call(CATEGORY_AMOUNTS,category))throw new DomainError("Choose an existing payment category.");
  const reserved=await transaction(async connection=>{
    const [users]=await connection.query<any[]>("SELECT id,email,barangay_id,purok_id FROM users WHERE id = ? AND role = 'resident' AND status = 'active' AND archived_at IS NULL FOR UPDATE",[req.user!.id]);
    const user=users[0];
    if(!user?.barangay_id||!user.purok_id)throw new DomainError("Complete your registered household assignment before paying.");
    const [previous]=await connection.query<any[]>("SELECT * FROM online_payment_attempts WHERE resident_id = ? AND category = ? AND billing_period = ? FOR UPDATE",[user.id,category,period]);
    if(previous[0]){
      if(previous[0].checkout_url&&previous[0].status==="pending")return {...previous[0],existing:true};
      throw new DomainError(previous[0].status==="paid"?"This billing period is already paid.":"This billing period has an earlier checkout. Ask the Admin to reconcile it before submitting another payment.",409);
    }
    const [payments]=await connection.query<any[]>("SELECT id FROM payments WHERE resident_id = ? AND category = ? AND billing_period = ? AND status <> 'rejected_by_leader' LIMIT 1",[user.id,category,period]);
    if(payments.length)throw new DomainError("A payment already exists for this billing period.",409);
    // Charge the same minimum the manual form enforces: the purok's weekly fee or the resident's issued fine.
    const amount=category==="weekly_fee"?Number((await paymentFeeInfo(Number(user.purok_id),connection)).amount):category==="violation_fine"?(await latestResidentViolationFine(Number(user.id),connection))??CATEGORY_AMOUNTS[category]:CATEGORY_AMOUNTS[category];
    cents(amount);
    const externalId=`SGMS-${randomBytes(16).toString("hex")}`;
    const [created]:any=await connection.execute("INSERT INTO online_payment_attempts (resident_id,barangay_id,purok_id,external_id,category,billing_period,amount) VALUES (?,?,?,?,?,?,?)",[user.id,user.barangay_id,user.purok_id,externalId,category,period,amount]);
    await audit(connection,req.user!,"online_checkout_reserved","online_payment_attempts",Number(created.insertId),{...user,resident_id:user.id});
    return {id:Number(created.insertId),external_id:externalId,amount,email:user.email,existing:false};
  });
  if(reserved.existing)return res.json({checkoutUrl:reserved.checkout_url});
  // Do not automatically repeat an ambiguous provider POST. A reserved checkout
  // remains available for webhook reconciliation even after a network timeout.
  const invoice=await invoiceApi("",{external_id:reserved.external_id,amount:reserved.amount,payer_email:reserved.email,description:`SGMS ${category} - ${period}`,currency:"PHP"});
  if(invoice.external_id!==reserved.external_id||cents(invoice.amount)!==cents(reserved.amount)||!invoice.id)throw new DomainError("The provider checkout does not match the reserved payment.",502);
  const url=new URL(String(invoice.invoice_url));
  if(url.protocol!=="https:"||!url.hostname.endsWith(".xendit.co"))throw new DomainError("The provider returned an invalid checkout URL.",502);
  await db.execute("UPDATE online_payment_attempts SET provider_id = ?, checkout_url = ?, status = CASE WHEN status = 'creating' THEN 'pending' ELSE status END WHERE id = ?",[invoice.id,url.href,reserved.id]);
  res.status(201).json({checkoutUrl:url.href});
}));

export const xenditWebhook:RequestHandler=safe(async(req,res)=>{
  const supplied=req.get("x-callback-token")||"",expected=process.env.XENDIT_CALLBACK_TOKEN!;
  const hash=(value:string)=>createHash("sha256").update(value).digest();
  if(!supplied||!timingSafeEqual(hash(supplied),hash(expected)))throw new DomainError("Invalid webhook authentication.",401);
  const id=String(req.body.id||"");
  if(!/^[a-zA-Z0-9_-]{1,120}$/.test(id))throw new DomainError("Invalid invoice ID.");
  const verified=await invoiceApi(`/${encodeURIComponent(id)}`);
  if(verified.id!==id||typeof verified.external_id!=="string")throw new DomainError("Invoice verification failed.",409);
  await transaction(async connection=>{
    const [rows]=await connection.query<any[]>("SELECT * FROM online_payment_attempts WHERE external_id = ? FOR UPDATE",[verified.external_id]);
    const attempt=rows[0];
    if(!attempt)throw new DomainError("Unknown reserved payment.",404);
    if(attempt.provider_id&&attempt.provider_id!==id)throw new DomainError("Invoice does not match this payment.",409);
    if(verified.currency!=="PHP"||cents(verified.amount)!==cents(attempt.amount))throw new DomainError("Invoice amount or currency mismatch.",409);
    if(attempt.status==="paid")return;
    if(verified.status==="EXPIRED") {await connection.execute("UPDATE online_payment_attempts SET status = 'expired',provider_id = ? WHERE id = ?",[id,attempt.id]);return;}
    if(!["PAID","SETTLED"].includes(verified.status))return;
    if(cents(verified.paid_amount)!==cents(attempt.amount))throw new DomainError("The verified paid amount does not match.",409);
    const paidAt=new Date(String(verified.paid_at||""));
    if(Number.isNaN(paidAt.getTime()))throw new DomainError("Missing verified payment timestamp.",409);
    const [created]:any=await connection.execute(`INSERT INTO payments (transaction_code,resident_id,barangay_id,purok_id,category,billing_period,amount,payment_method,payment_reference,receipt_proof,status)
      VALUES (?,?,?,?,?,?,?,'xendit',?,?,'completed')`,[attempt.external_id,attempt.resident_id,attempt.barangay_id,attempt.purok_id,attempt.category,attempt.billing_period,attempt.amount,id,JSON.stringify({provider:"xendit",invoiceId:id,paidAt:paidAt.toISOString()})]);
    await connection.execute("UPDATE online_payment_attempts SET status = 'paid',provider_id = ?,payment_id = ?,paid_at = ? WHERE id = ?",[id,created.insertId,paidAt,attempt.id]);
    await audit(connection,null,"online_payment_verified","payments",Number(created.insertId),attempt,{invoiceId:id,paidAt:paidAt.toISOString()});
    await connection.execute("INSERT INTO notifications (recipient_user_id,barangay_id,purok_id,title,message,notification_type) VALUES (?,?,?,'Online payment verified','Your online payment was verified by the payment provider.','payment')",[attempt.resident_id,attempt.barangay_id,attempt.purok_id]);
  });
  res.json({received:true});
});
export default router;
