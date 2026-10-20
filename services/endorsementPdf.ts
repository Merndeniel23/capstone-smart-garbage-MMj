/** Minimal text-only PDF, with no invented letterhead, signatures or seals.
 * Content is the officially approved template snapshotted during approval. */
export function createTextPdf(text: string): Buffer {
  const lines: string[] = [];
  for (const paragraph of text.replaceAll("\r", "").split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      if ((line + " " + word).length > 88 && line) { lines.push(line); line = ""; }
      line += (line ? " " : "") + word;
    }
    lines.push(line);
  }
  const objects: string[] = ["", "", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"];
  const pages: number[] = [];
  for (let offset = 0; offset < Math.max(lines.length,1); offset += 48) {
    const pageId = objects.length + 1, streamId = pageId + 1;
    pages.push(pageId);
    const escaped = lines.slice(offset,offset+48).map(line=>line.replace(/[\u2018\u2019]/g,"'").replace(/[\u201c\u201d]/g,'"').replace(/[\u2013\u2014]/g,"-").replace(/[^\x20-\xff]/g,"?").replace(/([\\()])/g,"\\$1"));
    const content = `BT /F1 11 Tf 14 TL 48 790 Td ${escaped.map((line,i)=>`${i ? "T* " : ""}(${line}) Tj`).join("\n")} ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${streamId} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(content,"latin1")} >>\nstream\n${content}\nendstream`);
  }
  objects[0] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[1] = `<< /Type /Pages /Kids [${pages.map(id=>`${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  let document = "%PDF-1.4\n", offsets = [0];
  for (let i=0;i<objects.length;i++) { offsets.push(Buffer.byteLength(document,"latin1")); document += `${i+1} 0 obj\n${objects[i]}\nendobj\n`; }
  const xref = Buffer.byteLength(document,"latin1");
  document += `xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(n=>`${String(n).padStart(10,"0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(document,"latin1");
}
