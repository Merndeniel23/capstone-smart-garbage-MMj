import { useEffect, useRef, useState } from "react";
import { apiRequest } from "../services/api";

type HouseholdBin = {bin_id: number; resident_id: number; full_name: string; bin_code: string; purok_name: string};
type IdentifiedBin = Readonly<{payload: string; bin: Readonly<HouseholdBin>; key: string}>;

export default function QrCollection({onSaved}: {onSaved: () => void}) {
  const [qr, setQr] = useState("");
  const [identified, setIdentified] = useState<IdentifiedBin | null>(null);
  const [segregation, setSegregation] = useState("");
  const [collectionStatus, setCollectionStatus] = useState("collected");
  const [notCollectedReason, setNotCollectedReason] = useState("");
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
  function changeQr(value: string) {
    if (submitting.current) return;
    lookupVersion.current++; lookup.current?.abort(); lookup.current = null;
    identifiedRef.current = null; setIdentified(null);
    qrRef.current = value; setQr(value); setBusy(false); setMessage("");
    setSegregation(""); setNotCollectedReason(""); setCamera(false);
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
              if (results[0]?.rawValue) {changeQr(results[0].rawValue);return;}
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
      setSegregation(""); setCollectionStatus("collected"); setNotCollectedReason("");
    } catch (error) {
      if (!controller.signal.aborted && version === lookupVersion.current) setMessage(error instanceof Error ? error.message : "QR lookup failed.");
    } finally { if (version === lookupVersion.current) { lookup.current = null; setBusy(false); } }
  }
  async function save() {
    const record = identifiedRef.current;
    if (!record || record !== identified || record.payload !== qrRef.current.trim() || !segregation || submitting.current) return;
    if (collectionStatus === "not_collected" && !notCollectedReason.trim()) {setMessage("Enter a reason for Not Collected.");return;}
    submitting.current=true;setBusy(true);setMessage("");
    try {
      const result=await apiRequest<{message:string}>("/sgms/collections",{method:"POST",body:JSON.stringify({qrPayload:record.payload,segregation,collectionStatus,notCollectedReason:collectionStatus === "not_collected" ? notCollectedReason.trim() : null,idempotencyKey:record.key})});
      if (identifiedRef.current === record) { setMessage(result.message); identifiedRef.current=null; setIdentified(null); qrRef.current=""; setQr(""); onSaved(); }
    }
    catch (error) {setMessage(error instanceof Error ? error.message : "Unable to record collection.");}
    finally {setBusy(false);submitting.current=false;}
  }
  const bin = identified?.bin;
  return <section aria-label="Household QR collection" className="rounded-2xl border bg-white p-4 space-y-3"><h2 className="text-lg font-black">Scan household bin</h2><p className="text-sm text-slate-600">Start today's assigned run, scan the registered bin, then record its segregation result.</p><div className="flex flex-wrap gap-2"><input aria-label="Household bin QR payload" value={qr} disabled={submitting.current} onChange={e=>changeQr(e.target.value)} className="min-w-0 flex-1 rounded-xl border p-3" placeholder="Scan QR into this field" /><button type="button" disabled={busy || !qr.trim()} onClick={()=>void identify()} className="rounded-xl bg-emerald-700 p-3 text-white disabled:opacity-50">Identify bin</button><button type="button" disabled={busy} onClick={()=>{if(camera)setCamera(false);else{changeQr("");setCamera(true);}}} className="rounded-xl border p-3">{camera?"Stop camera":"Scan with camera"}</button></div>{camera&&<video ref={video} muted playsInline className="max-h-64 w-full rounded-xl bg-black" />}{bin&&<div className="space-y-3 rounded-xl bg-slate-50 p-3"><p className="font-bold">{bin.full_name} · {bin.bin_code} · {bin.purok_name}</p><fieldset className="flex gap-4"><legend className="text-sm font-bold">Segregation result</legend>{[["segregated","Segregated"],["not_segregated","Not Segregated"]].map(([value,label])=><label key={value} className="flex items-center gap-2"><input type="radio" name="segregation" value={value} checked={segregation===value} onChange={()=>setSegregation(value)} />{label}</label>)}</fieldset><label className="block text-sm">Collection status<select value={collectionStatus} onChange={e=>setCollectionStatus(e.target.value)} className="ml-2 rounded border p-2"><option value="collected">Collected</option><option value="not_collected">Not collected</option></select></label>{collectionStatus==="not_collected"&&<label className="block text-sm font-bold">Reason for Not Collected<textarea required maxLength={1000} value={notCollectedReason} onChange={event=>setNotCollectedReason(event.target.value)} className="mt-2 w-full rounded-xl border p-3" placeholder="Explain why this scanned bin was not collected"/></label>}<button type="button" disabled={busy||!segregation||(collectionStatus==="not_collected"&&!notCollectedReason.trim())} onClick={()=>void save()} className="rounded-xl bg-emerald-700 p-3 text-white disabled:opacity-50">Save collection result</button></div>}<p role="status" className="text-sm">{message}</p></section>;
}
