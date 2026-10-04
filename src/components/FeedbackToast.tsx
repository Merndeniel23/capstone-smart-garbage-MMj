import { useEffect, useRef } from "react";
import { CheckCircle2, X } from "lucide-react";

/** Visible confirmation even when a long form or detail panel is scrolled. */
export default function FeedbackToast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  const dismissRef = useRef(onDismiss);
  useEffect(() => { dismissRef.current = onDismiss; }, [onDismiss]);
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => dismissRef.current(), 8000);
    return () => window.clearTimeout(timer);
  }, [message]);

  if (!message) return null;
  return (
    <div role="status" className="fixed bottom-24 left-4 right-4 z-50 flex items-start gap-3 rounded-2xl border border-emerald-300 bg-emerald-50 p-4 text-emerald-800 shadow-xl md:bottom-6 md:left-auto md:right-24 md:max-w-md">
      <CheckCircle2 aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
      <p className="flex-1 text-sm font-semibold">{message}</p>
      <button
        type="button"
        aria-label="Dismiss notification"
        title="Dismiss notification"
        onClick={onDismiss}
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border !border-emerald-200 !bg-emerald-100 !text-emerald-700 transition hover:!bg-emerald-200 hover:!text-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-400/40"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
