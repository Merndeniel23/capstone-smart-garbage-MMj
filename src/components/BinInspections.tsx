import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react';
import {
  Camera,
  ClipboardCheck,
  MapPin,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';
import { useAppState } from '../context/AppStateContext';

type DatabaseStatus =
  | 'empty'
  | 'half_full'
  | 'full'
  | 'overflowing'
  | 'damaged';

interface InspectionRecord {
  id: number;
  bin_id?: number;
  bin_code: string | null;
  inspector: string | null;
  status: DatabaseStatus;
  estimated_fill_level: number | null;
  remarks: string | null;
  photo_path: string | null;
  inspected_at: string;
}

interface InspectionForm {
  binId: string;
  status: DatabaseStatus;
  estimatedFillLevel: string;
  remarks: string;
  photoPath: string;
}

const API_URL = '/api/inspections';

function getToken(): string {
  return (
    localStorage.getItem('token') ||
    localStorage.getItem('authToken') ||
    sessionStorage.getItem('token') ||
    sessionStorage.getItem('authToken') ||
    ''
  );
}

async function apiRequest(
  url: string,
  options: RequestInit = {},
) {
  const token = getToken();

  if (!token) {
    throw new Error(
      'Your login session is missing. Please log out and log in again.',
    );
  }

  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || 'Request failed.');
  }

  return data;
}

const defaultForm: InspectionForm = {
  binId: '',
  status: 'half_full',
  estimatedFillLevel: '50',
  remarks: '',
  photoPath: '',
};

const fillLevelByStatus: Record<DatabaseStatus, number> = {
  empty: 10,
  half_full: 50,
  full: 90,
  overflowing: 100,
  damaged: 0,
};

const statusLabel: Record<DatabaseStatus, string> = {
  empty: 'Empty',
  half_full: 'Half-full',
  full: 'Full',
  overflowing: 'Overflowing',
  damaged: 'Damaged',
};

export default function BinInspections() {
  const { userRole } = useAppState();
  const canCreateInspection = userRole === 'leader';
  const [inspections, setInspections] = useState<InspectionRecord[]>([]);
  const [form, setForm] = useState<InspectionForm>(defaultForm);
  const [showForm, setShowForm] = useState(false);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const loadInspections = async () => {
    setLoading(true);
    setError('');

    try {
      const data = await apiRequest(API_URL);

      setInspections(
        Array.isArray(data)
          ? data
          : Array.isArray(data.inspections)
            ? data.inspections
            : [],
      );
    } catch (err) {
      console.error(err);
      setError(
        err instanceof Error
          ? err.message
          : 'Cannot load inspections.',
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadInspections();
  }, []);

  const stats = useMemo(
    () => ({
      total: inspections.length,
      urgent: inspections.filter(
        (item) =>
          item.status === 'full' || item.status === 'overflowing',
      ).length,
      damaged: inspections.filter(
        (item) => item.status === 'damaged',
      ).length,
    }),
    [inspections],
  );

  const handleStatusChange = (status: DatabaseStatus) => {
    setForm((previous) => ({
      ...previous,
      status,
      estimatedFillLevel: String(fillLevelByStatus[status]),
    }));
  };

  const submitInspection = async (event: FormEvent) => {
    event.preventDefault();

    setError('');
    setSuccessMessage('');

    const binId = Number(form.binId);
    const estimatedFillLevel = Number(form.estimatedFillLevel);

    if (!Number.isInteger(binId) || binId <= 0) {
      setError('Please enter a valid numeric Bin ID.');
      return;
    }

    if (
      !Number.isInteger(estimatedFillLevel) ||
      estimatedFillLevel < 0 ||
      estimatedFillLevel > 100
    ) {
      setError('Estimated fill level must be from 0 to 100.');
      return;
    }

    setSubmitting(true);

    try {
      const data = await apiRequest(API_URL, {
        method: 'POST',
        body: JSON.stringify({
          bin_id: binId,
          status: form.status,
          estimated_fill_level: estimatedFillLevel,
          remarks: form.remarks.trim() || null,
          photo_path: form.photoPath.trim() || null,
        }),
      });

      setSuccessMessage(
        data.message || 'Inspection saved successfully.',
      );

      setForm(defaultForm);
      setShowForm(false);

      await loadInspections();
    } catch (err) {
      console.error(err);

      setError(
        err instanceof Error
          ? err.message
          : 'Failed to save inspection.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const renderStatusBadge = (status: DatabaseStatus) => {
    let classes = 'bg-emerald-100 text-emerald-700';

    if (status === 'full' || status === 'overflowing') {
      classes = 'bg-rose-100 text-rose-700';
    } else if (status === 'damaged') {
      classes = 'bg-amber-100 text-amber-700';
    }

    return (
      <span
        className={`px-3 py-1 rounded-full text-[10px] font-black uppercase ${classes}`}
      >
        {statusLabel[status]}
      </span>
    );
  };

  const formatDate = (dateValue: string) => {
    if (!dateValue) {
      return 'No inspection date';
    }

    const date = new Date(dateValue);

    if (Number.isNaN(date.getTime())) {
      return dateValue;
    }

    return date.toLocaleString();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-widest text-emerald-600">
            Manual Monitoring
          </p>

          <h1 className="text-3xl font-black text-slate-900">
            Garbage Bin Inspections
          </h1>

          <p className="text-sm text-slate-500 mt-1">
            Purok Leaders inspect garbage bins and submit their actual
            field condition.
          </p>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={loadInspections}
            disabled={loading}
            className="flex items-center justify-center gap-2 bg-white text-slate-700 px-4 py-3 rounded-2xl font-black text-sm border border-slate-200 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw
              className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`}
            />
            Refresh
          </button>

          {canCreateInspection && (
            <button
              type="button"
              onClick={() => {
                setShowForm((previous) => !previous);
                setError('');
                setSuccessMessage('');
              }}
              className="flex items-center justify-center gap-2 bg-emerald-600 text-white px-5 py-3 rounded-2xl font-black text-sm border-none cursor-pointer shadow-lg shadow-emerald-600/20"
            >
              {showForm ? (
                <X className="w-4 h-4" />
              ) : (
                <Plus className="w-4 h-4" />
              )}

              {showForm ? 'Close Form' : 'New Inspection'}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">
          {error}
        </div>
      )}

      {successMessage && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">
          {successMessage}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm">
          <ClipboardCheck className="w-5 h-5 text-emerald-600 mb-3" />
          <span className="text-2xl font-black block">
            {stats.total}
          </span>
          <span className="text-[10px] font-black uppercase text-slate-400">
            Total Inspections
          </span>
        </div>

        <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm">
          <Trash2 className="w-5 h-5 text-rose-600 mb-3" />
          <span className="text-2xl font-black block">
            {stats.urgent}
          </span>
          <span className="text-[10px] font-black uppercase text-slate-400">
            Needs Collection
          </span>
        </div>

        <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm">
          <Camera className="w-5 h-5 text-amber-600 mb-3" />
          <span className="text-2xl font-black block">
            {stats.damaged}
          </span>
          <span className="text-[10px] font-black uppercase text-slate-400">
            Damaged Bins
          </span>
        </div>
      </div>

      {canCreateInspection && showForm && (
        <form
          onSubmit={submitInspection}
          className="bg-white rounded-3xl border border-slate-100 shadow-xl p-6 space-y-4"
        >
          <div>
            <h2 className="font-black text-xl">
              Record Physical Inspection
            </h2>

            <p className="text-xs text-slate-500 mt-1">
              Your Purok Leader account is detected automatically from your login token.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <label className="text-xs font-bold text-slate-600">
              Numeric Bin ID

              <input
                type="number"
                min="1"
                required
                placeholder="Example: 1"
                value={form.binId}
                onChange={(event) =>
                  setForm((previous) => ({
                    ...previous,
                    binId: event.target.value,
                  }))
                }
                className="mt-2 w-full p-3 rounded-xl border border-slate-200"
              />
            </label>

            <label className="text-xs font-bold text-slate-600">
              Observed Status

              <select
                value={form.status}
                onChange={(event) =>
                  handleStatusChange(
                    event.target.value as DatabaseStatus,
                  )
                }
                className="mt-2 w-full p-3 rounded-xl border border-slate-200 bg-white"
              >
                <option value="empty">Empty</option>
                <option value="half_full">Half-full</option>
                <option value="full">Full</option>
                <option value="overflowing">Overflowing</option>
                <option value="damaged">Damaged</option>
              </select>
            </label>

            <label className="text-xs font-bold text-slate-600">
              Estimated Fill Level (%)

              <input
                type="number"
                min="0"
                max="100"
                required
                value={form.estimatedFillLevel}
                onChange={(event) =>
                  setForm((previous) => ({
                    ...previous,
                    estimatedFillLevel: event.target.value,
                  }))
                }
                className="mt-2 w-full p-3 rounded-xl border border-slate-200"
              />
            </label>

            <label className="text-xs font-bold text-slate-600 md:col-span-2">
              Photo Path or URL (optional)

              <input
                type="text"
                placeholder="Example: /uploads/bin-photo.jpg"
                value={form.photoPath}
                onChange={(event) =>
                  setForm((previous) => ({
                    ...previous,
                    photoPath: event.target.value,
                  }))
                }
                className="mt-2 w-full p-3 rounded-xl border border-slate-200"
              />
            </label>

            <label className="text-xs font-bold text-slate-600 md:col-span-2">
              Remarks

              <textarea
                rows={3}
                placeholder="Describe the condition of the garbage bin."
                value={form.remarks}
                onChange={(event) =>
                  setForm((previous) => ({
                    ...previous,
                    remarks: event.target.value,
                  }))
                }
                className="mt-2 w-full p-3 rounded-xl border border-slate-200"
              />
            </label>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full md:w-auto bg-slate-900 text-white px-6 py-3 rounded-xl font-black border-none cursor-pointer disabled:opacity-50"
          >
            {submitting ? 'Saving Inspection...' : 'Submit Inspection'}
          </button>
        </form>
      )}

      <div className="space-y-3">
        {loading ? (
          <div className="bg-white rounded-3xl border border-slate-100 p-8 text-center text-sm font-bold text-slate-500">
            Loading inspection records...
          </div>
        ) : inspections.length === 0 ? (
          <div className="bg-white rounded-3xl border border-slate-100 p-8 text-center">
            <ClipboardCheck className="w-10 h-10 text-slate-300 mx-auto mb-3" />

            <h3 className="font-black text-slate-700">
              No inspection records yet
            </h3>

            <p className="text-sm text-slate-500 mt-1">
              Click New Inspection to create the first record.
            </p>
          </div>
        ) : (
          inspections.map((item) => (
            <article
              key={item.id}
              className="bg-white rounded-3xl border border-slate-100 p-5 shadow-sm flex flex-col md:flex-row gap-5"
            >
              {item.photo_path ? (
                <img
                  src={item.photo_path}
                  alt="Garbage bin inspection"
                  className="w-full md:w-32 h-32 rounded-2xl object-cover border border-slate-100"
                />
              ) : (
                <div className="w-full md:w-32 h-28 rounded-2xl bg-slate-100 flex items-center justify-center">
                  <Camera className="text-slate-300" />
                </div>
              )}

              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  {renderStatusBadge(item.status)}

                  <span className="text-xs font-mono font-bold text-slate-400">
                    Inspection #{item.id}
                  </span>
                </div>

                <h3 className="font-black text-lg">
                  {item.bin_code || `Bin ID ${item.bin_id || 'Unknown'}`}
                  {' · '}
                  {item.estimated_fill_level ?? 0}% estimated
                </h3>

                <p className="text-sm text-slate-500 flex items-center gap-1 mt-1">
                  <MapPin className="w-4 h-4" />
                  Physical garbage-bin inspection
                </p>

                <p className="text-sm text-slate-700 mt-3">
                  {item.remarks || 'No remarks provided.'}
                </p>

                <p className="text-[11px] text-slate-400 mt-3">
                  Inspected by {item.inspector || 'Unknown Purok Leader'}
                  {' · '}
                  {formatDate(item.inspected_at)}
                </p>
              </div>
            </article>
          ))
        )}
      </div>
    </div>
  );
}
