/* Core: Google sign-in, Sheets API access, cached state and change notifications.
   Drawing lives in views.js; writing forms in editor.js. */
(function(){
  var CFG=window.LEDGER_CONFIG||{};
  var LS='expdash.v1',LS_CFG='ledger.config',SS_TOK='ledger.token';
  // Full sheets scope so the page can add entries and update balances, not only read.
  var SCOPE='https://www.googleapis.com/auth/spreadsheets';
  var API='https://sheets.googleapis.com/v4/spreadsheets/';
  var TRACK_RANGE='Tracking!A1:G5000';
  var INCOME_RANGE="'Dashboard Data'!A1:L120";

  var local={};
  try{local=JSON.parse(localStorage.getItem(LS_CFG)||'{}')||{};}catch(e){}
  var CLIENT_ID=CFG.clientId||local.clientId||'';
  var SHEET_ID=CFG.sheetId||local.sheetId||'';

  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function fmt(n){return 'Rs '+Math.round(n).toLocaleString('en-US');}
  function fmtS(n){return (n<0?'−':'')+'Rs '+Math.abs(Math.round(n)).toLocaleString('en-US');}
  function timeStr(ms){
    try{return new Date(ms).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});}catch(e){return '';}
  }

  var S={mode:'cycle',sel:null,tracking:null,incomeRows:null,income:{},at:0,stale:false,err:null,status:{msg:'Starting…',warn:false}};
  // authState: 'unconfigured' (no client or sheet id), 'loading' (Google script not ready), 'signedout', 'ready'
  var authState=(CLIENT_ID&&SHEET_ID)?'loading':'unconfigured';
  var tokenClient=null,token=null,pendingAuth=null,busy=false,again=false,retried=false,ctrl=null;
  var listeners=[];

  try{
    var t=JSON.parse(sessionStorage.getItem(SS_TOK)||'null');
    if(t&&t.t&&t.exp>Date.now()&&t.s===SCOPE) token=t;
  }catch(e){}

  function save(){
    try{localStorage.setItem(LS,JSON.stringify({tracking:S.tracking,incomeRows:S.incomeRows,at:S.at,mode:S.mode,sel:S.sel}));}catch(e){}
  }
  function restore(){
    try{
      var j=JSON.parse(localStorage.getItem(LS)||'null');
      if(!j) return;
      if(j.mode==='cycle'||j.mode==='month') S.mode=j.mode;
      S.sel=j.sel||null;
      if(Array.isArray(j.tracking)){
        S.tracking=j.tracking;S.incomeRows=j.incomeRows||null;
        S.income=Logic.parseIncome(S.incomeRows);S.at=j.at||0;S.stale=true;
      }
    }catch(e){}
  }
  // what: 'data' (rows changed), 'auth' (sign-in state), 'status' (message only), 'busy'
  function notify(what){listeners.forEach(function(f){try{f(what);}catch(e){console.error(e);setStatus('The page could not draw your data: '+e.message,true);}});}
  function setStatus(msg,warn){S.status={msg:msg,warn:!!warn};listeners.forEach(function(f){try{f('status');}catch(e){}});}

  function errMsg(e){
    var c=e&&e.code;
    if(c==='cancelled') return 'Google Sheets did not answer within 45 seconds. Press Refresh to try again.';
    if(c==='popup_closed') return 'The Google sign-in window was closed before access was granted. Press Sign in to try again.';
    if(c==='popup_failed') return 'The Google sign-in window could not open. Allow pop-ups for this site, then press Sign in.';
    if(c==='auth'||c==='unauthorized') return 'Your Google sign-in has expired or was refused. Press Sign in.';
    if(c==='forbidden') return 'Google refused access to the sheet. Sign out, then sign in again with the Google account that owns the Monthly Expense Tracking sheet and allow it to see and edit your spreadsheets.';
    if(c==='not_found') return 'The sheet or its Tracking tab was not found. Check the sheet ID in config.js and that the tab is still named Tracking.';
    if(c==='rate_limited'||c==='upstream_error'||c==='network') return 'Google Sheets did not answer. '+(S.tracking?'Showing the last saved copy. ':'')+'Press Refresh to try again.';
    return 'The sheet could not be loaded ('+(c||(e&&e.message)||'unknown error')+'). Press Refresh to try again.';
  }
  window.addEventListener('error',function(ev){setStatus('Page error: '+ev.message,true);});

  function setToken(r){
    token={t:r.access_token,s:SCOPE,exp:Date.now()+Math.max(60,(+r.expires_in||3600)-60)*1000};
    try{sessionStorage.setItem(SS_TOK,JSON.stringify(token));}catch(e){}
    authState='ready';
  }
  function dropToken(){
    token=null;
    try{sessionStorage.removeItem(SS_TOK);}catch(e){}
    if(authState==='ready'){authState='signedout';notify('auth');}
  }
  function signIn(){
    if(!tokenClient) return Promise.resolve();
    return new Promise(function(res,rej){
      pendingAuth={res:res,rej:rej};
      tokenClient.requestAccessToken({prompt:''});
    });
  }
  function initGoogle(){
    tokenClient=google.accounts.oauth2.initTokenClient({
      client_id:CLIENT_ID,
      scope:SCOPE,
      callback:function(r){
        var p=pendingAuth;pendingAuth=null;
        if(r&&r.access_token&&google.accounts.oauth2.hasGrantedAllScopes(r,SCOPE)){setToken(r);notify('auth');if(p)p.res();}
        else{var e=new Error((r&&(r.error_description||r.error))||'Access not granted');e.code='auth';if(p)p.rej(e);}
      },
      error_callback:function(err){
        var p=pendingAuth;pendingAuth=null;
        var e=new Error(err&&err.message||'Sign-in failed');e.code=err&&err.type==='popup_closed'?'popup_closed':'popup_failed';
        if(p)p.rej(e);
      }
    });
    authState=token?'ready':'signedout';
    notify('auth');
    if(authState==='ready') load(false);
    else setStatus(S.tracking?'Showing a saved copy from '+timeStr(S.at)+'. Sign in to update it.':'Sign in with the Google account that owns your expense sheet.',false);
  }
  function loadGoogle(){
    var s=document.createElement('script');
    s.src='https://accounts.google.com/gsi/client';
    s.async=true;
    s.onload=function(){try{initGoogle();}catch(e){setStatus('Google sign-in could not start: '+e.message,true);}};
    s.onerror=function(){setStatus('Google sign-in could not load. Check your connection or any content blocker, then reload.',true);};
    document.head.appendChild(s);
  }

  function api(path,opt){
    opt=opt||{};
    var h={Authorization:'Bearer '+token.t};
    if(opt.body) h['Content-Type']='application/json';
    return fetch(API+encodeURIComponent(SHEET_ID)+path,{method:opt.method||'GET',headers:h,body:opt.body?JSON.stringify(opt.body):undefined,signal:opt.signal})
      .catch(function(e){
        var er=new Error(e&&e.message||'Network error');er.code=e&&e.name==='AbortError'?'cancelled':'network';er.retryable=er.code==='network';throw er;
      })
      .then(function(r){
        if(r.ok) return r.json();
        return r.json().catch(function(){return {};}).then(function(j){
          var s=r.status;
          var er=new Error((j.error&&j.error.message)||('HTTP '+s));
          er.code=s===401?'unauthorized':s===403?'forbidden':s===404||s===400?'not_found':s===429?'rate_limited':s>=500?'upstream_error':'http_'+s;
          er.retryable=s===429||s>=500;
          if(er.code==='unauthorized') dropToken();
          throw er;
        });
      });
  }
  function getValues(range,signal,render){
    return api('/values/'+encodeURIComponent(range)+(render?'?valueRenderOption='+render:''),{signal:signal}).then(function(j){return Array.isArray(j.values)?j.values:[];});
  }

  function load(manual){
    if(busy){again=true;return Promise.resolve();}
    if(authState!=='ready') return Promise.resolve();
    if(!token||token.exp<=Date.now()){
      dropToken();
      setStatus('Your Google sign-in has expired. Press Sign in to update.'+(S.tracking?' Showing a saved copy from '+timeStr(S.at)+'.':''),true);
      return Promise.resolve();
    }
    busy=true;S.busy=true;notify('busy');
    if(manual||!S.tracking) setStatus('Reading your Tracking sheet…',false);
    ctrl=new AbortController();
    var thisCtrl=ctrl;
    var toAbort=setTimeout(function(){try{thisCtrl.abort();}catch(e){}},45000);
    var calls=0;
    function call(range){calls++;return getValues(range,thisCtrl.signal);}
    return call(TRACK_RANGE).then(function(rows){
      S.tracking=rows;S.rowCount=rows.length;
      S.at=Date.now();
      S.stale=false;S.err=null;retried=false;
      return call(INCOME_RANGE).then(function(ir){
        S.incomeRows=ir;S.income=Logic.parseIncome(ir);
      }).catch(function(){S.incomeRows=null;S.income={};}).then(function(){S.calls=calls;});
    }).then(function(){
      save();
      notify('data');
      setStatus('Live · synced '+timeStr(S.at),false);
    }).catch(function(e){
      S.err=e;
      if(S.tracking) notify('data');
      setStatus(errMsg(e),true);
      if(e&&e.retryable&&!retried){
        retried=true;
        setTimeout(function(){load(false);},1500+Math.random()*1500);
      }
    }).catch(function(){}).then(function(){
      clearTimeout(toAbort);
      busy=false;S.busy=false;notify('busy');
      if(again){again=false;load(false);}
    });
  }

  function signOut(){
    if(ctrl){try{ctrl.abort();}catch(e){}}
    if(token&&window.google&&google.accounts) try{google.accounts.oauth2.revoke(token.t,function(){});}catch(e){}
    token=null;
    try{sessionStorage.removeItem(SS_TOK);localStorage.removeItem(LS);}catch(e){}
    S.tracking=null;S.incomeRows=null;S.income={};S.at=0;S.rowCount=0;
    if(authState==='ready') authState='signedout';
    notify('auth');notify('data');
    setStatus('Signed out. The saved copy was removed from this browser.',false);
  }
  function configure(c,s){
    var m=/\/d\/([a-zA-Z0-9_-]+)/.exec(s);if(m) s=m[1];
    if(!c||!s) return;
    try{localStorage.setItem(LS_CFG,JSON.stringify({clientId:c,sheetId:s}));}catch(x){}
    location.reload();
  }

  window.Ledger={
    S:S,esc:esc,fmt:fmt,fmtS:fmtS,timeStr:timeStr,errMsg:errMsg,
    config:function(){return {clientId:CLIENT_ID,sheetId:SHEET_ID,range:TRACK_RANGE};},
    sheetUrl:function(){return 'https://docs.google.com/spreadsheets/d/'+encodeURIComponent(SHEET_ID)+'/edit';},
    state:function(){return authState;},
    hasToken:function(){return !!(token&&token.exp>Date.now());},
    signIn:function(){return signIn().then(function(){notify('auth');});},
    signInAndLoad:function(){
      return signIn().then(function(){retried=false;return load(true);},function(e){setStatus(errMsg(e),true);});
    },
    signOut:signOut,configure:configure,save:save,
    get:function(range,render){return getValues(range,undefined,render);},
    put:function(range,values){return api('/values/'+encodeURIComponent(range)+'?valueInputOption=RAW',{method:'PUT',body:{range:range,majorDimension:'ROWS',values:values}});},
    batch:function(data,input){return api('/values:batchUpdate',{method:'POST',body:{valueInputOption:input||'RAW',data:data}});},
    clear:function(range){return api('/values/'+encodeURIComponent(range)+':clear',{method:'POST',body:{}});},
    refresh:function(manual){retried=false;return load(!!manual);},
    on:function(f){listeners.push(f);}
  };

  setInterval(function(){if(!document.hidden&&authState==='ready') load(false);},60000);
  document.addEventListener('visibilitychange',function(){if(!document.hidden&&authState==='ready'&&Date.now()-S.at>60000) load(false);});

  restore();
  // views.js and editor.js load after this file; start once the page is parsed.
  document.addEventListener('DOMContentLoaded',function(){
    notify('auth');notify('data');
    if(authState==='unconfigured') setStatus('Add your Google OAuth client ID to finish setting up.',true);
    else{
      if(S.tracking) setStatus('Showing a saved copy from '+timeStr(S.at)+'. Connecting to Google…',false);
      loadGoogle();
    }
  });
})();
