/* Workspace UI: shell, Overview, Flows, Explorer, inspector and command palette.
   Reads state from Ledger (app.js) and derives everything with Logic (logic.js). */
(function(){
  var L=window.Ledger;
  var esc=L.esc,fmt=L.fmt,fmtS=L.fmtS,K=Viz.kfmt,S=L.S;
  var DAY=Logic.DAY,MON=Logic.MON;
  function $(s,r){return (r||document).querySelector(s);}
  function $$(s,r){return Array.prototype.slice.call((r||document).querySelectorAll(s));}

  // ---- categories: fixed slot per category, never by rank ----
  var SLOT={'Food':1,'Transport':2,'Utilities':3,'Family/Home':4,'Shopping':5,'Fun':6,'Renovation':7,'Loans given':8};
  var EXTRA={savings:'Savings',influx:'Money in',transfer:'Transfer'};
  function catName(lower){return Logic.CAT_KEY[lower]||EXTRA[lower]||(lower?lower.charAt(0).toUpperCase()+lower.slice(1):'–');}
  function cls(name){return SLOT[name]?'c'+SLOT[name]:'cn';}
  function tag(name){return '<span class="tag '+cls(name)+'"><i></i>'+esc(name)+'</span>';}
  function isSpend(t){return t.cat!=='savings'&&t.cat!=='influx'&&t.cat!=='transfer';}

  function fmtDay(n){var d=new Date(n*DAY);return d.getUTCDate()+' '+MON[d.getUTCMonth()];}
  function fmtDayY(n){var d=new Date(n*DAY);return d.getUTCDate()+' '+MON[d.getUTCMonth()]+' '+d.getUTCFullYear();}
  var WD=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  function wday(n){return WD[new Date(n*DAY).getUTCDay()];}
  function txId(t){return 'TX-'+String(t.row||0).padStart(4,'0');}
  function itemKey(name){return String(name||'').trim().toLowerCase();}
  function pct(a,b){return b?Math.round(a/b*100):0;}

  // ---- UI state, kept per browser ----
  var LSU='ledger.ui';
  var U={fx:false,view:'overview',layers:{prev:true,pace:true,events:true},ex:{type:'tx',scope:'period',q:'',cats:[],modes:[],min:0,sort:'day',dir:-1,sel:null}};
  try{var u=JSON.parse(localStorage.getItem(LSU)||'null');if(u){U.layers=Object.assign(U.layers,u.layers||{});if(u.ex){U.ex.type=u.ex.type||'tx';U.ex.scope=u.ex.scope||'period';}}}catch(e){}
  function saveU(){try{localStorage.setItem(LSU,JSON.stringify({layers:U.layers,ex:{type:U.ex.type,scope:U.ex.scope}}));}catch(e){}}
  function viewFromHash(){var m=/^#\/(overview|flows|explorer|forecast)/.exec(location.hash);return m?m[1]:'overview';}
  U.view=viewFromHash();

  // =====================================================================
  // model
  // =====================================================================
  var M=null;
  function model(){
    var parsed=Logic.parseTracking(S.tracking);
    var today=Logic.todayNum();
    var cyc=Logic.cyclePeriods(parsed,today);
    var periods=S.mode==='cycle'?cyc:Logic.monthPeriods(parsed,today);
    if(!periods.length) return {parsed:parsed,periods:periods,empty:true};
    var i=periods.findIndex(function(p){return p.key===S.sel;});
    if(i<0) i=periods.length-1;
    S.sel=periods[i].key;
    var cur=periods[i],prev=periods[i-1]||null;
    var aggs=periods.map(Logic.aggregate);
    var A=aggs[i],B=prev?aggs[i-1]:null;
    var isCycle=S.mode==='cycle';
    var balSrc=isCycle?cur:null;
    if(!isCycle) for(var j=cyc.length-1;j>=0;j--) if(cyc[j].bal){balSrc=cyc[j];break;}
    var bal=balSrc&&balSrc.bal&&balSrc.bal.acc&&Object.keys(balSrc.bal.acc).length?balSrc.bal:null;
    var sub=Logic.subscriptions(periods,i);
    var fb=isCycle?Logic.foodBudget(cur,cur.bal,sub,today):null;
    var rides=Logic.rides(periods);
    return {parsed:parsed,all:parsed.all,periods:periods,i:i,cur:cur,prev:prev,aggs:aggs,A:A,B:B,isCycle:isCycle,unit:isCycle?'cycle':'month',
      bal:bal,balSrc:balSrc,sub:sub,fb:fb,rides:rides,today:today,inc:isCycle?S.income[cur.label]:null};
  }
  function rangeText(p){return fmtDay(p.start)+' – '+(p.open?'today':fmtDay(p.end));}

  // =====================================================================
  // shell
  // =====================================================================
  function renderShell(){
    var st=L.state(),signed=st==='ready';
    $('#signin').hidden=st!=='signedout';
    $('#signout').hidden=!(signed||S.tracking);
    $('#refresh').hidden=!signed;
    $$('#tabs [data-view]').forEach(function(a){a.setAttribute('aria-current',a.getAttribute('data-view')===U.view?'page':'false');});
    $('#m-cycle').setAttribute('aria-pressed',String(S.mode==='cycle'));
    $('#m-month').setAttribute('aria-pressed',String(S.mode==='month'));
    if(window.LedgerEditor) LedgerEditor.sync();
  }
  function renderStatus(){
    var s=S.status||{};
    var el=$('#status-line');
    el.textContent=s.msg||'';
    el.className='status-line'+(s.warn?' warn':'');
    $('.statusbar').classList.toggle('warn',!!s.warn);
    var live=L.state()==='ready'&&!s.warn&&S.tracking&&!S.stale;
    $('#sync').className='sync '+(S.busy?'busy':live?'live':S.tracking?'stale':'off');
    $('#sync-t').textContent=S.busy?'SYNCING':live?'LIVE':S.tracking?'CACHED':'OFFLINE';
    $('#sync-time').textContent=S.at?L.timeStr(S.at):'–';
    var cfg=L.config();
    $('#sb-src').textContent=cfg.range;
    $('#sb-rows').textContent=S.rowCount?S.rowCount+' rows':(S.tracking?S.tracking.length+' rows':'–');
    $('#sb-req').textContent=S.calls?S.calls+' requests':'–';
  }
  function renderCtx(){
    var chips=$('#periods'),crumb=$('#crumb');
    if(!M||M.empty){chips.innerHTML='';crumb.innerHTML='<span>Tracking</span>';return;}
    crumb.innerHTML='<span>Tracking</span><b>/</b><span>'+(M.isCycle?'Payday cycles':'Calendar months')+'</span><b>/</b><span class="cur">'+esc(M.cur.name)+'</span>';
    chips.innerHTML=M.periods.slice().reverse().slice(0,10).map(function(p){
      var on=p.key===M.cur.key,pv=M.prev&&p.key===M.prev.key;
      return '<button type="button" class="pchip'+(on?' on':'')+(pv?' prev':'')+'" data-key="'+p.key+'" aria-pressed="'+on+'"><span>'+esc(p.label)+'</span><small>'+esc(fmtDay(p.start)+(p.open?' →':' – '+fmtDay(p.end)))+'</small></button>';
    }).join('');
  }

  function gate(){
    var st=L.state();
    if(st==='unconfigured'){
      var c=L.config();
      return '<div class="gate"><div class="gate-card"><div class="gate-mark">'+LOGO+'</div><h1>Connect a data source</h1>'+
        '<p>This workspace reads your Google Sheet straight from the browser after you sign in with Google. Paste the OAuth client ID you created in Google Cloud and your sheet link or ID. They are saved in this browser only; to set them everywhere, put them in config.js.</p>'+
        '<form id="setup"><label>OAuth client ID<input id="cfg-client" required autocomplete="off" spellcheck="false" placeholder="1234-abc.apps.googleusercontent.com" value="'+esc(c.clientId)+'"></label>'+
        '<label>Sheet link or ID<input id="cfg-sheet" required autocomplete="off" spellcheck="false" placeholder="https://docs.google.com/spreadsheets/d/…" value="'+esc(c.sheetId)+'"></label>'+
        '<button type="submit" class="btn primary">Connect</button></form></div></div>';
    }
    if(st==='signedout') return '<div class="gate"><div class="gate-card"><div class="gate-mark">'+LOGO+'</div><h1>Ledger workspace</h1>'+
      '<p>Sign in with the Google account that owns your Monthly Expense Tracking sheet. Google will ask to let this page see and edit your spreadsheets, so you can log entries and update balances here.</p>'+
      '<button type="button" class="btn primary" data-act="signin">Sign in with Google</button>'+
      (L.isApp()?'':'<a class="gate-apk" href="ledger.apk">Get the Android app ↓</a>')+'</div></div>';
    return '<div class="gate"><div class="gate-card loading"><div class="gate-mark">'+LOGO+'</div><h1>Opening workspace</h1><p>Reading your Tracking sheet…</p><div class="scan"></div></div></div>';
  }
  var LOGO='<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><path d="M4 18h16" class="lg-a"/><path d="M6 15l4-5 3 3 5-7" class="lg-b"/><circle cx="18" cy="6" r="1.8" class="lg-c"/></svg>';

  // =====================================================================
  // overview
  // =====================================================================
  function pnl(id,title,meta,body,o){
    o=o||{};
    return '<section class="pnl '+(o.cls||'')+'" id="'+id+'"><header class="pnl-h"><span class="pnl-t"><i class="pnl-dot"></i>'+esc(title)+'</span>'+
      (meta?'<span class="pnl-m">'+meta+'</span>':'')+(o.tools?'<span class="pnl-tools">'+o.tools+'</span>':'')+'</header><div class="pnl-b">'+body+'</div></section>';
  }
  function kpi(label,value,sub,o){
    o=o||{};
    return '<div class="kpi'+(o.cls?' '+o.cls:'')+'"'+(o.tip?' data-tip="'+esc(o.tip)+'"':'')+'><div class="kpi-l">'+esc(label)+'</div><div class="kpi-v">'+value+'</div>'+
      '<div class="kpi-s">'+(sub||'')+'</div>'+(o.spark||'')+'</div>';
  }

  function signals(){
    var A=M.A,B=M.B,out=[];
    var bal=M.isCycle?M.cur.bal:null;
    if(bal&&bal.remaining<0) out.push({lv:'critical',t:'Cycle overspent by '+fmt(-bal.remaining),d:M.cur.name+' started with '+(bal.start!=null?fmt(bal.start):'its month start')+'. Remaining in column G is below zero.'});
    if(M.bal&&M.bal.offset!=null){
      var off=M.bal.offset;
      if(Math.abs(off)>=1) out.push({lv:'serious',t:'Accounts off by '+fmt(Math.abs(off)),d:off>0?'Accounts hold more than the entries explain. A balance was probably not lowered after logging.':'Accounts hold less than the entries say. An expense is probably missing.',act:'<button type="button" class="lnk" data-open-bal="'+esc(M.balSrc.name)+'">Reconcile →</button>'});
      else out.push({lv:'good',t:'Accounts reconciled',d:'ABL, Sadapay and Cash match the logged entries for '+M.balSrc.name+'.'});
    }
    if(M.fb&&M.fb.avail<=0) out.push({lv:'critical',t:'Nothing safe to spend before payday',d:'Bills still due ('+fmt(M.fb.due)+') use up what remains.'});
    var due=M.sub.rows.filter(function(r){return r.status==='due';});
    if(due.length) out.push({lv:'warning',t:due.length+(due.length===1?' bill':' bills')+' still due · '+fmt(M.sub.due),d:due.map(function(r){return r.label;}).join(', ')+'.'});
    var missed=M.sub.rows.filter(function(r){return r.status==='missed';});
    if(missed.length) out.push({lv:'info',t:missed.length+' usual '+(missed.length===1?'bill':'bills')+' not recorded',d:missed.map(function(r){return r.label;}).join(', ')+' did not appear this '+M.unit+'.'});
    if(B&&A.dayCount>0){
      var n=Math.min(A.dayCount,B.daily.length),bc=0;
      for(var k=0;k<n;k++) bc+=B.daily[k].v;
      if(bc>0&&M.cur.open){
        var d=(A.spent-bc)/bc*100;
        if(Math.abs(d)>=5) out.push({lv:d>15?'warning':d<-10?'good':'info',t:'Pace '+(d>0?'+':'−')+Math.abs(Math.round(d))+'% vs '+M.prev.label,d:'Day '+A.dayCount+': '+fmt(A.spent)+' spent against '+fmt(bc)+' by the same day of '+M.prev.label+'.'});
      }
      var best=null;
      Logic.CATS.forEach(function(c){var dd=A.by[c]-B.by[c];if(!best||Math.abs(dd)>Math.abs(best.d)) best={c:c,d:dd};});
      if(best&&Math.abs(best.d)>=500) out.push({lv:'info',t:best.c+' '+(best.d>0?'up ':'down ')+fmt(Math.abs(best.d)),d:'Largest category change against '+M.prev.label+(M.cur.open?' so far':'')+'.'});
    }
    if(A.outside>0) out.push({lv:'info',t:A.outside+(A.outside===1?' entry':' entries')+' dated outside this '+M.unit,d:'Probably a typing slip in the Date column. They count in totals but not in the daily chart.'});
    var rank={critical:0,serious:1,warning:2,info:3,good:4};
    return out.sort(function(a,b){return rank[a.lv]-rank[b.lv];});
  }
  var ICON={critical:'✕',serious:'!',warning:'!',info:'i',good:'✓'};
  var LV={critical:'Critical',serious:'Serious',warning:'Warning',info:'Info',good:'OK'};

  function overview(){
    var A=M.A,B=M.B,cur=M.cur,prev=M.prev;
    // KPI strip
    var delta='First '+M.unit+' on record';
    if(B&&B.spent){var d=(A.spent-B.spent)/B.spent*100;delta='<b class="'+(d>0.5?'up':d<-0.5?'dn':'')+'">'+(d>0.5?'▲':d<-0.5?'▼':'■')+' '+Math.abs(Math.round(d))+'%</b> vs '+esc(prev.label)+(cur.open?' total':'');}
    var cum=0,cumVals=A.daily.map(function(x){cum+=x.v;return cum;});
    var k=[];
    k.push(kpi('Spent · '+cur.label,esc(fmt(A.spent)),delta,{cls:'hero',spark:Viz.spark(cumVals,120,30)}));
    if(M.fb) k.push(kpi('Safe to spend',esc(fmt(Math.max(0,Math.floor(M.fb.perDay))))+'<small>/day</small>',esc(M.fb.days+' days to payday · '+fmtDay(M.fb.payday)),{cls:M.fb.avail<=0?'bad':''}));
    var bal=M.isCycle?cur.bal:null;
    if(bal) k.push(kpi('Remaining',esc(fmtS(bal.remaining)),'Column G of '+esc(cur.name),{cls:bal.remaining<0?'bad':''}));
    if(M.bal){
      var tot=M.bal.total!=null?M.bal.total:0,off=M.bal.offset;
      k.push(kpi('Liquid',esc(fmt(tot)),off==null?'ABL + Sadapay + Cash':Math.abs(off)<1?'<span class="ok">✓ Reconciled</span>':'<span class="bad">! Off by '+esc(fmt(Math.abs(off)))+'</span>'));
    }
    // Pay myself is the running savings balance; growth from the previous period is what was saved.
    var sv=A.saved;
    if(sv>0){
      var pv=0;for(var j=M.i-1;j>=0;j--) if(M.aggs[j].saved>0){pv=M.aggs[j].saved;break;}
      var g=pv?sv-pv:null;
      k.push(kpi('Savings',esc(fmt(sv)),g==null?'Pay myself balance':g>0?'<span class="ok">\u25b2 +'+esc(fmt(g))+'</span> since last payday':g<0?'<span class="bad">\u25bc '+esc(fmt(-g))+'</span> since last payday':'Same as last payday'));
    }else k.push(kpi('Savings','\u2013','No Pay myself row in this '+M.unit));
    k.push(kpi('Activity',String(A.count)+'<small> entries</small>',esc(fmt(A.spent/Math.max(1,A.dayCount)))+' / day avg'));

    var sig=signals();
    var sigHTML=sig.length?'<ul class="sig">'+sig.map(function(s){
      return '<li class="sig-'+s.lv+'"><span class="sig-i" aria-hidden="true">'+ICON[s.lv]+'</span><div><div class="sig-t"><span class="sig-lv">'+LV[s.lv]+'</span>'+esc(s.t)+'</div><div class="sig-d">'+esc(s.d)+(s.act?' '+s.act:'')+'</div></div></li>';
    }).join('')+'</ul>':'<div class="empty">No signals for this '+M.unit+'.</div>';

    var layerBtn=function(k2,label,c){return '<button type="button" class="layer" data-layer="'+k2+'" aria-pressed="'+!!U.layers[k2]+'"><i class="'+c+'"></i>'+label+'</button>';};
    var tools=(B?layerBtn('prev',prev.label+' overlay','lg-prev'):'')+(bal&&bal.start!=null&&M.isCycle?layerBtn('pace','Even pace','lg-pace'):'')+layerBtn('events','Events','lg-ev');

    var html='<div class="kpis" style="--n:'+(k.length-1)+'">'+k.join('')+'</div>'+
      '<div class="grid">'+
      pnl('p-traj','Spend trajectory',esc(rangeText(cur)),'<div class="traj" id="traj"></div><div class="legend" id="traj-legend"></div>',{cls:'s8',tools:tools})+
      pnl('p-sig','Signals','<span class="count">'+sig.length+'</span>',sigHTML,{cls:'s4'})+
      accountsPanel()+budgetPanel()+billsPanel()+
      compositionPanel()+deltaPanel()+
      pnl('p-heat','Activity','Daily spend, last 22 weeks','<div id="heat"></div>',{cls:'s8'})+
      railsPanel()+
      ridesPanel()+largestPanel()+
      '</div>'+notes();
    return html;
  }

  function accountsPanel(){
    var b=M.bal;
    if(!b) return pnl('p-acct','Accounts','','<div class="empty">No ABL, Sadapay or Cash rows found in column G.</div>',{cls:'s4'});
    var names=Object.keys(b.acc).filter(function(k){return k!=='At home'||b.acc[k];});
    var total=b.total!=null?b.total:names.reduce(function(s,k){return s+b.acc[k];},0);
    var off=b.offset!=null?b.offset:(b.net!=null?b.net-b.remaining:null);
    var ok=off!=null&&Math.abs(off)<1;
    var tiles=names.map(function(k){
      var v=b.acc[k],share=total>0?Math.max(0,v)/total*100:0;
      return '<button type="button" class="acc" data-open-bal="'+esc(M.balSrc.name)+'" data-acct="'+esc(k)+'" aria-label="Edit '+esc(k)+' balance, now '+esc(fmtS(v))+'">'+
        '<span class="acc-n">'+esc(k)+'<em>Edit</em></span><span class="acc-v'+(v<0?' neg':'')+'">'+esc(fmtS(v))+'</span><span class="acc-b"><i style="width:'+share.toFixed(1)+'%"></i></span><span class="acc-p">'+Math.round(share)+'%</span></button>';
    }).join('');
    var pill=off==null?'':ok?'<span class="pill good"><b>✓</b>In sync</span>':'<span class="pill critical"><b>!</b>Off '+esc(fmt(Math.abs(off)))+'</span>';
    var recon=off==null?'':'<div class="recon'+(ok?'':' off')+'"><div><span>Accounts</span><b>'+esc(fmtS(total))+'</b></div><div class="eq">'+(ok?'=':'≠')+'</div><div><span>Entries say</span><b>'+esc(fmtS(total-off))+'</b></div>'+
      '<div class="diff"><span>Offset</span><b>'+(ok?'0':esc((off>0?'+':'−')+K(Math.abs(off))))+'</b></div></div>';
    return pnl('p-acct','Accounts',pill,'<div class="accs">'+tiles+'</div>'+recon+'<div class="pnl-foot"><span>'+esc(M.balSrc.name)+' · tap an account to correct it</span><button type="button" class="lnk" data-open-bal="'+esc(M.balSrc.name)+'">Update balances →</button></div>',{cls:'s4'});
  }

  function budgetPanel(){
    var fb=M.fb;
    if(!fb){
      var body='<div class="empty">'+(M.isCycle?(M.cur.open?'Needs the Remaining row in column G.':'Only shown for the current payday cycle.'):'Switch to payday cycles to see the daily limit.')+'</div>';
      return pnl('p-bud','Daily limit','',body,{cls:'s4'});
    }
    var pctB=Math.round(Logic.BUFFER*100);
    var seg='';
    if(fb.remaining>0&&fb.avail>0){
      var dp=fb.due/fb.remaining*100,bp=fb.buffer/fb.remaining*100,up=fb.usable/fb.remaining*100;
      seg='<div class="segbar">'+(up>0?'<i class="u" style="width:'+up+'%" data-tip="'+esc('Spend limit\n'+fmt(fb.usable))+'"></i>':'')+(dp>0?'<i class="d" style="width:'+dp+'%" data-tip="'+esc('Bills still due\n'+fmt(fb.due))+'"></i>':'')+(bp>0?'<i class="b" style="width:'+bp+'%" data-tip="'+esc(pctB+'% buffer\n'+fmt(fb.buffer))+'"></i>':'')+'</div>'+
        '<div class="legend sm"><span><i class="sw u"></i>Spendable</span><span><i class="sw d"></i>Bills due</span><span><i class="sw b"></i>'+pctB+'% buffer</span></div>';
    }
    var big=fb.avail<=0?'Rs 0':fmt(Math.floor(fb.perDay));
    var food=M.A.dayCount>=3&&M.A.by['Food']>0?'<div class="mini">Food so far: '+esc(fmt(M.A.by['Food']/M.A.dayCount))+'/day</div>':'';
    var led='<dl class="ledger">'+
      '<div><dt>Remaining</dt><dd>'+esc(fmtS(fb.remaining))+'</dd></div>'+
      '<div><dt>Bills due before payday</dt><dd>−'+esc(fmt(fb.due))+'</dd></div>'+
      '<div><dt>'+pctB+'% buffer</dt><dd>−'+esc(fmt(fb.buffer))+'</dd></div>'+
      '<div class="tot"><dt>Safe until payday</dt><dd>'+esc(fmt(fb.usable))+'</dd></div></dl>';
    return pnl('p-bud','Daily limit',esc(fb.days+' days · payday '+fmtDay(fb.payday)),
      '<div class="bud"><div class="bud-v'+(fb.avail<=0?' bad':'')+'">'+esc(big)+'<small>/day</small></div>'+food+'</div>'+seg+led,{cls:'s4'});
  }

  function billsPanel(){
    var sub=M.sub;
    if(!sub.rows.length) return pnl('p-bills','Bills & subscriptions','','<div class="empty">No recurring bills found yet.</div>',{cls:'s4'});
    var rows=sub.rows.map(function(r){
      var st=r.status==='paid'?'<span class="st good"><b>✓</b>Paid</span>':r.status==='due'?'<span class="st warning"><b>!</b>Due</span>':'<span class="st info"><b>i</b>Missing</span>';
      var when=r.status==='paid'?(r.when!=null?fmtDay(r.when):''):r.when!=null?'≈'+fmtDay(r.when):'';
      return '<li><span class="bl-n">'+esc(r.label)+'</span>'+st+'<span class="bl-w">'+esc(when)+'</span><span class="bl-v">'+(r.status==='missed'?'–':esc(fmt(r.amount)))+'</span></li>';
    }).join('');
    var total=sub.paid+sub.due;
    return pnl('p-bills','Bills & subscriptions',esc(fmt(sub.paid))+' paid'+(sub.due>0?' · '+esc(fmt(sub.due))+' due':''),
      (total>0?'<div class="segbar thin"><i class="u" style="width:'+(sub.paid/total*100)+'%"></i><i class="d" style="width:'+(sub.due/total*100)+'%"></i></div>':'')+'<ul class="bills">'+rows+'</ul>',{cls:'s4'});
  }

  function catTotals(X){
    var out=Logic.CATS.map(function(c){return {name:c,v:X.by[c]};});
    if(X.other) out.push({name:'Other',v:X.other});
    return out;
  }
  function compositionPanel(){
    var items=catTotals(M.A).filter(function(c){return c.v>0;}).sort(function(a,b){return b.v-a.v;});
    var body=items.length?'<div id="tree" class="tree"></div><div class="legend" id="tree-legend">'+items.map(function(c){return '<span><i class="sw '+cls(c.name)+'"></i>'+esc(c.name)+'</span>';}).join('')+'</div>':'<div class="empty">No spending in this '+M.unit+' yet.</div>';
    return pnl('p-comp','Composition',esc(fmt(M.A.spent))+' across '+items.length+' categories',body,{cls:'s7'});
  }
  function deltaPanel(){
    if(!M.B) return pnl('p-delta','Change vs previous','','<div class="empty">No earlier '+M.unit+' to compare with.</div>',{cls:'s5'});
    var a=catTotals(M.A),b=catTotals(M.B);
    var rows=a.map(function(c,i){return {name:c.name,a:c.v,b:(b[i]||{v:0}).v};}).filter(function(r){return r.a||r.b;});
    rows.forEach(function(r){r.d=r.a-r.b;});
    rows.sort(function(x,y){return y.d-x.d;});
    var mx=Math.max.apply(null,rows.map(function(r){return Math.abs(r.d);}).concat([1]));
    var W=100;
    var list=rows.map(function(r){
      var w=Math.abs(r.d)/mx*48;
      return '<li data-tip="'+esc(r.name+'\n'+M.cur.label+': '+fmt(r.a)+'\n'+M.prev.label+': '+fmt(r.b))+'"><span class="dl-n">'+tag(r.name)+'</span>'+
        '<span class="dl-bar"><i class="mid"></i>'+(r.d?'<i class="'+(r.d>0?'pos':'neg')+'" style="width:'+w.toFixed(1)+'%;'+(r.d>0?'left:50%':'right:50%')+'"></i>':'')+'</span>'+
        '<span class="dl-v '+(r.d>0?'pos':r.d<0?'neg':'')+'">'+(r.d>0?'+':r.d<0?'−':'')+esc(K(Math.abs(r.d)))+'</span></li>';
    }).join('');
    return pnl('p-delta','Change vs '+M.prev.label,M.cur.open?'so far':'',
      '<ul class="dlist">'+list+'</ul><div class="legend sm"><span><i class="sw neg"></i>Spent less</span><span><i class="sw pos"></i>Spent more</span></div>',{cls:'s5'});
  }
  function railsPanel(){
    var A=M.A;
    var keys=Object.keys(A.mode).filter(function(k){return A.mode[k]>0;}).sort(function(a,b){return A.mode[b]-A.mode[a];});
    var mx=Math.max.apply(null,keys.map(function(k){return A.mode[k];}).concat([1]));
    var rows=keys.map(function(k){
      return '<li data-tip="'+esc(k+'\n'+fmt(A.mode[k])+' · '+pct(A.mode[k],A.spent)+'% of spent')+'"><span class="rl-n">'+esc(k)+'</span><span class="rl-b"><i style="width:'+Math.max(1.5,A.mode[k]/mx*100)+'%"></i></span><span class="rl-v">'+esc(K(A.mode[k]))+'</span><span class="rl-p">'+pct(A.mode[k],A.spent)+'%</span></li>';
    }).join('');
    return pnl('p-rails','Payment rails',esc(M.cur.label),rows?'<ul class="rails">'+rows+'</ul>':'<div class="empty">Nothing yet.</div>',{cls:'s4'});
  }
  function ridesPanel(){
    var R=M.rides[M.i],RP=M.prev?M.rides[M.i-1]:null;
    if(!M.rides.some(function(r){return r.count;})) return '';
    var rows=R.list.slice().reverse().slice(0,6).map(function(r){
      var route=r.from&&r.to?r.from+' → '+r.to:r.to?'→ '+r.to:r.from?r.from+' →':(r.note||(r.office?'Office trip':'–'));
      return '<li><span class="rd-d">'+esc(r.day!=null?fmtDay(r.day):'')+'</span><span class="rd-r">'+esc(route)+r.tags.map(function(g){return '<em>'+esc(g)+'</em>';}).join('')+'</span><span class="rd-v">'+esc(fmt(r.amt))+'</span></li>';
    }).join('');
    var meta=esc(fmt(R.total))+' · '+R.count+(R.count===1?' ride':' rides')+(RP?' · '+esc(M.prev.label)+' '+esc(fmt(RP.total)):'');
    return pnl('p-rides','InDrive',meta,
      '<div class="rides"><div class="rides-c"><div id="rides-chart"></div></div><div class="rides-s">'+
        '<div><span>Avg fare</span><b>'+(R.count?esc(fmt(R.total/R.count)):'–')+'</b></div><div><span>Office trips</span><b>'+R.officeN+'</b></div>'+
        '<div><span>Share of transport</span><b>'+(M.A.by['Transport']>0?pct(R.total,M.A.by['Transport'])+'%':'–')+'</b></div></div></div>'+
      (rows?'<ul class="rlist">'+rows+'</ul>':'<div class="empty">No rides this '+M.unit+'.</div>'),{cls:'s6'});
  }
  function largestPanel(){
    var top=M.A.top.filter(function(t){return t.amt>0;}).sort(function(a,b){return b.amt-a.amt;}).slice(0,8);
    var rows=top.map(function(t){
      return '<tr data-tx="'+t.row+'" tabindex="0"><td class="id">'+txId(t)+'</td><td>'+esc(t.name)+'<small>'+esc(t.desc)+'</small></td><td>'+tag(catName(t.cat))+'</td><td class="n">'+esc(fmt(t.amt))+'</td></tr>';
    }).join('');
    return pnl('p-top','Largest transactions',esc(M.cur.label),rows?'<div class="tbl-w"><table class="tbl"><tbody>'+rows+'</tbody></table></div>':'<div class="empty">Nothing yet.</div>',{cls:'s6'});
  }
  function notes(){
    var n=[];
    n.push('Spent adds Food, Utilities, Family/Home, Renovation, Transport, Shopping, Fun, Loans given and Untracked. Savings, transfers and money received back are kept out of it.');
    n.push('Spend trajectory: cumulative spending by day. The overlay is the previous '+M.unit+' aligned by day number. Even pace runs from zero to the cycle’s spendable amount (month start minus savings) at the day before payday. Events mark the largest single expenses.');
    n.push('Accounts and offset come from column G of your Tracking tab: offset = (Total − savings) − Remaining. Logging an entry here updates its account so the two stay equal.');
    n.push('Bills are picked out of the Expense and Description columns: Claude, internet, Amazon, foodpanda, YouTube and Netflix. A bill is still due when it was paid in an earlier period but not yet in this one.');
    n.push('Daily limit: Remaining, minus bills due before payday, keeping '+Math.round(Logic.BUFFER*100)+'% back, divided by the days until the '+Logic.PAYDAY_DOM+'th.');
    n.push('InDrive rides are rows named InDrive, or with InDrive in the description; the route is read from the description.');
    return '<details class="notes"><summary>Methodology</summary>'+n.map(function(x){return '<p>'+esc(x)+'</p>';}).join('')+'</details>';
  }

  // ---- charts that need the panel width ----
  function drawTrajectory(){
    var el=$('#traj');
    if(!el) return;
    var A=M.A,B=M.B,cur=M.cur;
    var W=Math.max(280,el.clientWidth),narrow=W<560,H1=narrow?180:210,H2=narrow?52:64,G=16;
    var m={l:narrow?38:46,r:narrow?8:14,t:26,b:22};
    var bal=M.isCycle?cur.bal:null;
    var n=A.daily.length,xEnd=n-1;
    var pace=null;
    if(U.layers.pace&&bal&&bal.start!=null&&M.isCycle){
      var endDay=M.fb?M.fb.payday-1:cur.end;
      var budget=bal.start-A.saved;
      if(budget>0){pace={len:endDay-cur.start,budget:budget};xEnd=Math.max(xEnd,pace.len);}
    }
    var cum=[],c=0;A.daily.forEach(function(d){c+=d.v;cum.push(c);});
    var pcum=null;
    if(U.layers.prev&&B){pcum=[];var pc=0;B.daily.forEach(function(d){pc+=d.v;pcum.push(pc);});pcum=pcum.slice(0,xEnd+1);}
    var ymax=Viz.niceMax(Math.max.apply(null,cum.concat(pcum||[]).concat(pace?[pace.budget]:[]).concat([1])));
    var dmax=Viz.niceMax(Math.max.apply(null,A.daily.map(function(d){return d.v;}).concat([1])));
    var pw=W-m.l-m.r,ph=H1-m.t-m.b;
    var step=xEnd>0?pw/xEnd:pw;
    function X(i){return m.l+(xEnd>0?i*step:pw/2);}
    function Y(v){return m.t+ph-v/ymax*ph;}
    var y2t=H1+G,y2b=y2t+H2;
    function Y2(v){return y2b-v/dmax*H2;}
    var s='<svg viewBox="0 0 '+W+' '+(y2b+22)+'" width="'+W+'" height="'+(y2b+22)+'" role="img" aria-label="Cumulative and daily spending for '+esc(cur.name)+'">';
    // future region
    if(xEnd>n-1) s+='<rect class="future" x="'+X(n-1)+'" y="'+m.t+'" width="'+(X(xEnd)-X(n-1))+'" height="'+(y2b-m.t)+'"/>'+(narrow?'':'<text class="fut-t" x="'+(X(n-1)+6)+'" y="'+(m.t+ph-6)+'">REMAINING DAYS</text>');
    [0,0.25,0.5,0.75,1].forEach(function(f){
      var yy=Y(ymax*f);
      s+='<line class="grid" x1="'+m.l+'" x2="'+(W-m.r)+'" y1="'+yy+'" y2="'+yy+'"/><text class="tick" x="'+(m.l-8)+'" y="'+(yy+3.5)+'" text-anchor="end">'+K(ymax*f)+'</text>';
    });
    s+='<line class="axis" x1="'+m.l+'" x2="'+(W-m.r)+'" y1="'+Y(0)+'" y2="'+Y(0)+'"/>';
    if(pace) s+='<line class="pace" x1="'+X(0)+'" y1="'+Y(0)+'" x2="'+X(pace.len)+'" y2="'+Y(pace.budget)+'"/><text class="pace-t" x="'+(X(pace.len)-4)+'" y="'+(Y(pace.budget)+(pace.len<=n-1?16:-6))+'" text-anchor="end">PACE '+K(pace.budget)+'</text>';
    if(pcum&&pcum.length){
      s+='<path class="prev" d="'+pcum.map(function(v,i){return (i?'L':'M')+Viz.r1(X(i))+','+Viz.r1(Y(v));}).join(' ')+'"/>';
      var pl=pcum.length-1;
      s+='<text class="prev-t" x="'+(X(pl)-4)+'" y="'+(Y(pcum[pl])+14)+'" text-anchor="end">'+esc(M.prev.label)+'</text>';
    }
    var line=cum.map(function(v,i){return (i?'L':'M')+Viz.r1(X(i))+','+Viz.r1(Y(v));}).join(' ');
    s+='<path class="cum-a" d="'+line+' L'+Viz.r1(X(n-1))+','+Y(0)+' L'+Viz.r1(X(0))+','+Y(0)+' Z"/><path class="cum" d="'+line+'"/>';
    s+='<circle class="cum-d" cx="'+X(n-1)+'" cy="'+Y(cum[n-1]||0)+'" r="4"/><text class="cum-t" x="'+(X(n-1)-8)+'" y="'+(Y(cum[n-1]||0)-10)+'" text-anchor="end">'+esc(K(cum[n-1]||0))+'</text>';
    // events: largest single expenses, labelled when there is room
    if(U.layers.events){
      var ev=A.top.filter(function(t){return t.amt>0&&t.day!=null&&t.day>=cur.start&&t.day<=cur.end;}).sort(function(a,b){return b.amt-a.amt;}).slice(0,5);
      var lastX=-1e9;
      ev.sort(function(a,b){return a.day-b.day;}).forEach(function(t){
        var i=t.day-cur.start,x=X(i),y=Y(cum[i]);
        s+='<line class="ev" x1="'+x+'" x2="'+x+'" y1="'+m.t+'" y2="'+y+'"/><rect class="ev-d" x="'+(x-4)+'" y="'+(y-4)+'" width="8" height="8" transform="rotate(45 '+x+' '+y+')"/>';
        if(!narrow&&x-lastX>80){s+='<text class="ev-t" x="'+(x+5)+'" y="'+(m.t-8)+'">'+esc(K(t.amt)+' '+t.name.slice(0,14))+'</text>';lastX=x;}
      });
    }
    // daily bars
    var bw=Math.max(2,Math.min(14,step*0.62));
    s+='<text class="sub-t" x="'+m.l+'" y="'+(y2t-4)+'">DAILY</text><text class="tick" x="'+(m.l-8)+'" y="'+(y2t+8)+'" text-anchor="end">'+K(dmax)+'</text>';
    A.daily.forEach(function(d,i){s+=Viz.bar(X(i)-bw/2,y2b,bw,d.v>0?Math.max(2,d.v/dmax*H2):0,'dbar');});
    s+='<line class="axis" x1="'+m.l+'" x2="'+(W-m.r)+'" y1="'+y2b+'" y2="'+y2b+'"/>';
    var every=Math.max(1,Math.ceil((xEnd+1)/Math.max(2,Math.floor(pw/56))));
    var payLabel=!!(M.fb&&pace);
    for(var i=0;i<=xEnd;i+=every){
      if(payLabel&&X(i)>W-m.r-(narrow?70:104)) break;
      var dn=cur.start+i,dd=new Date(dn*DAY);
      s+='<text class="tick" x="'+X(i)+'" y="'+(y2b+15)+'" text-anchor="middle">'+(i===0||dd.getUTCDate()===1?fmtDay(dn):dd.getUTCDate())+'</text>';
    }
    if(payLabel) s+='<text class="pay-t" x="'+(W-m.r)+'" y="'+(y2b+15)+'" text-anchor="end">'+(narrow?'':'PAYDAY ')+esc(fmtDay(M.fb.payday))+' →</text>';
    if(cur.open) s+='<line class="today" x1="'+X(n-1)+'" x2="'+X(n-1)+'" y1="'+m.t+'" y2="'+y2b+'"/>';
    s+='<line class="xh" id="xh" x1="0" x2="0" y1="'+m.t+'" y2="'+y2b+'" visibility="hidden"/><circle class="xh-d" id="xh-d" r="4.5" visibility="hidden"/><circle class="xh-p" id="xh-p" r="3.5" visibility="hidden"/>';
    s+='<rect class="hit" id="traj-hit" x="'+m.l+'" y="'+m.t+'" width="'+pw+'" height="'+(y2b-m.t)+'"/></svg>';
    el.innerHTML=s;
    $('#traj-legend').innerHTML='<span><i class="sw ln cum"></i>'+esc(cur.label)+' cumulative</span>'+(pcum?'<span><i class="sw ln prev"></i>'+esc(M.prev.label)+' cumulative</span>':'')+(pace?'<span><i class="sw ln pace"></i>Even pace to payday</span>':'')+'<span><i class="sw dbar"></i>Daily spend</span>'+(U.layers.events?'<span><i class="sw ev"></i>Largest expenses</span>':'');
    // crosshair + tooltip
    var byDay={};
    A.top.forEach(function(t){if(t.day!=null){(byDay[t.day]=byDay[t.day]||[]).push(t);}});
    var hit=$('#traj-hit'),xh=$('#xh'),xd=$('#xh-d'),xp=$('#xh-p');
    function at(ev){
      var r=hit.getBoundingClientRect(),x=(ev.clientX-r.left)/r.width*pw;
      var i=Math.max(0,Math.min(xEnd,Math.round(xEnd>0?x/step:0)));
      xh.setAttribute('x1',X(i));xh.setAttribute('x2',X(i));xh.setAttribute('visibility','visible');
      if(i<n){xd.setAttribute('cx',X(i));xd.setAttribute('cy',Y(cum[i]));xd.setAttribute('visibility','visible');}else xd.setAttribute('visibility','hidden');
      if(pcum&&i<pcum.length){xp.setAttribute('cx',X(i));xp.setAttribute('cy',Y(pcum[i]));xp.setAttribute('visibility','visible');}else xp.setAttribute('visibility','hidden');
      var day=cur.start+i,list=(byDay[day]||[]).slice().sort(function(a,b){return b.amt-a.amt;});
      var h='<div class="tt-h">'+esc(wday(day)+' '+fmtDayY(day))+' <span>DAY '+(i+1)+'</span></div><dl class="tt-g">';
      if(i<n) h+='<dt><i class="sw ln cum"></i>Cumulative</dt><dd>'+esc(fmt(cum[i]))+'</dd><dt><i class="sw dbar"></i>That day</dt><dd>'+esc(fmt(A.daily[i].v))+'</dd>';
      else h+='<dt>Not reached yet</dt><dd></dd>';
      if(pcum&&i<pcum.length) h+='<dt><i class="sw ln prev"></i>'+esc(M.prev.label)+' by day '+(i+1)+'</dt><dd>'+esc(fmt(pcum[i]))+'</dd>';
      if(pace) h+='<dt><i class="sw ln pace"></i>Even pace</dt><dd>'+esc(fmt(Math.min(pace.budget,pace.budget*i/Math.max(1,pace.len))))+'</dd>';
      h+='</dl>';
      if(i<n&&list.length) h+='<ul class="tt-l">'+list.slice(0,5).map(function(t){return '<li><span>'+esc(t.name)+'</span><b>'+esc(K(t.amt))+'</b></li>';}).join('')+(list.length>5?'<li class="more">+'+(list.length-5)+' more</li>':'')+'</ul>';
      showTip(h,ev.clientX,ev.clientY);
    }
    hit.addEventListener('pointermove',at);
    hit.addEventListener('pointerdown',at);
    hit.addEventListener('pointerleave',function(){xh.setAttribute('visibility','hidden');xd.setAttribute('visibility','hidden');xp.setAttribute('visibility','hidden');hideTip();});
  }

  function drawTree(){
    var el=$('#tree');
    if(!el) return;
    var items=catTotals(M.A).filter(function(c){return c.v>0;}).sort(function(a,b){return b.v-a.v;});
    var W=Math.max(260,el.clientWidth),H=Math.round(Math.min(320,Math.max(220,W*0.42)));
    var rects=Viz.treemap(items,W,H);
    var s='<svg viewBox="0 0 '+W+' '+H+'" width="'+W+'" height="'+H+'" role="img" aria-label="Spending by category">';
    rects.forEach(function(r){
      var g=1,x=r.x+g,y=r.y+g,w=Math.max(0,r.w-2*g),h=Math.max(0,r.h-2*g);
      var share=pct(r.v,M.A.spent);
      s+='<g class="tm '+cls(r.name)+'" data-cat-filter="'+esc(r.name)+'" data-tip="'+esc(r.name+'\n'+fmt(r.v)+' · '+share+'% of spent\nClick to explore')+'">'+
        '<rect x="'+Viz.r1(x)+'" y="'+Viz.r1(y)+'" width="'+Viz.r1(w)+'" height="'+Viz.r1(h)+'" rx="2"/>';
      if(w>64&&h>38) s+='<text class="tm-n" x="'+(x+8)+'" y="'+(y+17)+'">'+esc(r.name.toUpperCase())+'</text><text class="tm-v" x="'+(x+8)+'" y="'+(y+34)+'">'+esc(K(r.v))+' · '+share+'%</text>';
      else if(w>34&&h>18) s+='<text class="tm-v" x="'+(x+5)+'" y="'+(y+14)+'">'+share+'%</text>';
      s+='</g>';
    });
    el.innerHTML=s+'</svg>';
  }

  function drawHeat(){
    var el=$('#heat');
    if(!el) return;
    var weeks=22,today=M.today;
    var dow=(new Date(today*DAY).getUTCDay()+6)%7; // Monday = 0
    var start=today-dow-(weeks-1)*7;
    var tot={},items={};
    M.all.forEach(function(t){
      if(!isSpend(t)||t.day==null||t.day<start||t.day>today) return;
      tot[t.day]=(tot[t.day]||0)+t.amt;
      (items[t.day]=items[t.day]||[]).push(t);
    });
    var vals=Object.keys(tot).map(function(k){return tot[k];}).filter(function(v){return v>0;}).sort(function(a,b){return a-b;});
    function q(p){return vals.length?vals[Math.min(vals.length-1,Math.floor(p*vals.length))]:0;}
    var cuts=[q(0.2),q(0.4),q(0.6),q(0.8)];
    function bin(v){if(!(v>0)) return 0;var b=1;cuts.forEach(function(c){if(v>c)b++;});return Math.min(5,b);}
    var W=Math.max(300,el.clientWidth),ml=30,mt=18;
    var gap=3,cw=Math.max(8,(W-ml)/weeks-gap),cs=Math.max(9,Math.min(17,cw));
    var H=mt+7*(cs+gap);
    var s='<svg viewBox="0 0 '+W+' '+(H+4)+'" width="'+W+'" height="'+(H+4)+'" role="img" aria-label="Daily spending heatmap, last '+weeks+' weeks">';
    ['Mon','','Wed','','Fri','','Sun'].forEach(function(d,i){if(d) s+='<text class="tick" x="0" y="'+(mt+i*(cs+gap)+cs-2)+'">'+d+'</text>';});
    var lastMon=-1;
    for(var w=0;w<weeks;w++){
      var wd=start+w*7,mo=new Date(wd*DAY).getUTCMonth();
      if(mo!==lastMon){s+='<text class="tick" x="'+Viz.r1(ml+w*(cw+gap))+'" y="10">'+MON[mo]+'</text>';lastMon=mo;}
      for(var d=0;d<7;d++){
        var day=wd+d;
        if(day>today) continue;
        var v=tot[day]||0,b=bin(v),list=(items[day]||[]).sort(function(a,c){return c.amt-a.amt;});
        var tip=wday(day)+' '+fmtDayY(day)+'\n'+(v?fmt(v):'No spending')+(list.length?'\n'+list.slice(0,3).map(function(t){return t.name+' '+K(t.amt);}).join('\n'):'');
        s+='<rect class="hm'+(day===today?' today':'')+'" x="'+Viz.r1(ml+w*(cw+gap))+'" y="'+(mt+d*(cs+gap))+'" width="'+Viz.r1(cw)+'" height="'+cs+'" rx="2" fill="'+Viz.seq(b/5)+'" data-tip="'+esc(tip)+'"/>';
      }
    }
    s+='</svg>';
    var leg='<div class="legend sm hm-leg"><span>Less</span>'+Viz.SEQ.map(function(c){return '<i class="sq" style="background:'+c+'"></i>';}).join('')+'<span>More</span><span class="hm-note">Bins by quintile of days with spending · top day '+esc(fmt(vals[vals.length-1]||0))+'</span></div>';
    el.innerHTML=s+leg;
  }

  function cols(el,items,h){
    if(!el) return;
    var W=Math.max(200,el.clientWidth),H=h||120,m={l:34,r:4,t:16,b:18};
    var pw=W-m.l-m.r,ph=H-m.t-m.b,mx=Viz.niceMax(Math.max.apply(null,items.map(function(i){return i.v;}).concat([1])));
    var slot=pw/Math.max(1,items.length),bw=Math.min(22,slot*0.6);
    var s='<svg viewBox="0 0 '+W+' '+H+'" width="'+W+'" height="'+H+'" role="img" aria-label="InDrive spending by period">';
    [0,1].forEach(function(f){var y=m.t+ph-f*ph;s+='<line class="grid" x1="'+m.l+'" x2="'+(W-m.r)+'" y1="'+y+'" y2="'+y+'"/><text class="tick" x="'+(m.l-6)+'" y="'+(y+3.5)+'" text-anchor="end">'+K(mx*f)+'</text>';});
    items.forEach(function(it,i){
      var cx=m.l+slot*i+slot/2,hh=it.v>0?Math.max(2,it.v/mx*ph):0;
      s+=Viz.bar(cx-bw/2,m.t+ph,bw,hh,it.cls)+'<rect x="'+(m.l+slot*i)+'" y="'+m.t+'" width="'+slot+'" height="'+ph+'" fill="transparent" data-tip="'+esc(it.tip)+'"/>';
      s+='<text class="tick" x="'+cx+'" y="'+(H-4)+'" text-anchor="middle">'+esc(it.xl)+'</text>';
    });
    el.innerHTML=s+'</svg>';
  }
  function drawRides(){
    var el=$('#rides-chart');
    if(!el) return;
    var from=Math.max(0,M.periods.length-8);
    cols(el,M.periods.slice(from).map(function(p,k){
      var x=M.rides[from+k];
      return {v:x.total,xl:p.label,cls:p.key===M.cur.key?'bar-cur':M.prev&&p.key===M.prev.key?'bar-prev':'bar-n',tip:p.name+'\n'+x.count+(x.count===1?' ride':' rides')+' · '+fmt(x.total)};
    }),118);
  }

  // =====================================================================
  // flows
  // =====================================================================
  function flows(){
    var tx=M.A.top.filter(function(t){return t.amt>0;});
    var ins=M.cur.tx.filter(function(t){return t.cat==='influx'&&t.amt<0;});
    var tr=M.cur.tx.filter(function(t){return t.cat==='transfer';});
    var inRows=ins.map(function(t){return '<tr data-tx="'+t.row+'" tabindex="0"><td class="id">'+txId(t)+'</td><td>'+esc(t.name)+'<small>'+esc(t.desc)+'</small></td><td>'+esc(t.mode)+'</td><td class="n good">+'+esc(fmt(-t.amt))+'</td></tr>';}).join('');
    var trRows=tr.map(function(t){return '<tr data-tx="'+t.row+'" tabindex="0"><td class="id">'+txId(t)+'</td><td>'+esc(t.desc||t.name)+'</td><td>'+esc(t.mode)+'</td><td class="n">'+esc(fmtS(t.amt))+'</td></tr>';}).join('');
    var items={};
    tx.forEach(function(t){var k=itemKey(t.name);var e=items[k]||(items[k]={name:t.name.trim(),v:0,n:0,cat:catName(t.cat)});e.v+=t.amt;e.n++;});
    var list=Object.keys(items).map(function(k){return items[k];}).sort(function(a,b){return b.v-a.v;});
    var topRows=list.slice(0,12).map(function(e,i){return '<tr data-item="'+esc(itemKey(e.name))+'" tabindex="0"><td class="id">'+String(i+1).padStart(2,'0')+'</td><td>'+esc(e.name)+'</td><td>'+tag(e.cat)+'</td><td class="n">'+e.n+'</td><td class="n">'+esc(fmt(e.v))+'</td></tr>';}).join('');
    return '<div class="grid">'+
      pnl('p-flow','Money flow',esc(fmt(M.A.spent))+' · account → category → item','<div id="sankey" class="sankey"></div><div class="legend sm">Width is money. Hover a band for its amount; click a category or item to open it in Explorer.</div>',{cls:'s12'})+
      pnl('p-items','Top items',esc(M.cur.label),topRows?'<div class="tbl-w"><table class="tbl"><thead><tr><th class="id">#</th><th>Item</th><th>Category</th><th class="n">Count</th><th class="n">Total</th></tr></thead><tbody>'+topRows+'</tbody></table></div>':'<div class="empty">Nothing yet.</div>',{cls:'s6'})+
      pnl('p-in','Money in',ins.length?'+'+esc(fmt(-ins.reduce(function(s,t){return s+t.amt;},0))):'',inRows?'<div class="tbl-w"><table class="tbl"><tbody>'+inRows+'</tbody></table></div>':'<div class="empty">Nothing received this '+M.unit+'.</div>',{cls:'s6'})+
      pnl('p-tr','Transfers between accounts',tr.length+' rows',trRows?'<div class="tbl-w"><table class="tbl"><tbody>'+trRows+'</tbody></table></div>':'<div class="empty">No transfers this '+M.unit+'.</div>',{cls:'s6'})+
      '</div>';
  }
  function drawSankey(){
    var el=$('#sankey');
    if(!el) return;
    var tx=M.A.top.filter(function(t){return t.amt>0;});
    if(!tx.length){el.innerHTML='<div class="empty">No spending in this '+M.unit+' yet.</div>';return;}
    var acc={},cat={},it={},l1={},l2={};
    var itemTot={};
    tx.forEach(function(t){var k=itemKey(t.name);itemTot[k]=(itemTot[k]||0)+t.amt;});
    var keep=Object.keys(itemTot).sort(function(a,b){return itemTot[b]-itemTot[a];}).slice(0,11);
    tx.forEach(function(t){
      var a='a:'+t.mode,cn=catName(t.cat),c='c:'+cn,k=itemKey(t.name),i=keep.indexOf(k)>=0?'i:'+k:'i:~';
      acc[a]=acc[a]||{id:a,label:t.mode,v:0,kind:'acct'};acc[a].v+=t.amt;
      cat[c]=cat[c]||{id:c,label:cn,v:0,kind:'cat',cls:cls(cn)};cat[c].v+=t.amt;
      it[i]=it[i]||{id:i,label:i==='i:~'?'Everything else':t.name.trim(),v:0,kind:'item',key:i==='i:~'?null:k,cls:i==='i:~'?'cn':cls(cn)};it[i].v+=t.amt;
      var k1=a+'|'+c,k2=c+'|'+i;
      l1[k1]=l1[k1]||{s:a,t:c,v:0,cls:cls(cn)};l1[k1].v+=t.amt;
      l2[k2]=l2[k2]||{s:c,t:i,v:0,cls:cls(cn)};l2[k2].v+=t.amt;
    });
    function vals(o){return Object.keys(o).map(function(k){return o[k];}).sort(function(a,b){return b.v-a.v;});}
    var C=[vals(acc),vals(cat),vals(it)];
    var other=C[2].filter(function(n){return n.id==='i:~';});
    C[2]=C[2].filter(function(n){return n.id!=='i:~';}).concat(other);
    var links=vals(l1).concat(vals(l2));
    var W=Math.max(320,el.clientWidth),narrow=W<640;
    var labW=narrow?78:150,H=Math.max(360,Math.min(560,C[2].length*40));
    var lay=Viz.sankey(C,links,W-labW*2,H,{nodeW:10,pad:narrow?6:10});
    var s='<svg viewBox="0 0 '+W+' '+(H+18)+'" width="'+W+'" height="'+(H+18)+'" role="img" aria-label="Money flow from accounts to categories to items"><g transform="translate('+labW+',0)">';
    lay.links.forEach(function(l,i){
      s+='<path class="lk '+l.cls+'" d="'+l.d+'" data-s="'+esc(l.s)+'" data-t="'+esc(l.t)+'" data-tip="'+esc(l.sn.label+' → '+l.tn.label+'\n'+fmt(l.v)+' · '+pct(l.v,M.A.spent)+'% of spent')+'"/>';
    });
    var lastY=[-1e9,-1e9,-1e9];
    Object.keys(lay.nodes).forEach(function(id){
      var n=lay.nodes[id];
      var attr=n.kind==='cat'?' data-cat-filter="'+esc(n.label)+'"':n.kind==='item'&&n.key?' data-item="'+esc(n.key)+'"':'';
      s+='<g class="nd nd-'+n.kind+'" data-node="'+esc(id)+'"'+attr+' data-tip="'+esc(n.label+'\n'+fmt(n.v)+' · '+pct(n.v,M.A.spent)+'%')+'">';
      s+='<rect class="nd-r '+(n.cls||'acct')+'" x="'+Viz.r1(n.x)+'" y="'+Viz.r1(n.y)+'" width="'+n.w+'" height="'+Viz.r1(n.h)+'" rx="1.5"/>';
      var right=n.col===2,ty=n.y+n.h/2;
      var lx=n.col===0?n.x-8:right?n.x+n.w+8:n.x+n.w+6;
      var anchor=n.col===0?'end':'start';
      var label=narrow&&n.label.length>10?n.label.slice(0,9)+'…':n.label;
      var room=ty-lastY[n.col]>=24;
      if(room) lastY[n.col]=ty;
      if(room) s+='<text class="nd-t" x="'+Viz.r1(lx)+'" y="'+Viz.r1(ty-1)+'" text-anchor="'+anchor+'">'+esc(label)+'</text><text class="nd-v" x="'+Viz.r1(lx)+'" y="'+Viz.r1(ty+11)+'" text-anchor="'+anchor+'">'+esc(K(n.v))+'</text>';
      s+='</g>';
    });
    el.innerHTML=s+'</g></svg>';
    // highlight a node's bands on hover
    $$('.nd',el).forEach(function(g){
      g.addEventListener('pointerenter',function(){
        var id=g.getAttribute('data-node');
        el.classList.add('focus');
        $$('.lk',el).forEach(function(p){if(p.getAttribute('data-s')===id||p.getAttribute('data-t')===id) p.classList.add('hot');});
      });
      g.addEventListener('pointerleave',function(){el.classList.remove('focus');$$('.lk.hot',el).forEach(function(p){p.classList.remove('hot');});});
    });
  }

  // =====================================================================
  // explorer
  // =====================================================================
  function exSource(){return U.ex.scope==='all'?M.all:M.cur.tx;}
  function exFiltered(){
    var q=U.ex.q.trim().toLowerCase();
    return exSource().filter(function(t){
      var cn=catName(t.cat);
      if(U.ex.cats.length&&U.ex.cats.indexOf(cn)<0) return false;
      if(U.ex.modes.length&&U.ex.modes.indexOf(t.mode)<0) return false;
      if(U.ex.min&&Math.abs(t.amt)<U.ex.min) return false;
      if(q&&(t.name+' '+t.desc+' '+cn+' '+t.mode+' '+txId(t)).toLowerCase().indexOf(q)<0) return false;
      return true;
    });
  }
  function itemsOf(list){
    var by={};
    list.forEach(function(t){
      var k=itemKey(t.name);if(!k) return;
      var e=by[k]||(by[k]={key:k,name:t.name.trim(),n:0,v:0,last:null,first:null,cats:{},tx:[]});
      e.n++;e.v+=t.amt;e.name=t.name.trim();e.tx.push(t);
      e.cats[catName(t.cat)]=(e.cats[catName(t.cat)]||0)+Math.abs(t.amt);
      if(t.day!=null){if(e.last==null||t.day>e.last)e.last=t.day;if(e.first==null||t.day<e.first)e.first=t.day;}
    });
    return Object.keys(by).map(function(k){var e=by[k];e.cat=Object.keys(e.cats).sort(function(a,b){return e.cats[b]-e.cats[a];})[0];return e;});
  }
  function facet(name,label,vals,sel,attr){
    return '<div class="facet"><div class="facet-h">'+esc(label)+'</div>'+vals.map(function(v){
      var on=sel.indexOf(v.k)>=0;
      return '<button type="button" class="fv'+(on?' on':'')+'" '+attr+'="'+esc(v.k)+'" aria-pressed="'+on+'">'+(v.cls?'<i class="sw '+v.cls+'"></i>':'')+'<span>'+esc(v.k)+'</span><em>'+v.n+'</em></button>';
    }).join('')+'</div>';
  }
  function explorer(){
    var src=exSource();
    var catCount={},modeCount={};
    src.forEach(function(t){var c=catName(t.cat);catCount[c]=(catCount[c]||0)+1;modeCount[t.mode]=(modeCount[t.mode]||0)+1;});
    var catVals=Object.keys(catCount).sort(function(a,b){return catCount[b]-catCount[a];}).map(function(k){return {k:k,n:catCount[k],cls:cls(k)};});
    var modeVals=Object.keys(modeCount).sort(function(a,b){return modeCount[b]-modeCount[a];}).map(function(k){return {k:k,n:modeCount[k]};});
    var seg=function(name,opts,val){return '<div class="seg sm">'+opts.map(function(o){return '<button type="button" data-ex-'+name+'="'+o[0]+'" aria-pressed="'+(val===o[0])+'">'+o[1]+'</button>';}).join('')+'</div>';};
    var mins=[[0,'Any'],[500,'≥500'],[2000,'≥2k'],[10000,'≥10k']];
    var nf=U.ex.cats.length+U.ex.modes.length+(U.ex.min?1:0);
    var side='<aside class="facets'+(U.fx?' show':'')+'"><div class="ex-search"><input id="ex-q" type="search" placeholder="Search items, notes, TX-…" value="'+esc(U.ex.q)+'" autocomplete="off" aria-label="Search transactions">'+
      '<button type="button" class="btn fx-toggle" data-fx aria-expanded="'+U.fx+'">Filters'+(nf?' <em>'+nf+'</em>':'')+'</button></div>'+
      '<div class="facet"><div class="facet-h">Object type</div>'+seg('type',[['tx','Transactions'],['item','Items']],U.ex.type)+'</div>'+
      '<div class="facet"><div class="facet-h">Scope</div>'+seg('scope',[['period',esc(M.cur.label)],['all','All time']],U.ex.scope)+'</div>'+
      facet('cat','Category',catVals,U.ex.cats,'data-ex-cat')+facet('mode','Payment mode',modeVals,U.ex.modes,'data-ex-mode')+
      '<div class="facet"><div class="facet-h">Amount</div><div class="seg sm">'+mins.map(function(o){return '<button type="button" data-ex-min="'+o[0]+'" aria-pressed="'+(U.ex.min===o[0])+'">'+o[1]+'</button>';}).join('')+'</div></div>'+
      '<button type="button" class="lnk" data-ex-reset>Reset filters</button></aside>';
    return '<div class="ex">'+side+'<section class="pnl ex-main"><header class="pnl-h"><span class="pnl-t"><i class="pnl-dot"></i>'+(U.ex.type==='tx'?'Transactions':'Items')+'</span><span class="pnl-m" id="ex-count"></span></header><div class="pnl-b" id="ex-table"></div></section>'+
      '<aside class="pnl inspector" id="inspector"></aside></div>';
  }
  function sortIcon(k){return U.ex.sort===k?(U.ex.dir>0?' ▴':' ▾'):'';}
  function exTable(){
    var el=$('#ex-table');
    if(!el) return;
    var list=exFiltered();
    var total=list.reduce(function(s,t){return s+(isSpend(t)?t.amt:0);},0);
    if(U.ex.type==='item'){
      var items=itemsOf(list);
      var sk=U.ex.sort==='day'?'last':U.ex.sort==='amt'?'v':U.ex.sort==='name'?'name':U.ex.sort==='n'?'n':'last';
      items.sort(function(a,b){var x=a[sk],y=b[sk];if(sk==='name'){x=a.key;y=b.key;}return (x>y?1:x<y?-1:0)*U.ex.dir;});
      $('#ex-count').textContent=items.length+' objects · '+list.length+' transactions';
      var from=Math.max(0,M.periods.length-6);
      el.innerHTML=items.length?'<div class="tbl-w"><table class="tbl ex-t ex-it"><thead><tr><th data-sort="name">Item'+sortIcon('name')+'</th><th>Category</th><th class="n" data-sort="n">Count'+sortIcon('n')+'</th><th class="n" data-sort="amt">Total'+sortIcon('amt')+'</th><th class="n">Avg</th><th data-sort="day">Last seen'+sortIcon('day')+'</th><th>Trend</th></tr></thead><tbody>'+
        items.slice(0,400).map(function(e){
          var tr=M.periods.slice(from).map(function(p){return p.tx.reduce(function(s,t){return s+(itemKey(t.name)===e.key?Math.abs(t.amt):0);},0);});
          return '<tr data-item="'+esc(e.key)+'" tabindex="0"'+(U.ex.sel==='i:'+e.key?' class="sel"':'')+'><td>'+esc(e.name)+'</td><td>'+tag(e.cat)+'</td><td class="n">'+e.n+'</td><td class="n">'+esc(fmtS(e.v))+'</td><td class="n">'+esc(fmtS(e.v/e.n))+'</td><td>'+(e.last!=null?esc(fmtDay(e.last)):'–')+'</td><td class="sp">'+Viz.spark(tr,72,18,{area:false})+'</td></tr>';
        }).join('')+'</tbody></table></div>':'<div class="empty">Nothing matches these filters.</div>';
    }else{
      var key=U.ex.sort;
      list=list.slice().sort(function(a,b){
        var x,y;
        if(key==='amt'){x=a.amt;y=b.amt;}else if(key==='name'){x=itemKey(a.name);y=itemKey(b.name);}else if(key==='n'){x=a.row;y=b.row;}else{x=a.day==null?-1:a.day;y=b.day==null?-1:b.day;if(x===y){x=a.row;y=b.row;}}
        return (x>y?1:x<y?-1:0)*U.ex.dir;
      });
      $('#ex-count').textContent=list.length+' objects · '+fmt(total)+' spent';
      el.innerHTML=list.length?'<div class="tbl-w"><table class="tbl ex-t ex-tx"><thead><tr><th data-sort="n">ID'+sortIcon('n')+'</th><th data-sort="day">Date'+sortIcon('day')+'</th><th data-sort="name">Item'+sortIcon('name')+'</th><th>Category</th><th>Mode</th><th class="n" data-sort="amt">Amount'+sortIcon('amt')+'</th></tr></thead><tbody>'+
        list.slice(0,500).map(function(t){
          return '<tr data-tx="'+t.row+'" tabindex="0"'+(U.ex.sel==='t:'+t.row?' class="sel"':'')+'><td class="id">'+txId(t)+'</td><td class="d">'+(t.day!=null?esc(fmtDay(t.day)):'–')+'</td><td>'+esc(t.name)+'<small>'+esc(t.desc)+'</small></td><td>'+tag(catName(t.cat))+'</td><td>'+esc(t.mode)+'</td><td class="n'+(t.amt<0?' good':'')+'">'+(t.amt<0?'+':'')+esc(fmt(Math.abs(t.amt)))+'</td></tr>';
        }).join('')+'</tbody></table>'+(list.length>500?'<div class="empty">Showing the first 500. Narrow the filters to see the rest.</div>':'')+'</div>':'<div class="empty">Nothing matches these filters.</div>';
    }
    inspector();
  }
  function findTx(row){row=+row;for(var i=0;i<M.all.length;i++) if(M.all[i].row===row) return M.all[i];return null;}
  function prop(k,v){return '<div><dt>'+esc(k)+'</dt><dd>'+v+'</dd></div>';}
  function itemHistory(key){
    var from=Math.max(0,M.periods.length-8);
    return M.periods.slice(from).map(function(p){
      var v=0,n=0;p.tx.forEach(function(t){if(itemKey(t.name)===key){v+=Math.abs(t.amt);n++;}});
      return {v:v,n:n,xl:p.label,cls:p.key===M.cur.key?'bar-cur':'bar-n',tip:p.name+'\n'+n+'× · '+fmt(v)};
    });
  }
  function inspector(){
    var el=$('#inspector');
    if(!el) return;
    var sel=U.ex.sel;
    if(!sel){
      el.classList.remove('open');
      el.innerHTML='<header class="pnl-h"><span class="pnl-t"><i class="pnl-dot"></i>Inspector</span></header><div class="pnl-b"><div class="empty">Select a transaction or item to see its properties and linked objects.</div></div>';
      return;
    }
    el.classList.add('open');
    var html='';
    if(sel.indexOf('t:')===0){
      var t=findTx(sel.slice(2));
      if(!t){U.ex.sel=null;return inspector();}
      var k=itemKey(t.name),same=M.all.filter(function(x){return itemKey(x.name)===k;});
      var tot=same.reduce(function(s,x){return s+Math.abs(x.amt);},0);
      html='<header class="pnl-h"><span class="pnl-t"><i class="pnl-dot"></i>Transaction</span><span class="pnl-m id">'+txId(t)+'</span><button type="button" class="x" data-insp-close aria-label="Close inspector">×</button></header><div class="pnl-b">'+
        '<div class="ins-h"><div class="ins-k">'+tag(catName(t.cat))+'</div><div class="ins-v'+(t.amt<0?' good':'')+'">'+(t.amt<0?'+':'')+esc(fmt(Math.abs(t.amt)))+'</div><div class="ins-n">'+esc(t.name)+'</div></div>'+
        '<dl class="props">'+prop('Description',esc(t.desc||'–'))+prop('Date',t.day!=null?esc(wday(t.day)+' '+fmtDayY(t.day)):'–')+prop('Payment mode',esc(t.mode))+prop('Cycle',esc(t.cycle||'–'))+
          prop('Source','<a href="'+esc(L.sheetUrl())+'#gid=0&range=A'+t.row+':F'+t.row+'" target="_blank" rel="noopener">Tracking!A'+t.row+':F'+t.row+' ↗</a>')+'</dl>'+
        '<div class="ins-sec">Linked object</div><button type="button" class="link-obj" data-item="'+esc(k)+'"><span class="lo-t">ITEM</span><span class="lo-n">'+esc(t.name.trim())+'</span><span class="lo-m">'+same.length+' transactions · '+esc(fmt(tot))+'</span></button>'+
        '<div class="ins-sec">History of this item</div><div id="ins-chart"></div>'+
        '<ul class="ins-list">'+same.slice(-6).reverse().map(function(x){return '<li data-tx="'+x.row+'"'+(x.row===t.row?' class="cur"':'')+'><span>'+(x.day!=null?esc(fmtDay(x.day)):'–')+'</span><span>'+esc(x.desc||'–')+'</span><b>'+esc(K(Math.abs(x.amt)))+'</b></li>';}).join('')+'</ul></div>';
      el.innerHTML=html;
      cols($('#ins-chart'),itemHistory(k),110);
    }else{
      var key=sel.slice(2),it=itemsOf(M.all).filter(function(e){return e.key===key;})[0];
      if(!it){U.ex.sel=null;return inspector();}
      var cats=Object.keys(it.cats).sort(function(a,b){return it.cats[b]-it.cats[a];});
      var descs={};it.tx.forEach(function(x){var d=x.desc.trim();if(d) descs[d]=(descs[d]||0)+1;});
      var topD=Object.keys(descs).sort(function(a,b){return descs[b]-descs[a];}).slice(0,5);
      var modes={};it.tx.forEach(function(x){modes[x.mode]=(modes[x.mode]||0)+Math.abs(x.amt);});
      html='<header class="pnl-h"><span class="pnl-t"><i class="pnl-dot"></i>Item</span><span class="pnl-m id">'+esc(key.toUpperCase().slice(0,18))+'</span><button type="button" class="x" data-insp-close aria-label="Close inspector">×</button></header><div class="pnl-b">'+
        '<div class="ins-h"><div class="ins-k">'+tag(it.cat)+'</div><div class="ins-v">'+esc(fmtS(it.v))+'</div><div class="ins-n">'+esc(it.name)+' · all time</div></div>'+
        '<dl class="props">'+prop('Transactions',String(it.n))+prop('Average',esc(fmtS(it.v/it.n)))+prop('First seen',it.first!=null?esc(fmtDayY(it.first)):'–')+prop('Last seen',it.last!=null?esc(fmtDayY(it.last)):'–')+
          prop('Categories',cats.map(function(c){return tag(c);}).join(' '))+prop('Paid with',Object.keys(modes).sort(function(a,b){return modes[b]-modes[a];}).map(esc).join(', '))+'</dl>'+
        '<div class="ins-sec">By period</div><div id="ins-chart"></div>'+
        (topD.length?'<div class="ins-sec">Common descriptions</div><div class="chips">'+topD.map(function(d){return '<span class="chip">'+esc(d)+' <em>'+descs[d]+'</em></span>';}).join('')+'</div>':'')+
        '<div class="ins-sec">Recent transactions</div><ul class="ins-list">'+it.tx.slice(-8).reverse().map(function(x){return '<li data-tx="'+x.row+'"><span>'+(x.day!=null?esc(fmtDay(x.day)):'–')+'</span><span>'+esc(x.desc||'–')+'</span><b>'+esc(K(Math.abs(x.amt)))+'</b></li>';}).join('')+'</ul></div>';
      el.innerHTML=html;
      cols($('#ins-chart'),itemHistory(key),110);
    }
  }

  // =====================================================================
  // command palette
  // =====================================================================
  var cmdSel=0,cmdItems=[];
  function openCmd(){
    var d=$('#cmd');
    if(!d.open) d.showModal();
    var i=$('#cmd-q');i.value='';cmdRun('');setTimeout(function(){i.focus();},10);
  }
  function cmdRun(q){
    q=q.trim().toLowerCase();
    var out=[];
    var acts=[
      {g:'Go to',t:'Overview',s:'Command centre',run:function(){go('overview');}},
      {g:'Go to',t:'Flows',s:'Account → category → item',run:function(){go('flows');}},
      {g:'Go to',t:'Explorer',s:'Every transaction and item',run:function(){go('explorer');}},
      {g:'Go to',t:'Forecast',s:'Budget food and shopping so Pay myself stays untouched',run:function(){go('forecast');}},
      {g:'Action',t:'Log entry',s:'Add a row to the sheet',run:function(){$('#add').click();}},
      {g:'Action',t:'Update balances',s:'ABL, Sadapay, Cash',run:function(){$('#bal').click();}},
      {g:'Action',t:'Refresh',s:'Read the sheet again',run:function(){L.refresh(true);}},
      {g:'Action',t:'Open the Google Sheet',s:'In a new tab',run:function(){window.open(L.sheetUrl(),'_blank','noopener');}},
      {g:'Action',t:'Sign out',s:'Revoke access and clear the saved copy',run:function(){L.signOut();}}
    ].concat(L.isApp()?[]:[{g:'Action',t:'Get the Android app',s:'Download Ledger.apk',run:function(){location.href='ledger.apk';}}]).concat([
    ]);
    acts.forEach(function(a){if(!q||(a.t+' '+a.s).toLowerCase().indexOf(q)>=0) out.push(a);});
    if(M&&!M.empty){
      Logic.CATS.concat(['Savings','Money in','Transfer']).forEach(function(c){
        if(q&&c.toLowerCase().indexOf(q)>=0) out.push({g:'Category',t:c,s:'Filter Explorer',cls:cls(c),run:function(){filterCat(c);}});
      });
      if(q){
        itemsOf(M.all).filter(function(e){return e.key.indexOf(q)>=0;}).sort(function(a,b){return b.n-a.n;}).slice(0,6).forEach(function(e){
          out.push({g:'Item',t:e.name,s:e.n+' transactions · '+fmtS(e.v),run:function(){openObj('i:'+e.key);}});
        });
        M.all.filter(function(t){return (t.desc+' '+txId(t)).toLowerCase().indexOf(q)>=0;}).slice(-6).reverse().forEach(function(t){
          out.push({g:'Transaction',t:t.name+' · '+fmt(Math.abs(t.amt)),s:txId(t)+' · '+(t.day!=null?fmtDay(t.day):'')+' · '+t.desc,run:function(){openObj('t:'+t.row);}});
        });
      }
    }
    cmdItems=out.slice(0,14);cmdSel=0;
    var lastG='';
    $('#cmd-r').innerHTML=cmdItems.length?cmdItems.map(function(a,i){
      var h=a.g!==lastG?'<li class="cmd-g">'+esc(a.g)+'</li>':'';lastG=a.g;
      return h+'<li class="cmd-i'+(i===0?' on':'')+'" data-cmd="'+i+'" role="option"'+(i===0?' aria-selected="true"':'')+'>'+(a.cls?'<i class="sw '+a.cls+'"></i>':'')+'<span class="ci-t">'+esc(a.t)+'</span><span class="ci-s">'+esc(a.s)+'</span></li>';
    }).join(''):'<li class="cmd-none">No matches</li>';
  }
  function cmdMove(d){
    if(!cmdItems.length) return;
    cmdSel=(cmdSel+d+cmdItems.length)%cmdItems.length;
    $$('#cmd-r .cmd-i').forEach(function(li){var on=+li.getAttribute('data-cmd')===cmdSel;li.classList.toggle('on',on);li.setAttribute('aria-selected',String(on));if(on) li.scrollIntoView({block:'nearest'});});
  }
  function cmdGo(i){var a=cmdItems[i];if(!a) return;$('#cmd').close();a.run();}

  // =====================================================================
  // navigation + rendering
  // =====================================================================
  function go(v){if(location.hash!=='#/'+v) location.hash='#/'+v;else{U.view=v;render();}}
  function filterCat(c){U.ex.cats=[c];U.ex.sel=null;go('explorer');}
  function openObj(sel){U.ex.sel=sel;if(U.view!=='explorer') go('explorer');else{exTable();}}

  function render(){
    renderShell();renderStatus();
    var v=$('#view');
    document.body.classList.toggle('gated',!S.tracking);
    if(!S.tracking){v.className='view gate-v';v.innerHTML=gate();renderCtx();return;}
    M=model();
    renderCtx();
    if(M.empty){v.className='view';v.innerHTML='<div class="gate"><div class="gate-card"><h1>No entries found</h1><p>Nothing in the Tracking tab matched the expected columns: Expense, Amount, Description, Date, Payment mode, Category, under a month heading.</p></div></div>';return;}
    v.className='view v-'+U.view;
    var y=window.scrollY;
    if(U.view==='forecast'&&window.Forecast){v.innerHTML=Forecast.view(M,UI);Forecast.draw(UI);}
    else if(U.view==='flows'){v.innerHTML=flows();drawSankey();}
    else if(U.view==='explorer'){v.innerHTML=explorer();exTable();}
    else{v.innerHTML=overview();drawTrajectory();drawTree();drawHeat();drawRides();}
    window.scrollTo(0,y);
  }

  var UI={pnl:pnl,kpi:kpi,showTip:showTip,hideTip:hideTip,rerender:function(){render();}};
  window.LedgerUI=UI;

  // ---- tooltip ----
  var tip=null,tipTimer=0;
  function showTip(html,x,y){
    tip=tip||$('#tip');
    tip.innerHTML=html;tip.classList.add('on');
    var r=tip.getBoundingClientRect(),px=x+16,py=y+16;
    if(px+r.width>window.innerWidth-8) px=x-r.width-16;
    if(py+r.height>window.innerHeight-8) py=y-r.height-16;
    tip.style.left=Math.max(8,px)+'px';tip.style.top=Math.max(8,py)+'px';
  }
  function hideTip(){(tip||$('#tip')).classList.remove('on');}
  function tipFor(e){
    if(e.target.closest&&e.target.closest('#traj-hit')) return;
    var t=e.target.closest&&e.target.closest('[data-tip]');
    if(!t){hideTip();return;}
    var parts=t.getAttribute('data-tip').split('\n');
    showTip('<div class="tt-h">'+esc(parts[0])+'</div>'+(parts.length>1?'<div class="tt-b">'+parts.slice(1).map(esc).join('<br>')+'</div>':''),e.clientX,e.clientY);
    clearTimeout(tipTimer);
    if(e.pointerType==='touch') tipTimer=setTimeout(hideTip,2200);
  }
  document.addEventListener('pointermove',tipFor);
  document.addEventListener('pointerdown',tipFor);
  window.addEventListener('scroll',hideTip,{passive:true});

  // ---- events ----
  document.addEventListener('click',function(e){
    var t=e.target.closest?e.target:null;
    if(!t) return;
    var b;
    if((b=t.closest('[data-view]'))){e.preventDefault();go(b.getAttribute('data-view'));return;}
    if((b=t.closest('.pchip[data-key]'))){S.sel=b.getAttribute('data-key');U.ex.sel=null;L.save();render();return;}
    if((b=t.closest('[data-mode]'))){S.mode=b.getAttribute('data-mode');S.sel=null;U.ex.sel=null;L.save();render();return;}
    if((b=t.closest('[data-layer]'))){var k=b.getAttribute('data-layer');U.layers[k]=!U.layers[k];saveU();b.setAttribute('aria-pressed',String(U.layers[k]));drawTrajectory();return;}
    if((b=t.closest('[data-act="signin"]'))||t.closest('#signin')){L.signInAndLoad();return;}
    if(t.closest('#signout')){L.signOut();return;}
    if(t.closest('#refresh')){L.refresh(true);return;}
    if(t.closest('#cmdk')){openCmd();return;}
    if((b=t.closest('[data-cmd]'))){cmdGo(+b.getAttribute('data-cmd'));return;}
    if(t.closest('[data-open-bal]')) return; // editor.js
    if((b=t.closest('[data-cat-filter]'))){filterCat(b.getAttribute('data-cat-filter'));return;}
    if((b=t.closest('[data-tx]'))){openObj('t:'+b.getAttribute('data-tx'));return;}
    if((b=t.closest('[data-item]'))){openObj('i:'+b.getAttribute('data-item'));return;}
    if(t.closest('[data-insp-close]')){U.ex.sel=null;exTable();return;}
    if((b=t.closest('[data-ex-type]'))){U.ex.type=b.getAttribute('data-ex-type');U.ex.sort='day';U.ex.dir=-1;saveU();render();return;}
    if((b=t.closest('[data-ex-scope]'))){U.ex.scope=b.getAttribute('data-ex-scope');saveU();render();return;}
    if((b=t.closest('[data-ex-cat]'))){toggle(U.ex.cats,b.getAttribute('data-ex-cat'));render();return;}
    if((b=t.closest('[data-ex-mode]'))){toggle(U.ex.modes,b.getAttribute('data-ex-mode'));render();return;}
    if((b=t.closest('[data-ex-min]'))){U.ex.min=+b.getAttribute('data-ex-min');render();return;}
    if(t.closest('[data-fx]')){U.fx=!U.fx;render();return;}
    if(t.closest('[data-ex-reset]')){U.ex.cats=[];U.ex.modes=[];U.ex.min=0;U.ex.q='';render();return;}
    if((b=t.closest('th[data-sort]'))){var sk=b.getAttribute('data-sort');if(U.ex.sort===sk) U.ex.dir=-U.ex.dir;else{U.ex.sort=sk;U.ex.dir=sk==='name'?1:-1;}exTable();return;}
  });
  function toggle(arr,v){var i=arr.indexOf(v);if(i>=0) arr.splice(i,1);else arr.push(v);}
  document.addEventListener('keydown',function(e){
    if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();openCmd();return;}
    var c=$('#cmd');
    if(c.open){
      if(e.key==='ArrowDown'){e.preventDefault();cmdMove(1);}
      else if(e.key==='ArrowUp'){e.preventDefault();cmdMove(-1);}
      else if(e.key==='Enter'){e.preventDefault();cmdGo(cmdSel);}
      return;
    }
    var a=document.activeElement;
    if(e.key==='/'&&!(a&&/INPUT|TEXTAREA/.test(a.tagName))&&!document.querySelector('dialog[open]')){var q=$('#ex-q');if(q){e.preventDefault();q.focus();}return;}
    if(e.key==='Enter'&&a&&a.matches&&a.matches('tr[data-tx],tr[data-item],li[data-tx]')){a.click();}
  });
  var qTimer=0;
  document.addEventListener('input',function(e){
    if(e.target.id==='cmd-q'){cmdRun(e.target.value);return;}
    if(e.target.id==='ex-q'){U.ex.q=e.target.value;clearTimeout(qTimer);qTimer=setTimeout(exTable,120);}
  });
  document.addEventListener('submit',function(e){
    if(e.target.id!=='setup') return;
    e.preventDefault();
    L.configure($('#cfg-client').value.trim(),$('#cfg-sheet').value.trim());
  });
  $('#cmd').addEventListener('click',function(e){if(e.target===this) this.close();});
  window.addEventListener('hashchange',function(){U.view=viewFromHash();window.scrollTo(0,0);render();});
  var rz=0;
  // Charts follow the width only. On phones the keyboard opening changes the height, and
  // re-rendering then would throw away the box being typed in and close the keyboard.
  var lastW=window.innerWidth;
  window.addEventListener('resize',function(){clearTimeout(rz);rz=setTimeout(function(){
    if(!S.tracking||window.innerWidth===lastW) return;
    if(typing()) return;
    lastW=window.innerWidth;render();
  },160);});

  L.on(function(what){
    if(what==='status'){renderStatus();return;}
    if(what==='busy'){renderStatus();$('#refresh').classList.toggle('spin',!!S.busy);return;}
    if(what==='auth'){renderShell();if(!S.tracking) render();return;}
    // Do not redraw under an open form; it would reset what is being typed.
    if(document.querySelector('dialog.sheet[open]')||typing()){pending=true;return;}
    render();
  });
  var pending=false;
  function typing(){var f=document.activeElement;return !!(f&&$('#view').contains(f)&&/^(INPUT|TEXTAREA|SELECT)$/.test(f.tagName));}
  // a sync that lands while a Forecast box is being edited waits until you leave the box
  $('#view').addEventListener('focusout',function(){setTimeout(function(){if(pending&&!typing()&&!document.querySelector('dialog.sheet[open]')){pending=false;render();}},0);});
  document.addEventListener('close',function(e){if(e.target.matches&&e.target.matches('dialog.sheet')&&pending){pending=false;render();}},true);
})();
