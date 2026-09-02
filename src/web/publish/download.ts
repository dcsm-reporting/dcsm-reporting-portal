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
 * Render a node to a downloaded PDF (no browser print dialog, which mangled the
 * layout). The node is rasterised exactly as it looks on screen, then sliced
 * across US-Letter pages — so the layout matches the preview and prints cleanly.
 */
export async function downloadPdf(node: HTMLElement, filename: string): Promise<void> {
  const dataUrl = await Promise.race([
    toPng(node, { pixelRatio: 2, cacheBust: true, backgroundColor: "#ffffff" }),
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error("render timed out")), 25_000)),
  ]);
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const el = new Image();
    el.onload = () => res(el);
    el.onerror = () => rej(new Error("image decode failed"));
    el.src = dataUrl;
  });

  const pageW = 612; // US Letter, points
  const pageH = 792;
  const margin = 30;
  const contentWpt = pageW - margin * 2;
  const contentHpt = pageH - margin * 2;
  const pxToPt = contentWpt / img.naturalWidth;
  const sliceHpx = Math.floor(contentHpt / pxToPt);

  const pdf = new jsPDF({ unit: "pt", format: "letter" });
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;

  let y = 0;
  let page = 0;
  while (y < img.naturalHeight) {
    const hpx = Math.min(sliceHpx, img.naturalHeight - y);
    canvas.width = img.naturalWidth;
    canvas.height = hpx;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, y, img.naturalWidth, hpx, 0, 0, img.naturalWidth, hpx);
    if (page > 0) pdf.addPage();
    // JPEG, not PNG: a mostly-white text page compresses ~10x smaller and stays
    // perfectly readable — some stake reports were topping 25 MB as PNG.
    pdf.addImage(canvas.toDataURL("image/jpeg", 0.82), "JPEG", margin, margin, contentWpt, hpx * pxToPt);
    y += hpx;
    page += 1;
  }
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
