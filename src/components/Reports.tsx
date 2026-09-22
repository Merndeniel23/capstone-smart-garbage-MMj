import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  FileText,
  Loader2,
  Printer,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UserCog,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

interface ReportsSummary {
  barangays: number;
  captains: number;
  leaders: number;
  collectors: number;
  residents: number;
  activeUsers: number;
  pendingComplaints: number;
  resolvedComplaints: number;
  garbageBins: number;
}

interface ReportsResponse {
  success: boolean;
  generatedAt: string;
  scope: "municipality" | "barangay";
  barangayId: number | null;
  summary: ReportsSummary;
  message?: string;
}

const API_BASE = "/api";

function getToken() {
  return (
    localStorage.getItem("token") ||
    sessionStorage.getItem("token") ||
    ""
  );
}

function formatDate(value: string) {
  if (!value) return "Not available";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-PH", {
    dateStyle: "long",
    timeStyle: "short",
  }).format(date);
}

export default function Reports() {
  const [report, setReport] = useState<ReportsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadReport = useCallback(async () => {
    const token = getToken();

    if (!token) {
      setError("Login session is missing. Please sign in again.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");

    try {
      const response = await fetch(`${API_BASE}/admin/reports/summary`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = (await response.json().catch(() => ({}))) as ReportsResponse;

      if (!response.ok) {
        throw new Error(data.message || "Unable to generate report.");
      }

      setReport(data);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to generate report.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  const cards = useMemo(() => {
    const summary = report?.summary;

    return [
      {
        label: "Barangays",
        value: summary?.barangays ?? 0,
        icon: Building2,
      },
      {
        label: "Barangay Captains",
        value: summary?.captains ?? 0,
        icon: UserCog,
      },
      {
        label: "Purok Leaders",
        value: summary?.leaders ?? 0,
        icon: Users,
      },
      {
        label: "Collectors",
        value: summary?.collectors ?? 0,
        icon: Users,
      },
      {
        label: "Residents",
        value: summary?.residents ?? 0,
        icon: Users,
      },
      {
        label: "Active Users",
        value: summary?.activeUsers ?? 0,
        icon: ShieldCheck,
      },
      {
        label: "Pending Complaints",
        value: summary?.pendingComplaints ?? 0,
        icon: AlertTriangle,
      },
      {
        label: "Resolved Complaints",
        value: summary?.resolvedComplaints ?? 0,
        icon: CheckCircle2,
      },
      {
        label: "Garbage Bins",
        value: summary?.garbageBins ?? 0,
        icon: Trash2,
      },
    ];
  }, [report]);

  const exportPdf = () => {
    window.print();
  };

  if (loading) {
    return (
      <div className="flex min-h-[500px] items-center justify-center">
        <div className="text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-emerald-700" />
          <p className="mt-3 text-sm font-bold text-slate-500">
            Generating report...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="sg-page space-y-5 pb-20 md:pb-0">
      <style>
        {`
          @media print {
            body {
              background: white !important;
            }

            .no-print {
              display: none !important;
            }

            .print-report {
              box-shadow: none !important;
              border: none !important;
            }

            .print-card {
              break-inside: avoid;
            }
          }
        `}
      </style>

      <header className="sg-list-toolbar no-print flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-emerald-600">
            Smart Garbage Monitoring System
          </p>

          <h1 className="text-3xl font-black tracking-tight text-slate-900">
            Reports
          </h1>

          <p className="mt-1 text-sm text-slate-500">
            Generate, review, print, and save municipal or barangay summaries.
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={() => void loadReport()}
            className="flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 shadow-sm transition hover:border-emerald-300"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>

          <button
            type="button"
            onClick={() => window.print()}
            className="flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 shadow-sm transition hover:border-emerald-300"
          >
            <Printer className="h-4 w-4" />
            Print
          </button>

          <button
            type="button"
            onClick={exportPdf}
            className="flex min-h-10 items-center justify-center gap-2 rounded-xl bg-emerald-700 px-3 py-2 text-xs font-black text-white shadow-sm transition hover:bg-emerald-800"
          >
            <FileText className="h-4 w-4" />
            Export PDF
          </button>
        </div>
      </header>

      {error && (
        <div className="no-print flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-700">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="text-sm font-black">{error}</p>
            <button
              type="button"
              onClick={() => void loadReport()}
              className="mt-2 text-xs font-black uppercase tracking-wide underline"
            >
              Try Again
            </button>
          </div>
        </div>
      )}

      {report && (
        <section className="print-report overflow-hidden rounded-[1.5rem] border border-slate-100 bg-white shadow-sm">
          <div className="border-b border-slate-100 bg-gradient-to-r from-slate-900 to-emerald-900 p-5 text-white md:p-6">
            <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-300">
                  Official Summary Report
                </p>

                <h2 className="mt-1 text-2xl font-black">
                  {report.scope === "municipality"
                    ? "Municipality-wide Report"
                    : "Barangay Report"}
                </h2>

                <p className="mt-2 text-sm text-slate-300">
                  Generated on {formatDate(report.generatedAt)}
                </p>
              </div>

              <div className="rounded-xl border border-white/10 bg-white/10 px-4 py-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-300">
                  Scope
                </p>
                <p className="mt-1 text-sm font-black text-emerald-300">
                  {report.scope === "municipality"
                    ? "MUNICIPAL"
                    : `BARANGAY ${report.barangayId ?? ""}`}
                </p>
              </div>
            </div>
          </div>

          <div className="p-5 md:p-6">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {cards.map((card) => (
                <article
                  key={card.label}
                  className="print-card rounded-xl border border-slate-100 bg-slate-50 p-4"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                        {card.label}
                      </p>
                      <p className="mt-1.5 text-2xl font-black text-slate-900">
                        {card.value}
                      </p>
                    </div>

                    <div className="rounded-xl bg-white p-2.5 text-emerald-700 shadow-sm">
                      <card.icon className="h-5 w-5" />
                    </div>
                  </div>
                </article>
              ))}
            </div>

            <div className="mt-6 rounded-xl border border-emerald-100 bg-emerald-50 p-4">
              <h3 className="text-sm font-black text-emerald-900">
                Report Notes
              </h3>
              <p className="mt-2 text-xs leading-relaxed text-emerald-800">
                This report is generated from the current Smart Garbage Monitoring
                System database. Counts reflect the selected municipal or barangay
                scope at the time of generation.
              </p>
            </div>

            <div className="mt-8 grid gap-6 text-center text-xs text-slate-500 sm:grid-cols-2">
              <div>
                <div className="mx-auto mb-2 h-px max-w-xs bg-slate-300" />
                Municipal Administrator / Barangay Captain
              </div>

              <div>
                <div className="mx-auto mb-2 h-px max-w-xs bg-slate-300" />
                Date Signed
              </div>
            </div>
          </div>
        </section>
      )}

      <div className="no-print rounded-2xl border border-blue-200 bg-blue-50 p-4 text-xs leading-relaxed text-blue-800">
        To save as PDF, click <strong>Export PDF</strong>, then choose
        <strong> Save as PDF</strong> in the browser print window.
      </div>
    </div>
  );
}
