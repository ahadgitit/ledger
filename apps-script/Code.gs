/* Ledger inbox: receives SadaPay notifications from MacroDroid and keeps them in the
   Inbox tab of this spreadsheet, one row each, for Ledger to turn into entries.

   Deploy: Deploy > New deployment > Web app, Execute as: Me, Who has access: Anyone.
   MacroDroid sends: secret, app, title, text (as query parameters). */
var SECRET='PASTE-YOUR-SECRET-HERE'; // the key in MacroDroid; keep it out of git
var TAB='Inbox';
var HEAD=['Received','App','Title','Text','Status'];

function doPost(e){return take(e);}
function doGet(e){return take(e);}

function take(e){
  var p=(e&&e.parameter)||{};
  if(p.secret!==SECRET) return out('denied');
  var title=String(p.title||'').trim(),text=String(p.text||'').trim();
  if(!title&&!text) return out('empty');
  var lock=LockService.getScriptLock();
  lock.waitLock(20000);
  try{
    var ss=SpreadsheetApp.getActiveSpreadsheet(),sh=ss.getSheetByName(TAB);
    if(!sh){sh=ss.insertSheet(TAB);sh.appendRow(HEAD);sh.setFrozenRows(1);}
    var now=new Date(),props=PropertiesService.getScriptProperties(),key=title+'\n'+text;
    // Android often posts the same notification twice; skip a repeat within two minutes
    var prev=JSON.parse(props.getProperty('last')||'{}');
    if(prev.key===key&&now.getTime()-prev.at<120000) return out('duplicate');
    props.setProperty('last',JSON.stringify({key:key,at:now.getTime()}));
    sh.appendRow([Utilities.formatDate(now,'Asia/Karachi','yyyy-MM-dd HH:mm:ss'),String(p.app||''),title,text,'new']);
  }finally{lock.releaseLock();}
  return out('ok');
}
function out(s){return ContentService.createTextOutput(s);}
