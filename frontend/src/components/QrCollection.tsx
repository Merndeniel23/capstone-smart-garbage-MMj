import { useEffect, useRef, useState } from "react";
import { apiRequest } from "../services/api";

type HouseholdBin = {bin_id: number; resident_id: number; full_name: string; bin_code: string; purok_name: string; collection_suspended_until: string | null; scanned_today: string | null};
type IdentifiedBin = Readonly<{payload: string; bin: Readonly<HouseholdBin>; key: string}>;
type Segregation = "segregated" | "not_segregated";

// The Collector goes straight to the purok: scan each bin, then tap
// Segregated or Not Segregated. The result goes to the Purok Leader.
export default function QrCollection({onSaved}: {onSaved: () => void}) {
  const [qr, setQr] = useState("");
  const [identified, setIdentified] = useState<IdentifiedBin | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [camera, setCamera] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const submitting = useRef(false);
  const identifiedRef = useRef<IdentifiedBin | null>(null);
  const qrRef = useRef("");
  const lookupVersion = useRef(0);
  const lookup = useRef<AbortController | null>(null);
  function changeQr(value: string, keepMessage = false) {
    if (submitting.current) return;
    lookupVersion.current++; lookup.current?.abort(); lookup.current = null;
    identifiedRef.current = null; setIdentified(null);
    qrRef.current = value; setQr(value); setBusy(false);
    if (!keepMessage) setMessage("");
    setCamera(false);
  }
  useEffect(() => () => { lookupVersion.current++; lookup.current?.abort(); identifiedRef.current = null; }, []);
  useEffect(()=>{
    if (!camera) return;
    let cancelled = false, timer: number | undefined;
    const Detector = (window as any).BarcodeDetector;
    if (!Detector || !navigator.mediaDevices?.getUserMedia) {setMessage("Camera QR scanning is unavailable here. Use a QR scanner that types into the QR field.");setCamera(false);return;}
    void (async()=>{
      try {
        const feed = await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"}},audio:false});
        if (cancelled) {feed.getTracks().forEach(track=>track.stop());return;}
        stream.current = feed;
        if (video.current) {video.current.srcObject = feed;await video.current.play();}
        const detector = new Detector({formats:["qr_code"]});
        const scan = async()=>{
          if (cancelled) return;
          try {
            if (video.current?.readyState === 4) {
              const results = await detector.detect(video.current);
              if (results[0]?.rawValue) {changeQr(results[0].rawValue);void identify();return;}
            }
          } catch { /* Retry a frame without keeping a failed frame. */ }
          if (!cancelled) timer = window.setTimeout(()=>void scan(),300);
        };
        void scan();
      } catch {if (!cancelled) {setMessage("Unable to access the camera. Allow camera access or use a QR scanner.");setCamera(false);}}
    })();
    return ()=>{cancelled=true;window.clearTimeout(timer);stream.current?.getTracks().forEach(track=>track.stop());stream.current=null;};
  },[camera]);
  async function identify() {
    if (submitting.current || !qrRef.current.trim()) return;
    const payload = qrRef.current.trim(), version = ++lookupVersion.current;
    lookup.current?.abort();
    const controller = new AbortController(); lookup.current = controller;
    identifiedRef.current = null; setIdentified(null); setCamera(false); setBusy(true); setMessage("");
    try {
      const data = await apiRequest<{bin: HouseholdBin}>("/sgms/collections/identify", {method:"POST", signal:controller.signal, body:JSON.stringify({qrPayload:payload})});
      if (controller.signal.aborted || version !== lookupVersion.current || qrRef.current.trim() !== payload) return;
      if (!Number.isSafeInteger(data.bin?.bin_id) || !Number.isSafeInteger(data.bin?.resident_id)) throw new Error("The QR lookup returned an invalid household bin.");
      const record = Object.freeze({payload, bin:Object.freeze({...data.bin}), key:crypto.randomUUID()});
      identifiedRef.current = record; setIdentified(record);
    } catch (error) {
      if (!controller.signal.aborted && version === lookupVersion.current) setMessage(error instanceof Error ? error.message : "QR lookup failed.");
    } finally { if (version === lookupVersion.current) { lookup.current = null; setBusy(false); } }
  }
  async function save(segregation: Segregation) {
    const record = identifiedRef.current;
    if (!record || record !== identified || record.payload !== qrRef.current.trim() || submitting.current) return;
    submitting.current=true;setBusy(true);setMessage("");
    try {
      const result=await apiRequest<{message:string}>("/sgms/collections",{method:"POST",body:JSON.stringify({qrPayload:record.payload,segregation,idempotencyKey:record.key})});
      if (identifiedRef.current === record) {
        submitting.current=false;
        changeQr("", true);
        setMessage(`${record.bin.bin_code} · ${record.bin.full_name}: ${segregation === "segregated" ? "Segregated" : "Not Segregated"}. ${result.message}`);
        onSaved();
      }
    }
    catch (error) {setMessage(error instanceof Error ? error.message : "Unable to record the scan.");}
    finally {setBusy(false);submitting.current=false;}
  }
  const bin = identified?.bin;
  return <section aria-label="Household QR collection" className="space-y-3 rounded-2xl border bg-white p-4">
    <h2 className="text-lg font-black">Scan household bin</h2>
    <p className="text-sm text-slate-600">Scan the bin's QR code, then tap whether the garbage is segregated. The Purok Leader is notified right away.</p>
    <div className="flex flex-wrap gap-2">
      <input aria-label="Household bin QR payload" value={qr} disabled={submitting.current} onChange={e=>changeQr(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();void identify();}}} className="min-w-0 flex-1 rounded-xl border p-3" placeholder="Scan QR into this field" />
      <button type="button" disabled={busy || !qr.trim()} onClick={()=>void identify()} className="rounded-xl bg-emerald-700 p-3 font-bold text-white disabled:opacity-50">Identify bin</button>
      <button type="button" disabled={busy} onClick={()=>{if(camera)setCamera(false);else{changeQr("");setCamera(true);}}} className="rounded-xl border p-3 font-bold">{camera?"Stop camera":"Scan with camera"}</button>
    </div>
    {camera&&<video ref={video} muted playsInline className="max-h-64 w-full rounded-xl bg-black" />}
    {bin&&<div className="space-y-3 rounded-xl bg-slate-50 p-4">
      <div>
        <p className="text-xs font-black uppercase tracking-wider text-slate-500">QR {bin.bin_code} · {bin.purok_name}</p>
        <p className="text-lg font-black text-slate-900">{bin.full_name}</p>
      </div>
      {bin.scanned_today&&<p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm font-semibold text-amber-800">This bin was already scanned today ({bin.scanned_today === "segregated" ? "Segregated" : "Not Segregated"}).</p>}
      {bin.collection_suspended_until&&<p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm font-semibold text-rose-800">Collection service is suspended until {new Date(bin.collection_suspended_until).toLocaleDateString("en-PH",{timeZone:"Asia/Manila"})}. Record the result but do not collect the garbage.</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <button type="button" disabled={busy||Boolean(bin.scanned_today)} onClick={()=>void save("segregated")} className="rounded-2xl bg-emerald-600 px-4 py-5 text-base font-black text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50">✓ Segregated</button>
        <button type="button" disabled={busy||Boolean(bin.scanned_today)} onClick={()=>void save("not_segregated")} className="rounded-2xl bg-rose-600 px-4 py-5 text-base font-black text-white shadow-sm transition hover:bg-rose-700 disabled:opacity-50">✗ Not Segregated</button>
      </div>
    </div>}
    <p role="status" className="text-sm font-semibold text-slate-700">{message}</p>
  </section>;
}
