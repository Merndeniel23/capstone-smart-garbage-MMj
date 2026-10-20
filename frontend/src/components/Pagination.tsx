import { ChevronLeft, ChevronRight } from "lucide-react";

export const DEFAULT_PAGE_SIZE = 10;
export const PAGE_SIZE_OPTIONS = [10, 25, 50] as const;

interface PaginationProps {
  page: number;
  pageSize: number;
  totalItems: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  compact?: boolean;
  itemLabel?: string;
}

/**
 * Shared, client-side pagination for API lists that currently return a
 * reasonably sized complete data set. It keeps the API contract untouched.
 */
export default function Pagination({
  page,
  pageSize,
  totalItems,
  onPageChange,
  onPageSizeChange,
  compact = false,
  itemLabel = "records",
}: PaginationProps) {
  const pageCount = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(Math.max(1, page), pageCount);
  const firstItem = totalItems === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const lastItem = Math.min(safePage * pageSize, totalItems);
  const nearbyPages = Array.from(
    { length: Math.min(5, pageCount) },
    (_, index) => Math.max(1, Math.min(pageCount - 4, safePage - 2)) + index,
  );

  return (
    <nav
      aria-label={`${itemLabel} pagination`}
      className={`flex flex-col gap-3 border-t border-slate-100 pt-3 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between ${compact ? "mt-3" : "mt-4"}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span aria-live="polite">
          {totalItems === 0
            ? `No ${itemLabel}`
            : `${firstItem}–${lastItem} of ${totalItems} ${itemLabel}`}
        </span>
        <label className="flex items-center gap-1.5">
          <span className="sr-only">Items per page</span>
          <select
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            className="min-h-9 rounded-lg border border-slate-200 bg-white px-2 py-1 font-semibold text-slate-700"
            aria-label="Items per page"
          >
            {PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>{size} / page</option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex items-center gap-1" aria-label="Page controls">
        <button
          type="button"
          onClick={() => onPageChange(safePage - 1)}
          disabled={safePage <= 1}
          className="flex min-h-9 min-w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:border-emerald-300 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Previous page"
          title="Previous page"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        {nearbyPages.map((number) => (
          <button
            key={number}
            type="button"
            onClick={() => onPageChange(number)}
            aria-current={number === safePage ? "page" : undefined}
            aria-label={`Page ${number}`}
            className={`min-h-9 min-w-9 rounded-lg border px-2 font-bold transition ${
              number === safePage
                ? "border-emerald-700 bg-emerald-700 text-white"
                : "border-slate-200 bg-white text-slate-600 hover:border-emerald-300 hover:text-emerald-700"
            }`}
          >
            {number}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onPageChange(safePage + 1)}
          disabled={safePage >= pageCount}
          className="flex min-h-9 min-w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:border-emerald-300 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Next page"
          title="Next page"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </nav>
  );
}
