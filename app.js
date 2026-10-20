(function(){
  var CFG=window.LEDGER_CONFIG||{};
  var LS='expdash.v1',LS_CFG='ledger.config',SS_TOK='ledger.token';
  // Full sheets scope so the page can add entries and update balances, not only read.
  var SCOPE='https://www.googleapis.com/auth/spreadsheets';
  var API='https://sheets.googleapis.com/v4/spreadsheets/';
  var TRACK_RANGE='Tracking!A1:G5000';
  var INCOME_RANGE="'Dashboard Data'!A1:L120";
  var MON=Logic.MON,DAY=Logic.DAY;

  var local={};
  try{local=JSON.parse(localStorage.getItem(LS_CFG)||'{}')||{};}catch(e){}
  var CLIENT_ID=CFG.clientId||local.clientId||'';
  var SHEET_ID=CFG.sheetId||local.sheetId||'';

  function $(s){return document.querySelector(s);}
  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function fmt(n){return 'Rs '+Math.round(n).toLocaleString('en-US');}
  function fmtS(n){return (n<0?'−':'')+'Rs '+Math.abs(Math.round(n)).toLocaleString('en-US');}
  function kfmt(n){
    n=Math.round(n);
    if(n>=1000){var v=n/1000;return (v>=10?Math.round(v):Math.round(v*10)/10)+'k';}
    return String(n);
  }
  function fmtDay(n){var d=new Date(n*DAY);return d.getUTCDate()+' '+MON[d.getUTCMonth()];}
  function fmtDayY(n){var d=new Date(n*DAY);return d.getUTCDate()+' '+MON[d.getUTCMonth()]+' '+d.getUTCFullYear();}
  function dom(n){return String(new Date(n*DAY).getUTCDate());}
  function niceMax(v){
    if(v<=0) return 1;
    var p=Math.pow(10,Math.floor(Math.log10(v)));
    var f=v/p;
    var m=f<=1?1:f<=2?2:f<=2.5?2.5:f<=5?5:10;
    return m*p;
  }

  var S={mode:'cycle',sel:null,tracking:null,incomeRows:null,income:{},at:0,stale:false,err:null};
  // authState: 'unconfigured' (no client or sheet id), 'loading' (Google script not ready), 'signedout', 'ready'
  var authState=(CLIENT_ID&&SHEET_ID)?'loading':'unconfigured';
  var tokenClient=null,token=null,pendingAuth=null,busy=false,again=false,retried=false,ctrl=null;

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

  function setStatus(msg,warn){
    var el=$('#status');
    el.className='status'+(warn?' warn':'');
    el.textContent=msg;
  }
  function timeStr(ms){
    try{return new Date(ms).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});}catch(e){return '';}
  }
  function errMsg(e){
    var c=e&&e.code;
    if(c==='cancelled') return 'Google Sheets did not answer within 45 seconds. Press Refresh to try again.';
    if(c==='popup_closed') return 'The Google sign-in window was closed before access was granted. Press Sign in with Google to try again.';
    if(c==='popup_failed') return 'The Google sign-in window could not open. Allow pop-ups for this site, then press Sign in with Google.';
    if(c==='auth'||c==='unauthorized') return 'Your Google sign-in has expired or was refused. Press Sign in with Google.';
    if(c==='forbidden') return 'Google refused access to the sheet. Sign out, then sign in again with the Google account that owns the Monthly Expense Tracking sheet and allow it to see and edit your spreadsheets.';
    if(c==='not_found') return 'The sheet or its Tracking tab was not found. Check the sheet ID in config.js and that the tab is still named Tracking.';
    if(c==='rate_limited'||c==='upstream_error'||c==='network') return 'Google Sheets did not answer. '+(S.tracking?'Showing the last saved copy. ':'')+'Press Refresh to try again.';
    return 'The sheet could not be loaded ('+(c||(e&&e.message)||'unknown error')+'). Press Refresh to try again.';
  }
  window.addEventListener('error',function(ev){
    var el=document.getElementById('status');
    if(el){el.className='status warn';el.textContent='Page error: '+ev.message;}
  });

  function showAuthButtons(){
    var signedIn=authState==='ready';
    $('#signin').hidden=signedIn||authState!=='signedout';
    $('#signout').hidden=!signedIn&&!S.tracking;
    $('#refresh').hidden=!signedIn;
    if(window.LedgerEditor) LedgerEditor.sync();
  }
  function setToken(r){
    token={t:r.access_token,s:SCOPE,exp:Date.now()+Math.max(60,(+r.expires_in||3600)-60)*1000};
    try{sessionStorage.setItem(SS_TOK,JSON.stringify(token));}catch(e){}
    authState='ready';
  }
  function dropToken(){
    token=null;
    try{sessionStorage.removeItem(SS_TOK);}catch(e){}
    if(authState==='ready') authState='signedout';
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
        if(r&&r.access_token&&google.accounts.oauth2.hasGrantedAllScopes(r,SCOPE)){setToken(r);if(p)p.res();}
        else{var e=new Error((r&&(r.error_description||r.error))||'Access not granted');e.code='auth';if(p)p.rej(e);}
      },
      error_callback:function(err){
        var p=pendingAuth;pendingAuth=null;
        var e=new Error(err&&err.message||'Sign-in failed');e.code=err&&err.type==='popup_closed'?'popup_closed':'popup_failed';
        if(p)p.rej(e);
      }
    });
    authState=token?'ready':'signedout';
    showAuthButtons();
    if(authState==='ready') load(false);
    else{
      if(!S.tracking) render();
      setStatus(S.tracking?'Showing a saved copy from '+timeStr(S.at)+'. Sign in with Google to update it.':'Sign in with the Google account that owns your expense sheet.',false);
    }
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
          if(er.code==='unauthorized'){dropToken();showAuthButtons();}
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
      dropToken();showAuthButtons();
      setStatus('Your Google sign-in has expired. Press Sign in with Google to update.'+(S.tracking?' Showing a saved copy from '+timeStr(S.at)+'.':''),true);
      return Promise.resolve();
    }
    busy=true;
    $('#refresh').disabled=true;$('#refresh').textContent='Refreshing…';
    if(manual||!S.tracking) setStatus('Reading your Tracking sheet…',false);
    ctrl=new AbortController();
    var thisCtrl=ctrl;
    var toAbort=setTimeout(function(){try{thisCtrl.abort();}catch(e){}},45000);
    var calls=0;
    function call(range){calls++;return getValues(range,thisCtrl.signal);}
    return call(TRACK_RANGE).then(function(rows){
      S.tracking=rows;S.rowCount=rows.length;S.calls=calls;
      S.at=Date.now();
      S.stale=false;S.err=null;retried=false;
      return call(INCOME_RANGE).then(function(ir){
        S.incomeRows=ir;S.income=Logic.parseIncome(ir);
      }).catch(function(){S.incomeRows=null;S.income={};}).then(function(){S.calls=calls;});
    }).then(function(){
      save();
      showAuthButtons();
      try{render();}catch(x){setStatus('The page could not draw your data: '+(x&&x.message),true);return;}
      setStatus('Live from your Tracking sheet. Updated '+timeStr(S.at)+'. Refreshes every minute while open.',false);
    }).catch(function(e){
      S.err=e;
      if(e&&e.code==='unauthorized'){dropToken();showAuthButtons();}
      if(S.tracking){try{render();}catch(x){}}
      setStatus(errMsg(e),true);
      if(e&&e.retryable&&!retried){
        retried=true;
        setTimeout(function(){load(false);},1500+Math.random()*1500);
      }
    }).catch(function(){}).then(function(){
      clearTimeout(toAbort);
      busy=false;$('#refresh').disabled=false;$('#refresh').textContent='Refresh';
      if(again){again=false;load(false);}
    });
  }

  // Small surface for editor.js: authenticated Sheets calls plus shared helpers.
  window.Ledger={
    S:S,esc:esc,fmt:fmt,fmtS:fmtS,errMsg:errMsg,
    sheetUrl:function(){return 'https://docs.google.com/spreadsheets/d/'+encodeURIComponent(SHEET_ID)+'/edit';},
    state:function(){return authState;},
    hasToken:function(){return !!(token&&token.exp>Date.now());},
    signIn:function(){return signIn().then(function(){showAuthButtons();});},
    get:function(range,render){return getValues(range,undefined,render);},
    put:function(range,values){return api('/values/'+encodeURIComponent(range)+'?valueInputOption=RAW',{method:'PUT',body:{range:range,majorDimension:'ROWS',values:values}});},
    batch:function(data,input){return api('/values:batchUpdate',{method:'POST',body:{valueInputOption:input||'RAW',data:data}});},
    clear:function(range){return api('/values/'+encodeURIComponent(range)+':clear',{method:'POST',body:{}});},
    refresh:function(){retried=false;return load(false);}
  };

  function periodsFor(){
    var parsed=Logic.parseTracking(S.tracking);
    var today=Logic.todayNum();
    return S.mode==='cycle'?Logic.cyclePeriods(parsed,today):Logic.monthPeriods(parsed,today);
  }
  function rangeText(p){
    return fmtDay(p.start)+' to '+(p.open?'today':fmtDay(p.end));
  }

  function drawCols(el,items,o){
    if(!el) return;
    var W=Math.max(260,Math.floor(el.clientWidth||320)),H=o.h||190;
    var m={l:40,r:6,t:18,b:22};
    var pw=W-m.l-m.r,ph=H-m.t-m.b;
    var mx=niceMax(Math.max.apply(null,items.map(function(i){return i.v;}).concat([0])));
    var slot=pw/items.length;
    var bw=Math.min(28,Math.max(2,slot*0.68));
    function y(v){return m.t+ph-(v/mx)*ph;}
    var s='<svg viewBox="0 0 '+W+' '+H+'" width="'+W+'" height="'+H+'" role="img" aria-label="'+esc(o.aria)+'">';
    [0,0.5,1].forEach(function(f){
      var yy=y(mx*f);
      s+='<line class="grid" x1="'+m.l+'" x2="'+(W-m.r)+'" y1="'+yy+'" y2="'+yy+'"/>';
      s+='<text class="tick" x="'+(m.l-6)+'" y="'+(yy+3.5)+'" text-anchor="end">'+kfmt(mx*f)+'</text>';
    });
    items.forEach(function(it,i){
      var cx=m.l+slot*i+slot/2;
      var h=it.v>0?Math.max(2,(it.v/mx)*ph):0;
      var x=cx-bw/2,base=m.t+ph,top=base-h;
      if(h>0){
        var r=Math.min(4,h,bw/2);
        s+='<path class="'+it.cls+'" d="M'+x+','+base+' V'+(top+r)+' Q'+x+','+top+' '+(x+r)+','+top+' H'+(x+bw-r)+' Q'+(x+bw)+','+top+' '+(x+bw)+','+(top+r)+' V'+base+' Z"/>';
      }
      s+='<rect x="'+(m.l+slot*i)+'" y="'+m.t+'" width="'+slot+'" height="'+ph+'" fill="transparent" data-tip="'+esc(it.tip)+'"/>';
      if(it.xl) s+='<text class="tick" x="'+cx+'" y="'+(H-6)+'" text-anchor="middle">'+esc(it.xl)+'</text>';
      if(it.top&&h>0) s+='<text class="lab" x="'+cx+'" y="'+(top-5)+'" text-anchor="middle">'+esc(it.top)+'</text>';
    });
    s+='<line class="axis" x1="'+m.l+'" x2="'+(W-m.r)+'" y1="'+(m.t+ph)+'" y2="'+(m.t+ph)+'"/>';
    s+='</svg>';
    el.innerHTML=s;
  }

  function emptyHTML(){
    if(authState==='unconfigured'){
      return '<section class="panel setup"><h2>Connect your sheet</h2>'+
        '<p class="hint">This dashboard reads your Google Sheet directly from your browser after you sign in with Google. Nothing is sent anywhere else. Paste the OAuth client ID you created in Google Cloud (see the README) and your sheet link or ID. Both are saved in this browser only; to set them for every device, put them in config.js instead.</p>'+
        '<form id="setup"><label>OAuth client ID<input id="cfg-client" required autocomplete="off" spellcheck="false" placeholder="1234-abc.apps.googleusercontent.com" value="'+esc(CLIENT_ID)+'"></label>'+
        '<label>Sheet link or ID<input id="cfg-sheet" required autocomplete="off" spellcheck="false" placeholder="https://docs.google.com/spreadsheets/d/…" value="'+esc(SHEET_ID)+'"></label>'+
        '<button type="submit" class="btn">Save and continue</button></form></section>';
    }
    if(authState==='signedout'){
      return '<section class="panel empty"><b>Sign in to see your spending</b>Press Sign in with Google and choose the account that owns your Monthly Expense Tracking sheet. Google will ask to let this page see and edit your spreadsheets, so you can add entries and update balances from here.</section>';
    }
    return '<section class="panel empty"><b>Loading your spending</b>The dashboard will show the current cycle against the previous one, with category totals, daily spending and your largest expenses, as soon as the Tracking sheet answers.</section>';
  }

  function render(){
    var main=$('#main'),chips=$('#chips'),notes=$('#notes');
    $('#m-cycle').setAttribute('aria-pressed',S.mode==='cycle');
    $('#m-month').setAttribute('aria-pressed',S.mode==='month');
    if(!S.tracking){main.innerHTML=emptyHTML();chips.innerHTML='';notes.innerHTML='';return;}
    var periods=periodsFor();
    if(!periods.length){
      main.innerHTML='<section class="panel empty"><b>No entries yet</b>Nothing in the Tracking tab matched the expected columns: Expense, Amount, Description, Date, Payment mode, Category.</section>';
      chips.innerHTML='';notes.innerHTML='';return;
    }
    var i=periods.findIndex(function(p){return p.key===S.sel;});
    if(i<0) i=periods.length-1;
    S.sel=periods[i].key;
    var cur=periods[i],prev=periods[i-1]||null;
    var aggs=periods.map(Logic.aggregate);
    var A=aggs[i],B=prev?aggs[i-1]:null;
    var isCycle=S.mode==='cycle';
    var unit=isCycle?'cycle':'month';
    $('#sub').textContent=(isCycle?'Payday cycles, each running from one Pay myself row to the next. ':'Calendar months, by entry date. ')+cur.label+' covers '+rangeText(cur)+'.';

    chips.innerHTML=periods.slice().reverse().slice(0,8).map(function(p){
      var cls='chip'+(p.key===cur.key?' is-sel':'')+(prev&&p.key===prev.key?' is-prev':'');
      return '<button type="button" class="'+cls+'" data-key="'+p.key+'" aria-pressed="'+(p.key===cur.key)+'">'+esc(p.label)+'<small>'+esc(fmtDay(p.start)+(p.open?' on':' to '+fmtDay(p.end)))+'</small></button>';
    }).join('');

    var inc=isCycle?S.income[cur.label]:null;
    var delta='First '+unit+' on record.';
    if(B){
      if(B.spent===0) delta='No spending in '+prev.label+' to compare with.';
      else{
        var d=(A.spent-B.spent)/B.spent*100;
        var arrow=d<-0.5?'▼':d>0.5?'▲':'■';
        var phrase=Math.abs(d)<0.5?'level with':Math.abs(d).toFixed(0)+'% '+(d<0?'lower':'higher')+' than';
        delta=arrow+' '+phrase+' '+prev.label+(cur.open?' so far':'')+'. '+prev.label+' total: '+fmt(B.spent)+' over '+B.dayCount+' days.';
      }
    }
    var stats=[];
    var bal=isCycle&&cur.bal?cur.bal:null;
    if(inc&&!isNaN(inc.income)) stats.push(['Payout',fmt(inc.income)]);
    stats.push(['Saved',fmt(A.saved)]);
    if(bal) stats.push(['Remaining (sheet)',fmtS(bal.remaining),bal.remaining<0?'neg':'']);
    stats.push(['Loans given',fmt(A.by['Loans given'])]);
    stats.push(['Money received back',fmt(A.back)]);
    stats.push(['Per day',fmt(A.spent/A.dayCount)]);
    stats.push(['Entries',String(A.count)]);

    var cats=Logic.CATS.slice();
    if(A.other||(B&&B.other)) cats.push('Other');
    function val(X,c){return X?(c==='Other'?X.other:X.by[c]):0;}
    cats=cats.filter(function(c){return val(A,c)||val(B,c);}).sort(function(a,b){return (val(A,b)-val(A,a))||(val(B,b)-val(B,a));});
    var cmax=Math.max.apply(null,cats.map(function(c){return Math.max(val(A,c),val(B,c));}).concat([1]));
    function barW(v){return v>0?Math.max(1.5,v/cmax*100):0;}
    var catRows=cats.map(function(c){
      var a=val(A,c),b=val(B,c);
      var share=A.spent?Math.round(a/A.spent*100):0;
      var tip=c+'\n'+cur.label+': '+fmt(a)+' ('+share+'% of spent)'+(B?'\n'+prev.label+': '+fmt(b):'');
      return '<li class="cat" data-tip="'+esc(tip)+'"><div class="cat-name">'+esc(c)+'<small>'+share+'% of spent</small></div>'+
        '<div class="track"><i class="bar b1" style="width:'+barW(a)+'%"></i></div><div class="v v1">'+fmt(a)+'</div>'+
        (B?'<div class="track"><i class="bar b2" style="width:'+barW(b)+'%"></i></div><div class="v v2">'+fmt(b)+'</div>':'')+'</li>';
    }).join('');

    var modeKeys=Object.keys(A.mode).filter(function(k){return A.mode[k]>0;}).sort(function(a,b){return A.mode[b]-A.mode[a];});
    var mmax=Math.max.apply(null,modeKeys.map(function(k){return A.mode[k];}).concat([1]));
    var modeRows=modeKeys.map(function(k){
      var share=A.spent?Math.round(A.mode[k]/A.spent*100):0;
      return '<li class="mode" data-tip="'+esc(k+'\n'+fmt(A.mode[k])+' ('+share+'% of spent)')+'"><div class="m-name">'+esc(k)+'<small>'+share+'%</small></div><div class="track"><i class="bar bn" style="width:'+Math.max(1.5,A.mode[k]/mmax*100)+'%"></i></div><div class="v v1">'+fmt(A.mode[k])+'</div></li>';
    }).join('');

    var top=A.top.slice().sort(function(a,b){return b.amt-a.amt;}).slice(0,8);
    var topRows=top.map(function(t){
      var cat=Logic.CATS.filter(function(c){return c.toLowerCase()===t.cat||(t.cat==='loaned'&&c==='Loans given');})[0]||t.cat;
      return '<tr><td>'+esc(t.name)+(t.desc?'<small>'+esc(t.desc)+'</small>':'')+'</td><td>'+esc(t.day!=null?fmtDay(t.day):'')+'</td><td>'+esc(cat)+'</td><td class="n">'+fmt(t.amt)+'</td></tr>';
    }).join('');

    var dayRows=A.daily.filter(function(d){return d.v>0;}).map(function(d){return '<tr><td>'+esc(fmtDayY(d.day))+'</td><td class="n">'+fmt(d.v)+'</td></tr>';}).join('');

    var subAll=Logic.subscriptions(periods,i);
    var subHTML='';
    (function(){
      var sub=Logic.subscriptions(periods,i);
      if(!sub.rows.length) return;
      var today=Logic.todayNum();
      var smax=Math.max.apply(null,sub.rows.map(function(r){return r.amount;}).concat([1]));
      function sw(v){return v>0?Math.max(1.5,v/smax*100):0;}
      var items=sub.rows.map(function(r){
        var cls,note;
        if(r.status==='paid'){cls='paid';note=r.when!=null?'Paid '+fmtDay(r.when):'Paid';}
        else if(r.status==='due'){cls='due';note=r.when==null?'Still to pay':(r.when>=today?'Due around '+fmtDay(r.when):'Expected '+fmtDay(r.when)+', not recorded');}
        else{cls='miss';note='Not recorded, usually '+fmt(r.amount);}
        var val=r.status==='missed'?'\u2013':fmt(r.amount);
        var tip=r.label+'\n'+note+(r.status==='missed'?'':'\n'+fmt(r.amount));
        return '<li class="sub" data-tip="'+esc(tip)+'"><div class="sub-name">'+esc(r.label)+'</div>'+
          '<div class="sub-track"><i class="sbar '+cls+'" style="width:'+sw(r.amount)+'%"></i></div>'+
          '<div class="sub-v">'+esc(val)+'<small>'+esc(note)+'</small></div></li>';
      }).join('');
      var total=sub.paid+sub.due;
      var pp=total?sub.paid/total*100:0,dp=total?sub.due/total*100:0;
      var head='<div class="sub-sum"><div class="sub-line"><b>'+esc(fmt(sub.paid))+'</b> '+(sub.due>0?'paid of '+esc(fmt(total)):'paid')+
        (sub.due>0?'<span class="hint"> \u00b7 '+esc(fmt(sub.due))+' still to come</span>':'')+'</div>'+
        (total>0?'<div class="sub-all" aria-hidden="true">'+(pp>0?'<i class="sbar paid" style="width:'+pp+'%"></i>':'')+(dp>0?'<i class="sbar due" style="width:'+dp+'%"></i>':'')+'</div>':'')+'</div>';
      var from=Math.max(0,periods.length-8);
      var tRows=periods.slice(from).map(function(q,k){
        var ix=from+k,tot=0;
        var cells=sub.cols.map(function(c){var v=c.per[ix].paid;tot+=v;return '<td class="n">'+(v>0?esc(fmt(v)):'\u2013')+'</td>';}).join('');
        return '<tr'+(q.key===cur.key?' class="selrow"':'')+'><td>'+esc(q.label)+'</td>'+cells+'<td class="n">'+esc(fmt(tot))+'</td></tr>';
      }).join('');
      var unitCap=unit.charAt(0).toUpperCase()+unit.slice(1);
      subHTML='<section class="panel"><div class="panel-h"><h2>Subscriptions and bills</h2><div class="legend"><span><i class="sw s1"></i>Paid</span><span><i class="sw due"></i>Still due</span><span><i class="sw miss"></i>Not recorded</span></div></div>'+
        head+'<ul class="subs">'+items+'</ul>'+
        '<details><summary>Cost by '+unit+'</summary><div class="tbl-wrap"><table><thead><tr><th>'+unitCap+'</th>'+sub.cols.map(function(c){return '<th class="n">'+esc(c.label)+'</th>';}).join('')+'<th class="n">Total</th></tr></thead><tbody>'+tRows+'</tbody></table></div></details></section>';
    })();
    var rideAll=Logic.rides(periods),rideHTML='',rideTrend=null;
    (function(){
      if(!rideAll.some(function(r){return r.count;})) return;
      var R=rideAll[i],RP=prev?rideAll[i-1]:null;
      var stats=[['Rides',String(R.count)],['Average ride',R.count?fmt(R.total/R.count):'–']];
      stats.push(['Office trips',R.officeN?R.officeN+' · '+fmt(R.office):'0']);
      var tr=A.by['Transport'];
      if(tr>0) stats.push(['Share of Transport',Math.round(R.total/tr*100)+'%']);
      var cmp='First '+unit+' on record.';
      if(RP) cmp=prev.label+': '+fmt(RP.total)+' over '+RP.count+(RP.count===1?' ride':' rides')+'.';
      var rows=R.list.map(function(r){
        var route=r.from&&r.to?r.from+' → '+r.to:r.to?'To '+r.to:r.from?'From '+r.from:(r.note||(r.office?'Office trip':'–'));
        var tags=r.tags.map(function(g){return '<span class="tag">'+esc(g)+'</span>';}).join('');
        return '<tr><td>'+esc(r.day!=null?fmtDay(r.day):'')+'</td><td>'+esc(route)+tags+'</td><td>'+esc(r.mode)+'</td><td class="n">'+fmt(r.amt)+'</td></tr>';
      }).join('');
      var dest={};
      rideAll.forEach(function(x){x.list.forEach(function(r){
        if(!r.to) return;
        var k=r.to.toLowerCase();
        if(!dest[k]) dest[k]={name:r.to,n:0,v:0};
        dest[k].n++;dest[k].v+=r.amt;
      });});
      var dl=Object.keys(dest).map(function(k){return dest[k];}).sort(function(a,b){return (b.n-a.n)||(b.v-a.v);}).slice(0,6);
      var dmax=Math.max.apply(null,dl.map(function(d){return d.n;}).concat([1]));
      var destRows=dl.map(function(d){
        return '<li class="mode" data-tip="'+esc(d.name+'\n'+d.n+(d.n===1?' ride, ':' rides, ')+fmt(d.v)+'\nAverage '+fmt(d.v/d.n))+'"><div class="m-name">'+esc(d.name)+'</div><div class="track"><i class="bar bn" style="width:'+Math.max(1.5,d.n/dmax*100)+'%"></i></div><div class="v v1">'+d.n+(d.n===1?' ride':' rides')+'</div></li>';
      }).join('');
      var from=Math.max(0,periods.length-8);
      rideTrend=periods.slice(from).map(function(p,k){
        var x=rideAll[from+k];
        var cls=p.key===cur.key?'c-s1':(prev&&p.key===prev.key)?'c-s2':'c-n';
        return {v:x.total,cls:cls,xl:p.label,top:x.total?kfmt(x.total):'',tip:p.name+'\n'+x.count+(x.count===1?' ride':' rides')+'\n'+fmt(x.total)};
      });
      rideHTML='<section class="panel"><div class="panel-h"><h2>InDrive rides</h2><span class="hint">'+esc(rangeText(cur))+'</span></div>'+
        '<div class="pair"><div><div class="eyebrow">Spent on InDrive</div><div class="bud-big">'+esc(fmt(R.total))+'</div><div class="bud-note">'+esc(cmp)+'</div>'+
        '<dl class="stats ride-stats">'+stats.map(function(s){return '<div><dt>'+esc(s[0])+'</dt><dd>'+esc(s[1])+'</dd></div>';}).join('')+'</dl></div>'+
        '<div><div class="sub-line">InDrive by '+unit+'</div><div id="rides-trend"></div></div></div>'+
        '<div class="pair ride-lower"><div><div class="sub-line">Rides this '+unit+'</div>'+(rows?'<div class="tbl-wrap"><table><thead><tr><th>Date</th><th>Route</th><th>Paid via</th><th class="n">Fare</th></tr></thead><tbody>'+rows+'</tbody></table></div>':'<div class="empty">No InDrive rides this '+unit+' yet.</div>')+'</div>'+
        '<div><div class="sub-line">Where you go most, all time</div>'+(destRows?'<ul class="modes">'+destRows+'</ul>':'<div class="empty">No destinations recorded yet.</div>')+'</div></div></section>';
    })();
    var budgetHTML='';
    (function(){
      var fb=Logic.foodBudget(cur,bal,subAll,Logic.todayNum());
      if(!fb) return;
      var perDay=Math.floor(fb.perDay);
      var pct=Math.round(Logic.BUFFER*100);
      var last=fmtDay(fb.payday-1);
      var pf=(B&&B.dayCount)?B.by['Food']/B.dayCount:null;
      var big,note,warn=false;
      if(fb.avail<=0){
        big='Rs\u00a00<small>a day</small>';
        note='Bills still due ('+fmt(fb.due)+') '+(fb.avail<0?'are '+fmt(fb.short)+' more than what remains.':'use up everything that remains.')+' Nothing is left to spend before payday on '+fmtDay(fb.payday)+'.';
        warn=true;
      }else{
        big=esc(fmt(perDay))+'<small>a day</small>';
        note='Spread over '+fb.days+(fb.days===1?' day':' days')+', '+fmtDay(fb.from)+' to '+last+', until payday on '+fmtDay(fb.payday)+'. The '+pct+'% buffer is kept back.';
      }
      var extra='';
      if(!warn&&pf!=null&&pf>0){
        extra+='<div class="bud-note">'+esc('For comparison, your '+prev.label+' food spending alone averaged '+fmt(pf)+' a day.')+'</div>';
      }
      if(A.dayCount>=3&&A.by['Food']>0) extra+='<div class="bud-note">'+esc('Food so far this '+unit+': '+fmt(A.by['Food']/A.dayCount)+' a day.')+'</div>';
      if(fb.later>0) extra+='<div class="bud-note">'+esc(fmt(fb.later)+' of bills fall after payday and are not counted.')+'</div>';
      var bar='';
      if(fb.remaining>0&&fb.avail>0){
        var dp=fb.due/fb.remaining*100,bp=fb.buffer/fb.remaining*100,up=fb.usable/fb.remaining*100;
        bar='<div class="bud-bar" role="img" aria-label="Remaining split into bills still due, buffer and daily spend limit">'+
          (dp>0?'<i class="sbar due" style="width:'+dp+'%" data-tip="'+esc('Bills still due\n'+fmt(fb.due))+'"></i>':'')+
          (bp>0?'<i class="sbar buf" style="width:'+bp+'%" data-tip="'+esc(pct+'% buffer\n'+fmt(fb.buffer))+'"></i>':'')+
          (up>0?'<i class="sbar paid" style="width:'+up+'%" data-tip="'+esc('Spend limit\n'+fmt(fb.usable))+'"></i>':'')+'</div>';
      }
      var minus='\u2212';
      var ledger='<dl class="ledger">'+
        '<div><dt>Remaining (sheet)</dt><dd>'+esc(fmtS(fb.remaining))+'</dd></div>'+
        '<div><dt>Bills still due before payday</dt><dd>'+esc(minus+fmt(fb.due))+'</dd></div>'+
        '<div><dt>Left after bills</dt><dd>'+esc(fmtS(fb.avail))+'</dd></div>'+
        '<div><dt>'+pct+'% buffer kept</dt><dd>'+esc(minus+fmt(fb.buffer))+'</dd></div>'+
        '<div class="total"><dt>Safe to spend until payday</dt><dd>'+esc(fmt(fb.usable))+'</dd></div></dl>';
      budgetHTML='<section class="panel"><div class="panel-h"><h2>Daily spend limit</h2>'+
        (bar?'<div class="legend"><span><i class="sw s1"></i>Spend limit</span><span><i class="sw due"></i>Bills still due</span><span><i class="sw buf"></i>'+pct+'% buffer</span></div>':'')+'</div>'+
        '<div class="bud"><div><div class="eyebrow">Safe to spend</div><div class="bud-big">'+big+'</div><div class="bud-note'+(warn?' warn':'')+'">'+esc(note.replace(/<[^>]*>/g,''))+'</div>'+extra+'</div>'+
        '<div>'+bar+ledger+'</div></div></section>';
    })();
    var alertHTML='';
    if(bal&&bal.remaining<0){
      var figs=[];
      if(bal.start!=null) figs.push(['Started with',fmt(bal.start),'']);
      if(bal.spent!=null) figs.push(['Spent (sheet)',fmt(bal.spent),'']);
      figs.push(['Remaining',fmtS(bal.remaining),'neg']);
      alertHTML='<section class="alert" role="alert"><span class="pill">Overspent</span>'+
        '<div class="alert-t"><b>'+esc(cur.name)+': you are '+esc(fmt(-bal.remaining))+' over what this cycle started with.</b>'+
        '<span>Taken from the balance notes in column G of your Tracking tab, so Spent there can differ from the dashboard total below.</span></div>'+
        '<dl class="alert-f">'+figs.map(function(f){return '<div><dt>'+esc(f[0])+'</dt><dd'+(f[2]?' class="'+f[2]+'"':'')+'>'+esc(f[1])+'</dd></div>';}).join('')+'</dl></section>';
    }
    main.innerHTML=
      alertHTML+
      '<section class="hero" aria-label="Summary"><div><div class="eyebrow">Spent, '+esc(rangeText(cur))+'</div><div class="big">'+fmt(A.spent)+'</div><div class="delta">'+esc(delta)+'</div></div>'+
      '<dl class="stats">'+stats.map(function(s){return '<div><dt>'+esc(s[0])+'</dt><dd'+(s[2]?' class="'+s[2]+'"':'')+'>'+esc(s[1])+'</dd></div>';}).join('')+'</dl></section>'+
      budgetHTML+
      '<section class="panel"><div class="panel-h"><h2>Where it went</h2><div class="legend"><span><i class="sw s1"></i>'+esc(cur.label)+'</span>'+(B?'<span><i class="sw s2"></i>'+esc(prev.label)+'</span>':'')+'</div></div>'+
        (catRows?'<ul class="cats">'+catRows+'</ul>':'<div class="empty">No spending recorded in this period yet.</div>')+'</section>'+
      subHTML+
      rideHTML+
      '<div class="pair">'+
        '<section class="panel"><div class="panel-h"><h2>Spending by day</h2><span class="hint">'+esc(rangeText(cur))+'</span></div><div id="daily"></div>'+
          '<details><summary>Daily figures</summary><div class="tbl-wrap"><table><thead><tr><th>Date</th><th class="n">Spent</th></tr></thead><tbody>'+(dayRows||'<tr><td colspan="2">No spending yet.</td></tr>')+'</tbody></table></div></details></section>'+
        '<section class="panel"><div class="panel-h"><h2>Spent by '+unit+'</h2><div class="legend"><span><i class="sw s1"></i>'+esc(cur.label)+'</span>'+(B?'<span><i class="sw s2"></i>'+esc(prev.label)+'</span>':'')+'<span><i class="sw n"></i>Earlier</span></div></div><div id="trend"></div></section>'+
      '</div>'+
      '<div class="pair">'+
        '<section class="panel"><div class="panel-h"><h2>Paid from</h2><span class="hint">Share of '+esc(cur.label)+' spending</span></div>'+(modeRows?'<ul class="modes">'+modeRows+'</ul>':'<div class="empty">Nothing yet.</div>')+'</section>'+
        '<section class="panel"><div class="panel-h"><h2>Largest expenses</h2><span class="hint">'+esc(cur.label)+'</span></div>'+(topRows?'<div class="tbl-wrap"><table><thead><tr><th>Expense</th><th>Date</th><th>Category</th><th class="n">Amount</th></tr></thead><tbody>'+topRows+'</tbody></table></div>':'<div class="empty">Nothing yet.</div>')+'</section>'+
      '</div>';

    var dn=A.daily.length,step=Math.max(1,Math.ceil(dn/6));
    var dItems=A.daily.map(function(d,k){
      var xl=(k===0)?fmtDay(d.day):(k%step===0||k===dn-1)?dom(d.day):'';
      if(k===dn-1&&dn>1&&(dn-1)%step!==0&&(dn-1)-Math.floor((dn-1)/step)*step<2) xl='';
      return {v:d.v,cls:'c-s1',xl:xl,tip:fmtDayY(d.day)+'\n'+fmt(d.v)};
    });
    var mxv=Math.max.apply(null,dItems.map(function(d){return d.v;}).concat([0]));
    var marked=false;
    dItems.forEach(function(d){if(!marked&&d.v>0&&d.v===mxv){d.top=kfmt(d.v);marked=true;}});
    drawCols($('#daily'),dItems,{aria:'Daily spending in '+cur.label});

    var from=Math.max(0,periods.length-8);
    var tItems=periods.slice(from).map(function(p,k){
      var v=aggs[from+k].spent;
      var cls=p.key===cur.key?'c-s1':(prev&&p.key===prev.key)?'c-s2':'c-n';
      return {v:v,cls:cls,xl:p.label,top:kfmt(v),tip:p.name+'\n'+rangeText(p)+'\nSpent '+fmt(v)};
    });
    drawCols($('#trend'),tItems,{aria:'Spending by '+unit});
    if(rideTrend) drawCols($('#rides-trend'),rideTrend,{aria:'InDrive spending by '+unit,h:170});

    var n=[];
    n.push('<p>Spent adds Food, Utilities, Family/Home, Renovation, Transport, Shopping, Fun, Loans given and Untracked. Savings, transfers and money received back are kept out of it.</p>');
    if(bal) n.push('<p>Remaining comes from the balance notes in column G of your Tracking tab: what the cycle started with, minus Spent.</p>');
    if(subHTML) n.push('<p>Subscriptions and bills are picked out of the Expense and Description columns: Claude, internet, Amazon, foodpanda, YouTube and Netflix. A bill counts as still due when it was paid in an earlier period but not yet in this one, at the amount last paid. The due date repeats the day of the month it was last paid.</p>');
    if(rideHTML) n.push('<p>InDrive rides are rows named InDrive, or with InDrive in the description. The route comes from the description: "home to office", "to office" or "to api from home". Office trips are rides whose description mentions the office or says absent. Where you go most counts every ride with a destination.</p>');
    if(budgetHTML) n.push('<p>Daily spend limit: Remaining from column G of your Tracking tab, minus bills still due before payday, keeping '+Math.round(Logic.BUFFER*100)+'% back, divided by the days from today up to the day before the '+Logic.PAYDAY_DOM+'th. It covers all everyday spending, food or otherwise, from this one limit. It only appears for the current payday cycle.</p>');
    if(inc&&!isNaN(inc.spent)){
      var diff=Math.abs(inc.spent-A.spent);
      n.push('<p>'+(diff<1?'This total matches the Spent column in your Dashboard Data tab.':'Your Dashboard Data tab shows '+fmt(inc.spent)+' for this cycle and this page counts '+fmt(A.spent)+'. The tab may be a refresh behind.')+'</p>');
    }
    if(A.outside>0) n.push('<p>'+A.outside+' '+(A.outside===1?'entry has':'entries have')+' a date outside this period, probably a typing slip. They count in the totals but not in the daily chart.</p>');
    if(S.rowCount) n.push('<p>Read '+S.rowCount+' rows from the Tracking tab in '+S.calls+' requests. Periods found: '+periods.map(function(p){return p.label;}).join(', ')+'.</p>');
    notes.innerHTML=n.join('');
  }

  document.addEventListener('click',function(e){
    var c=e.target.closest&&e.target.closest('[data-key]');
    if(c&&c.classList.contains('chip')){S.sel=c.getAttribute('data-key');save();render();return;}
    var m=e.target.closest&&e.target.closest('[data-mode]');
    if(m){S.mode=m.getAttribute('data-mode');S.sel=null;save();render();}
  });
  $('#refresh').addEventListener('click',function(){retried=false;load(true);});
  $('#signin').addEventListener('click',function(){
    signIn().then(function(){showAuthButtons();retried=false;return load(true);},function(e){setStatus(errMsg(e),true);});
  });
  $('#signout').addEventListener('click',function(){
    if(ctrl){try{ctrl.abort();}catch(e){}}
    if(token&&window.google&&google.accounts) try{google.accounts.oauth2.revoke(token.t,function(){});}catch(e){}
    token=null;
    try{sessionStorage.removeItem(SS_TOK);localStorage.removeItem(LS);}catch(e){}
    S.tracking=null;S.incomeRows=null;S.income={};S.at=0;S.rowCount=0;
    if(authState==='ready') authState='signedout';
    showAuthButtons();render();
    setStatus('Signed out. The saved copy was removed from this browser.',false);
  });
  document.addEventListener('submit',function(e){
    if(e.target.id!=='setup') return;
    e.preventDefault();
    var c=$('#cfg-client').value.trim(),s=$('#cfg-sheet').value.trim();
    var m=/\/d\/([a-zA-Z0-9_-]+)/.exec(s);if(m) s=m[1];
    if(!c||!s) return;
    try{localStorage.setItem(LS_CFG,JSON.stringify({clientId:c,sheetId:s}));}catch(x){}
    location.reload();
  });

  var tip=$('#tip'),tipTimer=0;
  function showTip(e){
    var t=e.target.closest&&e.target.closest('[data-tip]');
    if(!t){tip.classList.remove('on');return;}
    tip.textContent=t.getAttribute('data-tip');
    tip.classList.add('on');
    var r=tip.getBoundingClientRect();
    var x=e.clientX+12,y=e.clientY+14;
    if(x+r.width>window.innerWidth-8) x=e.clientX-r.width-12;
    if(y+r.height>window.innerHeight-8) y=e.clientY-r.height-12;
    tip.style.left=Math.max(8,x)+'px';tip.style.top=Math.max(8,y)+'px';
    clearTimeout(tipTimer);
    if(e.pointerType==='touch') tipTimer=setTimeout(function(){tip.classList.remove('on');},1800);
  }
  document.addEventListener('pointermove',showTip);
  document.addEventListener('pointerdown',showTip);
  document.addEventListener('pointerout',function(e){if(!e.relatedTarget) tip.classList.remove('on');});
  window.addEventListener('scroll',function(){tip.classList.remove('on');},{passive:true});

  var rz=0;
  window.addEventListener('resize',function(){clearTimeout(rz);rz=setTimeout(function(){if(S.tracking) render();},150);});

  setInterval(function(){if(!document.hidden&&authState==='ready') load(false);},60000);
  document.addEventListener('visibilitychange',function(){if(!document.hidden&&authState==='ready'&&Date.now()-S.at>60000) load(false);});

  restore();
  showAuthButtons();
  render();
  if(authState==='unconfigured'){
    setStatus('Add your Google OAuth client ID to finish setting up.',true);
  }else{
    if(S.tracking) setStatus('Showing a saved copy from '+timeStr(S.at)+'. Connecting to Google…',false);
    loadGoogle();
  }
})();
