import { PAYMENT_CATEGORY_LABELS, type PaymentCategoryOption } from "../../shared/paymentCategories";
import {
  useEffect,
  useMemo,
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
  Eye,
  FileImage,
  Filter,
  Loader2,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Upload,
  X,
} from "lucide-react";
import { notifyAdminActionCountsChanged } from "../hooks/useAdminActionCounts";

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
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }

  if (
    status === "rejected_by_leader" ||
    status === "discrepancy"
  ) {
    return "border-rose-200 bg-rose-50 text-rose-700";
  }

  return "border-amber-200 bg-amber-50 text-amber-700";
}

export default function PaymentPortal({
  role = "household",
}: PaymentPortalProps) {
  const [CATEGORY_OPTIONS, setCategoryOptions] = useState<PaymentCategoryOption[]>([]);
  const [payments, setPayments] =
    useState<PaymentRecord[]>([]);

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
  const isAdmin =
    role === "admin" ||
    role === "super_admin";

  const loadPayments = async () => {
    setLoading(true);

    try {
      const data =
        await apiRequest("/");

      setCategoryOptions(data.categories);
      setPayments(
        Array.isArray(data.payments)
          ? data.payments
          : [],
      );
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

  const filteredPayments =
    useMemo(() => {
      const query =
        search.trim().toLowerCase();

      return payments.filter((payment) => {
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
    }, [payments, search, statusFilter]);

  const paymentPageSize = 8;
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
    paymentPageCount,
  ]);

  useEffect(() => {
    setPaymentPage(1);
  }, [search, statusFilter]);

  useEffect(() => {
    if (paymentPage > paymentPageCount) {
      setPaymentPage(paymentPageCount);
    }
  }, [paymentPage, paymentPageCount]);

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

    setSubmitting(true);
    setMessage(null);

    try {
      const data = await apiRequest(
        "/",
        {
          method: "POST",
          body: JSON.stringify({
            category,
            billingPeriod,
            amount: Number(amount),
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

  return (
    <div className="space-y-6 pb-20 md:pb-0">
      <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <span className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-600">
            Accountable Collection Workflow
          </span>

          <h1 className="mt-1 text-3xl font-black text-slate-900">
            {isResident
              ? "My Payments"
              : isLeader
                ? "Purok Payment Verification"
                : "Barangay Remittance Control"}
          </h1>

          <p className="mt-1 text-xs font-medium text-slate-500">
            Every payment records who submitted, verified, remitted, and confirmed it.
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

      {message && (
        <div
          className={`rounded-2xl border px-5 py-4 text-sm font-bold ${
            message.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-rose-200 bg-rose-50 text-rose-700"
          }`}
        >
          {message.text}
        </div>
      )}

      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Metric
          label="Transactions"
          value={String(payments.length)}
        />
        <Metric
          label="Completed Total"
          value={`₱${completedTotal.toFixed(2)}`}
        />
        <Metric
          label="Pending Accountability"
          value={`₱${pendingTotal.toFixed(2)}`}
        />
      </section>

      <div className="flex flex-col gap-3 md:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(event) =>
              setSearch(event.target.value)
            }
            placeholder="Search transaction, resident, reference, purok, or status"
            className="w-full rounded-2xl border border-slate-200 bg-white py-3 pl-11 pr-4 text-sm outline-none focus:border-emerald-500"
          />
        </div>

        <div className="relative md:w-64">
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
            className="w-full appearance-none rounded-2xl border border-slate-200 bg-white py-3 pl-11 pr-4 text-sm font-bold text-slate-600 outline-none focus:border-emerald-500"
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
      </div>

      {loading ? (
        <div className="flex min-h-[300px] items-center justify-center rounded-[2rem] border bg-white">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
        </div>
      ) : (
        <div className="space-y-4">
          {filteredPayments.length > 0 && (
            <div className="flex flex-col gap-3 rounded-2xl border border-slate-100 bg-white px-4 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
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
                <button
                  type="button"
                  onClick={() => setPaymentPage((page) => Math.max(1, page - 1))}
                  disabled={paymentPage === 1}
                  aria-label="Previous payments page"
                  className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-slate-600 transition hover:border-emerald-300 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
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
                  className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-slate-600 transition hover:border-emerald-300 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {visiblePayments.map(
            (payment) => (
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

      {showPaymentForm && (
        <Modal
          title="Submit Payment"
          onClose={() =>
            setShowPaymentForm(false)
          }
        >
          <form
            onSubmit={submitPayment}
            className="space-y-4"
          >
            <select
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
              className="w-full rounded-xl border p-3 text-sm"
            >
              {CATEGORY_OPTIONS.map(
                (item) => (
                  <option
                    key={item.value}
                    value={item.value}
                  >
                    {item.label} — ₱{item.amount}
                  </option>
                ),
              )}
            </select>

            <input
              value={billingPeriod}
              onChange={(event) =>
                setBillingPeriod(
                  event.target.value,
                )
              }
              placeholder="Billing period"
              className="w-full rounded-xl border p-3 text-sm"
              required
            />

            <input
              type="number"
              min="1"
              step="0.01"
              value={amount}
              onChange={(event) =>
                setAmount(
                  event.target.value,
                )
              }
              className="w-full rounded-xl border p-3 text-sm"
              required
            />

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

            <div className="rounded-xl bg-slate-50 p-4 text-xs text-slate-600">
              {method ===
              "over_the_counter"
                ? "Pay the Purok Leader in person. Enter the official receipt number and upload a photo of the signed receipt."
                : "Pay only to the official Purok collection account shown by your local office. The uploaded screenshot is supporting evidence; the Leader must still verify the actual transaction."}
            </div>

            <input
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
              className="w-full rounded-xl border p-3 text-sm"
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
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-[1.8rem] border border-slate-100 bg-white p-5 shadow-sm">
      <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">
        {label}
      </p>
      <p className="mt-2 text-2xl font-black text-slate-900">
        {value}
      </p>
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
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/70 p-4">
      <div className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-[2rem] bg-white p-6 shadow-2xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-xl font-black text-slate-900">
            {title}
          </h2>

          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-slate-100 p-2"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {children}
      </div>
    </div>
  );
}
