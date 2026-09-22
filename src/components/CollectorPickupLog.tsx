import { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  CheckCircle2,
  Clock3,
  History,
  Loader2,
  MapPin,
  RefreshCw,
  Search,
  Truck,
} from "lucide-react";
import Pagination, { DEFAULT_PAGE_SIZE } from "./Pagination";

type CollectionRunHistory = {
  id: number;
  collection_date: string;
  status: "pending" | "in_progress" | "completed" | "cancelled" | string;
  started_at?: string | null;
  completed_at?: string | null;
  notes?: string | null;
  barangay_name?: string | null;
  truck_code?: string | null;
  plate_number?: string | null;
};

function getToken(): string {
  return (
    localStorage.getItem("token") ||
    sessionStorage.getItem("token") ||
    localStorage.getItem("authToken") ||
    sessionStorage.getItem("authToken") ||
    ""
  );
}

function formatStatus(status?: string | null): string {
  return String(status || "pending")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value?: string | null): string {
  if (!value) return "No date";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateTime(value?: string | null): string {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function statusClasses(status?: string | null): string {
  switch (status) {
    case "completed":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "in_progress":
      return "bg-blue-50 text-blue-700 border-blue-200";
    case "cancelled":
      return "bg-rose-50 text-rose-700 border-rose-200";
    default:
      return "bg-amber-50 text-amber-700 border-amber-200";
  }
}

export default function CollectorPickupLog() {
  const [runs, setRuns] = useState<CollectionRunHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [expandedRunId, setExpandedRunId] = useState<number | null>(null);

  const loadHistory = async (manualRefresh = false) => {
    if (manualRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    setError("");

    try {
      const token = getToken();

      const response = await fetch("/api/collection-runs/history", {
        headers: token
          ? { Authorization: `Bearer ${token}` }
          : undefined,
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data.message || "Unable to load pickup history.",
        );
      }

      setRuns(Array.isArray(data.runs) ? data.runs : []);
    } catch (requestError) {
      console.error("Load collector pickup log error:", requestError);
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to load pickup history.",
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void loadHistory();
  }, []);

  const completedCount = useMemo(
    () => runs.filter((run) => run.status === "completed").length,
    [runs],
  );

  const inProgressCount = useMemo(
    () => runs.filter((run) => run.status === "in_progress").length,
    [runs],
  );

  const statusOptions = useMemo(
    () => Array.from(new Set(runs.map((run) => run.status))).sort(),
    [runs],
  );

  const filteredRuns = useMemo(() => {
    const query = search.trim().toLowerCase();

    return runs.filter((run) => {
      const matchesStatus = statusFilter === "all" || run.status === statusFilter;
      const matchesSearch = !query || [
        run.id,
        run.barangay_name,
        run.truck_code,
        run.plate_number,
        run.collection_date,
      ].some((value) => String(value || "").toLowerCase().includes(query));

      return matchesStatus && matchesSearch;
    });
  }, [runs, search, statusFilter]);

  const pageCount = Math.max(1, Math.ceil(filteredRuns.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const paginatedRuns = useMemo(
    () => filteredRuns.slice((safePage - 1) * pageSize, safePage * pageSize),
    [filteredRuns, pageSize, safePage],
  );

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter]);

  return (
    <div className="min-h-full bg-slate-50 px-5 py-8 md:px-8 lg:px-10">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.28em] text-emerald-600">
              Collection History
            </p>
            <h1 className="mt-1 text-3xl font-black tracking-tight text-slate-950">
              Pickup Log
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Actual municipal collection runs recorded under your collector account.
            </p>
          </div>

          <button
            type="button"
            onClick={() => void loadHistory(true)}
            disabled={refreshing}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-5 text-sm font-extrabold text-slate-700 shadow-sm transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw
              className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
            />
            Refresh
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
              Total Runs
            </p>
            <div className="mt-3 flex items-center justify-between">
              <span className="text-3xl font-black text-slate-950">{runs.length}</span>
              <div className="rounded-2xl bg-slate-100 p-3 text-slate-600">
                <History className="h-5 w-5" />
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
              Completed
            </p>
            <div className="mt-3 flex items-center justify-between">
              <span className="text-3xl font-black text-emerald-600">
                {completedCount}
              </span>
              <div className="rounded-2xl bg-emerald-50 p-3 text-emerald-600">
                <CheckCircle2 className="h-5 w-5" />
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
              In Progress
            </p>
            <div className="mt-3 flex items-center justify-between">
              <span className="text-3xl font-black text-blue-600">
                {inProgressCount}
              </span>
              <div className="rounded-2xl bg-blue-50 p-3 text-blue-600">
                <Truck className="h-5 w-5" />
              </div>
            </div>
          </div>
        </div>

        {error && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm font-bold text-rose-700">
            {error}
          </div>
        )}

        <section className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:grid-cols-[1fr_180px]" aria-label="Pickup history filters">
          <label className="text-xs font-bold text-slate-600">
            Search history
            <span className="relative mt-1 block">
              <Search aria-hidden="true" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Run, barangay, truck, or plate"
                className="min-h-10 w-full rounded-xl border border-slate-200 py-2 pl-9 pr-3 text-sm font-normal"
              />
            </span>
          </label>
          <label className="text-xs font-bold text-slate-600">
            Status
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="mt-1 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-normal"
            >
              <option value="all">All statuses</option>
              {statusOptions.map((status) => (
                <option key={status} value={status}>{formatStatus(status)}</option>
              ))}
            </select>
          </label>
        </section>

        <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-200 px-6 py-5">
            <div>
              <h2 className="text-lg font-black text-slate-950">
                Collection Run Records
              </h2>
              <p className="text-xs text-slate-500">
                Newest collection activity appears first.
              </p>
            </div>
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-emerald-700">
              {filteredRuns.length} record{filteredRuns.length === 1 ? "" : "s"}
            </span>
          </div>

          {loading ? (
            <div className="flex min-h-64 items-center justify-center gap-3 text-slate-500">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm font-bold">Loading pickup history...</span>
            </div>
          ) : filteredRuns.length === 0 ? (
            <div className="flex min-h-72 flex-col items-center justify-center px-6 text-center">
              <div className="rounded-3xl bg-slate-100 p-5 text-slate-400">
                <History className="h-9 w-9" />
              </div>
              <h3 className="mt-5 text-lg font-black text-slate-800">
                {runs.length === 0 ? "No collection runs recorded yet" : "No pickup runs match these filters"}
              </h3>
              <p className="mt-1 max-w-md text-sm text-slate-500">
                {runs.length === 0
                  ? "Start a scheduled barangay collection from Collection Tasks. Its run history will appear here automatically."
                  : "Try another status or clear the search phrase."}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-200">
              {paginatedRuns.map((run) => (
                <article
                  key={run.id}
                  className="grid gap-4 px-4 py-4 transition hover:bg-slate-50 lg:grid-cols-[1.2fr_1fr_1fr_auto] lg:items-center"
                >
                  <div className="flex items-start gap-4">
                    <div className="mt-0.5 rounded-2xl bg-emerald-50 p-3 text-emerald-600">
                      <Truck className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-black text-slate-950">
                          Collection Run #{run.id}
                        </h3>
                        <span
                          className={`rounded-full border px-2.5 py-1 text-[9px] font-black uppercase tracking-wider ${statusClasses(run.status)}`}
                        >
                          {formatStatus(run.status)}
                        </span>
                      </div>
                      <div className="mt-2 flex items-center gap-2 text-xs font-bold text-slate-500">
                        <MapPin className="h-3.5 w-3.5" />
                        {run.barangay_name || "Barangay not specified"}
                      </div>
                    </div>
                  </div>

                  <div>
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                      Collection Date
                    </p>
                    <div className="mt-2 flex items-center gap-2 text-sm font-extrabold text-slate-800">
                      <CalendarDays className="h-4 w-4 text-emerald-600" />
                      {formatDate(run.collection_date)}
                    </div>
                  </div>

                  <div>
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                      Assigned Truck
                    </p>
                    <p className="mt-2 text-sm font-black text-slate-800">
                      {run.truck_code || "No truck recorded"}
                    </p>
                    <p className="text-xs text-slate-500">
                      {run.plate_number || "No plate number"}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => setExpandedRunId(expandedRunId === run.id ? null : run.id)}
                    aria-expanded={expandedRunId === run.id}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-emerald-700 transition hover:bg-emerald-50"
                  >
                    {expandedRunId === run.id ? "Hide details" : "View details"}
                  </button>

                  {expandedRunId === run.id && (
                    <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600 sm:grid-cols-2 lg:col-span-4">
                      <div className="flex items-center gap-2 font-bold">
                        <Clock3 className="h-3.5 w-3.5" />
                        Started: {formatDateTime(run.started_at)}
                      </div>
                      <div className="flex items-center gap-2 font-bold">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Completed: {formatDateTime(run.completed_at)}
                      </div>
                      {run.notes && (
                        <p className="sm:col-span-2"><span className="font-black text-slate-700">Notes:</span>{" "}{run.notes}</p>
                      )}
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
          {!loading && filteredRuns.length > 0 && (
            <div className="px-6 pb-5">
              <Pagination
                page={safePage}
                pageSize={pageSize}
                totalItems={filteredRuns.length}
                onPageChange={setPage}
                onPageSizeChange={(nextPageSize) => {
                  setPageSize(nextPageSize);
                  setPage(1);
                }}
                compact
                itemLabel="pickup records"
              />
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
