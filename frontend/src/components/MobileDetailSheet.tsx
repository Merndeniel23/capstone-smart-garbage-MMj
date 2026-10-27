import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

interface MobileDetailSheetProps {
  /** True when a record is selected. */
  open: boolean;
  onClose: () => void;
  title?: string;
  /** Extra classes for the wrapper (e.g. grid placement on desktop). */
  className?: string;
  children: ReactNode;
}

/**
 * Detail column of a master-detail view.
 * - lg and up: renders in normal flow, exactly as before.
 * - below lg: hidden until a record is selected, then shown as a slide-up
 *   sheet over the list, so the list/queue is what mobile users see first.
 */
export default function MobileDetailSheet({ open, onClose, title = "Details", className = "", children }: MobileDetailSheetProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && window.matchMedia("(max-width: 1023px)").matches) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <>
      {open && (
        <button
          type="button"
          aria-label="Close details"
          onClick={onClose}
          className="fixed inset-0 z-[45] bg-slate-950/50 lg:hidden"
        />
      )}
      <div
        className={`${
          open
            ? "fixed inset-x-0 bottom-0 z-50 max-h-[88dvh] overflow-y-auto rounded-t-3xl bg-white pb-[env(safe-area-inset-bottom)] shadow-2xl lg:static lg:z-auto lg:max-h-none lg:overflow-visible lg:rounded-none lg:bg-transparent lg:pb-0 lg:shadow-none"
            : "hidden lg:block"
        } ${className}`}
        role={open ? "dialog" : undefined}
        aria-label={open ? title : undefined}
      >
        {open && (
          <div className="sticky top-0 z-10 border-b border-slate-200 bg-white px-4 pb-3 pt-2 lg:hidden">
            <span aria-hidden="true" className="mx-auto mb-2 block h-1 w-10 rounded-full bg-slate-300" />
            <div className="flex items-center justify-between gap-3">
              <p className="truncate text-sm font-semibold text-slate-800">{title}</p>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close details"
                className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>
        )}
        {children}
      </div>
    </>
  );
}
