/**
 * The stake-president cover-letter template. Editable in Structure → Recipients,
 * stored in config as `report_email_template`. Placeholders:
 *   {stake} {president} {date} {weekLabel}
 */
export interface EmailTemplate {
  subject: string;
  body: string;
}

export const DEFAULT_EMAIL_TEMPLATE: EmailTemplate = {
  subject: "Weekly Key Indicators of Conversion Report, {stake} Stake - {date}",
  body: [
    "Dear President {president},",
    "",
    "Below is the weekly Key Indicators of Conversion report for the {stake} Stake.",
    "",
    "Definitions:",
    '"New People Found" are those who have given missionaries contact information and have a return teaching appointment.',
    '"Lessons With Members Participating" is the number of lessons where a member actively participated.',
    '"Potential Members at Sacrament" is the number of progressing friends who attended sacrament meeting.',
    '"People with Baptismal Date" are those who have accepted baptism but have not yet attended church.',
    '"Baptized and Confirmed" are those who have entered into the covenant of baptism and received the Holy Ghost.',
    '"New Members attending Sacrament" are those baptized within the last year who attended sacrament meeting that week.',
    '"Friends with Baptismal Date" are those who have accepted baptism, have a prepared calendar, and have attended church.',
    "",
    "Please send any suggestions to the mission secretary at jsandberg@missionary.org.",
    "",
    "We are grateful for your efforts in gathering Israel and are thankful to labor with you in this work.",
    "",
    "Sincerely,",
    "The Washington D.C. South Mission",
  ].join("\n"),
};
