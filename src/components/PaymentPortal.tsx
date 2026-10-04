import { PAYMENT_CATEGORY_LABELS, type PaymentCategoryOption } from "../../shared/paymentCategories";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  CreditCard,
  Download,
  Eye,
  FileImage,
  Filter,
  Loader2,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { notifyAdminActionCountsChanged } from "../hooks/useAdminActionCounts";
import FeedbackToast from "./FeedbackToast";
import ConfirmDialog from "./ConfirmDialog";

interface PaymentPortalProps {
  role?:
    | "household"
    | "collector"
    | "leader"
    | "admin"
    | "super_admin";
}

type PaymentStatus =
  | "pending_leader_verification"
  | "rejected_by_leader"
  | "pending_remittance"
  | "pending_admin_confirmation"
  | "discrepancy"
  | "completed";

interface PaymentRecord {
  id: number;
  transaction_code: string;
  resident_name: string;
  resident_email: string;
  barangay_name: string;
  purok_name: string;
  category:
    | "weekly_fee"
    | "special_heavy_trash"
    | "hazardous_disposal";
  billing_period: string;
  amount: number | string;
  payment_method:
    | "gcash"
    | "maya"
    | "over_the_counter";
  payment_reference: string;
  receipt_proof: string;
  status: PaymentStatus;
  leader_name?: string | null;
  leader_verified_at?: string | null;
  leader_remarks?: string | null;
  remittance_reference?: string | null;
  remittance_proof?: string | null;
  remitted_at?: string | null;
  admin_name?: string | null;
  admin_confirmed_at?: string | null;
  admin_remarks?: string | null;
  discrepancy_amount?: number | string | null;
  created_at: string;
}

interface ContributionSummaryRow {
  scope_id: number;
  scope_name: string;
  parent_name: string | null;
  total_records: number;
  completed_records: number;
  pending_records: number;
  to_confirm_records: number;
  rejected_records: number;
  discrepancy_records: number;
  confirmed_contribution: number;
  pending_contribution: number;
  to_confirm_amount: number;
}

interface WeeklyFeeInfo {
  amount: number;
  effective_from: string | null;
  uses_default: boolean;
}

interface PaymentReminder {
  current_weekly_fee: number;
  last_completed_payment_at: string | null;
  last_completed_amount: number | null;
  missed_payment_count: number;
  outstanding_balance: number;
  counting_from: string;
  missed_periods: Array<{
    due_date: string;
    fee: number;
  }>;
}

function token() {
  return (
    localStorage.getItem("token") ||
    localStorage.getItem("authToken") ||
    sessionStorage.getItem("token") ||
    sessionStorage.getItem("authToken") ||
    ""
  );
}

async function apiRequest(
  endpoint: string,
  options: RequestInit = {},
) {
  const response = await fetch(
    `/api/payments${endpoint}`,
    {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token()}`,
        ...(options.headers || {}),
      },
    },
  );

  const data = await response
    .json()
    .catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      data.message || "Request failed.",
    );
  }

  return data;
}

function imageToDataUrl(
  file: File,
): Promise<string> {
  return new Promise(
    (resolve, reject) => {
      if (
        !file.type.startsWith("image/")
      ) {
        reject(
          new Error(
            "Please select an image file.",
          ),
        );
        return;
      }

      if (file.size > 3_500_000) {
        reject(
          new Error(
            "Image must be smaller than 3.5 MB.",
          ),
        );
        return;
      }

      const reader = new FileReader();

      reader.onload = () =>
        resolve(String(reader.result));

      reader.onerror = () =>
        reject(
          new Error(
            "Unable to read the image.",
          ),
        );

      reader.readAsDataURL(file);
    },
  );
}

function categoryLabel(
  category: PaymentRecord["category"],
) {
  return (
    PAYMENT_CATEGORY_LABELS[category] || category
  );
}

function methodLabel(
  method: PaymentRecord["payment_method"],
) {
  if (method === "gcash") {
    return "GCash";
  }

  if (method === "maya") {
    return "Maya";
  }

  return "Over-the-Counter";
}

function statusLabel(
  status: PaymentStatus,
) {
  const labels: Record<
    PaymentStatus,
    string
  > = {
    pending_leader_verification:
      "Pending Leader Verification",
    rejected_by_leader:
      "Rejected by Leader",
    pending_remittance:
      "Pending Remittance",
    pending_admin_confirmation:
      "Pending Admin Confirmation",
    discrepancy:
      "Remittance Discrepancy",
    completed: "Completed",
  };

  return labels[status];
}

function statusClasses(
  status: PaymentStatus,
) {
  if (status === "completed") {
    return "border-emerald-500/40 bg-emerald-500/10 text-emerald-600";
  }

  if (
    status === "rejected_by_leader" ||
    status === "discrepancy"
  ) {
    return "border-rose-500/40 bg-rose-500/10 text-rose-600";
  }

  return "border-amber-500/40 bg-amber-500/10 text-amber-600";
}

export default function PaymentPortal({
  role = "household",
}: PaymentPortalProps) {
  const [CATEGORY_OPTIONS, setCategoryOptions] = useState<PaymentCategoryOption[]>([]);
  const [payments, setPayments] =
    useState<PaymentRecord[]>([]);
  const [contributionSummary, setContributionSummary] =
    useState<ContributionSummaryRow[]>([]);
  const [viewMode, setViewMode] =
    useState<
      "resident_payments" |
      "barangay_summary" |
      "purok_summary"
    >("resident_payments");
  const [weeklyFee, setWeeklyFee] =
    useState<WeeklyFeeInfo | null>(null);
  const [paymentReminder, setPaymentReminder] =
    useState<PaymentReminder | null>(null);
  const [editingWeeklyFee, setEditingWeeklyFee] =
    useState(false);
  const [weeklyFeeInput, setWeeklyFeeInput] =
    useState("");

  const [loading, setLoading] =
    useState(true);

  const [submitting, setSubmitting] =
    useState(false);

  const [message, setMessage] =
    useState<{
      type: "success" | "error";
      text: string;
    } | null>(null);

  const [search, setSearch] =
    useState("");

  const [statusFilter, setStatusFilter] =
    useState<"all" | PaymentStatus>("all");

  const [paymentPage, setPaymentPage] =
    useState(1);
  const [paymentPageSize, setPaymentPageSize] =
    useState(10);
  const [selectedPayment, setSelectedPayment] = useState<number | null>(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [barangayFilter, setBarangayFilter] = useState("");
  const [purokFilter, setPurokFilter] = useState("");
  const [paymentToDelete, setPaymentToDelete] = useState<PaymentRecord | null>(null);
  const [deletingPayment, setDeletingPayment] = useState(false);

  const [showPaymentForm, setShowPaymentForm] =
    useState(false);

  const [showImage, setShowImage] =
    useState<string | null>(null);

  const [category, setCategory] =
    useState<
      PaymentRecord["category"]
    >("weekly_fee");

  const [amount, setAmount] =
    useState("");

  const [billingPeriod, setBillingPeriod] =
    useState(
      new Date().toLocaleDateString(
        "en-US",
        {
          month: "long",
          year: "numeric",
        },
      ),
    );

  const [method, setMethod] =
    useState<
      PaymentRecord["payment_method"]
    >("gcash");

  const [reference, setReference] =
    useState("");

  const [receiptProof, setReceiptProof] =
    useState("");

  const [reviewRemarks, setReviewRemarks] =
    useState("");

  const [remittanceReference, setRemittanceReference] =
    useState("");

  const [remittanceProof, setRemittanceProof] =
    useState("");

  const [discrepancyAmount, setDiscrepancyAmount] =
    useState("");

  useEffect(() => {
    setAmount(String(CATEGORY_OPTIONS.find(item => item.value === category)?.amount ?? ''));
  }, [CATEGORY_OPTIONS, category]);

  const isResident = role === "household";
  const isLeader = role === "leader";
  const isSuperAdmin =
    role === "super_admin";
  const isBarangayAdmin =
    role === "admin";
  const isAdmin =
    isBarangayAdmin ||
    isSuperAdmin;

  const isSummaryView =
    viewMode === "barangay_summary" ||
    viewMode === "purok_summary";

  const filteredContributionSummary =
    useMemo(() => {
      const query =
        search.trim().toLowerCase();

      if (!query) {
        return contributionSummary;
      }

      return contributionSummary.filter(
        (row) =>
          [
            row.scope_name,
            row.parent_name,
            String(row.confirmed_contribution),
            String(row.pending_contribution),
          ].some((value) =>
            String(value || "")
              .toLowerCase()
              .includes(query),
          ),
      );
    }, [
      contributionSummary,
      search,
    ]);

  const summaryTotals =
    useMemo(
      () =>
        contributionSummary.reduce(
          (totals, row) => ({
            records:
              totals.records +
              Number(row.total_records || 0),
            completed:
              totals.completed +
              Number(row.completed_records || 0),
            pending:
              totals.pending +
              Number(row.pending_records || 0),
            confirmedAmount:
              totals.confirmedAmount +
              Number(
                row.confirmed_contribution || 0,
              ),
            pendingAmount:
              totals.pendingAmount +
              Number(
                row.pending_contribution || 0,
              ),
          }),
          {
            records: 0,
            completed: 0,
            pending: 0,
            confirmedAmount: 0,
            pendingAmount: 0,
          },
        ),
      [contributionSummary],
    );

  const loadPayments = async () => {
    setLoading(true);

    try {
      const data =
        await apiRequest("/");

      setCategoryOptions(
        Array.isArray(data.categories)
          ? data.categories
          : [],
      );
      setPayments(
        Array.isArray(data.payments)
          ? data.payments
          : [],
      );
      setContributionSummary(
        Array.isArray(data.contributionSummary)
          ? data.contributionSummary
          : [],
      );
      setViewMode(
        data.viewMode === "barangay_summary" ||
        data.viewMode === "purok_summary"
          ? data.viewMode
          : "resident_payments",
      );
      setWeeklyFee(
        data.weeklyFee || null,
      );
      setPaymentReminder(
        data.paymentReminder ||
          null,
      );

      if (
        data.weeklyFee?.amount !==
        undefined
      ) {
        setWeeklyFeeInput(
          String(
            data.weeklyFee.amount,
          ),
        );
      }
    } catch (error) {
      setMessage({
        type: "error",
        text:
          error instanceof Error
            ? error.message
            : "Unable to load payments.",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadPayments();
  }, [role]);

  const barangayOptions = useMemo(() => {
    const values = payments
      .map((payment) => payment.barangay_name)
      .filter(
        (value): value is string =>
          typeof value === "string" &&
          value.trim().length > 0,
      );

    return Array.from(
      new Set<string>(values),
    ).sort((a, b) => a.localeCompare(b));
  }, [payments]);

  const purokOptions = useMemo(() => {
    const values = payments
      .filter(
        (payment) =>
          !barangayFilter ||
          payment.barangay_name === barangayFilter,
      )
      .map((payment) => payment.purok_name)
      .filter(
        (value): value is string =>
          typeof value === "string" &&
          value.trim().length > 0,
      );

    return Array.from(
      new Set<string>(values),
    ).sort((a, b) => a.localeCompare(b));
  }, [barangayFilter, payments]);

  const filteredPayments =
    useMemo(() => {
      const query =
        search.trim().toLowerCase();

      return payments.filter((payment) => {
        const created = new Date(payment.created_at);
        const day = [created.getFullYear(), String(created.getMonth() + 1).padStart(2, "0"), String(created.getDate()).padStart(2, "0")].join("-");
        if ((dateFrom && day < dateFrom) || (dateTo && day > dateTo)) return false;
        if (
          barangayFilter &&
          payment.barangay_name !== barangayFilter
        ) return false;
        if (
          purokFilter &&
          payment.purok_name !== purokFilter
        ) return false;

        const matchesStatus =
          statusFilter === "all" ||
          payment.status === statusFilter;

        if (!matchesStatus) {
          return false;
        }

        if (!query) {
          return true;
        }

        return [
          payment.transaction_code,
          String(payment.amount),
          payment.resident_name,
          payment.payment_reference,
          payment.purok_name,
          payment.barangay_name,
          statusLabel(payment.status),
        ].some((value) =>
          String(value || "")
            .toLowerCase()
            .includes(query),
        );
      });
    }, [
      payments,
      search,
      statusFilter,
      dateFrom,
      dateTo,
      barangayFilter,
      purokFilter,
    ]);

  const paymentPageCount = Math.max(
    1,
    Math.ceil(
      filteredPayments.length / paymentPageSize,
    ),
  );

  const visiblePayments = useMemo(() => {
    const safePage = Math.min(
      paymentPage,
      paymentPageCount,
    );
    const start =
      (safePage - 1) * paymentPageSize;

    return filteredPayments.slice(
      start,
      start + paymentPageSize,
    );
  }, [
    filteredPayments,
    paymentPage,
    paymentPageSize,
    paymentPageCount,
  ]);

  useEffect(() => {
    setPaymentPage(1);
  }, [
    search,
    statusFilter,
    dateFrom,
    dateTo,
    barangayFilter,
    purokFilter,
  ]);

  useEffect(() => {
    if (paymentPage > paymentPageCount) {
      setPaymentPage(paymentPageCount);
    }
  }, [paymentPage, paymentPageCount]);

  useEffect(() => {
    if (
      purokFilter &&
      !purokOptions.includes(purokFilter)
    ) {
      setPurokFilter("");
    }
  }, [purokFilter, purokOptions]);

  const completedTotal = payments
    .filter(
      (payment) =>
        payment.status === "completed",
    )
    .reduce(
      (total, payment) =>
        total + Number(payment.amount),
      0,
    );

  const pendingTotal = payments
    .filter(
      (payment) =>
        payment.status !== "completed" &&
        payment.status !==
          "rejected_by_leader",
    )
    .reduce(
      (total, payment) =>
        total + Number(payment.amount),
      0,
    );

  const resetForm = () => {
    setReference("");
    setReceiptProof("");
    setReviewRemarks("");
    setRemittanceReference("");
    setRemittanceProof("");
    setDiscrepancyAmount("");
  };

  const submitPayment = async (
    event: React.FormEvent,
  ) => {
    event.preventDefault();

    setMessage(null);

    const enteredAmount = Number(amount);

    if (
      !Number.isFinite(enteredAmount) ||
      enteredAmount <= 0
    ) {
      setMessage({
        type: "error",
        text: "Enter a valid payment amount greater than PHP 0.00.",
      });
      return;
    }

    setSubmitting(true);

    try {
      const data = await apiRequest(
        "/",
        {
          method: "POST",
          body: JSON.stringify({
            category,
            billingPeriod,
            amount: enteredAmount,
            paymentMethod: method,
            paymentReference:
              reference.trim(),
            receiptProof,
          }),
        },
      );

      setMessage({
        type: "success",
        text:
          data.message ||
          "Payment submitted successfully.",
      });

      setShowPaymentForm(false);
      resetForm();
      await loadPayments();
      notifyAdminActionCountsChanged();
    } catch (error) {
      setMessage({
        type: "error",
        text:
          error instanceof Error
            ? error.message
            : "Unable to submit payment.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const leaderReview = async (
    paymentId: number,
    action: "approve" | "reject",
  ) => {
    setSubmitting(true);
    setMessage(null);

    try {
      const data = await apiRequest(
        `/${paymentId}/leader-review`,
        {
          method: "PATCH",
          body: JSON.stringify({
            action,
            remarks:
              reviewRemarks.trim(),
          }),
        },
      );

      setMessage({
        type: "success",
        text: data.message,
      });

      setReviewRemarks("");
      await loadPayments();
      notifyAdminActionCountsChanged();
    } catch (error) {
      setMessage({
        type: "error",
        text:
          error instanceof Error
            ? error.message
            : "Unable to review payment.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const submitRemittance = async (
    paymentId: number,
  ) => {
    setSubmitting(true);
    setMessage(null);

    try {
      const data = await apiRequest(
        `/${paymentId}/remit`,
        {
          method: "PATCH",
          body: JSON.stringify({
            remittanceReference:
              remittanceReference.trim(),
            remittanceProof,
          }),
        },
      );

      setMessage({
        type: "success",
        text: data.message,
      });

      setRemittanceReference("");
      setRemittanceProof("");
      await loadPayments();
      notifyAdminActionCountsChanged();
    } catch (error) {
      setMessage({
        type: "error",
        text:
          error instanceof Error
            ? error.message
            : "Unable to submit remittance.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const adminReview = async (
    paymentId: number,
    action:
      | "confirm"
      | "discrepancy",
  ) => {
    setSubmitting(true);
    setMessage(null);

    try {
      const data = await apiRequest(
        `/${paymentId}/admin-review`,
        {
          method: "PATCH",
          body: JSON.stringify({
            action,
            remarks:
              reviewRemarks.trim(),
            discrepancyAmount:
              Number(
                discrepancyAmount,
              ),
          }),
        },
      );

      setMessage({
        type: "success",
        text: data.message,
      });

      setReviewRemarks("");
      setDiscrepancyAmount("");
      await loadPayments();
      notifyAdminActionCountsChanged();
    } catch (error) {
      setMessage({
        type: "error",
        text:
          error instanceof Error
            ? error.message
            : "Unable to review remittance.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const saveWeeklyFee = async (
    event: React.FormEvent,
  ) => {
    event.preventDefault();

    const enteredFee =
      Number(weeklyFeeInput);

    if (
      !Number.isFinite(enteredFee) ||
      enteredFee <= 0
    ) {
      setMessage({
        type: "error",
        text:
          "Enter a valid weekly pickup fee greater than PHP 0.00.",
      });
      return;
    }

    setSubmitting(true);
    setMessage(null);

    try {
      const data =
        await apiRequest(
          "/weekly-fee",
          {
            method: "PATCH",
            body: JSON.stringify({
              amount: enteredFee,
            }),
          },
        );

      setMessage({
        type: "success",
        text:
          data.message ||
          "Weekly pickup fee updated.",
      });

      setEditingWeeklyFee(false);
      await loadPayments();
    } catch (error) {
      setMessage({
        type: "error",
        text:
          error instanceof Error
            ? error.message
            : "Unable to update the weekly pickup fee.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleImage = async (
    file: File | undefined,
    target:
      | "receipt"
      | "remittance",
  ) => {
    if (!file) {
      return;
    }

    try {
      const dataUrl =
        await imageToDataUrl(file);

      if (target === "receipt") {
        setReceiptProof(dataUrl);
      } else {
        setRemittanceProof(dataUrl);
      }
    } catch (error) {
      setMessage({
        type: "error",
        text:
          error instanceof Error
            ? error.message
            : "Unable to load image.",
      });
    }
  };

  const confirmPurokRemittance = async (
    purokId: number,
  ) => {
    if (!isBarangayAdmin || submitting) {
      return;
    }

    setSubmitting(true);
    setMessage(null);

    try {
      const data = await apiRequest(
        `/summary/purok/${purokId}/confirm`,
        {
          method: "PATCH",
          body: JSON.stringify({}),
        },
      );

      setMessage({
        type: "success",
        text:
          data.message ||
          "Purok remittance confirmed.",
      });

      await loadPayments();
      notifyAdminActionCountsChanged();
    } catch (error) {
      setMessage({
        type: "error",
        text:
          error instanceof Error
            ? error.message
            : "Unable to confirm the Purok remittance.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const deletePaymentRecord = async () => {
    if (!isSuperAdmin || !paymentToDelete || deletingPayment) {
      return;
    }

    setDeletingPayment(true);
    setMessage(null);

    try {
      const data = await apiRequest(
        `/${paymentToDelete.id}`,
        { method: "DELETE" },
      );

      setMessage({
        type: "success",
        text:
          data.message ||
          "Payment record deleted successfully.",
      });

      if (selectedPayment === paymentToDelete.id) {
        setSelectedPayment(null);
      }

      setPaymentToDelete(null);
      await loadPayments();
      notifyAdminActionCountsChanged();
    } catch (error) {
      setMessage({
        type: "error",
        text:
          error instanceof Error
            ? error.message
            : "Unable to delete the payment record.",
      });
      setPaymentToDelete(null);
    } finally {
      setDeletingPayment(false);
    }
  };

  return (
    <div className="sg-page space-y-4">
      <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <span className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-600">
            Smart Garbage Monitoring System
          </span>

          <h1 className="mt-1 text-2xl font-black text-slate-900">
            {isResident
              ? "My Payments"
              : isLeader
                ? "Resident Payments"
                : isSuperAdmin
                  ? "Barangay Payment Contributions"
                  : "Purok Payment Contributions"}
          </h1>

          <p className="mt-1 text-xs font-medium text-slate-500">
            {isSuperAdmin
              ? "View confirmed and pending payment contributions summarized per barangay."
              : isBarangayAdmin
                ? "View payment contributions summarized per purok without exposing resident-level payment records."
                : isLeader
                  ? "Review resident payments from your assigned purok."
                  : "Track your submitted, verified, remitted, and completed payments."}
          </p>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() =>
              void loadPayments()
            }
            disabled={loading}
            className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs font-black text-slate-700"
          >
            <RefreshCw
              className={`h-4 w-4 ${
                loading
                  ? "animate-spin"
                  : ""
              }`}
            />
            Refresh
          </button>

          {isResident && (
            <button
              type="button"
              onClick={() =>
                setShowPaymentForm(true)
              }
              className="flex items-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3 text-xs font-black uppercase text-white"
            >
              <CreditCard className="h-4 w-4" />
              Submit Payment
            </button>
          )}
        </div>
      </header>

      {message?.type === "success" && (
        <FeedbackToast message={message.text} onDismiss={() => setMessage(null)} />
      )}

      {message?.type === "error" && (
        <div
          role="alert"
          className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm font-bold text-rose-700"
        >
          {message.text}
        </div>
      )}

      {isResident && paymentReminder && (
        <section className="sg-payment-reminder-card rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-amber-700">
                Weekly Pickup Payment Reminder
              </p>
              <h2 className="mt-1 text-lg font-black text-slate-900">
                {paymentReminder.missed_payment_count > 0
                  ? `${paymentReminder.missed_payment_count} missed ${
                      paymentReminder.missed_payment_count === 1
                        ? "payment"
                        : "payments"
                    }`
                  : "Your weekly pickup payment is up to date"}
              </h2>
              <p className="mt-1 text-xs font-medium text-slate-600">
                {paymentReminder.last_completed_payment_at
                  ? `Last completed weekly payment: ${new Date(
                      paymentReminder.last_completed_payment_at,
                    ).toLocaleDateString()}`
                  : `No completed weekly payment yet. Counting from ${new Date(
                      `${paymentReminder.counting_from}T00:00:00`,
                    ).toLocaleDateString()}.`}
              </p>
              <p className="mt-1 text-[11px] text-slate-500">
                Only completed weekly payments reset the missed-payment counter.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-amber-200 bg-white px-4 py-3">
                <p className="text-[9px] font-black uppercase text-slate-400">
                  Weekly Fee
                </p>
                <p className="mt-1 text-lg font-black text-slate-900">
                  ₱{Number(
                    paymentReminder.current_weekly_fee,
                  ).toFixed(2)}
                </p>
              </div>

              <div className="rounded-xl border border-amber-200 bg-white px-4 py-3">
                <p className="text-[9px] font-black uppercase text-slate-400">
                  Missed
                </p>
                <p className="mt-1 text-lg font-black text-amber-700">
                  {paymentReminder.missed_payment_count}
                </p>
              </div>

              <div className="col-span-2 rounded-xl border border-amber-200 bg-white px-4 py-3 sm:col-span-1">
                <p className="text-[9px] font-black uppercase text-slate-400">
                  Outstanding
                </p>
                <p className="mt-1 text-lg font-black text-rose-600">
                  ₱{Number(
                    paymentReminder.outstanding_balance,
                  ).toFixed(2)}
                </p>
              </div>
            </div>
          </div>
        </section>
      )}

      {isLeader && weeklyFee && (
        <section className="sg-weekly-fee-card rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-700">
                Purok Weekly Pickup Fee
              </p>
              <h2 className="mt-1 text-xl font-black text-slate-900">
                ₱{Number(
                  weeklyFee.amount,
                ).toFixed(2)} / week
              </h2>
              <p className="mt-1 text-xs font-medium text-slate-600">
                This fee applies to residents assigned to your purok.
                {weeklyFee.effective_from
                  ? ` Current rate effective ${new Date(
                      `${String(weeklyFee.effective_from).slice(0, 10)}T00:00:00`,
                    ).toLocaleDateString()}.`
                  : " The system default rate is currently being used."}
              </p>
              <p className="mt-1 text-[11px] text-slate-500">
                Changing the rate today keeps previous fee history unchanged.
              </p>
            </div>

            {!editingWeeklyFee ? (
              <button
                type="button"
                onClick={() => {
                  setWeeklyFeeInput(
                    String(
                      weeklyFee.amount,
                    ),
                  );
                  setEditingWeeklyFee(true);
                }}
                className="rounded-xl bg-emerald-600 px-5 py-3 text-xs font-black uppercase text-white"
              >
                Edit Weekly Fee
              </button>
            ) : (
              <form
                onSubmit={saveWeeklyFee}
                className="flex flex-col gap-2 sm:flex-row sm:items-end"
              >
                <label className="text-[10px] font-black uppercase tracking-wider text-slate-600">
                  Weekly fee
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={weeklyFeeInput}
                    onChange={(event) =>
                      setWeeklyFeeInput(
                        event.target.value,
                      )
                    }
                    className="mt-1 block min-h-11 w-40 rounded-xl border border-emerald-200 bg-white px-3 py-2 text-sm font-bold text-slate-900"
                    required
                  />
                </label>

                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={submitting}
                    className="min-h-11 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-black uppercase text-white disabled:opacity-50"
                  >
                    Save Fee
                  </button>
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => {
                      setEditingWeeklyFee(false);
                      setWeeklyFeeInput(
                        String(
                          weeklyFee.amount,
                        ),
                      );
                    }}
                    className="min-h-11 rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-black uppercase text-slate-600"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        </section>
      )}

      {isSummaryView ? (
        <>
          <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <Metric
              label={
                isSuperAdmin
                  ? "Barangays"
                  : "Puroks"
              }
              icon={CreditCard}
              tone="bg-blue-500/10 text-blue-500"
              value={String(
                contributionSummary.length,
              )}
            />
            <Metric
              label="Payment records"
              icon={CheckCircle2}
              tone="bg-emerald-500/10 text-emerald-500"
              value={String(
                summaryTotals.records,
              )}
            />
            <Metric
              label="Completed"
              icon={CheckCircle2}
              tone="bg-emerald-500/10 text-emerald-500"
              value={String(
                summaryTotals.completed,
              )}
            />
            <Metric
              label="Pending"
              icon={Clock3}
              tone="bg-amber-500/10 text-amber-500"
              value={String(
                summaryTotals.pending,
              )}
            />
          </section>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-[10px] font-black uppercase tracking-wider text-emerald-700">
                Confirmed Contributions
              </p>
              <p className="mt-1 text-2xl font-black text-slate-900">
                ₱{summaryTotals.confirmedAmount.toFixed(2)}
              </p>
            </div>

            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <p className="text-[10px] font-black uppercase tracking-wider text-amber-700">
                Pending Accountability
              </p>
              <p className="mt-1 text-2xl font-black text-slate-900">
                ₱{summaryTotals.pendingAmount.toFixed(2)}
              </p>
            </div>
          </div>

          <section
            aria-label="Contribution summary filters"
            className="sg-list-toolbar flex flex-wrap items-center gap-2"
          >
            <div className="relative min-w-[220px] flex-1">
              <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                aria-label={
                  isSuperAdmin
                    ? "Search barangay contributions"
                    : "Search purok contributions"
                }
                onChange={(event) =>
                  setSearch(event.target.value)
                }
                placeholder={
                  isSuperAdmin
                    ? "Search barangay..."
                    : "Search purok..."
                }
                className="w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-11 pr-4 text-xs outline-none focus:border-emerald-500"
              />
            </div>

            <button
              type="button"
              onClick={() => setSearch("")}
              className="h-10 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-500"
            >
              Clear
            </button>

            <button
              type="button"
              disabled={!filteredContributionSummary.length}
              onClick={() => {
                const cell = (value: unknown) =>
                  '"' +
                  String(value ?? "")
                    .replace(
                      /^[\s]*[=+@-]/,
                      "'$&",
                    )
                    .replace(/"/g, '""') +
                  '"';

                const rows = [
                  [
                    isSuperAdmin
                      ? "Barangay"
                      : "Purok",
                    "Payment Records",
                    "Completed Records",
                    "Pending Records",
                    "Confirmed Contribution (PHP)",
                    "Pending Accountability (PHP)",
                    "Awaiting Captain Confirmation",
                  ],
                  ...filteredContributionSummary.map(
                    (row) => [
                      row.scope_name,
                      row.total_records,
                      row.completed_records,
                      row.pending_records,
                      row.confirmed_contribution,
                      row.pending_contribution,
                      row.to_confirm_records,
                    ],
                  ),
                ];

                const url =
                  URL.createObjectURL(
                    new Blob(
                      [
                        "\uFEFF" +
                          rows
                            .map((row) =>
                              row
                                .map(cell)
                                .join(","),
                            )
                            .join("\r\n"),
                      ],
                      {
                        type:
                          "text/csv;charset=utf-8",
                      },
                    ),
                  );

                const link =
                  document.createElement("a");

                link.href = url;
                link.download =
                  isSuperAdmin
                    ? "barangay-contributions.csv"
                    : "purok-contributions.csv";
                link.click();

                setTimeout(
                  () =>
                    URL.revokeObjectURL(
                      url,
                    ),
                  1000,
                );
              }}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-emerald-500 px-3 text-xs font-bold text-emerald-600 disabled:opacity-40"
            >
              <Download className="h-4 w-4" />
              Export CSV
            </button>
          </section>

          {loading ? (
            <div className="flex min-h-[260px] items-center justify-center rounded-2xl border border-slate-200 bg-white">
              <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
            </div>
          ) : (
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[800px] text-left text-xs">
                  <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-3 font-black">
                        {isSuperAdmin
                          ? "Barangay"
                          : "Purok"}
                      </th>
                      <th className="px-4 py-3 text-center font-black">
                        Records
                      </th>
                      <th className="px-4 py-3 text-center font-black">
                        Completed
                      </th>
                      <th className="px-4 py-3 text-center font-black">
                        Pending
                      </th>
                      <th className="px-4 py-3 text-right font-black">
                        Confirmed Contribution
                      </th>
                      <th className="px-4 py-3 text-right font-black">
                        Pending Accountability
                      </th>
                      {isBarangayAdmin && (
                        <th className="px-4 py-3 text-center font-black">
                          Action
                        </th>
                      )}
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-slate-100">
                    {filteredContributionSummary.map(
                      (row) => (
                        <tr
                          key={row.scope_id}
                          className="transition hover:bg-emerald-500/5"
                        >
                          <td className="px-4 py-4">
                            <p className="font-black text-slate-900">
                              {row.scope_name}
                            </p>
                            {row.parent_name && (
                              <p className="mt-0.5 text-[10px] font-semibold text-slate-400">
                                {row.parent_name}
                              </p>
                            )}
                          </td>

                          <td className="px-4 py-4 text-center font-bold text-slate-600">
                            {row.total_records}
                          </td>

                          <td className="px-4 py-4 text-center font-black text-emerald-600">
                            {row.completed_records}
                          </td>

                          <td className="px-4 py-4 text-center">
                            <span className="font-black text-amber-600">
                              {row.pending_records}
                            </span>
                            {row.discrepancy_records > 0 && (
                              <span className="ml-1 text-[9px] font-black text-rose-600">
                                + {row.discrepancy_records} issue
                                {row.discrepancy_records === 1
                                  ? ""
                                  : "s"}
                              </span>
                            )}
                          </td>

                          <td className="px-4 py-4 text-right font-black tabular-nums text-emerald-600">
                            ₱{Number(
                              row.confirmed_contribution,
                            ).toFixed(2)}
                          </td>

                          <td className="px-4 py-4 text-right">
                            <p className="font-black tabular-nums text-amber-600">
                              ₱{Number(
                                row.pending_contribution,
                              ).toFixed(2)}
                            </p>
                            {row.to_confirm_records > 0 && (
                              <p className="mt-0.5 text-[9px] font-bold text-slate-400">
                                {row.to_confirm_records} waiting for captain confirmation
                              </p>
                            )}
                          </td>

                          {isBarangayAdmin && (
                            <td className="px-4 py-4 text-center">
                              <button
                                type="button"
                                disabled={
                                  submitting ||
                                  row.to_confirm_records <= 0
                                }
                                onClick={() =>
                                  void confirmPurokRemittance(
                                    row.scope_id,
                                  )
                                }
                                className="rounded-lg bg-emerald-600 px-3 py-2 text-[10px] font-black uppercase text-white disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                {row.to_confirm_records > 0
                                  ? `Confirm ${row.to_confirm_records}`
                                  : "Nothing to confirm"}
                              </button>
                            </td>
                          )}
                        </tr>
                      ),
                    )}

                    {filteredContributionSummary.length === 0 && (
                      <tr>
                        <td
                          colSpan={
                            isBarangayAdmin
                              ? 7
                              : 6
                          }
                          className="px-4 py-10 text-center text-sm font-bold text-slate-400"
                        >
                          No contribution summary matches your search.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <p className="text-[11px] font-semibold text-slate-500">
            {isSuperAdmin
              ? "Municipal Administrator sees barangay totals only. Resident-level payment details remain hidden."
              : "Barangay Captain sees purok totals only. Resident-level payment details are handled by the assigned Purok Leader."}
          </p>
        </>
      ) : (
        <>
      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Metric
          label="Total records"
          icon={CreditCard}
          tone="bg-blue-500/10 text-blue-500"
          value={String(payments.length)}
        />
        <Metric
          label="Completed"
          icon={CheckCircle2}
          tone="bg-emerald-500/10 text-emerald-500"
          value={String(payments.filter(p => p.status === "completed").length)}
        />
        <Metric
          label="Pending"
          icon={Clock3}
          tone="bg-amber-500/10 text-amber-500"
          value={String(payments.filter(p => p.status.startsWith("pending_")).length)}
        />
        <Metric icon={AlertTriangle} tone="bg-rose-500/10 text-rose-500" label="Rejected / discrepancy" value={String(payments.filter(p => ["rejected_by_leader", "discrepancy"].includes(p.status)).length)} />
      </section>
      <p className="text-xs text-slate-500">Confirmed collections: PHP {completedTotal.toFixed(2)} · Pending accountability: PHP {pendingTotal.toFixed(2)}</p>

      <section
        aria-label="Payment filters"
        className="sg-list-toolbar flex flex-wrap items-center gap-2"
      >
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            aria-label="Search payments"
            onChange={(event) =>
              setSearch(event.target.value)
            }
            placeholder="Search transaction, resident, reference, purok or amount..."
            className="w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-11 pr-4 text-xs outline-none focus:border-emerald-500"
          />
        </div>

        {isSuperAdmin && (
          <select
            value={barangayFilter}
            onChange={(event) => {
              setBarangayFilter(event.target.value);
              setPurokFilter("");
            }}
            aria-label="Filter payments by barangay"
            className="h-10 min-w-[165px] rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600"
          >
            <option value="">All barangays</option>
            {barangayOptions.map((barangay) => (
              <option key={barangay} value={barangay}>
                {barangay}
              </option>
            ))}
          </select>
        )}

        {(isSuperAdmin || isBarangayAdmin) && (
          <select
            value={purokFilter}
            onChange={(event) =>
              setPurokFilter(event.target.value)
            }
            aria-label="Filter payments by purok"
            className="h-10 min-w-[145px] rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600"
          >
            <option value="">All puroks</option>
            {purokOptions.map((purok) => (
              <option key={purok} value={purok}>
                {purok}
              </option>
            ))}
          </select>
        )}

        <div className="relative min-w-[180px]">
          <Filter className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <select
            value={statusFilter}
            onChange={(event) =>
              setStatusFilter(
                event.target.value as
                  | "all"
                  | PaymentStatus,
              )
            }
            className="w-full appearance-none rounded-lg border border-slate-200 bg-white py-2.5 pl-11 pr-4 text-xs font-bold text-slate-600 outline-none focus:border-emerald-500"
          >
            <option value="all">All payment statuses</option>
            <option value="pending_leader_verification">
              Pending leader verification
            </option>
            <option value="pending_remittance">
              Pending remittance
            </option>
            <option value="pending_admin_confirmation">
              Pending admin confirmation
            </option>
            <option value="discrepancy">
              Remittance discrepancy
            </option>
            <option value="rejected_by_leader">
              Rejected by leader
            </option>
            <option value="completed">Completed</option>
          </select>
        </div>

        <label className="text-[10px] font-semibold text-slate-500">
          <span className="sr-only">From</span>
          <input
            type="date"
            value={dateFrom}
            max={dateTo || undefined}
            onChange={(event) => setDateFrom(event.target.value)}
            className="block h-10 w-[125px] rounded-lg border border-slate-200 bg-white px-2 py-2 text-slate-700"
          />
        </label>

        <label className="text-[10px] font-semibold text-slate-500">
          <span className="sr-only">To</span>
          <input
            type="date"
            value={dateTo}
            min={dateFrom || undefined}
            onChange={(event) => setDateTo(event.target.value)}
            className="block h-10 w-[125px] rounded-lg border border-slate-200 bg-white px-2 py-2 text-slate-700"
          />
        </label>

        <button
          type="button"
          onClick={() => {
            setSearch("");
            setStatusFilter("all");
            setDateFrom("");
            setDateTo("");
            setBarangayFilter("");
            setPurokFilter("");
          }}
          className="h-10 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-500"
        >
          Clear
        </button>
      </section>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2" aria-label="Payment status filters">
          {(["all", "pending_leader_verification", "pending_remittance", "pending_admin_confirmation", "completed", "rejected_by_leader", "discrepancy"] as const).map(status => <button key={status} type="button" aria-pressed={statusFilter === status} onClick={() => setStatusFilter(status)} className={`rounded-full border px-3 py-2 text-[10px] font-semibold transition ${statusFilter === status ? "border-emerald-500 bg-emerald-500/15 text-emerald-600" : "border-slate-200 text-slate-500 hover:border-emerald-500"}`}>{status === "all" ? "All" : ({pending_leader_verification:"To verify",pending_remittance:"To remit",pending_admin_confirmation:"To confirm",completed:"Completed",rejected_by_leader:"Rejected",discrepancy:"Discrepancy"}[status])} ({payments.filter(p => status === "all" || p.status === status).length.toLocaleString()})</button>)}
        </div>
        <button type="button" disabled={!filteredPayments.length} onClick={() => {
          const cell = (value: unknown) => '"' + String(value ?? "").replace(/^[\s]*[=+@-]/, "'$&").replace(/"/g, '""') + '"';
          const rows = [["Date", "Transaction", "Resident", "Barangay", "Purok", "Category", "Amount (PHP)", "Status"], ...filteredPayments.map(p => [p.created_at,p.transaction_code,p.resident_name,p.barangay_name,p.purok_name,categoryLabel(p.category),p.amount,statusLabel(p.status)])];
          const url = URL.createObjectURL(new Blob(["\uFEFF" + rows.map(row => row.map(cell).join(",")).join("\r\n")], {type:"text/csv;charset=utf-8"}));
          const link = document.createElement("a"); link.href=url; link.download="payments.csv"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        }} className="inline-flex items-center gap-2 rounded-lg border border-emerald-500 px-3 py-2 text-xs font-bold text-emerald-600 disabled:opacity-40"><Download className="h-4 w-4" />Export CSV</button>
      </div>

      {loading ? (
        <div className="flex min-h-[300px] items-center justify-center rounded-[2rem] border bg-white">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
        </div>
      ) : (
        <div className="space-y-1">
          <div className="sg-desktop-table overflow-hidden rounded-xl border border-slate-200 bg-white">
            <table className="w-full table-fixed text-left text-[11px] xl:text-xs">
              <colgroup>
                <col className="w-[10%]" />
                <col className="w-[13%]" />
                <col className="w-[13%]" />
                <col className="w-[8%]" />
                <col className="w-[18%]" />
                <col className="w-[9%]" />
                <col className="w-[19%]" />
                <col className="w-[10%]" />
              </colgroup>
              <thead className="bg-slate-50 text-[9px] uppercase tracking-wide text-slate-500 xl:text-[10px]">
                <tr>
                  <th scope="col" className="px-3 py-3 font-bold">Date & time</th>
                  <th scope="col" className="px-3 py-3 font-bold">Transaction #</th>
                  <th scope="col" className="px-3 py-3 font-bold">Resident</th>
                  <th scope="col" className="px-3 py-3 font-bold">Purok</th>
                  <th scope="col" className="px-3 py-3 font-bold">Category</th>
                  <th scope="col" className="px-3 py-3 font-bold">Amount</th>
                  <th scope="col" className="px-3 py-3 font-bold">Status</th>
                  <th scope="col" className="px-3 py-3 text-center font-bold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">{visiblePayments.map(payment => <tr key={payment.id} className="transition hover:bg-emerald-500/5">
                <td className="whitespace-nowrap px-3 py-3 text-slate-700">{new Date(payment.created_at).toLocaleDateString()}<span className="mt-1 block text-[10px] text-slate-400">{new Date(payment.created_at).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}</span></td>
                <td className="truncate px-3 py-3 font-mono text-[9px] text-slate-700 xl:text-[10px]" title={payment.transaction_code}>{payment.transaction_code}</td>
                <td className="truncate px-3 py-3 font-semibold text-slate-700" title={payment.resident_name}>{payment.resident_name}</td>
                <td className="truncate px-3 py-3 text-slate-500" title={payment.purok_name}>{payment.purok_name}</td>
                <td className="truncate px-3 py-3 text-slate-500" title={categoryLabel(payment.category)}>{categoryLabel(payment.category)}</td>
                <td className="whitespace-nowrap px-3 py-3 font-bold tabular-nums text-slate-700">₱{Number(payment.amount).toFixed(2)}</td>
                <td className="px-3 py-3"><span className={`inline-flex whitespace-nowrap rounded-full border px-3 py-1.5 text-[10px] font-bold ${statusClasses(payment.status)}`}>{statusLabel(payment.status)}</span></td>
                <td className="px-3 py-3 text-center">
                  <div className="flex items-center justify-center gap-1">
                    <button type="button" aria-label={`View payment ${payment.transaction_code}`} onClick={() => {resetForm(); setSelectedPayment(payment.id);}} className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 px-2.5 py-1.5 text-[10px] text-slate-600 transition hover:border-emerald-500 hover:text-emerald-600 xl:px-3 xl:py-2 xl:text-xs"><Eye className="h-3.5 w-3.5" />View</button>
                    {isSuperAdmin && (
                      <button
                        type="button"
                        aria-label={`Delete payment ${payment.transaction_code}`}
                        title="Delete payment record"
                        onClick={() => setPaymentToDelete(payment)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>)}</tbody>
            </table>
          </div>
          <div className="sg-mobile-list-card space-y-2">
            {visiblePayments.map((payment) => (
              <article key={payment.id} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-[10px] font-bold text-slate-700">{payment.transaction_code}</p>
                    <p className="mt-1 truncate text-sm font-bold text-slate-900">{payment.resident_name}</p>
                    <p className="mt-1 text-xs text-slate-500">{payment.purok_name} · {new Date(payment.created_at).toLocaleDateString()}</p>
                  </div>
                  <span className={`shrink-0 rounded-full border px-2 py-1 text-[9px] font-bold ${statusClasses(payment.status)}`}>{statusLabel(payment.status)}</span>
                </div>
                <div className="mt-3 flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
                  <span className="font-bold tabular-nums text-slate-800">₱{Number(payment.amount).toFixed(2)}</span>
                  <div className="flex items-center gap-2">
                    <button type="button" aria-label={`View payment ${payment.transaction_code}`} onClick={() => { resetForm(); setSelectedPayment(payment.id); }} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700">View details</button>
                    {isSuperAdmin && (
                      <button
                        type="button"
                        onClick={() => setPaymentToDelete(payment)}
                        aria-label={`Delete payment ${payment.transaction_code}`}
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-rose-200 text-rose-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
          {filteredPayments.length > 0 && (
            <div className="flex flex-col gap-2 px-1 py-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs font-bold text-slate-500">
                Showing{" "}
                <span className="font-black text-slate-800">
                  {(paymentPage - 1) * paymentPageSize + 1}
                </span>
                {"–"}
                <span className="font-black text-slate-800">
                  {Math.min(
                    paymentPage * paymentPageSize,
                    filteredPayments.length,
                  )}
                </span>{" "}
                of{" "}
                <span className="font-black text-slate-800">
                  {filteredPayments.length}
                </span>{" "}
                transactions
              </p>

              <div className="flex items-center gap-2">
                <label className="sr-only" htmlFor="payment-page-size">Payments per page</label>
                <select
                  id="payment-page-size"
                  value={paymentPageSize}
                  onChange={(event) => {
                    setPaymentPageSize(Number(event.target.value));
                    setPaymentPage(1);
                  }}
                  className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-[10px] font-bold text-slate-600"
                  aria-label="Payments per page"
                >
                  <option value={10}>10 / page</option>
                  <option value={25}>25 / page</option>
                  <option value={50}>50 / page</option>
                </select>
                <button
                  type="button"
                  onClick={() => setPaymentPage((page) => Math.max(1, page - 1))}
                  disabled={paymentPage === 1}
                  aria-label="Previous payments page"
                  className="flex h-7 w-7 items-center justify-center rounded-xl border border-slate-200 text-slate-600 transition hover:border-emerald-300 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>

                <span className="min-w-16 text-center text-xs font-black text-slate-600">
                  {paymentPage} / {paymentPageCount}
                </span>

                <button
                  type="button"
                  onClick={() => setPaymentPage((page) => Math.min(paymentPageCount, page + 1))}
                  disabled={paymentPage === paymentPageCount}
                  aria-label="Next payments page"
                  className="flex h-7 w-7 items-center justify-center rounded-xl border border-slate-200 text-slate-600 transition hover:border-emerald-300 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {payments.filter(payment => payment.id === selectedPayment).map(
            (payment) => (
              <Modal key={payment.id} title="Payment details" onClose={() => {setSelectedPayment(null); resetForm();}}>
              <article
                key={payment.id}
                className="rounded-[2rem] border border-slate-100 bg-white p-5 shadow-sm"
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-black text-slate-900">
                        {payment.transaction_code}
                      </h3>

                      <span
                        className={`rounded-full border px-2.5 py-1 text-[9px] font-black uppercase ${statusClasses(
                          payment.status,
                        )}`}
                      >
                        {statusLabel(
                          payment.status,
                        )}
                      </span>
                    </div>

                    <p className="mt-2 text-sm font-black text-slate-800">
                      {payment.resident_name}
                    </p>

                    <p className="text-xs text-slate-500">
                      {payment.purok_name}, {payment.barangay_name}
                    </p>
                  </div>

                  <div className="text-left lg:text-right">
                    <p className="text-2xl font-black text-slate-900">
                      ₱{Number(payment.amount).toFixed(2)}
                    </p>

                    <p className="text-[10px] font-black uppercase text-slate-400">
                      {methodLabel(
                        payment.payment_method,
                      )}
                    </p>
                  </div>
                </div>

                <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-3">
                  <Info
                    label="Category"
                    value={categoryLabel(
                      payment.category,
                    )}
                  />
                  <Info
                    label="Billing Period"
                    value={
                      payment.billing_period
                    }
                  />
                  <Info
                    label="Payment Reference"
                    value={
                      payment.payment_reference
                    }
                  />
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setShowImage(
                        payment.receipt_proof,
                      )
                    }
                    className="flex items-center gap-2 rounded-xl border px-3 py-2 text-[10px] font-black uppercase text-slate-700"
                  >
                    <Eye className="h-4 w-4" />
                    Resident Receipt
                  </button>

                  {payment.remittance_proof && (
                    <button
                      type="button"
                      onClick={() =>
                        setShowImage(
                          payment.remittance_proof!,
                        )
                      }
                      className="flex items-center gap-2 rounded-xl border px-3 py-2 text-[10px] font-black uppercase text-slate-700"
                    >
                      <Eye className="h-4 w-4" />
                      Remittance Proof
                    </button>
                  )}
                </div>

                {isLeader &&
                  payment.status ===
                    "pending_leader_verification" && (
                    <ActionBox title="Leader Verification">
                      <textarea
                        value={reviewRemarks}
                        onChange={(event) =>
                          setReviewRemarks(
                            event.target.value,
                          )
                        }
                        placeholder="Optional verification or rejection remarks"
                        className="w-full rounded-xl border p-3 text-xs"
                      />

                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={submitting}
                          onClick={() =>
                            void leaderReview(
                              payment.id,
                              "approve",
                            )
                          }
                          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 text-xs font-black text-white"
                        >
                          <Check className="h-4 w-4" />
                          Verify
                        </button>

                        <button
                          type="button"
                          disabled={submitting}
                          onClick={() =>
                            void leaderReview(
                              payment.id,
                              "reject",
                            )
                          }
                          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-rose-600 py-3 text-xs font-black text-white"
                        >
                          <X className="h-4 w-4" />
                          Reject
                        </button>
                      </div>
                    </ActionBox>
                  )}

                {isLeader &&
                  payment.status ===
                    "pending_remittance" && (
                    <ActionBox title="Remit to Barangay">
                      <input
                        value={
                          remittanceReference
                        }
                        onChange={(event) =>
                          setRemittanceReference(
                            event.target.value,
                          )
                        }
                        placeholder="Barangay remittance reference / OR number"
                        className="w-full rounded-xl border p-3 text-xs"
                      />

                      <UploadField
                        label="Upload remittance proof"
                        ready={
                          Boolean(
                            remittanceProof,
                          )
                        }
                        onFile={(file) =>
                          void handleImage(
                            file,
                            "remittance",
                          )
                        }
                      />

                      <button
                        type="button"
                        disabled={
                          submitting ||
                          !remittanceReference.trim() ||
                          !remittanceProof
                        }
                        onClick={() =>
                          void submitRemittance(
                            payment.id,
                          )
                        }
                        className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 py-3 text-xs font-black text-white disabled:opacity-50"
                      >
                        <Send className="h-4 w-4" />
                        Submit Remittance
                      </button>
                    </ActionBox>
                  )}

                {isAdmin &&
                  [
                    "pending_admin_confirmation",
                    "discrepancy",
                  ].includes(
                    payment.status,
                  ) && (
                    <ActionBox title="Barangay Final Confirmation">
                      <input
                        value={
                          reviewRemarks
                        }
                        onChange={(event) =>
                          setReviewRemarks(
                            event.target.value,
                          )
                        }
                        placeholder="Admin remarks"
                        className="w-full rounded-xl border p-3 text-xs"
                      />

                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={
                          discrepancyAmount
                        }
                        onChange={(event) =>
                          setDiscrepancyAmount(
                            event.target.value,
                          )
                        }
                        placeholder="Discrepancy amount, only when reporting a mismatch"
                        className="w-full rounded-xl border p-3 text-xs"
                      />

                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={submitting}
                          onClick={() =>
                            void adminReview(
                              payment.id,
                              "confirm",
                            )
                          }
                          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 text-xs font-black text-white"
                        >
                          <ShieldCheck className="h-4 w-4" />
                          Confirm Received
                        </button>

                        <button
                          type="button"
                          disabled={
                            submitting ||
                            Number(
                              discrepancyAmount,
                            ) <= 0
                          }
                          onClick={() =>
                            void adminReview(
                              payment.id,
                              "discrepancy",
                            )
                          }
                          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-rose-600 py-3 text-xs font-black text-white disabled:opacity-50"
                        >
                          <AlertTriangle className="h-4 w-4" />
                          Report Difference
                        </button>
                      </div>
                    </ActionBox>
                  )}

                <div className="mt-5 border-t pt-4">
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                    Audit Trail
                  </p>

                  <div className="mt-2 grid grid-cols-1 gap-2 text-[11px] text-slate-600 md:grid-cols-3">
                    <p>
                      <strong>Submitted:</strong>{" "}
                      {new Date(
                        payment.created_at,
                      ).toLocaleString()}
                    </p>
                    <p>
                      <strong>Leader:</strong>{" "}
                      {payment.leader_name ||
                        "Not yet verified"}
                    </p>
                    <p>
                      <strong>Admin:</strong>{" "}
                      {payment.admin_name ||
                        "Not yet confirmed"}
                    </p>
                  </div>
                </div>
              </article>
              </Modal>
            ),
          )}

          {filteredPayments.length ===
            0 && (
            <div className="rounded-[2rem] border-2 border-dashed p-12 text-center text-sm font-bold text-slate-400">
              No payment records found.
            </div>
          )}
        </div>
      )}
        </>
      )}

      {showPaymentForm && (
        <Modal
          title="Submit Payment"
          onClose={() =>
            setShowPaymentForm(false)
          }
        >
          <form
            onSubmit={submitPayment}
            className="sg-compact-form"
          >
            <fieldset className="sg-form-section">
              <legend>Payment details</legend>
              <div className="sg-form-grid sg-form-grid--two">
            <select
              aria-label="Payment category"
              value={category}
              onChange={(event) => {
                const selected =
                  CATEGORY_OPTIONS.find(
                    (item) =>
                      item.value ===
                      event.target.value,
                  );

                setCategory(
                  event.target.value as PaymentRecord["category"],
                );

                if (selected) {
                  setAmount(
                    String(selected.amount),
                  );
                }
              }}
              className="min-h-11 w-full rounded-xl border px-3 py-2 text-sm"
            >
              {CATEGORY_OPTIONS.map(
                (item) => (
                  <option
                    key={item.value}
                    value={item.value}
                  >
                    {item.label} — Suggested ₱{item.amount}
                  </option>
                ),
              )}
            </select>

            <input
              aria-label="Billing period"
              value={billingPeriod}
              onChange={(event) =>
                setBillingPeriod(
                  event.target.value,
                )
              }
              placeholder="Billing period"
              className="min-h-11 w-full rounded-xl border px-3 py-2 text-sm"
              required
            />

            <input
              aria-label="Amount in Philippine pesos"
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(event) =>
                setAmount(
                  event.target.value,
                )
              }
              placeholder="Enter any payment amount"
              className="min-h-11 w-full rounded-xl border px-3 py-2 text-sm"
              required
            />
              </div>
              <p className="mt-2 text-[11px] font-medium text-slate-500">
                You may enter any positive amount. The category fee shown above is only a suggested reference.
              </p>
            </fieldset>

            <fieldset className="sg-form-section">
              <legend>Payment method</legend>
            <div className="grid grid-cols-3 gap-2">
              {[
                ["gcash", "GCash"],
                ["maya", "Maya"],
                [
                  "over_the_counter",
                  "Over-the-Counter",
                ],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() =>
                    setMethod(
                      value as PaymentRecord["payment_method"],
                    )
                  }
                  className={`rounded-xl border p-3 text-[10px] font-black ${
                    method === value
                      ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                      : "text-slate-500"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="mt-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
              {method ===
              "over_the_counter"
                ? "Pay the Purok Leader in person. Enter the official receipt number and upload a photo of the signed receipt."
                : "Pay only to the official Purok collection account shown by your local office. The uploaded screenshot is supporting evidence; the Leader must still verify the actual transaction."}
            </div>

            <input
              aria-label={method === "over_the_counter" ? "Official receipt number" : "Payment reference number"}
              value={reference}
              onChange={(event) =>
                setReference(
                  event.target.value,
                )
              }
              placeholder={
                method ===
                "over_the_counter"
                  ? "Official receipt number"
                  : "GCash / Maya reference number"
              }
              className="mt-3 min-h-11 w-full rounded-xl border px-3 py-2 text-sm"
              required
            />

            <UploadField
              label={
                method ===
                "over_the_counter"
                  ? "Upload signed official receipt"
                  : "Upload payment screenshot"
              }
              ready={Boolean(receiptProof)}
              onFile={(file) =>
                void handleImage(
                  file,
                  "receipt",
                )
              }
            />
            </fieldset>

            <button
              type="submit"
              disabled={
                submitting ||
                !receiptProof
              }
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-4 text-xs font-black uppercase text-white disabled:opacity-50"
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CreditCard className="h-4 w-4" />
              )}
              Submit for Verification
            </button>
          </form>
        </Modal>
      )}

      <ConfirmDialog
        open={Boolean(paymentToDelete)}
        title="Delete payment record?"
        description={
          paymentToDelete
            ? `Delete ${paymentToDelete.transaction_code} for ${paymentToDelete.resident_name}? This permanently removes the payment record and its stored proof images.`
            : ""
        }
        confirmLabel="Delete Payment"
        destructive
        busy={deletingPayment}
        onCancel={() => {
          if (!deletingPayment) {
            setPaymentToDelete(null);
          }
        }}
        onConfirm={() => void deletePaymentRecord()}
      />

      {showImage && (
        <Modal
          title="Payment Evidence"
          onClose={() =>
            setShowImage(null)
          }
        >
          <img
            src={showImage}
            alt="Payment evidence"
            className="max-h-[65vh] w-full rounded-xl object-contain"
          />
        </Modal>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  icon: typeof CreditCard;
  tone: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tone}`}><Icon className="h-5 w-5" /></span>
      <div><p className="text-[9px] font-bold uppercase tracking-wider text-slate-500">
        {label}
      </p>
      <p className="mt-1 text-2xl font-black tabular-nums text-slate-900">
        {Number(value).toLocaleString()}
      </p>
      </div>
    </div>
  );
}

function Info({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <p className="text-[9px] font-black uppercase text-slate-400">
        {label}
      </p>
      <p className="mt-1 break-words text-xs font-bold text-slate-700">
        {value}
      </p>
    </div>
  );
}

function ActionBox({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-5 space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">
        {title}
      </p>
      {children}
    </div>
  );
}

function UploadField({
  label,
  ready,
  onFile,
}: {
  label: string;
  ready: boolean;
  onFile: (
    file: File | undefined,
  ) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between rounded-xl border border-dashed border-slate-300 bg-white p-4">
      <div className="flex items-center gap-3">
        {ready ? (
          <CheckCircle2 className="h-5 w-5 text-emerald-600" />
        ) : (
          <FileImage className="h-5 w-5 text-slate-400" />
        )}

        <span className="text-xs font-bold text-slate-600">
          {ready
            ? "Image ready"
            : label}
        </span>
      </div>

      <Upload className="h-4 w-4 text-slate-400" />

      <input
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(event) =>
          onFile(
            event.target.files?.[0],
          )
        }
      />
    </label>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      const openModals = document.querySelectorAll(
        '[data-sg-modal="true"]',
      );

      const topModal =
        openModals.length > 0
          ? openModals[openModals.length - 1]
          : null;

      if (topModal === modalRef.current) {
        event.preventDefault();
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <div
      ref={modalRef}
      data-sg-modal="true"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/70 p-4"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="max-h-[92vh] w-full max-w-xl overflow-hidden rounded-[2rem] bg-white shadow-2xl"
      >
        <div className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-200 bg-white px-6 py-5">
          <h2 className="text-xl font-black text-slate-900">
            {title}
          </h2>

          <button
            type="button"
            onClick={onClose}
            aria-label={`Close ${title}`}
            title="Close"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700 transition hover:bg-rose-50 hover:text-rose-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="max-h-[calc(92vh-5rem)] overflow-y-auto px-6 pb-6 pt-5">
          {children}
        </div>
      </div>
    </div>
  );
}
