import { DEFAULT_EMAIL_TEMPLATE, type EmailTemplate } from "@shared/emailTemplate";

const DEFAULT_TEMPLATE = DEFAULT_EMAIL_TEMPLATE;
export { DEFAULT_EMAIL_TEMPLATE, DEFAULT_TEMPLATE, type EmailTemplate };

/** M/D/YYYY of the report week's Sunday (weekStartIso is the Monday). */
export function reportDateLabel(weekStartIso: string): string {
  const d = new Date(Date.parse(`${weekStartIso}T00:00:00Z`) + 6 * 86_400_000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`;
}

export interface EmailContent {
  subject: string;
  bodyText: string;
  bodyHtml: string;
}

function sub(s: string, vars: Record<string, string>): string {
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k]! : m));
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Plain text -> HTML: blank-line-separated blocks become <p>, single \n -> <br>. */
function textToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((block) => {
      const withLinks = esc(block).replace(
        /([\w.+-]+@[\w.-]+\.\w+)/g,
        '<a href="mailto:$1">$1</a>',
      );
      return `<p>${withLinks.replace(/\n/g, "<br>")}</p>`;
    })
    .join("");
}

export function buildEmail(opts: {
  stake: string;
  presidentName: string | null;
  weekStartIso: string;
  weekLabel: string;
  template?: EmailTemplate;
}): EmailContent {
  const t = opts.template ?? DEFAULT_TEMPLATE;
  const vars = {
    stake: opts.stake,
    president: opts.presidentName || "",
    date: reportDateLabel(opts.weekStartIso),
    weekLabel: opts.weekLabel,
  };
  const bodyText = sub(t.body, vars);
  return {
    subject: sub(t.subject, vars),
    bodyText,
    bodyHtml: textToHtml(bodyText),
  };
}
