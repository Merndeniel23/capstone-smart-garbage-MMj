// User-triggered print/Save as PDF, isolated from dashboard content and styling.
// DOM/text nodes only: approved text is never interpreted as HTML or script.
export async function printDocument(title: string, content: Element): Promise<void> {
  const frame = document.createElement("iframe");
  frame.title = title;
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;left:-10000px;top:0;width:800px;height:1000px;border:0";
  document.body.appendChild(frame);
  try {
    const target = frame.contentDocument;
    const view = frame.contentWindow;
    if (!target || !view) throw new Error("Printing is unavailable. Use the download option instead.");
    target.title = title;
    target.documentElement.lang = "en";
    const style = target.createElement("style");
    style.textContent = "@page{size:A4;margin:18mm}body{margin:0;color:#000;background:#fff;font:12pt Arial,sans-serif}pre{font:inherit;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere}svg{display:block;width:70mm;height:auto;max-width:100%}h1{font-size:14pt}p{line-height:1.5}";
    target.head.appendChild(style);
    target.body.appendChild(target.importNode(content, true));
    await target.fonts?.ready;
    await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()));
    view.addEventListener("afterprint", () => frame.remove(), { once: true });
    view.print();
    window.setTimeout(() => frame.remove(), 60_000);
  } catch (error) {
    frame.remove();
    throw error;
  }
}
