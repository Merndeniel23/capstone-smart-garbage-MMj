import { useEffect, useRef, useState } from "react";
import { apiRequest } from "../services/api";

export default function QrCollection({onSaved}: {onSaved: () => void}) {
  const [qr, setQr] = useState("");
  const [bin, setBin] = useState<any>(null);
  const [segregation, setSegregation] = useState("");
  const [collectionStatus, setCollectionStatus] = useState("collected");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [camera, setCamera] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const submitting = useRef(false);
  const key = useRef("");
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
              if (results[0]?.rawValue) {setQr(results[0].rawValue);setBin(null);setCamera(false);return;}
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
    setBusy(true);setMessage("");setBin(null);
    try {const data = await apiRequest<any>("/sgms/collections/identify",{method:"POST",body:JSON.stringify({qrPayload:qr.trim()})});setBin(data.bin);key.current=crypto.randomUUID();setSegregation("");}
    catch (error) {setMessage(error instanceof Error ? error.message : "QR lookup failed.");}
    finally {setBusy(false);}
  }
  async function save() {
    if (!bin || !segregation || submitting.current) return;
    submitting.current=true;setBusy(true);setMessage("");
    try {const result=await apiRequest<any>("/sgms/collections",{method:"POST",body:JSON.stringify({qrPayload:qr.trim(),segregation,collectionStatus,idempotencyKey:key.current})});setMessage(result.message);setBin(null);setQr("");onSaved();}
    catch (error) {setMessage(error instanceof Error ? error.message : "Unable to record collection.");}
    finally {setBusy(false);submitting.current=false;}
  }
  return <section aria-label="Household QR collection" className="rounded-2xl border bg-white p-4 space-y-3"><h2 className="text-lg font-black">Scan household bin</h2><p className="text-sm text-slate-600">Start today's assigned run, scan the registered bin, then record its segregation result.</p><div className="flex flex-wrap gap-2"><input aria-label="Household bin QR payload" value={qr} onChange={e=>{setQr(e.target.value);setBin(null);}} className="min-w-0 flex-1 rounded-xl border p-3" placeholder="Scan QR into this field" /><button type="button" disabled={busy || !qr.trim()} onClick={()=>void identify()} className="rounded-xl bg-emerald-700 p-3 text-white disabled:opacity-50">Identify bin</button><button type="button" onClick={()=>setCamera(value=>!value)} className="rounded-xl border p-3">{camera?"Stop camera":"Scan with camera"}</button></div>{camera&&<video ref={video} muted playsInline className="max-h-64 w-full rounded-xl bg-black" />}{bin&&<div className="space-y-3 rounded-xl bg-slate-50 p-3"><p className="font-bold">{bin.full_name} · {bin.bin_code} · {bin.purok_name}</p><fieldset className="flex gap-4"><legend className="text-sm font-bold">Segregation result</legend>{[["segregated","Segregated"],["not_segregated","Not Segregated"]].map(([value,label])=><label key={value} className="flex items-center gap-2"><input type="radio" name="segregation" value={value} checked={segregation===value} onChange={()=>setSegregation(value)} />{label}</label>)}</fieldset><label className="block text-sm">Collection status<select value={collectionStatus} onChange={e=>setCollectionStatus(e.target.value)} className="ml-2 rounded border p-2"><option value="collected">Collected</option><option value="not_collected">Not collected</option></select></label><button type="button" disabled={busy||!segregation} onClick={()=>void save()} className="rounded-xl bg-emerald-700 p-3 text-white disabled:opacity-50">Save collection result</button></div>}<p role="status" className="text-sm">{message}</p></section>;
}
