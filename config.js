// Settings for the hosted dashboard. Neither value is a secret: an OAuth client ID
// only identifies this site to Google, and a sheet ID grants no access on its own.
// Only a Google account that can already open the sheet can read it here.
window.LEDGER_CONFIG={
  // OAuth 2.0 Web client ID from Google Cloud Console (see README). Leave empty to
  // enter it on the page instead; it is then kept in that browser only.
  clientId:'433635498387-p7aevg45oqgje5vggqsam3nbcukev2t9.apps.googleusercontent.com',
  // The Monthly Expense Tracking spreadsheet.
  sheetId:'19R0-R02U14iZ5IHFzimpAAieMflv9CV6JprRyjie3KI'
};
