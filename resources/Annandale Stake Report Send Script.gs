function emailANNANDALESheetAsPDF() {

  const sheetNameToExport = "Annandale";
  const folderId = "1c1DywE0FUZih_k9wag_atye0vSUTyQy7"; // <-- Replace with actual folder ID
  const emailSettingsSheet = "EMAILS";
  const row = 2; // <-- Replace with the row number for the name of the stake in your EMAILS sheet

  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheetToExport = spreadsheet.getSheetByName(sheetNameToExport);
  const emailSheet = spreadsheet.getSheetByName(emailSettingsSheet);

  if (!sheetToExport) throw new Error(`Sheet "${sheetNameToExport}" not found.`);
  if (!emailSheet) throw new Error(`Sheet "${emailSettingsSheet}" not found.`);

  // ===== DATE (Last Sunday) =====
  const today = new Date();
  const dayOfWeek = today.getDay();
  const lastSunday = new Date(today);
  if (dayOfWeek !== 0) lastSunday.setDate(today.getDate() - dayOfWeek);

  const formattedDate = `${lastSunday.getMonth() + 1}/${lastSunday.getDate()}/${lastSunday.getFullYear()}`;

  const fileName = `${sheetNameToExport} Report, ${formattedDate}`;

  // ===== EMAIL VALUES =====
  const emailTo = emailSheet.getRange(`B${row}`).getValue().toString().trim();

  const ccRange = emailSheet.getRange(`C${row}:G${row}`).getValues()[0];
  const emailCc = ccRange
    .filter(email => email && email.toString().trim() !== "")
    .map(email => email.toString().trim())
    .join(",");

  const presidentName = emailSheet.getRange(`H${row}`).getValue().toString().trim();

  // ===== EXPORT PDF =====
  const spreadsheetId = spreadsheet.getId();
  const sheetId = sheetToExport.getSheetId();

  const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?` +
              `format=pdf&` +
              `gid=${sheetId}&` +
              `portrait=true&` +
              `fitw=true&` +
              `sheetnames=false&` +
              `printtitle=false&` +
              `pagenum=UNDEFINED&` +
              `gridlines=false&` +
              `fzr=false&` +
              `size=letter&` +
              `scale=2&` +
              `top_margin=0.50&` +
              `bottom_margin=0.50&` +
              `left_margin=0.50&` +
              `right_margin=0.50`;

  const token = ScriptApp.getOAuthToken();
  const response = UrlFetchApp.fetch(url, {
    headers: { Authorization: `Bearer ${token}` }
  });

  const pdfBlob = response.getBlob().setName(`${fileName}.pdf`);

  // ===== SAVE TO DRIVE =====
  const folder = DriveApp.getFolderById(folderId);
  const savedFile = folder.createFile(pdfBlob);
  Logger.log(`Saved PDF: ${savedFile.getName()} to folder: ${folder.getName()}`);

  // ===== DELETE FILES OLDER THAN 6 MONTHS =====
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  const files = folder.getFiles();
  let deletedCount = 0;

  while (files.hasNext()) {
    const file = files.next();
    if (file.getDateCreated() < sixMonthsAgo) {
      file.setTrashed(true);
      deletedCount++;
    }
  }

  Logger.log(`Deleted ${deletedCount} old file(s)`);

  // ===== EMAIL BODY =====
  const { subject, htmlBody } = buildKIEmailContent(sheetNameToExport, presidentName, formattedDate);

  // ===== SEND EMAIL =====
  const emailOptions = {
    to: emailTo,
    subject: subject,
    htmlBody: htmlBody,
    attachments: [pdfBlob]
  };

  if (emailCc) {
    emailOptions.cc = emailCc;
  }

  MailApp.sendEmail(emailOptions);

  Logger.log(`Email sent to: ${emailTo} with CC: ${emailCc}`);
}