import { useEffect, useId, useRef, useState } from "react";
import { apiRequest } from "../services/api";
import { downloadEndorsement } from "../services/endorsementDownload";
import { printDocument } from "../services/printDocument";

type ApprovedDocument = { text: string; certificateNumber?: string; directPdfAvailable: boolean };

export default function ApprovedEndorsementDocument({ id, onClose, onLegacyCopy, viewOnly = false }: {
  id: number; onClose: () => void; onLegacyCopy: () => void; viewOnly?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const text = useRef<HTMLPreElement>(null);
  const heading = useId();
  const [document, setDocument] = useState<ApprovedDocument | null>(null);
  const [legacy, setLegacy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const element = dialog.current;
    const previousOverflow = window.document.body.style.overflow;
    element?.showModal();
    window.document.body.style.overflow = "hidden";
    return () => { element?.close(); window.document.body.style.overflow = previousOverflow; };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(""); setDocument(null); setLegacy(false);
    void apiRequest<{ document: ApprovedDocument | null; legacy?: boolean }>(`/sgms/endorsements/${id}/document`, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) { setDocument(result.document); setLegacy(result.legacy === true); } })
      .catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Unable to load the approved document."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id]);
  const action = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError("");
    try { await work(); }
    catch (error) { setError(error instanceof Error ? error.message : "Unable to prepare the document."); }
    finally { setBusy(false); }
  };
  return <dialog ref={dialog} aria-labelledby={heading} onCancel={event => { event.preventDefault(); onClose(); }} className="m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-3xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 text-slate-900 shadow-2xl backdrop:bg-slate-900/60 backdrop:backdrop-blur-sm">
    <div className="mb-4 flex items-center justify-between gap-3"><h2 id={heading} className="text-lg font-black">Approved endorsement #{id}</h2><button type="button" onClick={onClose} className="rounded-xl border px-3 py-2 font-bold">Close</button></div>
    {loading && <p role="status">Loading the approved document snapshot…</p>}
    {error && <p role="alert" className="mb-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
    {legacy && <div className="space-y-3"><p>This legacy approval has no saved document snapshot. No new official text will be fabricated.</p><button type="button" onClick={onLegacyCopy} className="rounded-xl border px-4 py-2 font-bold">Open existing legacy print copy</button></div>}
    {document && <>
      <p className="mb-3 text-xs text-slate-600">Saved at final approval. This view does not replace the text with a newer template or editable resident data.</p>
      <pre ref={text} dir="auto" className="whitespace-pre-wrap break-words rounded-xl border bg-white p-5 font-sans text-sm leading-relaxed" style={{ unicodeBidi: "plaintext" }}>{document.text}</pre>
      {!viewOnly && <div className="mt-4 flex flex-wrap gap-3"><button type="button" disabled={busy} onClick={() => void action(async () => { if (text.current) await printDocument(`Endorsement ${document.certificateNumber || id}`, text.current); })} className="rounded-xl bg-emerald-700 px-4 py-3 font-bold text-white disabled:opacity-50">Print / Save as PDF</button>{document.directPdfAvailable && <button type="button" disabled={busy} onClick={() => void action(() => downloadEndorsement(id))} className="rounded-xl border px-4 py-3 font-bold disabled:opacity-50">Download PDF</button>}</div>}
      {!viewOnly && !document.directPdfAvailable && <p className="mt-3 text-sm text-slate-600">This document contains Unicode text. Use Print / Save as PDF and check the preview for correct characters. The direct PDF generator will not replace names or unsupported characters.</p>}
    </>}
  </dialog>;
}
