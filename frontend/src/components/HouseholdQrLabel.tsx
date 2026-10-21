import { useId, useMemo, useRef, useState } from "react";
import { householdQrPath } from "../services/householdQr";
import { printDocument } from "../services/printDocument";

export type HouseholdQrLabelData = { payload: string; householdId: number; binId: number; binCode: string };

export default function HouseholdQrLabel({ label }: { label: HouseholdQrLabelData }) {
  const titleId = useId();
  const svg = useRef<SVGSVGElement>(null);
  const [message, setMessage] = useState("");
  const qr = useMemo(() => {
    try { return householdQrPath(label.payload); }
    catch { return null; }
  }, [label.payload]);
  if (!qr) return <p role="alert">The registered QR payload cannot be rendered. Register it again before labeling the bin.</p>;
  const filename = `household-${label.householdId}-bin-${label.binId}.svg`;
  const download = () => {
    if (!svg.current) return;
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg.current)], { type: "image/svg+xml;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = filename;
    document.body.appendChild(anchor); anchor.click(); anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <section className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4" aria-label="Registered household bin QR label">
    <h3 className="font-bold">Save the newly registered QR label</h3>
    <p className="text-sm">This label is shown once. Download or print it before leaving. Rotating the QR invalidates the previous label.</p>
    <svg ref={svg} xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${qr.size} ${qr.size + 9}`} width="328" height="400" role="img" aria-labelledby={titleId} className="max-w-full bg-white" shapeRendering="crispEdges">
      <title id={titleId}>SGMS bin {label.binCode}, household HH-{label.householdId}</title>
      <rect width={qr.size} height={qr.size + 9} fill="white" />
      <path d={qr.path} fill="black" />
      <text x={qr.size / 2} y={qr.size + 3} textAnchor="middle" fontFamily="Arial, sans-serif" fontSize="2" fill="black" shapeRendering="auto">{label.binCode.slice(0, 35)}</text>
      <text x={qr.size / 2} y={qr.size + 6} textAnchor="middle" fontFamily="Arial, sans-serif" fontSize="2" fill="black" shapeRendering="auto">SGMS · HH-{label.householdId} · Bin #{label.binId}</text>
    </svg>
    <div className="flex flex-wrap gap-2"><button type="button" onClick={download} className="rounded-xl border bg-white px-4 py-2 font-bold">Download QR label</button><button type="button" onClick={() => { if (svg.current) void printDocument(`SGMS household ${label.householdId} bin ${label.binId}`, svg.current).catch(error => setMessage(error instanceof Error ? error.message : "Unable to print.")); }} className="rounded-xl border bg-white px-4 py-2 font-bold">Print label</button></div>
    <p className="text-xs">Generated locally. The label contains a random bin token, not household names, contact details or passwords.</p>
    <p role="status" className="text-sm">{message}</p>
  </section>;
}
