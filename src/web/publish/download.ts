import { toPng } from "html-to-image";

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

/** Copy an element's rich HTML to the clipboard so it pastes formatted into Gmail. */
export async function copyRichHtml(node: HTMLElement): Promise<boolean> {
  try {
    const html = node.outerHTML;
    const text = node.innerText;
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([text], { type: "text/plain" }),
      }),
    ]);
    return true;
  } catch {
    try {
      await navigator.clipboard.writeText(node.innerText);
      return true;
    } catch {
      return false;
    }
  }
}

/** A Gmail "compose" deep link with recipients + subject prefilled. */
export function gmailComposeUrl(to: string[], cc: string[], subject: string): string {
  const p = new URLSearchParams({
    view: "cm",
    fs: "1",
    to: to.join(","),
    su: subject,
  });
  if (cc.length) p.set("cc", cc.join(","));
  p.set("body", "Report pasted below.\n\n");
  return `https://mail.google.com/mail/?${p.toString()}`;
}
