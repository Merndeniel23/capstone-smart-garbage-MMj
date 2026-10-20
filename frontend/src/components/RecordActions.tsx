import { MoreHorizontal } from "lucide-react";

export default function RecordActions({onArchive, disabled = false, label = "record"}: {onArchive: () => void; disabled?: boolean; label?: string}) {
  return <details onClick={event=>event.stopPropagation()} className="relative inline-block text-left"><summary aria-label={`More actions for ${label}`} className="inline-flex cursor-pointer list-none rounded-lg border border-slate-200 p-2 text-slate-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600"><MoreHorizontal className="h-4 w-4" /></summary><div className="mt-1 min-w-36 rounded-xl border border-slate-200 bg-white p-1 shadow-xl"><button type="button" disabled={disabled} onClick={event=>{event.currentTarget.closest("details")?.removeAttribute("open");onArchive();}} className="w-full rounded-lg px-3 py-2 text-left text-sm font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-50">Archive</button></div></details>;
}
