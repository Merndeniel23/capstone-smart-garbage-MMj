import { useEffect, useState } from "react";
import { apiRequest } from "../services/api";
import ConfirmDialog from "./ConfirmDialog";

type Purok = {id: number; name: string; assigned: number};
export default function CollectorPurokAssignment({collector, onClose, onSaved}: {
  collector: {id: number; full_name: string}; onClose: () => void; onSaved: (message: string) => void;
}) {
  const [puroks, setPuroks] = useState<Purok[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void apiRequest<{puroks: Purok[]}>(`/admin/collectors/${collector.id}/puroks`, {signal: controller.signal})
      .then(data => { if (!controller.signal.aborted) { setPuroks(data.puroks); setSelected(data.puroks.filter(p => Number(p.assigned) === 1).map(p => p.id)); setLoaded(true); } })
      .catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Unable to load assignments."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [collector.id]);
  async function save() {
    if (saving || loading || !loaded) return;
    setSaving(true); setError("");
    try {
      const result = await apiRequest<{message: string}>(`/admin/collectors/${collector.id}/puroks`, {method: "PUT", body: JSON.stringify({purokIds: selected})});
      onSaved(result.message);
    } catch (error) { setError(error instanceof Error ? error.message : "Unable to save assignments."); }
    finally { setSaving(false); }
  }
  return <ConfirmDialog open title={`Assigned Puroks: ${collector.full_name}`} confirmLabel="Save Puroks" busy={saving}
    onCancel={onClose} onConfirm={() => void save()} description={<div className="space-y-3">
      <p>Choose Puroks in your barangay. One Collector may cover multiple Puroks; the existing one-run-per-barangay/day rule is unchanged.</p>
      {loading && <p role="status">Loading assignments...</p>}
      {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-rose-700">{error}</p>}
      <fieldset disabled={saving || loading} className="max-h-64 space-y-2 overflow-y-auto"><legend className="font-bold">Authorized Puroks</legend>
        {puroks.map(purok => <label key={purok.id} className="flex items-center gap-3 rounded-lg border p-3"><input type="checkbox" checked={selected.includes(purok.id)} onChange={event => setSelected(previous => event.target.checked ? [...previous, purok.id] : previous.filter(id => id !== purok.id))}/>{purok.name}</label>)}
      </fieldset>
      <p>No selected Puroks means no collection access. Assignments cannot change while this Collector has an active run. Saving does not activate accounts or change roles.</p>
    </div>}/>;
}
