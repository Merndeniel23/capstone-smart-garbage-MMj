import { useEffect, useId, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { ChevronDown, Plus, RefreshCw, Settings2, ShieldAlert } from "lucide-react";
import { apiRequest } from "../services/api";
import { useAppState } from "../context/AppStateContext";
import ConfirmDialog from "./ConfirmDialog";
import RecordActions from "./RecordActions";
import QrCollection from "./QrCollection";
import CollectionRunRecovery from "./CollectionRunRecovery";
import HouseholdQrLabel, { type HouseholdQrLabelData } from "./HouseholdQrLabel";
import { DRAFT_ENDORSEMENT_TEMPLATE, ENDORSEMENT_PLACEHOLDERS } from "../../../shared/endorsementTemplate";
import { PAYMENT_CATEGORY_LABELS } from "../../../shared/paymentCategories";

export type RecordView = "households"|"puroks"|"collection-records"|"violations"|"activity-logs"|"archives"|"barangay-policies"|"payment-history";
const titles: Record<RecordView,string> = {
  households:"Households & members",
  puroks:"Puroks",
  "collection-records":"Segregation records",
  violations:"Violations & suspensions",
  "activity-logs":"Activity logs & history",
  archives:"Archives",
  "barangay-policies":"Policies & templates",
  "payment-history":"Payment history (including archived records)",
};
const inputClass = "w-full rounded-xl border border-slate-200 bg-white p-3 text-sm";
const date = (value: string) => value ? new Date(value).toLocaleString("en-PH",{timeZone:"Asia/Manila"}) : "—";
const roleNames: Record<string,string> = {admin:"Barangay Captain",purok_leader:"Purok Leader",collector:"Collector",resident:"Resident",system:"System"};
const activityLabels: Record<string,string> = {
  collection_segregated:"Bin scanned: ✓ Segregated",collection_not_segregated:"Bin scanned: ✗ NOT segregated",collection_recorded:"Bin scanned",
  violation_warning_issued:"Warning issued",violation_fine_issued:"Fine issued",violation_suspension_issued:"Suspension issued",violation_reviewed:"Violation reviewed by Admin",
  payment_received_verified:"Payment received & verified",manual_payment_verified:"Payment verified",manual_payment_rejected:"Payment rejected",
  endorsement_released:"Endorsement released",endorsement_approved:"Endorsement released",endorsement_rejected:"Endorsement rejected",endorsement_downloaded:"Endorsement PDF downloaded",endorsement_document_viewed:"Endorsement viewed",
  complaint_submitted:"Complaint submitted",complaint_investigation_started:"Complaint investigation started",
  household_registered:"Household registered",household_updated:"Household updated",household_member_created:"Household member added",
  staff_created:"Staff account created",account_activated:"Password set / account activated",activation_link_resent:"Password setup link resent",
  bin_qr_registered:"Bin QR registered",record_archived:"Record archived",record_restored:"Record restored",
};
function parseDetails(row: any): Record<string, unknown> {
  let details: any = row.details;
  if (typeof details === "string") { try { details = JSON.parse(details); } catch { details = details ? {note: details} : null; } }
  return details && typeof details === "object" ? details : {};
}
function activityDetail(row: any) {
  const details: any = parseDetails(row);
  return [details?.binCode && `QR ${details.binCode}`, details?.household, details?.subjectName && `About ${details.subjectName}`, details?.reason, details?.remarks].filter(Boolean).join(" · ") || `${row.entity_type} #${row.entity_id}`;
}
function decisionText(row: any) {
  if (row.action === "fine") return `Fine · PHP ${Number(row.fine_amount).toFixed(2)}`;
  if (row.action === "suspension") return `Suspended (${row.suspension_scope === "account" ? "account" : "collection"})${row.suspension_until ? ` until ${date(row.suspension_until)}` : ""}`;
  return "Warning";
}
// Full-record details shown in a modal when a history row is clicked.
type Detail = {title:string;subtitle?:string;tone:"rose"|"amber"|"emerald"|"slate";note?:string;rows:[string,ReactNode][]};
const humanize = (value: unknown) => String(value ?? "").replaceAll("_", " ").replace(/^\w/, letter => letter.toUpperCase());
const peso = (value: unknown) => `PHP ${Number(value || 0).toFixed(2)}`;
const methodNames: Record<string,string> = {gcash:"GCash",maya:"Maya",xendit:"Xendit (online)",over_the_counter:"Over-the-counter"};
const decisionNames: Record<string,string> = {warning:"Warning",fine:"Fine",suspension:"Suspended"};
const scanText = (row: any) => row.segregation === "segregated" ? "✓ Segregated" : row.segregation === "not_segregated" ? "✗ Not segregated" : "";
function violationDetail(row: any): Detail {
  const suspended = row.action === "suspension", until = row.suspension_until ? new Date(row.suspension_until) : null;
  const active = Boolean(suspended && until && until.getTime() > Date.now());
  const days = suspended && until ? Math.max(1, Math.round((until.getTime() - new Date(row.issued_at).getTime()) / 86400000)) : null;
  const scope = row.suspension_scope === "account" ? "Account access (cannot log in or use online services)" : "Garbage collection service for the household";
  return {
    title: suspended ? "Suspension details" : row.action === "fine" ? "Fine details" : "Warning details",
    subtitle: `${row.household_name} · issued ${date(row.issued_at)}`,
    tone: suspended ? "rose" : row.action === "fine" ? "amber" : "slate",
    note: suspended
      ? `${row.suspension_scope === "account" ? "Account access" : "Garbage collection"} ${active ? "is" : "was"} suspended${until ? ` until ${date(row.suspension_until)}` : ""}. Reason: ${row.reason || "no reason recorded"}`
      : row.action === "fine" ? `A fine of ${peso(row.fine_amount)} was issued. Pay it under Payments → Segregation Violation Fine.` : undefined,
    rows: [
      ["Decision", decisionText(row)],
      ...(suspended ? [
        ["Suspension status", active ? "Active" : "Ended"],
        ["What is suspended", scope],
        ["Duration", days ? `${days} day${days === 1 ? "" : "s"}` : ""],
        ["Suspended from", date(row.issued_at)],
        ["Suspended until", until ? date(row.suspension_until) : ""],
      ] as [string,ReactNode][] : []),
      ...(row.action === "fine" ? [["Fine amount", peso(row.fine_amount)]] as [string,ReactNode][] : []),
      ["Reason", row.reason],
      ["Issued by", row.issued_by_name],
      ["Household", row.household_name],
      ["Purok", row.purok_name],
      ["Basis", row.collection_id ? `QR scan of bin ${row.bin_code || "—"}: ${scanText(row) || "—"}${row.collector_name ? ` · scanned by ${row.collector_name}` : ""}${row.collected_at ? ` on ${date(row.collected_at)}` : ""}` : "Direct decision by the Purok Leader"],
      ["Policy", row.title ? `${row.title}${row.official_reference ? ` (${row.official_reference})` : ""}` : ""],
      ["Admin review", row.review_decision ? `${humanize(row.review_decision)} · ${row.review_reason || ""}${row.reviewed_at ? ` · ${date(row.reviewed_at)}` : ""}` : "Not reviewed"],
      ["Record ID", `V-${row.id}`],
    ],
  };
}
function paymentDetail(row: any): Detail {
  return {
    title: "Payment details",
    subtitle: `${row.transaction_code} · ${peso(row.amount)}`,
    tone: row.status === "completed" ? "emerald" : ["rejected_by_leader","discrepancy"].includes(row.status) ? "rose" : "amber",
    rows: [
      ["Status", `${humanize(row.status)}${row.archived_at ? ` · Archived ${date(row.archived_at)}` : ""}`],
      ["Amount", peso(row.amount)],
      ["Category", (PAYMENT_CATEGORY_LABELS as Record<string,string>)[row.category] || humanize(row.category)],
      ["Billing period", row.billing_period],
      ["Payment method", methodNames[row.payment_method] || humanize(row.payment_method)],
      ["Reference no.", row.payment_reference],
      ["Resident", row.resident_name],
      ["Purok", row.purok_name],
      ["Submitted", date(row.created_at)],
      ["Reviewed by", row.leader_name ? `${row.leader_name}${row.leader_verified_at ? ` · ${date(row.leader_verified_at)}` : ""}` : "Waiting for Purok Leader review"],
      ["Leader remarks", row.leader_remarks],
      ["Discrepancy", Number(row.discrepancy_amount) > 0 ? peso(row.discrepancy_amount) : ""],
      ["Admin confirmed", row.admin_confirmed_at ? date(row.admin_confirmed_at) : ""],
      ["Transaction code", row.transaction_code],
    ],
  };
}
function collectionDetail(row: any): Detail {
  return {
    title: "QR scan details",
    subtitle: `Bin ${row.bin_code} · ${date(row.collected_at)}`,
    tone: row.segregation === "segregated" ? "emerald" : "rose",
    rows: [
      ["Segregation", scanText(row)],
      ["Collection", row.collection_status === "collected" ? "Collected" : `Not collected${row.not_collected_reason ? ` · ${row.not_collected_reason}` : ""}`],
      ["Household", row.household_name],
      ["Purok", row.purok_name],
      ["Collector", row.collector_name],
      ["Scanned at", date(row.collected_at)],
      ["Leader decision", row.decision_action ? decisionNames[row.decision_action] : row.segregation === "not_segregated" ? "Waiting for leader" : "None needed"],
      ["Notes", row.notes],
    ],
  };
}
function activityLogDetail(row: any, linked: Detail | null): Detail {
  const details = parseDetails(row);
  return {
    title: activityLabels[row.action] || humanize(row.action),
    subtitle: date(row.occurred_at),
    tone: linked?.tone || "slate",
    note: linked?.note,
    rows: [
      ["Date & time", date(row.occurred_at)],
      ["Done by", row.actor_name],
      ["Role", roleNames[row.actor_role] || row.actor_role],
      ["Activity", activityLabels[row.action] || humanize(row.action)],
      ...Object.entries(details).filter(([, value]) => value !== null && value !== "").map(([key, value]) => [humanize(key.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()), typeof value === "object" ? JSON.stringify(value) : String(value)] as [string,ReactNode]),
      ...(linked ? linked.rows : [["Record", `${humanize(row.entity_type)} #${row.entity_id}`]] as [string,ReactNode][]),
    ],
  };
}
const toneClasses = {rose:"border-rose-200 bg-rose-50 text-rose-800",amber:"border-amber-200 bg-amber-50 text-amber-800",emerald:"border-emerald-200 bg-emerald-50 text-emerald-800",slate:"border-slate-200 bg-slate-50 text-slate-700"};
function DetailModal({detail,onClose}:{detail:Detail;onClose:()=>void}) {
  useEffect(()=>{const onKey=(event:KeyboardEvent)=>{if(event.key==="Escape")onClose();};window.addEventListener("keydown",onKey);return()=>window.removeEventListener("keydown",onKey);},[onClose]);
  const rows=detail.rows.filter(([,value])=>value!==null&&value!==undefined&&value!=="");
  return <div role="dialog" aria-modal="true" aria-label={detail.title} className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs" onClick={onClose}><div className="max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-3xl border border-slate-200 bg-white p-5 shadow-2xl" onClick={event=>event.stopPropagation()}>
    <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3"><div><h2 className="text-lg font-black text-slate-900">{detail.title}</h2>{detail.subtitle&&<p className="text-xs text-slate-500">{detail.subtitle}</p>}</div><button type="button" autoFocus onClick={onClose} className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-black text-slate-700 hover:bg-slate-100">Close ✕</button></div>
    {detail.note&&<p className={`rounded-xl border p-3 text-sm font-bold ${toneClasses[detail.tone]}`}>{detail.note}</p>}
    <dl className="divide-y divide-slate-100 text-sm">{rows.map(([label,value],index)=><div key={`${label}-${index}`} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-3 py-2"><dt className="font-bold text-slate-500">{label}</dt><dd className="break-words text-slate-900">{value}</dd></div>)}</dl>
  </div></div>;
}
// Props that make a row or card open its details on click or Enter/Space.
const clickable = (open: () => void) => ({role:"button",tabIndex:0,onClick:open,onKeyDown:(event:ReactKeyboardEvent<HTMLElement>)=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();open();}}});
// Warning / Fine / Suspension decision used by the Purok Leader (and Admin).
function DecisionForm({busy,onSubmit}:{busy:boolean;onSubmit:(values:Record<string,unknown>)=>Promise<boolean|undefined>}) {
  const [action,setAction]=useState("warning");
  const [error,setError]=useState("");
  return <form noValidate className="space-y-2" onSubmit={event=>{
    event.preventDefault();const form=event.currentTarget;
    const values:Record<string,unknown>=Object.fromEntries(new FormData(form));
    const reason=String(values.reason||"").trim(),fine=Number(values.fineAmount),days=Number(values.suspensionDays);
    if(action==="fine"&&!(Number.isFinite(fine)&&fine>0)){setError("Enter a valid fine amount in pesos.");return;}
    if(action==="suspension"&&!(Number.isInteger(days)&&days>=1&&days<=3650)){setError("Enter suspension days from 1 to 3650.");return;}
    if(action==="suspension"&&!["collection","account"].includes(String(values.suspensionScope||""))){setError("Choose what to suspend.");return;}
    if(!reason){setError("Enter the reason for this decision.");return;}
    setError("");
    void onSubmit({...values,reason,action}).then(ok=>{if(ok){form.reset();setAction("warning");}});
  }}>
    <div className="flex flex-wrap gap-2" role="group" aria-label="Decision">{[["warning","Warning"],["fine","Fine (Pay Violation)"],["suspension","Suspend"]].map(([value,label])=><button key={value} type="button" aria-pressed={action===value} onClick={()=>{setAction(value);setError("");}} className={`rounded-xl border px-4 py-2 text-sm font-bold ${action===value?"border-emerald-700 bg-emerald-700 text-white":"border-slate-200 bg-white text-slate-700"}`}>{label}</button>)}</div>
    {action==="fine"&&<input name="fineAmount" type="number" min="0.01" step="0.01" aria-label="Fine amount in pesos" placeholder="Fine amount (PHP)" className={inputClass}/>}
    {action==="suspension"&&<div className="grid gap-2 sm:grid-cols-2"><input name="suspensionDays" type="number" min="1" max="3650" step="1" aria-label="Suspension days" placeholder="Number of days" className={inputClass}/><select name="suspensionScope" aria-label="What to suspend" className={inputClass}><option value="collection">Suspend garbage collection</option><option value="account">Suspend account access</option></select></div>}
    <textarea name="reason" maxLength={1000} aria-label="Reason" placeholder="Reason for this decision" className={inputClass}/>
    {error&&<p role="alert" className="text-sm font-bold text-rose-700">{error}</p>}
    <button disabled={busy} className="rounded-xl bg-emerald-700 px-4 py-3 font-bold text-white disabled:opacity-50">Save decision</button>
  </form>;
}

// Shared presentation pieces: first-load skeleton, styled collapsible, and a
// table that becomes stacked cards below md.
function RecordsSkeleton() {
  return <div aria-hidden="true" className="animate-pulse space-y-3">{[0,1,2].map(index=><div key={index} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="sg-skeleton h-4 w-1/3"/><div className="sg-skeleton mt-3 h-3 w-2/3"/><div className="sg-skeleton mt-2 h-3 w-1/2"/></div>)}</div>;
}
function Collapsible({title,icon,children,variant="card"}:{title:string;icon?:ReactNode;children:ReactNode;variant?:"card"|"inline"}) {
  const [open,setOpen]=useState(false);
  const id=useId();
  const card=variant==="card";
  return <section className={card?"rounded-2xl border border-slate-200 bg-white shadow-sm":""}>
    <button type="button" aria-expanded={open} aria-controls={id} onClick={()=>setOpen(value=>!value)} className={card?"flex w-full items-center justify-between gap-3 rounded-2xl px-4 py-3 text-left font-semibold text-slate-800 hover:bg-slate-50":"sg-btn-secondary"}>
      <span className="flex items-center gap-2">{icon}{title}</span>
      <ChevronDown aria-hidden="true" className={`h-4 w-4 shrink-0 text-slate-500 transition-transform ${open?"rotate-180":""}`}/>
    </button>
    {open&&<div id={id} className={card?"border-t border-slate-100 p-4":"mt-3"}>{children}</div>}
  </section>;
}
function ResponsiveTable({label,headers,rows,cells,onRow}:{label:string;headers:string[];rows:any[];cells:(row:any)=>ReactNode[];onRow?:(row:any)=>void}) {
  const rowProps=(row:any)=>onRow?clickable(()=>onRow(row)):{};
  return <>
    <div className="hidden overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm md:block"><table aria-label={label} className="w-full min-w-[640px] text-left text-sm"><thead className="bg-slate-50 text-xs font-semibold text-slate-500"><tr>{headers.map(header=><th key={header} scope="col" className="p-3">{header}</th>)}</tr></thead><tbody>{rows.map(row=><tr key={row.id} {...rowProps(row)} className={`border-t border-slate-100 ${onRow?"cursor-pointer hover:bg-slate-50 focus:bg-emerald-50 focus:outline-none":""}`}>{cells(row).map((value,index)=><td key={index} className="p-3">{value||"—"}</td>)}</tr>)}</tbody></table></div>
    <ul aria-label={label} className="space-y-3 md:hidden">{rows.map(row=>{const values=cells(row);return <li key={row.id} {...rowProps(row)} className={`rounded-2xl border border-slate-200 bg-white p-4 shadow-sm ${onRow?"cursor-pointer active:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-emerald-500":""}`}>
      <p className="text-xs text-slate-500">{values[0]}</p>
      <p className="mt-0.5 font-semibold text-slate-900">{values[1]||"—"}</p>
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">{headers.slice(2).map((header,index)=><div key={header} className="min-w-0"><dt className="text-xs text-slate-500">{header}</dt><dd className="break-words text-slate-800">{values[index+2]||"—"}</dd></div>)}</dl>
    </li>;})}</ul>
  </>;
}
const segregationBadge=(row:any)=><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${row.segregation==="segregated"?"bg-emerald-50 text-emerald-700":"bg-rose-50 text-rose-700"}`}>{row.segregation==="segregated"?"✓ Segregated":"✗ Not segregated"}</span>;
const collectionHeaders=["Date & time","QR / bin","Household","Collector","Segregation","Collection","Leader decision"];
const collectionCells=(row:any):ReactNode[]=>[date(row.collected_at),row.bin_code,row.household_name,row.collector_name,segregationBadge(row),row.collection_status==="collected"?"Collected":`Not collected${row.not_collected_reason?` · ${row.not_collected_reason}`:""}`,row.decision_action?decisionNames[row.decision_action]:row.segregation==="not_segregated"?"Waiting for leader":"None needed"];
const violationHeaders=["Date & time","Household","QR / bin","Decision","Reason","Issued by","Admin review"];
const violationCells=(row:any):ReactNode[]=>[date(row.issued_at),row.household_name,row.bin_code||"Direct decision",decisionText(row),row.reason,row.issued_by_name,row.review_decision?`${row.review_decision} · ${row.review_reason}`:"Not reviewed"];

type HistoryTab = "all" | "scans" | "payments" | "violations";

export default function SgmsRecords({view}: {view:RecordView}) {
  const {userRole}=useAppState();
  const [data,setData]=useState<any[]>([]), [puroks,setPuroks]=useState<any[]>([]), [bins,setBins]=useState<any[]>([]), [residents,setResidents]=useState<any[]>([]), [collections,setCollections]=useState<any[]>([]);
  const [allCollections,setAllCollections]=useState<any[]>([]), [paymentHistory,setPaymentHistory]=useState<any[]>([]), [violationHistory,setViolationHistory]=useState<any[]>([]);
  const [historyTab,setHistoryTab]=useState<HistoryTab>("all");
  const [myQrs,setMyQrs]=useState<any[]>([]);
  const [directResident,setDirectResident]=useState("");
  const [message,setMessage]=useState(""),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true);
  const [archive,setArchive]=useState<{entity:string;id:number;label:string}|null>(null);
  const [qrLabel,setQrLabel]=useState<HouseholdQrLabelData|null>(null), [rotatingHouseholdId,setRotatingHouseholdId]=useState<number|null>(null);
  const [suspensionScope,setSuspensionScope]=useState("");
  const [templateBody,setTemplateBody]=useState("");
  const [phase1,setPhase1]=useState(false);
  const [detail,setDetail]=useState<Detail|null>(null);
  useEffect(()=>{const controller=new AbortController();void apiRequest<{phase1Enabled:boolean}>("/sgms/config",{signal:controller.signal}).then(result=>{if(!controller.signal.aborted)setPhase1(result.phase1Enabled===true);}).catch(()=>undefined);return()=>controller.abort();},[]);
  const admin=userRole==="admin", leader=userRole==="leader", collector=userRole==="collector";
  async function load(silent=false) {
    if(!silent)setLoading(true);
    try {
      const paths:Record<RecordView,string>={households:"households",puroks:"puroks","collection-records":"collections",violations:"violations","activity-logs":"activity",archives:"archives","barangay-policies":"policies","payment-history":"payment-history"};
      const result=await apiRequest<any>(`/sgms/${paths[view]}`);
      const key=view==="activity-logs"?"activities":view==="collection-records"?"collections":view==="barangay-policies"?"policies":view==="payment-history"?"payments":view;
      setData(result[key]||[]);
      if(view==="households"&&userRole==="household") {
        const qrResult=await apiRequest<any>("/sgms/my-qr").catch(()=>({qrs:[]}));
        setMyQrs(qrResult.qrs||[]);
      }
      if(view==="households"&&(admin||leader)) {
        const results=await Promise.all([apiRequest<any>("/sgms/puroks"),apiRequest<any>("/garbage-bins")]);
        setPuroks(results[0].puroks||[]);setBins(results[1].bins||[]);
      }
      if((view==="violations"||view==="activity-logs")&&(admin||leader)) {
        const [colRes,hhRes,payRes,vioRes]=await Promise.allSettled([
          apiRequest<any>("/sgms/collections"),
          apiRequest<any>("/sgms/households"),
          collector?Promise.resolve({payments:[]}):apiRequest<any>("/sgms/payment-history"),
          collector?Promise.resolve({violations:[]}):apiRequest<any>("/sgms/violations"),
        ]);
        const cols=colRes.status==="fulfilled"?colRes.value.collections||[]:[];
        setAllCollections(cols);
        setCollections(cols.filter((row:any)=>row.segregation==="not_segregated"&&!row.decision_action));
        setResidents(hhRes.status==="fulfilled"?hhRes.value.households||[]:[]);
        setPaymentHistory(payRes.status==="fulfilled"?payRes.value.payments||[]:[]);
        setViolationHistory(vioRes.status==="fulfilled"?vioRes.value.violations||[]:[]);
      } else if (view==="activity-logs") {
        const [colRes,payRes,vioRes]=await Promise.allSettled([
          apiRequest<any>("/sgms/collections"),
          collector?Promise.resolve({payments:[]}):apiRequest<any>("/sgms/payment-history"),
          collector?Promise.resolve({violations:[]}):apiRequest<any>("/sgms/violations"),
        ]);
        setAllCollections(colRes.status==="fulfilled"?colRes.value.collections||[]:[]);
        setPaymentHistory(payRes.status==="fulfilled"?payRes.value.payments||[]:[]);
        setViolationHistory(vioRes.status==="fulfilled"?vioRes.value.violations||[]:[]);
      }
    }catch(error){setMessage(error instanceof Error?error.message:"Unable to load records.");setData([]);}
    finally{if(!silent)setLoading(false);}
  }
  useEffect(()=>{setMessage("");setQrLabel(null);setDetail(null);setTemplateBody("");setHistoryTab("all");void load();},[view]);
  // An activity log about a violation, payment or scan also shows that record's full details.
  function openActivity(row:any) {
    const id=Number(row.entity_id), match=(rows:any[])=>rows.find(item=>Number(item.id)===id);
    const violation=row.entity_type==="household_violations"?match(violationHistory):null, payment=row.entity_type==="payments"?match(paymentHistory):null, scan=row.entity_type==="household_collections"?match(allCollections):null;
    setDetail(activityLogDetail(row,violation?violationDetail(violation):payment?paymentDetail(payment):scan?collectionDetail(scan):null));
  }
  const openRow=(row:any)=>view==="violations"?setDetail(violationDetail(row)):view==="collection-records"?setDetail(collectionDetail(row)):view==="activity-logs"?openActivity(row):undefined;
  const cardClass="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-2 cursor-pointer hover:border-emerald-300 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-emerald-500";
  async function registerHouseholdBin(household:any) {
    const householdId=Number(household.id);
    if(rotatingHouseholdId!==null||busy)return;
    const fallbackBin=household.bins?.[0]?.id||bins.find(bin=>Number(bin.purok_id)===Number(household.purok_id)&&Number(bin.is_active)===1)?.id;
    setRotatingHouseholdId(householdId);setMessage("");
    try{
      const result=await apiRequest<any>(`/sgms/households/${householdId}/bin`,{method:"POST",body:JSON.stringify(fallbackBin?{binId:Number(fallbackBin)}:{})});
      setMessage(result.message||"Saved.");
      if(result.qrPayload)setQrLabel({payload:result.qrPayload,householdId:Number(result.householdId),binId:Number(result.binId),binCode:String(result.binCode)});
      await load(true);
    }catch(error){setMessage(error instanceof Error?error.message:"Unable to register bin QR.");}
    finally{setRotatingHouseholdId(null);}
  }
  async function mutate(path:string,body:any,method="POST") {
    if(busy)return;
    setBusy(true);setMessage("");
    if (/^\/sgms\/households\/\d+\/bin$/.test(path)) setQrLabel(null);
    try{const result=await apiRequest<any>(path,{method,body:JSON.stringify(body)});setMessage(result.message||"Saved.");if(result.qrPayload)setQrLabel({payload:result.qrPayload,householdId:Number(result.householdId),binId:Number(result.binId),binCode:String(result.binCode)});await load(true);return true;}
    catch(error){setMessage(error instanceof Error?error.message:"Unable to save.");return false;}
    finally{setBusy(false);}
  }
  const formData = (event: FormEvent<HTMLFormElement>): Record<string, FormDataEntryValue> => {
    event.preventDefault();
    const values: Record<string, FormDataEntryValue> = Object.fromEntries(new FormData(event.currentTarget));
    if (values.action === "suspension") values.suspensionScope = suspensionScope;
    return values;
  };
  const button=(label:string)=><button disabled={busy} className="rounded-xl bg-emerald-700 px-4 py-3 font-bold text-white disabled:opacity-50">{label}</button>;
  // Skeletons only on the first load; refreshes and silent reloads keep the current rows.
  const initialLoading=loading&&!data.length;
  const requestArchive=(entity:string,row:any,label?:string)=>setArchive({entity,id:Number(row.id),label:label||row.full_name||row.name||`#${row.id}`});
  return <div className="sg-page space-y-4"><header className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-black">{userRole==="collector"&&view==="collection-records"?"QR Bin Scanner":userRole==="collector"&&view==="activity-logs"?"Scan History":titles[view]}</h1><button type="button" disabled={loading} onClick={()=>void load()} className="sg-btn-secondary"><RefreshCw aria-hidden="true" className="h-4 w-4"/>Refresh</button></header>{message&&<p role="status" className="text-sm text-slate-600">{message}</p>}{initialLoading&&<><span role="status" className="sr-only">Loading records</span><RecordsSkeleton/></>}{!loading&&["violations","activity-logs","payment-history","collection-records"].includes(view)&&<p className="text-xs text-slate-500">Click any record to view its full details.</p>}
    {view==="collection-records"&&userRole==="collector"&&<QrCollection defaultOpen onSaved={()=>void load()} />}
    {view==="collection-records"&&admin&&phase1&&<CollectionRunRecovery onRecovered={()=>void load()} />}
    {view==="barangay-policies"&&admin&&<label className="block rounded-2xl border border-slate-200 bg-white p-4 shadow-sm text-sm">Scope specified by the approved suspension policy<select aria-label="Approved suspension scope" value={suspensionScope} onChange={event=>setSuspensionScope(event.target.value)} className={inputClass}><option value="">Choose only if recording a suspension policy</option><option value="collection">Collection service</option><option value="account">Account access</option></select></label>}
    {view==="barangay-policies"&&admin&&data.map(policy=><div key={policy.id} className="flex justify-between rounded-2xl border border-slate-200 bg-white p-3 shadow-sm"><span className="font-bold">{policy.title}</span><RecordActions label={policy.title} disabled={busy} onArchive={()=>requestArchive("policies",policy)}/></div>)}
    {(view==="violations"||view==="activity-logs")&&leader&&<section className="space-y-3"><h2 className="text-lg font-black">✗ Not Segregated QR Scans — Waiting for Leader Decision ({collections.length})</h2>{collections.length===0?<p className="rounded-2xl border border-dashed border-slate-200 bg-white p-4 text-sm text-slate-500">All scanned bins followed segregation or have already been decided.</p>:collections.map(row=><article key={row.id} className="space-y-3 rounded-2xl border border-rose-200 bg-white p-4 shadow-xs"><div><p className="font-black text-rose-800">QR {row.bin_code} · {row.household_name}</p><p className="text-xs text-slate-600">✗ Not segregated · scanned by {row.collector_name} · {date(row.collected_at)} · {row.purok_name}</p></div><DecisionForm busy={busy} onSubmit={values=>mutate("/sgms/violations",{...values,collectionId:row.id})}/></article>)}</section>}
    {(view==="violations"||view==="activity-logs")&&leader&&<Collapsible title="Warn, fine or suspend a resident directly" icon={<ShieldAlert aria-hidden="true" className="h-4 w-4 text-rose-600"/>}><div className="space-y-3"><select required value={directResident} onChange={event=>setDirectResident(event.target.value)} aria-label="Resident" className={inputClass}><option value="">Choose a resident</option>{residents.map(row=><option key={row.id} value={row.id}>HH-{row.id} · {row.full_name} · {row.purok_name}</option>)}</select><DecisionForm busy={busy} onSubmit={async values=>{if(!directResident){setMessage("Choose a resident first.");return false;}const ok=await mutate("/sgms/violations",{...values,residentId:Number(directResident)});if(ok)setDirectResident("");return ok;}}/></div></Collapsible>}
    {view==="activity-logs"&&<div className="flex flex-wrap gap-2">
      {([
        ["all", `All Activity Logs (${data.length})`],
        ["scans", `QR Scan Results (${allCollections.length})`],
        ["payments", `Payment History (${paymentHistory.length})`],
        ["violations", `Violations & Suspensions (${violationHistory.length})`],
      ] as [HistoryTab, string][]).filter(([tabId]) => userRole !== "collector" || tabId === "all" || tabId === "scans").map(([tabId, label]) => (
        <button
          key={tabId}
          type="button"
          onClick={() => setHistoryTab(tabId)}
          className={`rounded-xl border px-4 py-2 text-xs font-black transition ${
            historyTab === tabId
              ? "border-emerald-700 bg-emerald-700 text-white"
              : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
          }`}
        >
          {label}
        </button>
      ))}
    </div>}
    {view==="puroks"&&admin&&<form className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" onSubmit={event=>{const form=event.currentTarget;const values=formData(event);void mutate("/admin/puroks",{name:values.name,description:values.description}).then(ok=>{if(ok)form.reset();});}}><h2 className="font-bold">Create a purok</h2><input className={inputClass} name="name" aria-label="Purok name" placeholder="Purok name" required maxLength={100} /><input className={inputClass} name="description" aria-label="Description" placeholder="Description" maxLength={255}/>{button("Create purok")}</form>}
    {view==="households"&&admin&&<Collapsible title="Register Household" icon={<Plus aria-hidden="true" className="h-4 w-4 text-emerald-700"/>}><form className="grid gap-3 sm:grid-cols-2" onSubmit={event=>{const form=event.currentTarget;const values=formData(event);void mutate("/sgms/households",values).then(ok=>{if(ok)form.reset();});}}>{[["fullName","Account holder name"],["email","Email"],["phone","Mobile number"],["address","Address"]].map(([name,label])=><label key={name} className="text-sm">{label}<input required name={name} type={name==="email"?"email":"text"} className={inputClass}/></label>)}<select required name="purokId" aria-label="Household purok" className={inputClass}><option value="">Choose purok</option>{puroks.map(row=><option key={row.id} value={row.id}>{row.name}</option>)}</select>{button("Register and email setup link")}</form></Collapsible>}
    {view==="households"&&userRole==="household"&&<section className="space-y-3">{myQrs.length===0?<p className="rounded-2xl border border-dashed border-slate-200 bg-white p-4 text-sm text-slate-500">No bin QR yet. Ask your Barangay Captain or Purok Leader to register your bin QR.</p>:myQrs.map(qr=>qr.qrPayload?<HouseholdQrLabel key={qr.binId} owner label={{payload:qr.qrPayload,householdId:Number(qr.householdId),binId:Number(qr.binId),binCode:String(qr.binCode)}}/>:<p key={qr.binId} className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Bin {qr.binCode}: ask your Purok Leader to rotate the QR so it can be shown here.</p>)}</section>}
    {view==="households"&&<>{data.map(household=><article key={household.id} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-start justify-between gap-3"><div><h2 className="font-black">HH-{household.id} · {household.full_name}</h2><p className="text-sm text-slate-600">{household.purok_name} · {household.address} · {household.phone}</p></div>{admin&&<RecordActions label={household.full_name} disabled={busy} onArchive={()=>requestArchive("users",household)}/>}</div><p className="text-xs text-slate-600">Account status: {household.status}</p>{admin&&household.status==="pending_activation"&&<div className="space-y-2 rounded-xl bg-amber-50 p-3 text-sm"><p>The account holder must create a password using the emailed setup link before a bin can be registered.</p><button type="button" disabled={busy} onClick={()=>void mutate(`/account-setup/${household.id}/resend`,{})} className="sg-btn-secondary">Resend password setup link</button></div>}<h3 className="text-sm font-bold">Registered household members</h3>{household.members?.length?<ul className="space-y-2">{household.members.map((member:any)=><li key={member.id} className="flex items-center justify-between border-b pb-2 text-sm"><span>{member.full_name} · {member.relationship}</span>{admin&&<RecordActions label={member.full_name} disabled={busy} onArchive={()=>requestArchive("members",member)}/>}</li>)}</ul>:<p className="text-sm text-slate-500">No registered members.</p>}<p className="text-sm">Registered bins: {household.bins?.map((bin:any)=>bin.bin_code).join(", ")||"None"}</p>{admin&&<Collapsible variant="inline" title="Manage household" icon={<Settings2 aria-hidden="true" className="h-4 w-4"/>}><form className="space-y-2" onSubmit={event=>{const values=formData(event);void mutate(`/sgms/households/${household.id}`,values,"PATCH");}}><input required name="address" aria-label="Address" defaultValue={household.address||""} className={inputClass}/><input required name="phone" aria-label="Mobile number" defaultValue={household.phone||""} className={inputClass}/><select required name="purokId" aria-label="Purok" defaultValue={household.purok_id} className={inputClass}>{puroks.map(row=><option key={row.id} value={row.id}>{row.name}</option>)}</select>{button("Save household")}</form><form className="mt-3 space-y-2" onSubmit={event=>{const form=event.currentTarget;const values=formData(event);void mutate(`/sgms/households/${household.id}/members`,values).then(ok=>{if(ok)form.reset();});}}><input required name="fullName" aria-label="Member name" placeholder="Member name" maxLength={150} className={inputClass}/><input required name="relationship" aria-label="Relationship" placeholder="Relationship" maxLength={80} className={inputClass}/>{button("Add household member")}</form></Collapsible>}{(admin||leader)&&household.status==="active"&&<div className="flex flex-wrap items-center gap-2"><button type="button" disabled={rotatingHouseholdId===Number(household.id)} onClick={()=>void registerHouseholdBin(household)} className="rounded-xl bg-emerald-700 px-4 py-3 font-bold text-white disabled:opacity-50">{rotatingHouseholdId===Number(household.id)?"Generating QR...":"Generate / Rotate Household QR"}</button></div>}</article>)}</>}
    {qrLabel&&<div role="dialog" aria-modal="true" aria-label="Registered household bin QR modal" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs" onClick={()=>setQrLabel(null)}><div className="max-h-[90vh] w-full max-w-lg space-y-3 overflow-y-auto rounded-3xl border border-slate-200 bg-white p-5 shadow-2xl" onClick={event=>event.stopPropagation()}><div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3"><h2 className="text-lg font-black text-slate-900">Household Bin QR Code · HH-{qrLabel.householdId}</h2><button type="button" onClick={()=>setQrLabel(null)} className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-black text-slate-700 hover:bg-slate-100">Close ✕</button></div><HouseholdQrLabel label={qrLabel}/></div></div>}
    {view==="barangay-policies"&&admin&&<><form className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" onSubmit={event=>{const values=formData(event);void mutate("/sgms/policies",{...values,confirmApproved:values.confirmApproved==="on"});}}><h2 className="font-bold">Record a barangay ordinance / policy (reference)</h2><p className="text-xs text-slate-600">Optional reference for the barangay's segregation ordinance. Purok Leaders decide warnings, fines and suspensions directly in Violations.</p><input required name="title" aria-label="Policy title" placeholder="Policy title" maxLength={180} className={inputClass}/><input required name="officialReference" aria-label="Official policy reference" placeholder="Approved ordinance / policy reference" maxLength={255} className={inputClass}/><select required name="action" aria-label="Policy action" className={inputClass}><option value="warning">Warning</option><option value="fine">Fine</option><option value="suspension">Suspension</option></select><input name="fineAmount" aria-label="Approved fine amount" type="number" min="0.01" step="0.01" placeholder="Exact approved fine, if applicable" className={inputClass}/><input name="suspensionDays" aria-label="Approved suspension duration in days" type="number" min="1" step="1" placeholder="Approved suspension days, if applicable" className={inputClass}/><label className="flex gap-2 text-sm"><input required type="checkbox" name="confirmApproved"/>These are the exact officially approved policy terms.</label>{button("Record policy version")}</form><form className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" onSubmit={event=>{const values=formData(event);void mutate("/sgms/endorsement-templates",{...values,confirmApproved:values.confirmApproved==="on"});}}><h2 className="font-bold">Endorsement template</h2><p className="text-xs text-slate-600">Optional. Until a template is recorded here, released endorsements use the standard template and are filled in automatically with the resident's verified details.</p><button type="button" disabled={busy||Boolean(templateBody.trim())} onClick={()=>setTemplateBody(DRAFT_ENDORSEMENT_TEMPLATE)} className="sg-btn-secondary">Load editable DRAFT outline</button><p className="text-xs text-amber-800">The outline is not approved wording and cannot be saved for issuance until its draft markers and missing official details are replaced. This action does not save a template.</p><input required name="officialReference" aria-label="Template approval reference" placeholder="Official approval reference" maxLength={255} className={inputClass}/><textarea required name="body" aria-label="Approved template text" rows={10} maxLength={20000} value={templateBody} onChange={event=>setTemplateBody(event.target.value)} className={inputClass}/><p className="text-xs text-slate-500">Placeholders: {ENDORSEMENT_PLACEHOLDERS.map(key=>`{{${key}}}`).join(", ")}. Approved text is saved with each newly issued endorsement. Existing issued documents are never rewritten.</p><label className="flex gap-2 text-sm"><input required type="checkbox" name="confirmApproved"/>This template has official barangay approval.</label>{button("Record template version")}</form></>}
    {view==="puroks"&&data.map(row=><article key={row.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="font-bold">{row.name}</p>{admin&&<><form className="flex gap-2" onSubmit={event=>{const values=formData(event);void mutate(`/admin/puroks/${row.id}`,values,"PATCH");}}><input required name="name" aria-label={`Rename ${row.name}`} defaultValue={row.name} maxLength={100} className={inputClass}/>{button("Rename")}</form><RecordActions label={row.name} disabled={busy} onArchive={()=>requestArchive("puroks",row)}/></>}</article>)}
    {view==="archives"&&data.map(row=><article key={`${row.entity}-${row.id}`} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div><p className="font-bold">{row.label}</p><p className="text-xs text-slate-500">{row.entity} · archived by user #{row.archived_by} · {date(row.archived_at)}</p></div><button disabled={busy} onClick={()=>void mutate(`/sgms/archives/${row.entity}/${row.id}/restore`,{})} className="rounded-xl border border-emerald-300 p-3 font-bold text-emerald-700">Restore</button></article>)}
    {view==="violations"&&data.length>0&&<h2 className="pt-2 text-lg font-black">Decision history</h2>}
    {view==="activity-logs"&&historyTab==="scans"&&!initialLoading&&(allCollections.length===0?<p className="rounded-2xl border border-dashed border-slate-200 bg-white p-6 text-sm text-slate-500">No QR scan results yet.</p>:<ResponsiveTable label="QR scan results" headers={collectionHeaders} rows={allCollections} cells={collectionCells} onRow={row=>setDetail(collectionDetail(row))}/>)}
    {view==="activity-logs"&&historyTab==="payments"&&<div className="space-y-3">{paymentHistory.length===0?<p className="rounded-2xl border border-dashed border-slate-200 bg-white p-6 text-sm text-slate-500">No payment history records yet.</p>:paymentHistory.map(row=><article key={row.id} {...clickable(()=>setDetail(paymentDetail(row)))} className={cardClass}><p className="font-bold">{row.transaction_code} · {row.resident_name} · PHP {Number(row.amount).toFixed(2)}</p><p className="text-sm">{row.category} · {row.billing_period} · {row.payment_method} · <span className="font-bold">{row.status}</span>{row.archived_at?" · Archived":""}</p><p className="text-xs text-slate-600">Submitted {date(row.created_at)}{row.leader_verified_at?` · Verified by ${row.leader_name} at ${date(row.leader_verified_at)}`:""}</p>{row.leader_remarks&&<p className="text-sm">{row.leader_remarks}</p>}</article>)}</div>}
    {view==="activity-logs"&&historyTab==="violations"&&!initialLoading&&(violationHistory.length===0?<p className="rounded-2xl border border-dashed border-slate-200 bg-white p-6 text-sm text-slate-500">No violations or suspensions recorded.</p>:<ResponsiveTable label="Violations and suspensions" headers={violationHeaders} rows={violationHistory} cells={violationCells} onRow={row=>setDetail(violationDetail(row))}/>)}
    {(["collection-records","violations","barangay-policies"].includes(view)||(view==="activity-logs"&&historyTab==="all"))&&data.length>0&&<ResponsiveTable
      label={titles[view]}
      headers={view==="collection-records"?collectionHeaders:view==="violations"?violationHeaders:view==="activity-logs"?["Date & time","Who","Role","Activity","Details"]:["Policy","Action","Amount / days","Official reference","Approved at"]}
      rows={data}
      onRow={view==="barangay-policies"?undefined:openRow}
      cells={row=>view==="collection-records"?collectionCells(row):view==="violations"?violationCells(row):view==="activity-logs"?[date(row.occurred_at),row.actor_name,roleNames[row.actor_role]||row.actor_role,<span className="flex flex-wrap items-center gap-2">{activityLabels[row.action]||row.action.replaceAll("_"," ")}{row.action==="collection_not_segregated"&&(admin||leader)&&<button type="button" onClick={event=>{event.stopPropagation();window.scrollTo({top:0,behavior:"smooth"});}} onKeyDown={event=>event.stopPropagation()} className="rounded-lg border border-rose-300 px-2 py-1 text-xs font-semibold text-rose-700">Decide above ↑</button>}</span>,activityDetail(row)]:[row.title,row.action,row.fine_amount||row.suspension_days,row.official_reference,date(row.approved_at)]}
    />}
    {view==="payment-history"&&data.map(row=><article key={row.id} {...clickable(()=>setDetail(paymentDetail(row)))} className={cardClass}><p className="font-bold">{row.transaction_code} · {row.resident_name} · PHP {Number(row.amount).toFixed(2)}</p><p className="text-sm">{row.category} · {row.billing_period} · {row.payment_method} · {row.status}{row.archived_at?" · Archived":""}</p><p className="text-xs text-slate-600">Submitted {date(row.created_at)}{row.leader_verified_at?` · Reviewed by ${row.leader_name} at ${date(row.leader_verified_at)}`:""}</p>{row.leader_remarks&&<p className="text-sm">{row.leader_remarks}</p>}</article>)}
    {!loading&&!data.length&&view!=="activity-logs"&&<p className="rounded-2xl border border-dashed border-slate-200 bg-white p-6 text-sm text-slate-500">No records to display.</p>}
    {!loading&&view==="activity-logs"&&historyTab==="all"&&!data.length&&<p className="rounded-2xl border border-dashed border-slate-200 bg-white p-6 text-sm text-slate-500">No activity logs to display yet.</p>}
    {detail&&<DetailModal detail={detail} onClose={()=>setDetail(null)}/>}
    <ConfirmDialog open={Boolean(archive)} title="Archive record?" description={archive?`Archive ${archive.label}? Historical records and relationships are preserved. Active dependencies may prevent archiving.`:""} confirmLabel="Archive" busy={busy} destructive onCancel={()=>{if(!busy)setArchive(null);}} onConfirm={()=>{if(archive)void mutate(`/sgms/archives/${archive.entity}/${archive.id}`,{}).then(ok=>{if(ok)setArchive(null);});}}/>
  </div>;
}
