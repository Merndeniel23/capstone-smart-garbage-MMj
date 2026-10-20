import { useEffect, useId, useRef, type ReactNode } from "react";
import { Loader2 } from "lucide-react";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  open, title, description, confirmLabel = "Confirm", cancelLabel = "Cancel",
  busy = false, destructive = false, onConfirm, onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = "hidden";
    cancelRef.current?.focus();
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      aria-busy={busy}
      onCancel={(event) => { event.preventDefault(); if (!busy) onCancel(); }}
      className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 text-slate-900 shadow-2xl backdrop:bg-slate-950/60"
    >
      <h2 id={titleId} className="text-xl font-black">{title}</h2>
      <div id={descriptionId} className="mt-3 text-sm leading-relaxed text-slate-600">{description}</div>
      <div className="mt-6 flex flex-wrap justify-end gap-3">
        <button ref={cancelRef} type="button" disabled={busy} onClick={onCancel} className="min-h-11 rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold disabled:opacity-50">{cancelLabel}</button>
        <button type="button" disabled={busy} onClick={onConfirm} className={`flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-bold text-white disabled:opacity-50 ${destructive ? "bg-rose-700 hover:bg-rose-800" : "bg-emerald-700 hover:bg-emerald-800"}`}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}{busy ? "Please wait…" : confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
