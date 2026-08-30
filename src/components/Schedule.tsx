import {
  Calendar as CalendarIcon,
  ChevronRight,
  Clock,
  Loader2,
  MapPin,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Truck,
  X,
} from "lucide-react";
import {
  type FormEvent,
  useEffect,
  useMemo,
  useState,
} from "react";
import { apiRequest } from "../services/api";

const DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

type DayOfWeek = (typeof DAYS)[number];

type CurrentUser = {
  id: number;
  full_name: string;
  email: string;
  role: string;
  barangay_id: number | null;
  barangay_name: string | null;
  purok_id: number | null;
  purok_name: string | null;
};

type CollectionSchedule = {
  id: number;
  barangay_id: number;
  barangay_name: string;
  day_of_week: DayOfWeek;
  start_time: string | null;
  end_time: string | null;
  notes: string | null;
  is_active: number | boolean;
};

type ScheduleForm = {
  dayOfWeek: DayOfWeek;
  startTime: string;
  endTime: string;
  notes: string;
};

const emptyForm: ScheduleForm = {
  dayOfWeek: "Monday",
  startTime: "",
  endTime: "",
  notes: "",
};

function formatTime(value: string | null): string {
  if (!value) return "";

  const match = value.match(/^(\d{1,2}):(\d{2})/);

  if (!match) return value;

  const date = new Date(2000, 0, 1);
  date.setHours(Number(match[1]), Number(match[2]), 0, 0);

  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatTimeRange(
  startTime: string | null,
  endTime: string | null,
): string {
  const start = formatTime(startTime);
  const end = formatTime(endTime);

  if (start && end) return `${start} - ${end}`;
  if (start) return `${start} onward`;
  if (end) return `Until ${end}`;
  return "Time to be announced";
}

function roleLabel(role: string): string {
  switch (role) {
    case "admin":
      return "Barangay Captain";
    case "super_admin":
      return "Municipal Administrator";
    case "purok_leader":
      return "Purok Leader";
    case "collector":
      return "Garbage Collector";
    default:
      return "Resident";
  }
}

export default function Schedule() {
  const today = new Date();
  const [visibleMonth, setVisibleMonth] = useState(
    () =>
      new Date(
        today.getFullYear(),
        today.getMonth(),
        1,
      ),
  );
  const [currentUser, setCurrentUser] =
    useState<CurrentUser | null>(null);
  const [schedules, setSchedules] = useState<
    CollectionSchedule[]
  >([]);
  const [selectedSchedule, setSelectedSchedule] =
    useState<CollectionSchedule | null>(null);
  const [deleteTarget, setDeleteTarget] =
    useState<CollectionSchedule | null>(null);
  const [form, setForm] =
    useState<ScheduleForm>(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [editingScheduleId, setEditingScheduleId] =
    useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const canManage =
    currentUser?.role === "admin" &&
    Boolean(currentUser.barangay_id);

  const scopeLabel =
    currentUser?.role === "super_admin"
      ? "All barangays"
      : currentUser?.barangay_name ||
        schedules[0]?.barangay_name ||
        "Assigned barangay";

  const calendarDays = useMemo(() => {
    const year = visibleMonth.getFullYear();
    const month = visibleMonth.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const totalDays = new Date(year, month + 1, 0).getDate();
    const cells: Array<number | null> = [];

    for (let index = 0; index < firstDay; index += 1) {
      cells.push(null);
    }

    for (let day = 1; day <= totalDays; day += 1) {
      cells.push(day);
    }

    while (cells.length % 7 !== 0) {
      cells.push(null);
    }

    return cells;
  }, [visibleMonth]);

  const scheduledWeekdays = useMemo(
    () =>
      new Set(
        schedules.map(
          (schedule) => schedule.day_of_week,
        ),
      ),
    [schedules],
  );

  const loadData = async (quiet = false) => {
    if (quiet) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    setError("");

    try {
      const [profileResult, scheduleResult] =
        await Promise.all([
          apiRequest<{
            success: boolean;
            user: CurrentUser;
          }>("/auth/me"),
          apiRequest<{
            success: boolean;
            schedules: CollectionSchedule[];
          }>("/collection-schedules"),
        ]);

      setCurrentUser(profileResult.user || null);
      setSchedules(
        Array.isArray(scheduleResult.schedules)
          ? scheduleResult.schedules
          : [],
      );
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load collection schedules.",
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const isToday = (day: number) =>
    today.getFullYear() === visibleMonth.getFullYear() &&
    today.getMonth() === visibleMonth.getMonth() &&
    today.getDate() === day;

  const weekdayForDay = (day: number): DayOfWeek => {
    const weekdayIndex = new Date(
      visibleMonth.getFullYear(),
      visibleMonth.getMonth(),
      day,
    ).getDay();

    return [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ][weekdayIndex] as DayOfWeek;
  };

  const hasScheduleOnDay = (day: number) =>
    scheduledWeekdays.has(weekdayForDay(day));

  const openNewForm = () => {
    setForm(emptyForm);
    setEditingScheduleId(null);
    setError("");
    setNotice("");
    setShowForm(true);
  };

  const openEditForm = (schedule: CollectionSchedule) => {
    setForm({
      dayOfWeek: schedule.day_of_week,
      startTime: schedule.start_time?.slice(0, 5) || "",
      endTime: schedule.end_time?.slice(0, 5) || "",
      notes: schedule.notes || "",
    });
    setEditingScheduleId(schedule.id);
    setSelectedSchedule(null);
    setError("");
    setNotice("");
    setShowForm(true);
  };

  const openDeleteDialog = (
    schedule: CollectionSchedule,
  ) => {
    setError("");
    setNotice("");
    setDeleteTarget(schedule);
  };

  const saveSchedule = async (
    event: FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();

    if (!canManage || !currentUser?.barangay_id) {
      setError(
        "Only a Barangay Captain with an assigned barangay can manage schedules.",
      );
      return;
    }

    if (
      form.startTime &&
      form.endTime &&
      form.endTime <= form.startTime
    ) {
      setError("End time must be later than start time.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");

    try {
      const result = await apiRequest<{
        success: boolean;
        message: string;
      }>("/collection-schedules", {
        method: "POST",
        body: JSON.stringify({
          barangay_id: currentUser.barangay_id,
          day_of_week: form.dayOfWeek,
          start_time: form.startTime || null,
          end_time: form.endTime || null,
          notes: form.notes.trim() || null,
        }),
      });

      setNotice(
        result.message ||
          "Collection schedule saved successfully.",
      );
      setShowForm(false);
      setEditingScheduleId(null);
      setForm(emptyForm);
      await loadData(true);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Unable to save the collection schedule.",
      );
    } finally {
      setSaving(false);
    }
  };

  const deleteSchedule = async () => {
    if (!deleteTarget || !canManage) return;

    setDeleting(true);
    setError("");
    setNotice("");

    try {
      const result = await apiRequest<{
        success: boolean;
        message: string;
      }>(
        `/collection-schedules/${deleteTarget.id}`,
        { method: "DELETE" },
      );

      setNotice(
        result.message ||
          "Collection schedule deleted successfully.",
      );
      setDeleteTarget(null);
      setSelectedSchedule(null);
      await loadData(true);
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Unable to delete the collection schedule.",
      );
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[420px] items-center justify-center">
        <div className="text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-emerald-500" />
          <p className="mt-3 text-sm font-semibold text-slate-500">
            Loading collection schedule...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-20">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Collection Schedule
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Weekly garbage collection plan for {scopeLabel}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void loadData(true)}
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-600 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw
              className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
            />
            Refresh
          </button>

          {canManage && (
            <button
              type="button"
              onClick={openNewForm}
              className="inline-flex items-center gap-2 rounded-full bg-emerald-600 px-5 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-700"
            >
              <Plus className="h-4 w-4" />
              Add Schedule
            </button>
          )}
        </div>
      </header>

      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
          {error}
        </div>
      )}

      {notice && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
          {notice}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-500">
        <span className="rounded-full bg-white px-3 py-1.5 shadow-sm ring-1 ring-slate-100">
          {roleLabel(currentUser?.role || "resident")}
        </span>
        <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-emerald-700 ring-1 ring-emerald-100">
          {canManage ? "Schedule manager" : "Read-only schedule"}
        </span>
      </div>

      <div className="overflow-hidden rounded-3xl border border-slate-100 bg-white p-4 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-900">
            {visibleMonth.toLocaleDateString("en-US", {
              month: "long",
              year: "numeric",
            })}
          </h3>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() =>
                setVisibleMonth(
                  new Date(
                    visibleMonth.getFullYear(),
                    visibleMonth.getMonth() - 1,
                    1,
                  ),
                )
              }
              className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-100 text-slate-400 transition hover:bg-slate-50"
              aria-label="Previous month"
            >
              <ChevronRight className="h-4 w-4 rotate-180" />
            </button>

            <button
              type="button"
              onClick={() =>
                setVisibleMonth(
                  new Date(
                    visibleMonth.getFullYear(),
                    visibleMonth.getMonth() + 1,
                    1,
                  ),
                )
              }
              className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-100 text-slate-400 transition hover:bg-slate-50"
              aria-label="Next month"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-2">
          {["S", "M", "T", "W", "T", "F", "S"].map(
            (day, index) => (
              <div
                key={`${day}-${index}`}
                className="py-1 text-center text-[10px] font-bold text-slate-300"
              >
                {day}
              </div>
            ),
          )}

          {calendarDays.map((day, index) => {
            if (day === null) {
              return (
                <div key={`empty-${index}`} className="py-2" />
              );
            }

            const todayCell = isToday(day);
            const scheduledCell = hasScheduleOnDay(day);

            return (
              <div
                key={`${visibleMonth.getFullYear()}-${visibleMonth.getMonth()}-${day}`}
                className={`relative rounded-xl py-2 text-center text-xs font-medium transition-colors ${
                  todayCell
                    ? "bg-emerald-500 font-bold text-white shadow-sm ring-2 ring-emerald-100"
                    : scheduledCell
                      ? "bg-emerald-50 font-bold text-emerald-700"
                      : "text-slate-600 hover:bg-slate-50"
                }`}
                title={
                  scheduledCell
                    ? `${weekdayForDay(day)} collection`
                    : undefined
                }
              >
                {day}

                {scheduledCell && (
                  <span
                    className={`absolute bottom-1 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full ${
                      todayCell ? "bg-white" : "bg-emerald-500"
                    }`}
                  />
                )}
              </div>
            );
          })}
        </div>

        <p className="mt-4 text-[11px] text-slate-400">
          Highlighted dates repeat weekly based on the active barangay
          collection plan.
        </p>
      </div>

      <div className="space-y-4">
        <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900">
          <Clock className="h-5 w-5 text-emerald-500" />
          Weekly Timeline
        </h2>

        <div className="space-y-3">
          {schedules.map((item) => (
            <div
              key={item.id}
              role="button"
              tabIndex={0}
              onClick={() => setSelectedSchedule(item)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setSelectedSchedule(item);
                }
              }}
              className="group flex cursor-pointer flex-col justify-between gap-4 rounded-3xl border border-slate-100 bg-white p-5 shadow-sm transition-colors hover:border-emerald-200 sm:flex-row sm:items-center"
            >
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-500 text-white">
                  <Truck className="h-6 w-6" />
                </div>

                <div className="space-y-1">
                  <span className="text-xs font-bold uppercase tracking-tight text-slate-400">
                    Weekly Garbage Collection
                  </span>
                  <h4 className="text-sm font-bold text-slate-900">
                    Every {item.day_of_week}
                  </h4>
                  <p className="text-xs text-slate-500">
                    {formatTimeRange(
                      item.start_time,
                      item.end_time,
                    )}
                    <span className="mx-1.5">•</span>
                    <span className="font-bold text-slate-400">
                      {item.barangay_name}
                    </span>
                  </p>
                  {item.notes && (
                    <p className="max-w-2xl pt-1 text-xs leading-relaxed text-slate-500">
                      {item.notes}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 self-end sm:self-center">
                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[9px] font-black uppercase tracking-wider text-emerald-600">
                  Active
                </span>
                {canManage &&
                  Number(item.barangay_id) ===
                    Number(currentUser?.barangay_id) && (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        openDeleteDialog(item);
                      }}
                      className="rounded-full p-2 text-slate-300 transition hover:bg-rose-50 hover:text-rose-600"
                      aria-label={`Delete ${item.day_of_week} schedule`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                <ChevronRight className="h-5 w-5 text-slate-300 transition-colors group-hover:text-emerald-500" />
              </div>
            </div>
          ))}

          {schedules.length === 0 && (
            <div className="rounded-3xl border border-dashed border-slate-200 bg-white px-6 py-12 text-center">
              <CalendarIcon className="mx-auto h-9 w-9 text-slate-300" />
              <p className="mt-3 text-sm font-bold text-slate-600">
                No active collection schedule
              </p>
              <p className="mt-1 text-xs text-slate-400">
                {canManage
                  ? "Add the first weekly collection day for your barangay."
                  : "Your Barangay Captain has not published a weekly schedule yet."}
              </p>
              {canManage && (
                <button
                  type="button"
                  onClick={openNewForm}
                  className="mt-5 rounded-full bg-emerald-600 px-5 py-2 text-xs font-bold text-white transition hover:bg-emerald-700"
                >
                  Add Schedule
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="relative mt-8 overflow-hidden rounded-[40px] border border-emerald-100 bg-emerald-50 p-6">
        <div className="relative z-10 max-w-xl">
          <h3 className="font-bold text-emerald-900">
            {canManage
              ? "Manage Weekly Plan"
              : "Published Weekly Plan"}
          </h3>
          <p className="mb-4 mt-1 text-xs leading-relaxed text-emerald-700">
            {canManage
              ? "Publishing a collection day makes it visible to residents, Purok Leaders, and collectors assigned to your barangay."
              : "This is the official recurring collection plan published by your Barangay Captain."}
          </p>
          {canManage && (
            <button
              type="button"
              onClick={openNewForm}
              className="rounded-full bg-white px-6 py-2 text-xs font-bold text-emerald-600 shadow-sm shadow-emerald-900/5 transition-all active:scale-95"
            >
              Configure Now
            </button>
          )}
        </div>
        <CalendarIcon className="absolute -bottom-4 -right-4 h-32 w-32 -rotate-12 text-emerald-100/60" />
      </div>

      {showForm && canManage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 p-4 backdrop-blur-md"
          role="dialog"
          aria-modal="true"
          aria-labelledby="schedule-form-title"
        >
          <form
            onSubmit={saveSchedule}
            className="relative w-full max-w-xl rounded-[2.5rem] border border-slate-100 bg-white p-6 shadow-2xl"
          >
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="absolute right-5 top-5 rounded-full bg-slate-100 p-2 text-slate-500 transition hover:bg-slate-200 hover:text-slate-800"
              aria-label="Close schedule form"
            >
              <X className="h-4 w-4" />
            </button>

            <div className="pr-10">
              <p className="text-[10px] font-black uppercase tracking-[0.35em] text-emerald-500">
                {scopeLabel}
              </p>
              <h3
                id="schedule-form-title"
                className="mt-2 text-2xl font-black text-slate-900"
              >
                {editingScheduleId
                  ? "Update Collection Day"
                  : "Add Collection Day"}
              </h3>
              <p className="mt-1 text-sm text-slate-500">
                Saving an existing weekday updates its time and notes.
              </p>
            </div>

            {error && (
              <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
                {error}
              </div>
            )}

            <div className="mt-6 space-y-4">
              <label className="block">
                <span className="mb-2 block text-xs font-bold text-slate-700">
                  Collection day
                </span>
                <select
                  value={form.dayOfWeek}
                  disabled={editingScheduleId !== null}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      dayOfWeek: event.target.value as DayOfWeek,
                    }))
                  }
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
                  required
                >
                  {DAYS.map((day) => (
                    <option key={day} value={day}>
                      {day}
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-2 block text-xs font-bold text-slate-700">
                    Start time
                  </span>
                  <input
                    type="time"
                    value={form.startTime}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        startTime: event.target.value,
                      }))
                    }
                    className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100"
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-xs font-bold text-slate-700">
                    End time
                  </span>
                  <input
                    type="time"
                    value={form.endTime}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        endTime: event.target.value,
                      }))
                    }
                    className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100"
                  />
                </label>
              </div>

              <label className="block">
                <span className="mb-2 block text-xs font-bold text-slate-700">
                  Route notes or reminders
                </span>
                <textarea
                  value={form.notes}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      notes: event.target.value,
                    }))
                  }
                  maxLength={255}
                  rows={4}
                  placeholder="Example: Place segregated waste outside before 7:00 AM."
                  className="w-full resize-none rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-300 focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100"
                />
                <span className="mt-1 block text-right text-[10px] text-slate-400">
                  {form.notes.length}/255
                </span>
              </label>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                disabled={saving}
                className="rounded-3xl border border-slate-200 py-3 text-xs font-black uppercase tracking-[0.18em] text-slate-600 transition hover:bg-slate-50 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center justify-center gap-2 rounded-3xl bg-emerald-600 py-3 text-xs font-black uppercase tracking-[0.18em] text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                {saving ? "Saving" : "Save Schedule"}
              </button>
            </div>
          </form>
        </div>
      )}

      {selectedSchedule && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 p-4 backdrop-blur-md"
          role="dialog"
          aria-modal="true"
          aria-labelledby="schedule-detail-title"
        >
          <div className="relative w-full max-w-2xl rounded-[2.5rem] border border-slate-100 bg-white p-6 shadow-2xl">
            <button
              type="button"
              onClick={() => setSelectedSchedule(null)}
              className="absolute right-5 top-5 rounded-full bg-slate-100 p-2 text-slate-500 transition hover:bg-slate-200 hover:text-slate-800"
              aria-label="Close schedule details"
            >
              <X className="h-4 w-4" />
            </button>

            <div className="space-y-5">
              <div className="flex flex-col gap-4 pr-10 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.4em] text-emerald-500">
                    Weekly Schedule
                  </p>
                  <h3
                    id="schedule-detail-title"
                    className="mt-2 text-2xl font-black text-slate-900"
                  >
                    Every {selectedSchedule.day_of_week}
                  </h3>
                  <p className="mt-1 text-sm text-slate-500">
                    Official recurring collection window
                  </p>
                </div>
                <span className="w-fit rounded-full bg-emerald-500 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-white">
                  Active
                </span>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-3xl border border-slate-100 bg-slate-50 p-4">
                  <p className="mb-3 text-[10px] font-black uppercase tracking-[0.35em] text-slate-400">
                    Collection Window
                  </p>
                  <p className="text-sm font-bold text-slate-900">
                    {formatTimeRange(
                      selectedSchedule.start_time,
                      selectedSchedule.end_time,
                    )}
                  </p>
                </div>
                <div className="rounded-3xl border border-slate-100 bg-slate-50 p-4">
                  <p className="mb-3 text-[10px] font-black uppercase tracking-[0.35em] text-slate-400">
                    Barangay
                  </p>
                  <p className="flex items-center gap-2 text-sm font-bold text-slate-900">
                    <MapPin className="h-4 w-4 text-emerald-500" />
                    {selectedSchedule.barangay_name}
                  </p>
                </div>
              </div>

              <div className="rounded-3xl border border-emerald-100 bg-emerald-50 p-4">
                <p className="mb-3 text-[10px] font-black uppercase tracking-[0.35em] text-emerald-700">
                  Collection Notes
                </p>
                <p className="text-sm leading-relaxed text-emerald-900">
                  {selectedSchedule.notes ||
                    "No additional route notes were published for this collection day."}
                </p>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-3xl border border-slate-100 bg-slate-50 p-4">
                  <p className="mb-3 text-[10px] font-black uppercase tracking-[0.35em] text-slate-400">
                    Your Access
                  </p>
                  <p className="text-sm font-bold text-slate-900">
                    {canManage
                      ? "Manage this barangay schedule"
                      : "View published schedule"}
                  </p>
                </div>
                <div className="rounded-3xl border border-slate-100 bg-slate-50 p-4">
                  <p className="mb-3 text-[10px] font-black uppercase tracking-[0.35em] text-slate-400">
                    Audience
                  </p>
                  <p className="text-sm font-bold text-slate-900">
                    Barangay residents and collection team
                  </p>
                </div>
              </div>

              <div
                className={`grid gap-3 ${canManage ? "sm:grid-cols-3" : ""}`}
              >
                {canManage && (
                  <button
                    type="button"
                    onClick={() => openEditForm(selectedSchedule)}
                    className="rounded-3xl bg-emerald-600 py-3 text-xs font-black uppercase tracking-[0.16em] text-white transition hover:bg-emerald-700"
                  >
                    Edit Schedule
                  </button>
                )}
                {canManage && (
                  <button
                    type="button"
                    onClick={() =>
                      openDeleteDialog(selectedSchedule)
                    }
                    className="rounded-3xl border border-rose-200 py-3 text-xs font-black uppercase tracking-[0.16em] text-rose-600 transition hover:bg-rose-50"
                  >
                    Delete
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setSelectedSchedule(null)}
                  className="rounded-3xl border border-slate-200 py-3 text-xs font-black uppercase tracking-[0.16em] text-slate-700 transition hover:bg-slate-50"
                >
                  Close Details
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && canManage && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/80 p-4 backdrop-blur-md"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-schedule-title"
        >
          <div className="w-full max-w-md rounded-[2rem] bg-white p-6 shadow-2xl">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-50 text-rose-600">
              <Trash2 className="h-6 w-6" />
            </div>
            <h3
              id="delete-schedule-title"
              className="mt-4 text-xl font-black text-slate-900"
            >
              Delete {deleteTarget.day_of_week} schedule?
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-500">
              Residents, leaders, and collectors will no longer see this
              weekly collection day.
            </p>
            {error && (
              <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
                {error}
              </div>
            )}
            <div className="mt-6 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className="rounded-3xl border border-slate-200 py-3 text-xs font-black uppercase tracking-[0.15em] text-slate-600 transition hover:bg-slate-50 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void deleteSchedule()}
                disabled={deleting}
                className="inline-flex items-center justify-center gap-2 rounded-3xl bg-rose-600 py-3 text-xs font-black uppercase tracking-[0.15em] text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {deleting && (
                  <Loader2 className="h-4 w-4 animate-spin" />
                )}
                {deleting ? "Deleting" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
