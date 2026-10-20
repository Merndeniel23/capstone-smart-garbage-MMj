import { Children, cloneElement, isValidElement, useEffect, useRef, type ReactNode, type ReactElement } from "react";
import { createPortal } from "react-dom";

let overlayCount = 0;
let oldOverflow = "";
let rootWasInert = false;
function AccessibleOverlay({children}: {children: ReactNode}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const previous = document.activeElement as HTMLElement | null;
    const root = document.getElementById("root");
    if (overlayCount++ === 0) { oldOverflow = document.body.style.overflow; rootWasInert = Boolean(root?.inert); if (root) root.inert = true; }
    document.body.style.overflow = "hidden";
    if(ref.current&&!ref.current.querySelector('[role="dialog"],dialog')) {
      ref.current.setAttribute("role","dialog");ref.current.setAttribute("aria-modal","true");
      ref.current.setAttribute("aria-label",ref.current.querySelector("h1,h2,h3")?.textContent||"Dialog");
    }
    const focusable = () => Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]') || []).filter(el=>el.getClientRects().length > 0);
    (focusable()[0] || ref.current)?.focus();
    const keydown = (event: KeyboardEvent) => {
      const layers = document.querySelectorAll("[data-sg-portal]");
      if (layers[layers.length-1] !== ref.current || document.querySelector("dialog[open]")) return;
      if (event.key === "Tab") {
        const items = focusable(), first = items[0], last = items[items.length-1];
        if (!first) {event.preventDefault();ref.current?.focus();}
        else if (event.shiftKey && (document.activeElement === first || !ref.current?.contains(document.activeElement))) {event.preventDefault();last.focus();}
        else if (!event.shiftKey && (document.activeElement === last || !ref.current?.contains(document.activeElement))) {event.preventDefault();first.focus();}
      }
      if (event.key === "Escape") {
        const button = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") || []).find(el=>/^close|^cancel/i.test(el.getAttribute("aria-label") || el.textContent?.trim() || ""));
        if (button) {event.preventDefault();button.click();}
      }
    };
    document.addEventListener("keydown",keydown);
    return ()=>{document.removeEventListener("keydown",keydown); if (--overlayCount === 0) { document.body.style.overflow = oldOverflow; if (root) root.inert = rootWasInert; } previous?.focus();};
  },[]);
  return createPortal(<div ref={ref} tabIndex={-1} data-sg-portal className="sg-app-shell">{children}</div>,document.body);
}
/** Only portals existing fixed full-screen overlays; leaves page layout intact. */
export function portalOverlays(children: ReactNode) {
  function walk(node: ReactNode): ReactNode {
    return Children.map(node, child=>{
      if (!isValidElement(child)) return child;
      const element = child as ReactElement<{className?: string; children?: ReactNode}>;
      if(element.type === "dialog") return element;
      const classes = String(element.props.className || "").split(/\s+/);
      if (classes.includes("fixed") && classes.includes("inset-0")) return <AccessibleOverlay>{element}</AccessibleOverlay>;
      return element.props.children == null ? element : cloneElement(element, undefined, walk(element.props.children));
    });
  }
  return <>{walk(children)}</>;
}
export default function PortalOverlays({children}: {children: ReactNode}) { return portalOverlays(children); }
