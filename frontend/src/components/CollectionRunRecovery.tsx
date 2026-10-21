import { useEffect, useState } from "react";
import { apiRequest } from "../services/api";
import ConfirmDialog from "./ConfirmDialog";

type RecoverableRun = {id: number; collection_date: string; collector_name: string; overnight: number; missing_coverage: number};
export default function CollectionRunRecovery({onRecovered}: {onRecovered: () => void}) {
  const [runs, setRuns] = useState<RecoverableRun[]>([]);
  const [selected, setSelected] = useState<RecoverableRun | null>(null);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function load(signal?: AbortSignal) {
    try {
      const data = await apiRequest<{runs: RecoverableRun[]}>("/collection-runs/recovery", {signal});
      if (!signal?.aborted) setRuns(data.runs);
    } catch (error) { if (!signal?.aborted) setMessage(error instanceof Error ? error.message : "Unable to load recoverable runs."); }
  }
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, []);
  async function recover() {
    if (!selected || busy) return;
    if (!reason.trim()) { setMessage("Enter the reason for administrative recovery."); return; }
    setBusy(true); setMessage("");
    try {
      const result = await apiRequest<{message: string}>(`/collection-runs/${selected.id}/recover`, {method: "POST", body: JSON.stringify({reason: reason.trim()})});
      setMessage(result.message); setSelected(null); setReason(""); await load(); onRecovered();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to recover the run."); }
    finally { setBusy(false); }
  }
  return <section className="space-y-3 rounded-2xl border bg-white p-4">
    <div className="flex flex-wrap justify-between gap-3"><h2 className="font-bold">Administrative run recovery</h2><button type="button" disabled={busy} onClick={() => void load()} className="rounded-lg border px-3 py-2 text-sm">Refresh runs</button></div>
    <p className="text-sm">Only legacy runs without coverage or runs left active overnight are listed. Recovery closes a run as Cancelled, never Completed. Same-day replacement runs remain disallowed.</p>
    <p role="status" className="text-sm">{message}</p>
    {!runs.length && <p className="text-sm text-slate-500">No eligible runs loaded.</p>}
    {runs.map(run => <div key={run.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3"><p className="text-sm">#{run.id} - {run.collection_date} - {run.collector_name} ({Number(run.overnight) ? "overnight" : "legacy coverage missing"})</p><button type="button" disabled={busy} onClick={() => { setSelected(run); setReason(""); setMessage(""); }} className="rounded-xl border px-3 py-2 text-sm font-bold">Review recovery</button></div>)}
    <ConfirmDialog open={Boolean(selected)} title={`Close run #${selected?.id || ""} as Cancelled?`} confirmLabel="Record recovery" busy={busy} onCancel={() => setSelected(null)} onConfirm={() => void recover()} description={<div className="space-y-3"><p>No scans, results, bin states, requests or completion timestamps will be fabricated or reset. This action is audited and does not reopen the run.</p><label className="block font-bold">Recovery reason<textarea value={reason} onChange={event => setReason(event.target.value)} maxLength={1000} disabled={busy} className="mt-2 w-full rounded-xl border p-3"/></label>{message && <p role="alert">{message}</p>}</div>}/>
  </section>;
}
