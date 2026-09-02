/**
 * The standard stake-president cover letter. Ported from the mission's
 * `buildKIEmailContent` Apps Script (resources/Annandale Stake Report Send
 * Script.gs), adjusted for the portal pasting the report inline rather than
 * attaching a PDF.
 */

const DEFINITIONS: [string, string][] = [
  ["New People Found", "those who have given missionaries contact information and have a return teaching appointment."],
  ["Lessons With Members Participating", "the number of lessons where a member actively participated."],
  ["Potential Members at Sacrament", "the number of progressing friends who attended sacrament meeting."],
  ["People with Baptismal Date", "those who have accepted baptism but have not yet attended church."],
  ["Baptized and Confirmed", "those who have entered into the covenant of baptism and received the Holy Ghost."],
  ["New Members attending Sacrament", "those baptized within the last year who attended sacrament meeting that week."],
  ["Friends with Baptismal Date", "those who have accepted baptism, have a prepared calendar, and have attended church."],
];

const SECRETARY = "jsandberg@missionary.org";

/** M/D/YYYY of the report week's Sunday (weekStartIso is the Monday). */
export function reportDateLabel(weekStartIso: string): string {
  const d = new Date(Date.parse(`${weekStartIso}T00:00:00Z`) + 6 * 86_400_000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`;
}

export interface EmailContent {
  subject: string;
  bodyText: string; // for the Gmail compose URL (plain text only)
  bodyHtml: string; // for "copy full email"
}

export function buildEmail(opts: {
  stake: string;
  presidentName: string | null;
  weekStartIso: string;
}): EmailContent {
  const { stake, presidentName } = opts;
  const dateLabel = reportDateLabel(opts.weekStartIso);
  const greeting = presidentName ? `Dear President ${presidentName},` : "Dear President,";
  const subject = `Weekly Key Indicators of Conversion Report, ${stake} Stake - ${dateLabel}`;

  const lines = [
    greeting,
    "",
    `Below is the weekly Key Indicators of Conversion report for the ${stake} Stake.`,
    "",
    "Definitions:",
    ...DEFINITIONS.map(([k, v]) => `• "${k}" are ${v}`),
    "",
    `Please send any suggestions to the mission secretary at ${SECRETARY}.`,
    "",
    "We are grateful for your efforts in gathering Israel and are thankful to labor with you in this work.",
    "",
    "Sincerely,",
    "The Washington D.C. South Mission",
  ];
  const bodyText = lines.join("\n");

  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const bodyHtml = [
    `<p>${esc(greeting)}</p>`,
    `<p>Below is the weekly Key Indicators of Conversion report for the ${esc(stake)} Stake.</p>`,
    `<p><strong>Definitions:</strong></p>`,
    ...DEFINITIONS.map(([k, v]) => `<p>"${esc(k)}" are ${esc(v)}</p>`),
    `<p>Please send any suggestions to the mission secretary at <a href="mailto:${SECRETARY}">${SECRETARY}</a>.</p>`,
    `<p>We are grateful for your efforts in gathering Israel and are thankful to labor with you in this work.</p>`,
    `<p>Sincerely,<br>The Washington D.C. South Mission</p>`,
  ].join("");

  return { subject, bodyText, bodyHtml };
}
