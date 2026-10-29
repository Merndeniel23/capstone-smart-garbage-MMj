import { Router, type RequestHandler } from "express";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { PoolConnection } from "mysql2/promise";
import { db } from "../config/db.js";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";
import { CATEGORY_AMOUNTS } from "../config/paymentFees.js";
import { latestResidentViolationFine, paymentFeeInfo } from "./payments.js";
import { audit, DomainError, requiredText, revisionsEnabled, transaction } from "../services/sgms.js";

const router=Router();
type XenditLogger=Pick<Console,"info"|"warn"|"error">;
export type XenditInvoiceFailureKind="not_found"|"authentication"|"forbidden"|"rate_limited"|"network"|"provider"|"invalid_response";
export class XenditInvoiceApiError extends DomainError {
  constructor(message:string,status:number,public readonly kind:XenditInvoiceFailureKind,public readonly providerStatus?:number,public readonly providerCode?:string) {
    super(message,status);
  }
}
function configured() {
  if (!revisionsEnabled() || process.env.XENDIT_ENABLED !== "true" || !process.env.XENDIT_SECRET_KEY || !process.env.XENDIT_CALLBACK_TOKEN) throw new DomainError("Online payments are not configured.",503);
}
function cents(value:unknown) {
  const amount=Number(value);
  if(!Number.isFinite(amount)||amount<=0||Math.abs(amount*100-Math.round(amount*100))>0.000001)throw new DomainError("Invalid payment amount.");
  return Math.round(amount*100);
}
const safeProviderCode=(value:unknown)=>typeof value==="string"&&/^[A-Z0-9_-]{1,80}$/i.test(value)?value:undefined;
const fingerprint=(value:string)=>createHash("sha256").update(value).digest("hex").slice(0,12);
export async function invoiceApi(path:string,body?:any,fetchImpl:typeof fetch=fetch,logger:XenditLogger=console) {
  const operation=body?"create_invoice":"get_invoice";
  const invoiceFingerprint=!body&&path.startsWith("/")?fingerprint(path.slice(1)):undefined;
  let response:Response;
  try {
    response=await fetchImpl(`https://api.xendit.co/v2/invoices${path}`,{method:body?"POST":"GET",headers:{Authorization:`Basic ${Buffer.from(`${process.env.XENDIT_SECRET_KEY}:`).toString("base64")}`,"Content-Type":"application/json"},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});
  } catch(error:any) {
    logger.error("[xendit] Invoice API network failure",{operation,invoiceFingerprint,errorType:String(error?.name||"NetworkError")});
    throw new XenditInvoiceApiError("The payment provider is temporarily unreachable. Please try again later.",503,"network");
  }
  const result=await response.json().catch(()=>null) as any;
  if(response.ok&&result)return result;
  if(response.ok) {
    logger.error("[xendit] Invoice API returned an invalid response",{operation,invoiceFingerprint,providerStatus:response.status});
    throw new XenditInvoiceApiError("The payment provider returned an invalid response.",502,"invalid_response",response.status);
  }
  const providerCode=safeProviderCode(result?.error_code||result?.code);
  const context={operation,invoiceFingerprint,providerStatus:response.status,providerCode};
  if(response.status===404) {
    logger.info("[xendit] Invoice was not found",context);
    throw new XenditInvoiceApiError("The requested Xendit invoice was not found.",404,"not_found",response.status,providerCode);
  }
  if(response.status===401) {
    logger.error("[xendit] Invoice API authentication failed",context);
    throw new XenditInvoiceApiError("Xendit API authentication failed. Check the configured secret key.",502,"authentication",response.status,providerCode);
  }
  if(response.status===403) {
    logger.error("[xendit] Invoice API request was forbidden",context);
    throw new XenditInvoiceApiError("Xendit denied access to the invoice. Check API-key permissions and account mode.",502,"forbidden",response.status,providerCode);
  }
  if(response.status===429) {
    logger.warn("[xendit] Invoice API rate limit reached",context);
    throw new XenditInvoiceApiError("The payment provider is busy. Please retry later.",503,"rate_limited",response.status,providerCode);
  }
  logger.error("[xendit] Invoice API provider failure",context);
  throw new XenditInvoiceApiError(response.status>=500?"The payment provider is temporarily unavailable.":"The payment provider rejected the invoice request.",response.status>=500?503:502,"provider",response.status,providerCode);
}
const safe=(work:(req:AuthRequest,res:any)=>Promise<any>):RequestHandler=>async(req,res)=>{
  try{configured();await work(req as AuthRequest,res);}
  catch(error){
    if(!(error instanceof DomainError))console.error("[xendit] Unexpected request failure",{errorType:String((error as any)?.name||"Error")});
    res.status(error instanceof DomainError?error.status:503).json({message:error instanceof DomainError?error.message:"Payment provider temporarily unavailable. Check transaction history before trying again."});
  }
};
router.get("/",requireAuth,async(req:AuthRequest,res)=>{
  try {
    if(req.user!.role!=="resident")throw new DomainError("Resident access required.",403);
    const [attempts]=await db.query<any[]>("SELECT external_id,category,billing_period,amount,checkout_url,status,created_at,paid_at FROM online_payment_attempts WHERE resident_id = ? ORDER BY created_at DESC LIMIT 100",[req.user!.id]).catch(()=>[[]]);
    res.json({attempts, configured: revisionsEnabled() && process.env.XENDIT_ENABLED === "true" && Boolean(process.env.XENDIT_SECRET_KEY && process.env.XENDIT_CALLBACK_TOKEN)});
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
  const hostname=url.hostname.toLowerCase();
  if(url.protocol!=="https:"||(hostname!=="xendit.co"&&!hostname.endsWith(".xendit.co")))throw new DomainError("The provider returned an invalid checkout URL.",502);
  await db.execute("UPDATE online_payment_attempts SET provider_id = ?, checkout_url = ?, status = CASE WHEN status = 'creating' THEN 'pending' ELSE status END WHERE id = ?",[invoice.id,url.href,reserved.id]);
  res.status(201).json({checkoutUrl:url.href});
}));

type TransactionRunner=<T>(work:(connection:PoolConnection)=>Promise<T>)=>Promise<T>;
type WebhookDependencies={
  ensureConfigured:()=>void;
  fetchInvoice:(path:string)=>Promise<any>;
  runTransaction:TransactionRunner;
  recordAudit:typeof audit;
  logger:XenditLogger;
};
type WebhookOutcome="pending"|"paid"|"expired"|"duplicate"|"ignored_status"|"ignored_unknown_reference";

export function createXenditWebhookHandler(overrides:Partial<WebhookDependencies>={}):RequestHandler {
  const logger=overrides.logger||console;
  const dependencies:WebhookDependencies={
    ensureConfigured:overrides.ensureConfigured||configured,
    fetchInvoice:overrides.fetchInvoice||((path:string)=>invoiceApi(path,undefined,fetch,logger)),
    runTransaction:overrides.runTransaction||transaction,
    recordAudit:overrides.recordAudit||audit,
    logger,
  };
  return async(req,res)=>{
    try {
      dependencies.ensureConfigured();
      const supplied=req.get("x-callback-token")||"",expected=process.env.XENDIT_CALLBACK_TOKEN||"";
      const hash=(value:string)=>createHash("sha256").update(value).digest();
      if(!supplied||!expected||!timingSafeEqual(hash(supplied),hash(expected))) {
        dependencies.logger.warn("[xendit] Rejected webhook authentication",{reason:"callback_token_mismatch"});
        throw new DomainError("Invalid webhook authentication.",401);
      }
      const id=String(req.body?.id||"");
      if(!/^[a-zA-Z0-9_-]{1,120}$/.test(id))throw new DomainError("Invalid invoice ID.");

      let verified:any;
      try {
        verified=await dependencies.fetchInvoice(`/${encodeURIComponent(id)}`);
      } catch(error) {
        if(error instanceof XenditInvoiceApiError&&error.kind==="not_found") {
          dependencies.logger.info("[xendit] Ignored webhook for an invoice absent from Xendit",{invoiceFingerprint:fingerprint(id),providerStatus:error.providerStatus,providerCode:error.providerCode});
          return res.status(200).json({received:true,ignored:true});
        }
        throw error;
      }
      if(verified?.id!==id||typeof verified?.external_id!=="string"||!verified.external_id.trim())throw new DomainError("Invoice verification failed.",409);
      const externalId=verified.external_id.trim();
      const providerStatus=String(verified.status||"").toUpperCase();

      const outcome=await dependencies.runTransaction<WebhookOutcome>(async connection=>{
        const [rows]=await connection.query<any[]>("SELECT * FROM online_payment_attempts WHERE external_id = ? FOR UPDATE",[externalId]);
        const attempt=rows[0];
        if(!attempt) {
          dependencies.logger.info("[xendit] Ignored verified invoice with no local reservation",{invoiceFingerprint:fingerprint(id),externalReferenceFingerprint:fingerprint(externalId),providerStatus});
          return "ignored_unknown_reference";
        }
        if(attempt.provider_id&&attempt.provider_id!==id)throw new DomainError("Invoice does not match this payment.",409);
        let invoiceAmount:number;
        try {invoiceAmount=cents(verified.amount);} catch {throw new DomainError("Invoice amount or currency mismatch.",409);}
        if(verified.currency!=="PHP"||invoiceAmount!==cents(attempt.amount))throw new DomainError("Invoice amount or currency mismatch.",409);
        if(attempt.status==="paid")return "duplicate";

        if(providerStatus==="PENDING") {
          await connection.execute("UPDATE online_payment_attempts SET provider_id = ?, status = CASE WHEN status = 'creating' THEN 'pending' ELSE status END WHERE id = ?",[id,attempt.id]);
          return "pending";
        }
        if(providerStatus==="EXPIRED") {
          await connection.execute("UPDATE online_payment_attempts SET status = 'expired',provider_id = ? WHERE id = ? AND status <> 'paid'",[id,attempt.id]);
          return "expired";
        }
        if(!["PAID","SETTLED"].includes(providerStatus)) {
          dependencies.logger.warn("[xendit] Ignored verified invoice status",{invoiceFingerprint:fingerprint(id),providerStatus:providerStatus||"MISSING"});
          return "ignored_status";
        }

        let paidAmount:number;
        try {paidAmount=cents(verified.paid_amount);} catch {throw new DomainError("The verified paid amount does not match.",409);}
        if(paidAmount!==cents(attempt.amount))throw new DomainError("The verified paid amount does not match.",409);
        const paidAt=new Date(String(verified.paid_at||""));
        if(Number.isNaN(paidAt.getTime()))throw new DomainError("Missing verified payment timestamp.",409);
        const [created]:any=await connection.execute(`INSERT INTO payments (transaction_code,resident_id,barangay_id,purok_id,category,billing_period,amount,payment_method,payment_reference,receipt_proof,status)
          VALUES (?,?,?,?,?,?,?,'xendit',?,?,'completed')`,[attempt.external_id,attempt.resident_id,attempt.barangay_id,attempt.purok_id,attempt.category,attempt.billing_period,attempt.amount,id,JSON.stringify({provider:"xendit",invoiceId:id,paidAt:paidAt.toISOString()})]);
        await connection.execute("UPDATE online_payment_attempts SET status = 'paid',provider_id = ?,payment_id = ?,paid_at = ? WHERE id = ?",[id,created.insertId,paidAt,attempt.id]);
        await dependencies.recordAudit(connection,null,"online_payment_verified","payments",Number(created.insertId),attempt,{invoiceId:id,paidAt:paidAt.toISOString()});
        await connection.execute("INSERT INTO notifications (recipient_user_id,barangay_id,purok_id,title,message,notification_type) VALUES (?,?,?,'Online payment verified','Your online payment was verified by the payment provider.','payment')",[attempt.resident_id,attempt.barangay_id,attempt.purok_id]);
        return "paid";
      });
      const ignored=outcome==="ignored_status"||outcome==="ignored_unknown_reference";
      return res.status(200).json({received:true,...(ignored?{ignored:true}:{})});
    } catch(error) {
      if(!(error instanceof DomainError))dependencies.logger.error("[xendit] Unexpected webhook failure",{errorType:String((error as any)?.name||"Error")});
      return res.status(error instanceof DomainError?error.status:503).json({message:error instanceof DomainError?error.message:"Payment provider temporarily unavailable. Check transaction history before trying again."});
    }
  };
}

export const xenditWebhook:RequestHandler=createXenditWebhookHandler();
export default router;
