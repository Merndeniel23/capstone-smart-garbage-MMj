/** Minimal text-only PDF, with no invented letterhead, signatures or seals.
 * Content is the officially approved template snapshotted during approval. */
const extraWinAnsi: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84,
  0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88,
  0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c,
  0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93,
  0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
  0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b,
  0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};

export function supportsTextPdf(text: string): boolean {
  return Array.from(text).every(character => {
    const code = character.codePointAt(0)!;
    return [9, 10, 13].includes(code) || (code >= 32 && code <= 126) ||
      (code >= 160 && code <= 255) || Object.prototype.hasOwnProperty.call(extraWinAnsi, code);
  });
}

export function createTextPdf(text: string): Buffer {
  if (!supportsTextPdf(text)) throw new Error("Use the approved document's Unicode print/Save as PDF option.");
  const lines: string[] = [];
  for (const paragraph of text.replace(/\r\n?/g, "\n").replaceAll("\t", "    ").split("\n")) {
    let line = "";
    // A conservative width also bounds long unbroken names/addresses.
    // Helvetica's widest WinAnsi glyph fits within 1.1em.
    for (const character of paragraph) {
      if (line.length >= 41) {
        const space = line.lastIndexOf(" ");
        if (space > 0) { lines.push(line.slice(0, space)); line = line.slice(space + 1); }
        else { lines.push(line); line = ""; }
      }
      line += character;
    }
    lines.push(line);
  }
  const objects: string[] = ["", "", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"];
  const pages: number[] = [];
  for (let offset = 0; offset < Math.max(lines.length,1); offset += 48) {
    const pageId = objects.length + 1, streamId = pageId + 1;
    pages.push(pageId);
    const escaped = lines.slice(offset,offset+48).map(line => Array.from(line, character => {
      const code = character.codePointAt(0)!;
      return String.fromCharCode(extraWinAnsi[code] ?? code);
    }).join("").replace(/([\\()])/g,"\\$1"));
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
