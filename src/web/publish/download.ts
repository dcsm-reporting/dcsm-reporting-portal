import { toPng } from "html-to-image";
import { jsPDF } from "jspdf";

/** Render a DOM node to a PNG and trigger a download. 2× for crisp phone display. */
export async function downloadPng(node: HTMLElement, filename: string): Promise<void> {
  const dataUrl = await toPng(node, {
    pixelRatio: 2,
    cacheBust: true,
    backgroundColor: getComputedStyle(node).backgroundColor || "#ffffff",
  });
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename.endsWith(".png") ? filename : `${filename}.png`;
  a.click();
}

/**
 * Render a node straight to a downloaded PDF (no browser print dialog, which
 * mangled the layout). Uses jsPDF's html2canvas path, which draws text directly
 * and paginates automatically.
 */
export async function downloadPdf(node: HTMLElement, filename: string): Promise<void> {
  const pdf = new jsPDF({ unit: "pt", format: "letter" });
  const margin = 28;
  const pageW = pdf.internal.pageSize.getWidth();
  await pdf.html(node, {
    x: margin,
    y: margin,
    width: pageW - margin * 2,
    windowWidth: node.offsetWidth || 780,
    autoPaging: "text",
    html2canvas: { scale: 2, backgroundColor: "#ffffff", useCORS: true },
  });
  pdf.save(filename.endsWith(".pdf") ? filename : `${filename}.pdf`);
}

async function writeClipboard(html: string, text: string): Promise<boolean> {
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([text], { type: "text/plain" }),
      }),
    ]);
    return true;
  } catch {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }
}

/** Copy an element's rich HTML to the clipboard so it pastes formatted into Gmail. */
export function copyRichHtml(node: HTMLElement): Promise<boolean> {
  return writeClipboard(node.outerHTML, node.innerText);
}

/** Copy the cover letter followed by the report, as one rich block. */
export function copyEmail(letterHtml: string, letterText: string, reportNode: HTMLElement): Promise<boolean> {
  const html = `<div>${letterHtml}<div style="margin-top:24px">${reportNode.outerHTML}</div></div>`;
  const text = `${letterText}\n\n${reportNode.innerText}`;
  return writeClipboard(html, text);
}

/** A Gmail "compose" deep link with recipients, subject, and body prefilled.
 *  Gmail only accepts a plain-text body here. */
export function gmailComposeUrl(
  to: string[],
  cc: string[],
  subject: string,
  body = "Report pasted below.\n\n",
): string {
  const p = new URLSearchParams({
    view: "cm",
    fs: "1",
    to: to.join(","),
    su: subject,
  });
  if (cc.length) p.set("cc", cc.join(","));
  p.set("body", body);
  return `https://mail.google.com/mail/?${p.toString()}`;
}
