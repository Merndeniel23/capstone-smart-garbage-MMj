import assert from "node:assert/strict";
import test from "node:test";
import {
  createXenditWebhookHandler,
  invoiceApi,
  XenditInvoiceApiError,
} from "./xendit.js";

const callbackToken="test-callback-token";
process.env.XENDIT_CALLBACK_TOKEN=callbackToken;
process.env.XENDIT_SECRET_KEY="test-secret-key";

function quietLogger() {
  const entries:any[]=[];
  return {
    entries,
    logger:{
      info(message:string,context?:unknown){entries.push(["info",message,context]);},
      warn(message:string,context?:unknown){entries.push(["warn",message,context]);},
      error(message:string,context?:unknown){entries.push(["error",message,context]);},
    },
  };
}

function responseCapture() {
  const state={status:200,payload:null as any};
  const response:any={
    status(code:number){state.status=code;return response;},
    json(payload:any){state.payload=payload;return response;},
  };
  return {state,response};
}

async function invokeWebhook(options:{
  body?:Record<string,unknown>;
  token?:string;
  fetchInvoice:(path:string)=>Promise<any>;
  connection?:any;
  recordAudit?:(...args:any[])=>Promise<any>;
}) {
  const {state,response}=responseCapture();
  const logs=quietLogger();
  let transactions=0;
  const connection=options.connection||{
    async query(){return [[]];},
    async execute(){throw new Error("Unexpected database write");},
  };
  const handler=createXenditWebhookHandler({
    ensureConfigured:()=>undefined,
    fetchInvoice:options.fetchInvoice,
    runTransaction:async work=>{transactions++;return work(connection);},
    recordAudit:(options.recordAudit||(async()=>undefined)) as any,
    logger:logs.logger,
  });
  const request:any={
    body:options.body||{id:"invoice-123"},
    get(name:string){return name.toLowerCase()==="x-callback-token"?(options.token??callbackToken):undefined;},
  };
  await (handler as any)(request,response,()=>assert.fail("Webhook unexpectedly delegated"));
  return {state,transactions,logs:logs.entries};
}

const attempt=(overrides:Record<string,unknown>={})=>({
  id:8,
  external_id:"SGMS-local-reference",
  resident_id:17,
  barangay_id:2,
  purok_id:4,
  category:"weekly_fee",
  billing_period:"October 2026",
  amount:50,
  provider_id:"invoice-123",
  status:"pending",
  ...overrides,
});

const invoice=(status:string,overrides:Record<string,unknown>={})=>({
  id:"invoice-123",
  external_id:"SGMS-local-reference",
  currency:"PHP",
  amount:50,
  status,
  paid_amount:50,
  paid_at:"2026-10-30T01:00:00.000Z",
  ...overrides,
});

test("invoiceApi classifies not-found, authentication, provider, and network failures",async()=>{
  const cases=[
    {status:404,kind:"not_found",clientStatus:404},
    {status:401,kind:"authentication",clientStatus:502},
    {status:500,kind:"provider",clientStatus:503},
  ] as const;
  for(const item of cases) {
    const logs=quietLogger();
    await assert.rejects(
      ()=>invoiceApi("/dashboard-sample",undefined,async()=>new Response(JSON.stringify({error_code:"DATA_NOT_FOUND"}),{status:item.status,headers:{"Content-Type":"application/json"}}),logs.logger),
      (error:any)=>error instanceof XenditInvoiceApiError&&error.kind===item.kind&&error.status===item.clientStatus,
    );
    const serialized=JSON.stringify(logs.entries);
    assert.doesNotMatch(serialized,/test-secret-key|test-callback-token|authorization/i);
  }
  const logs=quietLogger();
  await assert.rejects(
    ()=>invoiceApi("/invoice-123",undefined,async()=>{throw new TypeError("fetch failed");},logs.logger),
    (error:any)=>error instanceof XenditInvoiceApiError&&error.kind==="network"&&error.status===503,
  );
});

test("valid-token webhook acknowledges a provider 404 without touching the database",async()=>{
  const result=await invokeWebhook({
    fetchInvoice:async()=>{throw new XenditInvoiceApiError("missing",404,"not_found",404,"DATA_NOT_FOUND");},
  });
  assert.equal(result.state.status,200);
  assert.deepEqual(result.state.payload,{received:true,ignored:true});
  assert.equal(result.transactions,0);
});

test("provider authentication failure remains non-2xx and is not ignored",async()=>{
  const result=await invokeWebhook({
    fetchInvoice:async()=>{throw new XenditInvoiceApiError("auth failed",502,"authentication",401,"INVALID_API_KEY");},
  });
  assert.equal(result.state.status,502);
  assert.equal(result.state.payload.message,"auth failed");
  assert.equal(result.transactions,0);
});

test("invalid callback token is rejected before calling Xendit",async()=>{
  let providerCalls=0;
  const result=await invokeWebhook({token:"wrong-token",fetchInvoice:async()=>{providerCalls++;return invoice("PAID");}});
  assert.equal(result.state.status,401);
  assert.equal(providerCalls,0);
  assert.equal(result.transactions,0);
});

test("verified invoice with no local reservation is acknowledged without writes",async()=>{
  let writes=0;
  const result=await invokeWebhook({
    fetchInvoice:async()=>invoice("PAID"),
    connection:{async query(){return [[]];},async execute(){writes++;}},
  });
  assert.equal(result.state.status,200);
  assert.deepEqual(result.state.payload,{received:true,ignored:true});
  assert.equal(writes,0);
});

test("webhook body payment fields are ignored and verified PENDING state wins",async()=>{
  const statements:string[]=[];
  const result=await invokeWebhook({
    body:{id:"invoice-123",status:"PAID",paid_amount:999999},
    fetchInvoice:async()=>invoice("PENDING",{paid_amount:undefined,paid_at:undefined}),
    connection:{
      async query(){return [[attempt({status:"creating"})]];},
      async execute(sql:string){statements.push(sql);return [{}];},
    },
  });
  assert.equal(result.state.status,200);
  assert.equal(statements.length,1);
  assert.match(statements[0],/status = CASE WHEN status = 'creating' THEN 'pending'/);
  assert.doesNotMatch(statements[0],/INSERT INTO payments/);
});

for(const status of ["PAID","SETTLED"]) {
  test(`verified ${status} invoice creates one completed payment`,async()=>{
    const statements:string[]=[];
    let audits=0;
    const result=await invokeWebhook({
      fetchInvoice:async()=>invoice(status),
      connection:{
        async query(){return [[attempt()]];},
        async execute(sql:string){statements.push(sql);return sql.includes("INSERT INTO payments")?[{insertId:91}]:[{}];},
      },
      recordAudit:async()=>{audits++;},
    });
    assert.equal(result.state.status,200);
    assert.equal(statements.filter(sql=>sql.includes("INSERT INTO payments")).length,1);
    assert.equal(statements.filter(sql=>sql.includes("status = 'paid'")).length,1);
    assert.equal(statements.filter(sql=>sql.includes("INSERT INTO notifications")).length,1);
    assert.equal(audits,1);
  });
}

test("verified EXPIRED invoice expires only its local reserved attempt",async()=>{
  const statements:string[]=[];
  const result=await invokeWebhook({
    fetchInvoice:async()=>invoice("EXPIRED",{paid_amount:undefined,paid_at:undefined}),
    connection:{
      async query(){return [[attempt()]];},
      async execute(sql:string){statements.push(sql);return [{}];},
    },
  });
  assert.equal(result.state.status,200);
  assert.equal(statements.length,1);
  assert.match(statements[0],/SET status = 'expired'/);
});

test("already-paid attempt is idempotent and does not create a duplicate payment",async()=>{
  let writes=0;
  const result=await invokeWebhook({
    fetchInvoice:async()=>invoice("PAID"),
    connection:{async query(){return [[attempt({status:"paid"})]];},async execute(){writes++;return [{}];}},
  });
  assert.equal(result.state.status,200);
  assert.equal(writes,0);
});

test("verified currency or amount mismatch remains non-2xx with no payment write",async()=>{
  let writes=0;
  const result=await invokeWebhook({
    fetchInvoice:async()=>invoice("PAID",{amount:51}),
    connection:{async query(){return [[attempt()]];},async execute(){writes++;return [{}];}},
  });
  assert.equal(result.state.status,409);
  assert.match(result.state.payload.message,/currency mismatch/i);
  assert.equal(writes,0);
});
