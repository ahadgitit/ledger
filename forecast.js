/* Savings forecast: a Monte Carlo model of the coming payday cycles built from the
   Tracking history, plus the Plan tab (pay, fixed costs, goal, upcoming expenses).

   Model, per future cycle:
     saving = pay - fixed (family, Touheed, other) - bills - planned - variable - one-offs
   - Fixed costs and pay come from the plan. Bills are detected from history.
   - Variable spending (food, getting around, personal) is a moving-block bootstrap:
     random 7-day stretches of your own past days, recent weeks weighted more
     (half-life 60 days), stitched to the cycle length. This keeps real weekly rhythm.
   - One-off purchases (single entries of Rs 3,000 or more) are a compound Poisson
     process: how often they happen and how big they are, both taken from history.
   - Scenarios restrict the bootstrap to your better weeks (Modest: the cheapest 40%,
   Lean: 20%) and thin out one-offs. They describe weeks you have already lived.
   2,000 paths give the percentile bands. A seeded generator keeps numbers stable. */
var Forecast=(function(){
  var L=window.Ledger,esc=L.esc,fmt=L.fmt,fmtS=L.fmtS,K=Viz.kfmt,DAY=Logic.DAY,MON=Logic.MON;
  function $(s,r){return (r||document).querySelector(s);}
  function $$(s,r){return Array.prototype.slice.call((r||document).querySelectorAll(s));}
  var LUMP=3000,HL=60,SIMS=2000;
  var TOUHEED=/tou?heed|tohid/;

  // ---------------------------------------------------------------- plan
  var KEYS=[
    ['minPay','Minimum pay'],['extra','Usual extra pay (overtime, bonuses)'],
    ['family','Family support (Mama)'],['touheed','Touheed (transport and advances)'],['otherFixed','Other fixed costs'],
    ['balance','Savings balance today'],['goal','Savings goal'],['goalDate','Goal date']
  ];
  function parsePlan(rows){
    if(!rows) return null;
    var p={upcoming:[]},sec='';
    rows.forEach(function(r){
      r=r||[];
      var a=String(r[0]==null?'':r[0]).trim(),al=a.toLowerCase();
      if(!a) return;
      if(al==='upcoming expenses'){sec='up';return;}
      if(sec==='up'){
        if(al.indexOf('month')===0) return;
        var amt=Logic.num(r[2]);
        if(!isNaN(amt)&&amt) p.upcoming.push({month:a,item:String(r[1]==null?'':r[1]).trim(),amount:amt,note:String(r[3]==null?'':r[3])});
        return;
      }
      KEYS.forEach(function(k){
        if(al===k[1].toLowerCase()) p[k[0]]=k[0]==='goalDate'?String(r[1]==null?'':r[1]).trim():Logic.num(r[1]);
      });
    });
    return p;
  }
  function planRows(p){
    var rows=[['LEDGER PLAN','Written by the Ledger app. Edit the values in column B and keep the labels in column A.'],[],['Setting','Value']];
    KEYS.forEach(function(k){var v=p[k[0]];rows.push([k[1],k[0]==='goalDate'?(v||''):(isFinite(v)&&v!==''&&v!=null?Math.round(v):'')]);});
    rows.push([]);rows.push(['Upcoming expenses']);rows.push(['Month (YYYY-MM)','Item','Amount','Note']);
    p.upcoming.forEach(function(u){rows.push([u.month,u.item,Math.round(u.amount),u.note||'']);});
    return rows;
  }

  // ---------------------------------------------------------------- history
  function bucket(t){
    var c=t.cat,s=(t.name+' '+t.desc).toLowerCase();
    if(c==='savings'||c==='transfer') return null;
    if(c==='influx') return TOUHEED.test(s)?'touheed':null;
    if(TOUHEED.test(s)) return 'touheed';
    // office transport is paid to Touheed whatever category it was logged under
    if(!/in\s*-?\s*drive|courier/.test(s)&&(/\btransport\b|advance pay|extra charge|car fuel|car feul/.test(s)||(c==='transport'&&/weekend|early payment|prepaid/.test(s)))) return 'touheed';
    if(c==='renovation') return 'renovation';
    if(c==='family/home') return 'family';
    if(t.amt>=5000&&/\b(mama|amma|mother|mom)\b/.test(s)) return 'family';
    if(t.amt>0&&(/claude|internet|amazon|youtube|netflix/.test(s)||(/foodpanda/.test(s)&&/subscri/.test(s)&&c!=='food'))) return 'bills';
    if(c==='food') return 'food';
    if(c==='transport') return 'around';
    return 'personal';
  }
  var VB=['food','around','personal'];
  function median(a){if(!a.length) return 0;a=a.slice().sort(function(x,y){return x-y;});var m=a.length>>1;return a.length%2?a[m]:(a[m-1]+a[m])/2;}
  function q(sorted,p){if(!sorted.length) return 0;var i=(sorted.length-1)*p,lo=Math.floor(i),hi=Math.ceil(i);return sorted[lo]+(sorted[hi]-sorted[lo])*(i-lo);}
  function wq(pairs,p){
    pairs=pairs.slice().sort(function(a,b){return a[0]-b[0];});
    var tot=pairs.reduce(function(s,x){return s+x[1];},0),acc=0;
    for(var i=0;i<pairs.length;i++){acc+=pairs[i][1];if(acc>=p*tot) return pairs[i][0];}
    return pairs.length?pairs[pairs.length-1][0]:0;
  }
  // Per completed cycle totals by bucket, for evidence and defaults.
  function cycleTotals(M){
    var cyc=Logic.cyclePeriods(M.parsed,M.today);
    return cyc.map(function(p){
      var o={key:p.key,label:p.label,name:p.name,start:p.start,end:p.end,open:p.open,days:p.end-p.start+1,food:0,around:0,personal:0,touheed:0,family:0,bills:0,lumps:0,saved:0,lentT:0};
      p.tx.forEach(function(t){
        if(t.cat==='savings'){o.saved+=t.amt;return;}
        var b=bucket(t);if(!b||b==='renovation') return;
        if(b==='touheed'){o.touheed+=t.amt;if(t.cat==='loaned') o.lentT+=t.amt;return;}
        if(VB.indexOf(b)>=0){if(!(t.amt>0)) return;if(t.amt>=LUMP) o.lumps+=t.amt;else o[b]+=t.amt;return;}
        o[b]+=t.amt;
      });
      o.variable=o.food+o.around+o.personal+o.lumps;
      return o;
    });
  }
  function history(M,end){
    var cyc=Logic.cyclePeriods(M.parsed,M.today);
    if(!cyc.length) return null;
    var first=cyc[0].start;
    end=end!=null?end:M.today;
    if(end-first<21) return null;
    var start=Math.max(first,end-240),N=end-start,days=[],lumps=[],logged=[];
    for(var i=0;i<N;i++){days.push([0,0,0]);logged.push(false);}
    M.all.forEach(function(t){
      if(t.day==null||t.day<start||t.day>=end) return;
      logged[t.day-start]=true;
      if(!(t.amt>0)) return;
      var bi=VB.indexOf(bucket(t));
      if(bi<0) return;
      // a catch-up row ("2 week chaos", "untracked days") is ordinary spending of unlogged days, not an impulse buy
      if(t.amt>=LUMP&&!/untrack|could not track|chaos/.test((t.name+' '+t.desc).toLowerCase())) lumps.push({age:end-1-t.day,amt:t.amt,b:bi,name:t.name,w:0});
      else if(t.amt<LUMP) days[t.day-start][bi]+=t.amt;
    });
    // Stretches of 4+ days with nothing logged are gaps, not cheap days: leave them out.
    var gap=[];
    for(var g=0;g<N;){
      if(logged[g]){gap.push(false);g++;continue;}
      var e=g;while(e<N&&!logged[e]) e++;
      for(var x=g;x<e;x++) gap.push(e-g>=4);
      g=e;
    }
    var blocks=[];
    for(var s=0;s+7<=N;s++){
      var f=0,a=0,p=0,bad=false;
      for(var d=s;d<s+7;d++){if(gap[d]){bad=true;break;}f+=days[d][0];a+=days[d][1];p+=days[d][2];}
      if(!bad) blocks.push({f:f,a:a,p:p,t:f+a+p,w:Math.pow(0.5,(N-1-(s+3))/HL)});
    }
    var wd=0;for(var d2=0;d2<N;d2++) if(!gap[d2]) wd+=Math.pow(0.5,(N-1-d2)/HL);
    var wl=0;lumps.forEach(function(l){l.w=Math.pow(0.5,l.age/HL);wl+=l.w;});
    if(blocks.length<3) return null;
    return {start:start,end:end,N:N,blocks:blocks,lumps:lumps,rate:wd?wl/wd:0,gaps:gap.filter(Boolean).length};
  }
  var SCEN={usual:{p:1,l:1,label:'Usual'},modest:{p:0.4,l:0.5,label:'Modest'},lean:{p:0.2,l:0.2,label:'Lean'}};
  function prep(H,name){
    var sc=SCEN[name];
    var thr=sc.p>=1?Infinity:wq(H.blocks.map(function(b){return [b.t,b.w];}),sc.p);
    var bl=H.blocks.filter(function(b){return b.t<=thr;});
    if(!bl.length) bl=H.blocks;
    var cum=[],c=0;bl.forEach(function(b){c+=b.w;cum.push(c);});
    var lc=[],lt=0;H.lumps.forEach(function(l){lt+=l.w;lc.push(lt);});
    return {bl:bl,cum:cum,tot:c,lumps:H.lumps,lc:lc,lt:lt,rate:H.rate*sc.l};
  }
  function rng(seed){var a=seed>>>0;return function(){a=(a+0x6D2B79F5)>>>0;var t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};}
  function pick(cum,tot,r){var x=r()*tot,lo=0,hi=cum.length-1;while(lo<hi){var m=(lo+hi)>>1;if(cum[m]<x) lo=m+1;else hi=m;}return lo;}
  function poisson(lam,r){if(lam<=0) return 0;var Lm=Math.exp(-lam),k=0,p=1;do{k++;p*=r();}while(p>Lm&&k<60);return k-1;}
  function simVar(P,len,r,out){
    var f=0,a=0,p=0,left=len;
    if(P.bl.length) while(left>0){var b=P.bl[pick(P.cum,P.tot,r)],take=Math.min(7,left),k=take/7;f+=b.f*k;a+=b.a*k;p+=b.p*k;left-=take;}
    var l=0,n=P.lumps.length?poisson(P.rate*len,r):0;
    for(var i=0;i<n;i++) l+=P.lumps[pick(P.lc,P.lt,r)].amt;
    out[0]=f;out[1]=a;out[2]=p;out[3]=l;
    return f+a+p+l;
  }

  // ---------------------------------------------------------------- forecast
  function ymKey(day){var d=new Date(day*DAY);return d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0');}
  function ymLabel(key){var p=key.split('-');return MON[+p[1]-1]+' '+p[0];}
  function cycleLen(ct){
    var d=[];for(var i=1;i<ct.length;i++) d.push(ct[i].start-ct[i-1].start);
    var m=Math.round(median(d.slice(-6)));
    return m>=25&&m<=35?m:30;
  }
  function analyse(M,plan,scen,horizon){
    var ct=cycleTotals(M),done=ct.filter(function(c){return !c.open;});
    var len=cycleLen(ct);
    var H=history(M);
    if(!H) return {error:'Not enough history yet. The forecast needs about three weeks of entries.'};
    var cur=ct[ct.length-1];
    var nextPay=M.fb?M.fb.payday:(cur.open?cur.start+len:M.today+1);
    var cycles=[];
    for(var k=0;k<horizon;k++){var st=nextPay+k*len;cycles.push({start:st,len:len,key:ymKey(st),label:MON[new Date(st*DAY).getUTCMonth()]});}
    var curKey=ymKey(cur.start);
    // defaults from history where the plan is silent
    var recent=done.slice(-4);
    var sug={
      touheed:Math.round(median(recent.map(function(c){return c.touheed;}))/500)*500,
      family:35000,
      bills:Math.round(median(done.slice(-3).map(function(c){return c.bills;}))),
      balance:M.all.filter(function(t){return t.cat==='savings';}).reduce(function(s,t){return s+t.amt;},0)
    };
    plan=plan||{upcoming:[]};
    function val(k,d){var v=plan[k];return isFinite(v)&&v!==''&&v!=null?v:d;}
    var inc=val('minPay',0)+val('extra',0),minPay=val('minPay',0);
    var fixed={family:val('family',sug.family),touheed:val('touheed',sug.touheed),other:val('otherFixed',0),bills:sug.bills};
    var fixedTot=fixed.family+fixed.touheed+fixed.other+fixed.bills;
    var planned=cycles.map(function(c){return plan.upcoming.filter(function(u){return u.month===c.key;}).reduce(function(s,u){return s+u.amount;},0);});
    var plannedNow=plan.upcoming.filter(function(u){return u.month===curKey;}).reduce(function(s,u){return s+u.amount;},0);
    var balance=val('balance',sug.balance),goal=val('goal',0);
    var seed=(S_hash(M)+scen.length*7919+horizon)|0;

    function runScenario(name,sims){
      var P=prep(H,name),r=rng(seed+name.length),out=[0,0,0,0];
      var cum=new Float64Array(sims*(horizon+1)),next=new Float64Array(sims),nextVar=new Float64Array(sims),sweep=new Float64Array(sims);
      var parts=[[],[],[],[]];
      for(var s=0;s<sims;s++){
        var acc=balance;
        // what is left of the current cycle can be moved to savings on payday
        if(M.fb){var v0=simVar(P,Math.max(0,M.fb.days),r,out);var left=M.fb.remaining-M.fb.due-plannedNow-v0;sweep[s]=left;acc+=Math.max(0,left);}
        cum[s*(horizon+1)]=acc;
        for(var k=0;k<horizon;k++){
          var v=simVar(P,cycles[k].len,r,out);
          var sv=inc-fixedTot-planned[k]-v;
          if(k===0){next[s]=sv;nextVar[s]=v;for(var j=0;j<4;j++) parts[j].push(out[j]);}
          acc+=sv;
          cum[s*(horizon+1)+k+1]=acc;
        }
      }
      var bands=[];
      for(var k2=0;k2<=horizon;k2++){
        var col=new Array(sims);for(var s2=0;s2<sims;s2++) col[s2]=cum[s2*(horizon+1)+k2];
        col.sort(function(a,b){return a-b;});
        bands.push({p10:q(col,0.1),p25:q(col,0.25),p50:q(col,0.5),p75:q(col,0.75),p90:q(col,0.9),col:k2===horizon?null:null});
      }
      var ns=Array.prototype.slice.call(next).sort(function(a,b){return a-b;});
      var nv=Array.prototype.slice.call(nextVar).sort(function(a,b){return a-b;});
      var sw=Array.prototype.slice.call(sweep).sort(function(a,b){return a-b;});
      var goalHit=null,goalProb=null;
      if(goal>0){
        for(var k3=0;k3<=horizon;k3++) if(bands[k3].p50>=goal){goalHit=k3;break;}
        if(plan.goalDate){
          var gd=Date.parse(plan.goalDate);
          if(!isNaN(gd)){
            var gday=Math.floor(gd/DAY),kk=-1;
            for(var k4=0;k4<horizon;k4++) if(cycles[k4].start<=gday) kk=k4+1;
            if(kk>=0){var hit=0;for(var s3=0;s3<sims;s3++) if(cum[s3*(horizon+1)+kk]>=goal) hit++;goalProb={p:hit/sims,k:kk,beyond:kk===horizon&&cycles[horizon-1].start+len<gday};}
          }
        }
      }
      return {bands:bands,next:ns,nextVar:nv,sweep:M.fb?sw:null,parts:parts.map(function(a){return median(a);}),goalHit:goalHit,goalProb:goalProb,neg:ns.filter(function(x){return x<0;}).length/sims};
    }
    var main=runScenario(scen,SIMS);
    var alt=runScenario(scen==='usual'?'modest':'usual',800);
    // levers: what each change is worth per cycle, from the scenario medians
    var usual=scen==='usual'?main:alt,modest=scen==='modest'?main:runScenario('modest',800);
    var levers=[
      {k:'Food',d:usual.parts[0]-modest.parts[0],how:'Eat like your better weeks'},
      {k:'Getting around',d:usual.parts[1]-modest.parts[1],how:'Ride like your better weeks'},
      {k:'Personal & other',d:usual.parts[2]-modest.parts[2],how:'Keep small buys to your better weeks'},
      {k:'One-off buys',d:usual.parts[3]-modest.parts[3],how:'Halve purchases of Rs 3,000+'},
      {k:'Extra pay',d:10000,how:'Each Rs 10,000 of overtime or bonus'}
    ].filter(function(l){return l.d>0;}).sort(function(a,b){return b.d-a.d;});
    var s50=main.next.length?q(main.next,0.5):0;
    levers.forEach(function(l){
      l.year=l.d*365/len;
      if(goal>0&&s50>0){var need=goal-main.bands[0].p50,base=need/s50;l.sooner=need>0&&base<=60?(base-need/(s50+l.d))*len:0;}
    });
    // the amount that can go to savings on payday with 80% confidence of not running short
    var safe=inc?inc-fixedTot-planned[0]-q(main.nextVar,0.8):null;
    return {ct:ct,done:done,len:len,cycles:cycles,curKey:curKey,inc:inc,minPay:minPay,extra:val('extra',0),fixed:fixed,fixedTot:fixedTot,
      planned:planned,plannedNow:plannedNow,balance:balance,goal:goal,goalDate:plan.goalDate||'',sug:sug,main:main,alt:alt,altName:scen==='usual'?'modest':'usual',
      levers:levers,safe:safe,s50:s50,H:H,horizon:horizon,scen:scen};
  }
  function S_hash(M){var h=2166136261;var s=String(M.all.length)+'|'+M.today+'|'+(M.all.length?M.all[M.all.length-1].amt:0);for(var i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0;}

  // Walk-forward check: forecast each recent finished cycle using only the days before it.
  function backtest(M){
    var ct=cycleTotals(M).filter(function(c){return !c.open;}),out=[];
    ct.slice(-5).forEach(function(c){
      var H=history(M,c.start);
      if(!H||H.N<28) return;
      var P=prep(H,'usual'),r=rng(c.start),o=[0,0,0,0],v=[];
      for(var s=0;s<1000;s++) v.push(simVar(P,c.days,r,o));
      v.sort(function(a,b){return a-b;});
      out.push({label:c.label,name:c.name,p10:q(v,0.1),p50:q(v,0.5),p90:q(v,0.9),actual:c.variable,inside:c.variable>=q(v,0.1)&&c.variable<=q(v,0.9)});
    });
    return out;
  }

  // ---------------------------------------------------------------- view
  var UIS={scen:'usual',horizon:12};
  try{var us=JSON.parse(localStorage.getItem('ledger.fc')||'null');if(us){if(SCEN[us.scen]) UIS.scen=us.scen;if([6,12,24].indexOf(us.horizon)>=0) UIS.horizon=us.horizon;}}catch(e){}
  function saveUIS(){try{localStorage.setItem('ledger.fc',JSON.stringify(UIS));}catch(e){}}
  var R=null,BT=null,CUR_M=null;

  function view(M,ui){
    CUR_M=M;
    var plan=parsePlan(L.S.planRows);
    R=analyse(M,plan,UIS.scen,UIS.horizon);
    var seg=function(attr,opts,v){return '<div class="seg">'+opts.map(function(o){return '<button type="button" '+attr+'="'+o[0]+'" aria-pressed="'+(String(v)===String(o[0]))+'">'+o[1]+'</button>';}).join('')+'</div>';};
    var bar='<div class="fc-bar">'+seg('data-fc-scen',[['usual','Usual'],['modest','Modest'],['lean','Lean']],UIS.scen)+seg('data-fc-h',[[6,'6 cycles'],[12,'12'],[24,'24']],UIS.horizon)+
      '<button type="button" class="btn primary" data-fc-plan>'+(plan&&plan.minPay?'Edit plan':'Set up plan')+'</button></div>';
    var scenNote={usual:'Usual: resamples all your weeks, as you actually spend.',modest:'Modest: only your cheaper 40% of weeks, and half the one-off buys.',lean:'Lean: only your cheapest 20% of weeks, and a fifth of the one-off buys.'}[UIS.scen];
    if(R.error) return bar+'<div class="pnl"><div class="pnl-b"><div class="empty">'+esc(R.error)+'</div></div></div>';
    if(!R.inc){
      return bar+'<section class="pnl fc-setup"><div class="pnl-b"><div class="fc-setup-in"><div class="fc-setup-k">SAVINGS FORECAST</div><h2>Tell the model what you earn</h2>'+
        '<p>Enter your minimum pay once. Your usual extra pay (overtime, bonuses), Mama’s 35,000, Touheed’s transport and anything coming up next month make the forecast sharper. Everything is saved to a new <b>Plan</b> tab in your sheet.</p>'+
        '<button type="button" class="btn primary" data-fc-plan>Set up plan</button></div>'+
        '<div class="fc-pre"><div><span>Your spending forecast for next cycle</span><b>'+esc(fmt(q(R.main.nextVar,0.5)))+'</b><small>food, getting around, personal and one-offs · typical</small></div>'+
        '<div><span>Fixed costs found</span><b>'+esc(fmt(R.fixedTot))+'</b><small>Mama '+esc(K(R.fixed.family))+' · Touheed '+esc(K(R.fixed.touheed))+' · bills '+esc(K(R.fixed.bills))+'</small></div></div></div></section>';
    }
    var m=R.main,last=m.bands[R.horizon];
    var kp=[];
    kp.push(ui.kpi('Pay yourself next payday',esc(fmt(Math.max(0,R.safe))),'80% sure you won’t run short · '+esc(fmtDayS(R.cycles[0].start)),{cls:'hero'}));
    kp.push(ui.kpi('Saving per cycle',esc(fmtS(R.s50)),'typical · range '+esc(K(q(m.next,0.1)))+' to '+esc(K(q(m.next,0.9)))));
    kp.push(ui.kpi('Savings rate',Math.round(R.s50/R.inc*100)+'<small>%</small>','of '+esc(fmt(R.inc))+' pay'));
    kp.push(ui.kpi('In '+R.horizon+' cycles',esc(fmt(last.p50)),'savings balance · typical'));
    if(R.goal>0) kp.push(ui.kpi('Goal '+K(R.goal),m.goalHit!=null?esc(R.cycles[Math.max(0,m.goalHit-1)].label+' '+new Date(R.cycles[Math.max(0,m.goalHit-1)].start*DAY).getUTCFullYear()):'Beyond '+R.horizon+' cycles',
      m.goalProb?Math.round(m.goalProb.p*100)+'% chance by '+esc(R.goalDate):(m.goalHit!=null?'typical path reaches it':'raise savings or extend horizon'),{cls:m.goalProb&&m.goalProb.p<0.5?'bad':''}));
    if(m.sweep) kp.push(ui.kpi('Left at payday',esc(fmtS(q(m.sweep,0.5))),'this cycle · can go to savings'));
    var html=bar+'<div class="kpis" style="--n:'+(kp.length-1)+'">'+kp.join('')+'</div><div class="grid">'+
      ui.pnl('fc-traj','Savings trajectory',esc(scenNote),'<div id="fc-fan"></div><div class="legend" id="fc-leg"></div>',{cls:'s8'})+
      ui.pnl('fc-dist','Next cycle outcomes',esc(R.cycles[0].label)+' · '+SIMS+' simulations','<div id="fc-hist"></div><div class="fc-risk" id="fc-risk"></div>',{cls:'s4'})+
      ui.pnl('fc-wf','Where next cycle’s pay goes',esc(R.cycles[0].label)+' · typical','<div id="fc-water"></div>',{cls:'s7'})+
      leversPanel(ui)+
      inputsPanel(ui)+upcomingPanel(ui)+
      ui.pnl('fc-bt','Model check','<span id="fc-bt-m"></span>','<div id="fc-btest"></div>',{cls:'s6'})+
      ui.pnl('fc-how','How this forecast works','',howHTML(),{cls:'s6'})+
      '</div>';
    return html;
  }
  function niceStep(x){var p=Math.pow(10,Math.floor(Math.log10(Math.max(1,x)))),f=x/p;return (f<=1?1:f<=2?2:f<=2.5?2.5:f<=5?5:10)*p;}
  function fmtDayS(n){var d=new Date(n*DAY);return d.getUTCDate()+' '+MON[d.getUTCMonth()];}
  function leversPanel(ui){
    var rows=R.levers.map(function(l){
      return '<li><div class="lv-t"><b>'+esc(l.k)+'</b><span>'+esc(l.how)+'</span></div><div class="lv-v">+'+esc(K(l.d))+'<small>/cycle</small></div>'+
        '<div class="lv-s">'+esc(K(l.year))+' a year'+(l.sooner>=1?' \u00b7 goal '+(l.sooner>=14?Math.round(l.sooner/7)+' weeks':Math.round(l.sooner)+' days')+' sooner':'')+'</div></li>';
    }).join('');
    return ui.pnl('fc-lev','Levers','biggest first',rows?'<ul class="levers">'+rows+'</ul>':'<div class="empty">Not enough history to compare.</div>',{cls:'s5'});
  }
  function inputsPanel(ui){
    var f=R.fixed,last=R.done.slice(-6);
    var mx=Math.max.apply(null,last.map(function(c){return Math.abs(c.touheed);}).concat([1]));
    var th=last.map(function(c){return '<div class="th-c" data-tip="'+esc(c.name+'\nTouheed net '+fmt(c.touheed)+(c.lentT?'\nincl. lent '+fmt(c.lentT):''))+'"><i style="height:'+Math.max(2,Math.abs(c.touheed)/mx*100)+'%"></i><span>'+esc(c.label)+'</span></div>';}).join('');
    var rows=[['Minimum pay',R.minPay,'you'],['Usual extra pay',R.extra,'you'],['Family support (Mama)',f.family,'you'],['Touheed: transport + advances',f.touheed,'you'],['Bills (Claude, internet, …)',f.bills,'history'],['Other fixed costs',f.other,'you']];
    return ui.pnl('fc-in','Model inputs','per cycle · cycle ≈ '+R.len+' days',
      '<dl class="ledger">'+rows.map(function(r){return '<div><dt>'+esc(r[0])+' <em class="src '+r[2]+'">'+(r[2]==='you'?'plan':'detected')+'</em></dt><dd>'+esc(fmt(r[1]))+'</dd></div>';}).join('')+'</dl>'+
      '<div class="ins-sec">Touheed per cycle (transport, loans, returns)</div><div class="th-bars">'+th+'</div>'+
      '<p class="fc-note">Loans to Touheed that come back as transport deductions are netted in each cycle, so this is what he really costs. Suggested from your last four cycles: <b>'+esc(fmt(R.sug.touheed))+'</b>.</p>',{cls:'s6'});
  }
  function upcomingPanel(ui){
    var plan=parsePlan(L.S.planRows)||{upcoming:[]};
    var keys=[R.curKey].concat(R.cycles.map(function(c){return c.key;}));
    var list=plan.upcoming.slice().sort(function(a,b){return a.month<b.month?-1:a.month>b.month?1:0;});
    var rows=list.map(function(u){
      var i=keys.indexOf(u.month),when=i===0?'This cycle':i>0?R.cycles[i-1].label+' cycle':(u.month<R.curKey?'Past':'Later');
      return '<li><span class="up-m">'+esc(when)+'</span><span class="up-i">'+esc(u.item)+(u.note?'<small>'+esc(u.note)+'</small>':'')+'</span><span class="up-v">'+esc(fmt(u.amount))+'</span></li>';
    }).join('');
    return ui.pnl('fc-up','Upcoming expenses',list.length?esc(fmt(list.reduce(function(s,u){return s+u.amount;},0)))+' planned':'',
      (rows?'<ul class="upl">'+rows+'</ul>':'<div class="empty">Nothing planned. Add things you know are coming, like a wedding gift or a phone repair, and they come out of that month.</div>')+
      '<div class="pnl-foot"><span>Counted in full in the month you pick</span><button type="button" class="lnk" data-fc-plan="up">Add or edit →</button></div>',{cls:'s6'});
  }
  function howHTML(){
    var h=R.H;
    return '<div class="how"><p><b>Pay minus fixed costs</b> comes from your plan: minimum pay plus usual extra, less Mama, Touheed, other fixed costs and the bills detected in your sheet.</p>'+
      '<p><b>Everyday spending</b> is simulated by stitching together random 7-day stretches of your own last '+h.N+' days'+(h.gaps?' (skipping '+h.gaps+' days with nothing logged)':'')+' (food, InDrive and other rides, personal). Recent weeks count more: a week from two months ago counts half as much as this week. This keeps your real rhythm, like weekend rides and payday treats, instead of a flat average.</p>'+
      '<p><b>One-off buys</b> of Rs 3,000 or more (an oven, a course, a perfume) are simulated separately: you’ve had about '+(h.rate*30).toFixed(1)+' per cycle lately, with sizes drawn from your real ones.</p>'+
      '<p><b>'+SIMS.toLocaleString('en-US')+' simulated futures</b> give the bands: the dark band is the middle half of outcomes, the light band 80% of them. <b>Modest</b> and <b>Lean</b> only use your cheaper weeks, so they describe how you’ve already lived, not wishful targets.</p></div>';
  }

  // ---------------------------------------------------------------- charts
  function draw(ui){
    if(!R||R.error||!R.inc) return;
    drawFan(ui);drawHist(ui);drawWater(ui);drawBacktest();
  }
  function drawFan(ui){
    var el=$('#fc-fan');if(!el) return;
    var m=R.main,a=R.alt,n=R.horizon;
    var W=Math.max(280,el.clientWidth),narrow=W<560,H=narrow?230:280,mg={l:narrow?44:56,r:narrow?10:18,t:18,b:26};
    var pw=W-mg.l-mg.r,ph=H-mg.t-mg.b;
    var vals=[];m.bands.forEach(function(b){vals.push(b.p10,b.p90);});a.bands.forEach(function(b){vals.push(b.p50);});
    if(R.goal>0) vals.push(R.goal);
    // Fit the axis to the paths (a balance axis need not start at zero) with round steps.
    var vmin=Math.min.apply(null,vals),vmax=Math.max.apply(null,vals),span=Math.max(1,vmax-vmin);
    var step=niceStep(span/4),lo=Math.floor((vmin-span*0.04)/step)*step,hi=Math.ceil((vmax+span*0.04)/step)*step;
    function X(k){return mg.l+k/n*pw;}
    function Y(v){return mg.t+ph-(v-lo)/(hi-lo)*ph;}
    var s='<svg viewBox="0 0 '+W+' '+H+'" width="'+W+'" height="'+H+'" role="img" aria-label="Projected savings balance over the next '+n+' cycles">';
    for(var v=lo;v<=hi+step/2;v+=step){var y=Y(v);s+='<line class="grid" x1="'+mg.l+'" x2="'+(W-mg.r)+'" y1="'+y+'" y2="'+y+'"/><text class="tick" x="'+(mg.l-8)+'" y="'+(y+3.5)+'" text-anchor="end">'+K(v)+'</text>';}
    if(lo<0&&hi>0) s+='<line class="axis" x1="'+mg.l+'" x2="'+(W-mg.r)+'" y1="'+Y(0)+'" y2="'+Y(0)+'"/>';
    function area(k1,k2){
      var up=m.bands.map(function(b,k){return (k?'L':'M')+Viz.r1(X(k))+','+Viz.r1(Y(b[k1]));}).join(' ');
      var dn=m.bands.slice().reverse().map(function(b,k){return 'L'+Viz.r1(X(n-k))+','+Viz.r1(Y(b[k2]));}).join(' ');
      return up+' '+dn+' Z';
    }
    s+='<path class="fan-o" d="'+area('p90','p10')+'"/><path class="fan-i" d="'+area('p75','p25')+'"/>';
    s+='<path class="fan-alt" d="'+a.bands.map(function(b,k){return (k?'L':'M')+Viz.r1(X(k))+','+Viz.r1(Y(b.p50));}).join(' ')+'"/>';
    s+='<path class="fan-m" d="'+m.bands.map(function(b,k){return (k?'L':'M')+Viz.r1(X(k))+','+Viz.r1(Y(b.p50));}).join(' ')+'"/>';
    if(R.goal>0){
      s+='<line class="goal" x1="'+mg.l+'" x2="'+(W-mg.r)+'" y1="'+Y(R.goal)+'" y2="'+Y(R.goal)+'"/><text class="goal-t" x="'+(mg.l+6)+'" y="'+(Y(R.goal)-6)+'">GOAL '+K(R.goal)+'</text>';
      if(m.goalHit!=null) s+='<circle class="goal-d" cx="'+X(m.goalHit)+'" cy="'+Y(R.goal)+'" r="5"/>';
    }
    R.planned.forEach(function(p,k){if(p>0) s+='<rect class="pl-m" x="'+(X(k+1)-4)+'" y="'+(mg.t+ph-4)+'" width="8" height="8" transform="rotate(45 '+X(k+1)+' '+(mg.t+ph)+')" data-tip="'+esc(R.cycles[k].label+' cycle\nPlanned '+fmt(p))+'"/>';});
    var endv=m.bands[n].p50;
    s+='<circle class="fan-d" cx="'+X(n)+'" cy="'+Y(endv)+'" r="4"/><text class="fan-t" x="'+(X(n)-8)+'" y="'+(Y(endv)-10)+'" text-anchor="end">'+esc(K(endv))+'</text>';
    var every=Math.max(1,Math.ceil(n/(narrow?6:12)));
    for(var k=0;k<=n;k+=every) s+='<text class="tick" x="'+X(k)+'" y="'+(H-8)+'" text-anchor="middle">'+(k===0?'Now':esc(R.cycles[k-1].label))+'</text>';
    s+='<line class="xh" id="fc-xh" x1="0" x2="0" y1="'+mg.t+'" y2="'+(mg.t+ph)+'" visibility="hidden"/><rect class="hit" id="fc-hit" x="'+mg.l+'" y="'+mg.t+'" width="'+pw+'" height="'+ph+'"/></svg>';
    el.innerHTML=s;
    $('#fc-leg').innerHTML='<span><i class="sw ln cum"></i>'+esc(SCEN[R.scen].label)+', typical</span><span><i class="sw fan-i"></i>Middle half of outcomes</span><span><i class="sw fan-o"></i>80% of outcomes</span><span><i class="sw ln prev"></i>'+esc(SCEN[R.altName].label)+', typical</span>'+(R.goal>0?'<span><i class="sw ln goal"></i>Goal</span>':'')+(R.planned.some(function(p){return p>0;})?'<span><i class="sw ev"></i>Planned expense</span>':'');
    var hit=$('#fc-hit'),xh=$('#fc-xh');
    function at(ev){
      var r=hit.getBoundingClientRect(),k=Math.max(0,Math.min(n,Math.round((ev.clientX-r.left)/r.width*n)));
      xh.setAttribute('x1',X(k));xh.setAttribute('x2',X(k));xh.setAttribute('visibility','visible');
      var b=m.bands[k],ab=a.bands[k];
      var h='<div class="tt-h">'+(k===0?'Now':esc(R.cycles[k-1].label+' '+new Date(R.cycles[k-1].start*DAY).getUTCFullYear()+' cycle'))+'<span>'+(k?'CYCLE '+k:'TODAY')+'</span></div><dl class="tt-g">'+
        '<dt><i class="sw ln cum"></i>Typical</dt><dd>'+esc(fmt(b.p50))+'</dd><dt>Likely range</dt><dd>'+esc(K(b.p25)+' – '+K(b.p75))+'</dd><dt>80% range</dt><dd>'+esc(K(b.p10)+' – '+K(b.p90))+'</dd>'+
        '<dt><i class="sw ln prev"></i>'+esc(SCEN[R.altName].label)+'</dt><dd>'+esc(fmt(ab.p50))+'</dd>'+
        (k&&R.planned[k-1]?'<dt>Planned that cycle</dt><dd>'+esc(fmt(R.planned[k-1]))+'</dd>':'')+'</dl>';
      ui.showTip(h,ev.clientX,ev.clientY);
    }
    hit.addEventListener('pointermove',at);hit.addEventListener('pointerdown',at);
    hit.addEventListener('pointerleave',function(){xh.setAttribute('visibility','hidden');ui.hideTip();});
  }
  function drawHist(){
    var el=$('#fc-hist');if(!el) return;
    var v=R.main.next;if(!v.length) return;
    var W=Math.max(240,el.clientWidth),H=190,mg={l:10,r:10,t:22,b:24},pw=W-mg.l-mg.r,ph=H-mg.t-mg.b;
    var lo=q(v,0.01),hi=q(v,0.99);if(hi<=lo) hi=lo+1;
    var nb=24,bw=(hi-lo)/nb,bins=new Array(nb).fill(0);
    v.forEach(function(x){var i=Math.floor((x-lo)/bw);if(i>=0&&i<nb) bins[i]++;});
    var mx=Math.max.apply(null,bins);
    function X(x){return mg.l+(x-lo)/(hi-lo)*pw;}
    var s='<svg viewBox="0 0 '+W+' '+H+'" width="'+W+'" height="'+H+'" role="img" aria-label="Distribution of next cycle saving">';
    var slot=pw/nb;
    bins.forEach(function(c,i){
      var x0=lo+i*bw,h=c/mx*ph,neg=x0+bw<=0;
      s+=Viz.bar(mg.l+i*slot+1,mg.t+ph,Math.max(1,slot-2),c?Math.max(2,h):0,neg?'hb neg':'hb','')+'<rect x="'+(mg.l+i*slot)+'" y="'+mg.t+'" width="'+slot+'" height="'+ph+'" fill="transparent" data-tip="'+esc(K(x0)+' to '+K(x0+bw)+'\n'+(c/v.length*100).toFixed(1)+'% of futures')+'"/>';
    });
    s+='<line class="axis" x1="'+mg.l+'" x2="'+(W-mg.r)+'" y1="'+(mg.t+ph)+'" y2="'+(mg.t+ph)+'"/>';
    [['P10',0.1],['P50',0.5],['P90',0.9]].forEach(function(p){var x=X(q(v,p[1]));s+='<line class="pm" x1="'+x+'" x2="'+x+'" y1="'+(mg.t-4)+'" y2="'+(mg.t+ph)+'"/><text class="pm-t" x="'+x+'" y="'+(mg.t-8)+'" text-anchor="middle">'+p[0]+' '+K(q(v,p[1]))+'</text>';});
    if(lo<0&&hi>0) s+='<line class="zero" x1="'+X(0)+'" x2="'+X(0)+'" y1="'+mg.t+'" y2="'+(mg.t+ph)+'"/>';
    s+='<text class="tick" x="'+mg.l+'" y="'+(H-6)+'">'+K(lo)+'</text><text class="tick" x="'+(W-mg.r)+'" y="'+(H-6)+'" text-anchor="end">'+K(hi)+'</text></svg>';
    el.innerHTML=s;
    var neg=R.main.neg;
    $('#fc-risk').innerHTML=neg>0.005?'<span class="st '+(neg>0.2?'warning':'info')+'"><b>!</b>'+Math.round(neg*100)+'% chance of spending more than you earn</span>':'<span class="st good"><b>✓</b>Saves money in '+Math.round((1-neg)*100)+'% of simulated cycles</span>';
  }
  function drawWater(){
    var el=$('#fc-water');if(!el) return;
    var p=R.main.parts,f=R.fixed;
    var steps=[['Pay',R.inc,'c1',1],['Mama',-f.family,'c4'],['Touheed',-f.touheed,'c2'],['Bills',-f.bills,'c3'],['Food',-p[0],'c1'],['Getting around',-p[1],'c2'],['Personal',-p[2],'c5'],['One-offs',-p[3],'c7']];
    if(f.other) steps.push(['Other fixed',-f.other,'cn']);
    if(R.planned[0]) steps.push(['Planned',-R.planned[0],'c8']);
    var save=steps.reduce(function(s,x){return s+x[1];},0);
    var W=Math.max(280,el.clientWidth),rowH=24,mg={l:104,r:70},H=(steps.length+1)*rowH+8,pw=W-mg.l-mg.r;
    var mx=R.inc||1;
    function X(v){return mg.l+Math.max(0,Math.min(1,v/mx))*pw;}
    var s='<svg viewBox="0 0 '+W+' '+H+'" width="'+W+'" height="'+H+'" role="img" aria-label="Next cycle: pay minus each cost">';
    var run=0;
    steps.forEach(function(st,i){
      var y=i*rowH+4,a=run,b=run+st[1];run=b;
      var x0=X(Math.min(a,b)),x1=X(Math.max(a,b));
      s+='<text class="wf-l" x="'+(mg.l-8)+'" y="'+(y+15)+'" text-anchor="end">'+esc(st[0])+'</text>';
      s+='<rect class="wf-b '+st[2]+(st[3]?' inc':'')+'" x="'+x0+'" y="'+(y+4)+'" width="'+Math.max(1,x1-x0)+'" height="'+(rowH-8)+'" rx="2" data-tip="'+esc(st[0]+'\n'+fmtS(st[1]))+'"/>';
      if(i<steps.length-1) s+='<line class="wf-c" x1="'+X(b)+'" x2="'+X(b)+'" y1="'+(y+rowH-4)+'" y2="'+(y+rowH+4)+'"/>';
      s+='<text class="wf-v" x="'+(W-mg.r+6)+'" y="'+(y+15)+'">'+(st[1]>0?'':'−')+esc(K(Math.abs(st[1])))+'</text>';
    });
    var y=steps.length*rowH+4;
    s+='<text class="wf-l tot" x="'+(mg.l-8)+'" y="'+(y+15)+'" text-anchor="end">Saving</text><rect class="wf-b save'+(save<0?' neg':'')+'" x="'+X(Math.min(0,save))+'" y="'+(y+4)+'" width="'+Math.max(1,Math.abs(X(save)-X(0)))+'" height="'+(rowH-8)+'" rx="2"/>'+
      '<text class="wf-v tot" x="'+(W-mg.r+6)+'" y="'+(y+15)+'">'+esc((save<0?'−':'')+K(Math.abs(save)))+'</text></svg>';
    el.innerHTML=s;
  }
  function drawBacktest(){
    var el=$('#fc-btest');if(!el) return;
    BT=backtest(CUR_M);
    if(!BT.length){el.innerHTML='<div class="empty">Needs a few finished cycles with history before them.</div>';return;}
    var mx=Math.max.apply(null,BT.map(function(b){return Math.max(b.p90,b.actual);}).concat([1]));
    var inside=BT.filter(function(b){return b.inside;}).length;
    var err=BT.reduce(function(s,b){return s+Math.abs(b.p50-b.actual)/Math.max(1,b.actual);},0)/BT.length;
    $('#fc-bt-m').textContent=inside+' of '+BT.length+' inside the 80% range · typical off by '+Math.round(err*100)+'%';
    el.innerHTML='<ul class="bt">'+BT.map(function(b){
      var l=b.p10/mx*100,w=(b.p90-b.p10)/mx*100;
      return '<li data-tip="'+esc(b.name+'\nForecast '+fmt(b.p50)+' (80%: '+K(b.p10)+'–'+K(b.p90)+')\nActual '+fmt(b.actual))+'"><span class="bt-l">'+esc(b.label)+'</span><span class="bt-t"><i class="r" style="left:'+l+'%;width:'+Math.max(0.5,w)+'%"></i><i class="m" style="left:'+(b.p50/mx*100)+'%"></i><i class="a'+(b.inside?'':' out')+'" style="left:'+(b.actual/mx*100)+'%"></i></span><span class="bt-v">'+esc(K(b.actual))+'</span></li>';
    }).join('')+'</ul><div class="legend sm"><span><i class="sw fan-i"></i>Forecast 80% range</span><span><i class="sw bt-mk"></i>Forecast typical</span><span><i class="sw bt-ak"></i>What you actually spent</span></div>'+
      '<p class="fc-note">Each finished cycle was forecast using only the days before it, then compared with what really happened (everyday spending and one-offs; fixed costs excluded).</p>';
  }

  // ---------------------------------------------------------------- plan dialog
  function openPlan(focusUp){
    var M=CUR_M;if(!M||!R) return;
    var plan=parsePlan(L.S.planRows)||{upcoming:[]};
    var d=$('#plan-dlg'),b=$('#plan-body');
    var keys=[R.curKey].concat(R.cycles.slice(0,6).map(function(c){return c.key;}));
    var opt=function(sel){return keys.map(function(k,i){return '<option value="'+k+'"'+(k===sel?' selected':'')+'>'+(i===0?ymLabel(k)+' (this cycle)':ymLabel(k))+'</option>';}).join('')+(sel&&keys.indexOf(sel)<0?'<option value="'+esc(sel)+'" selected>'+esc(sel)+'</option>':'');};
    function num(id,label,v,hint,sug){return '<label class="pf"><span>'+esc(label)+'</span><span class="pf-in"><i>Rs</i><input id="'+id+'" inputmode="numeric" autocomplete="off" value="'+(isFinite(v)&&v!==''&&v!=null?Math.round(v):'')+'" placeholder="'+(sug!=null?Math.round(sug):'0')+'"></span>'+(hint?'<small>'+hint+'</small>':'')+'</label>';}
    var up=plan.upcoming.length?plan.upcoming:[];
    b.innerHTML='<div class="pf-sec">Income</div><div class="pf-g">'+
      num('pl-min','Minimum pay',plan.minPay,'Your guaranteed pay. Update it when you get a raise.')+
      num('pl-extra','Usual extra pay',plan.extra,'Typical overtime and attendance bonus per cycle. Leave 0 to plan on the minimum only.')+'</div>'+
      '<div class="pf-sec">Fixed every cycle</div><div class="pf-g">'+
      num('pl-fam','Family support (Mama)',plan.family!=null&&isFinite(plan.family)?plan.family:35000,'')+
      num('pl-tou','Touheed: transport + advances',plan.touheed,'Suggested <button type="button" class="lnk" data-sug="pl-tou" data-v="'+R.sug.touheed+'">'+esc(fmt(R.sug.touheed))+'</button> from your last four cycles, loans netted.',R.sug.touheed)+
      num('pl-oth','Other fixed costs',plan.otherFixed,'Anything else every cycle that is not in the sheet yet.')+'</div>'+
      '<div class="pf-sec">Savings</div><div class="pf-g">'+
      num('pl-bal','Savings balance today',plan.balance,'Suggested <button type="button" class="lnk" data-sug="pl-bal" data-v="'+Math.round(R.sug.balance)+'">'+esc(fmt(R.sug.balance))+'</button>: all your Pay myself rows.',R.sug.balance)+
      num('pl-goal','Savings goal',plan.goal,'')+
      '<label class="pf"><span>Goal date</span><span class="pf-in"><input id="pl-gd" type="date" value="'+esc(plan.goalDate||'')+'"></span></label></div>'+
      '<div class="pf-sec" id="pl-up-h">Upcoming expenses</div><div id="pl-up">'+up.map(function(u){return upRow(u,opt);}).join('')+'</div>'+
      '<button type="button" class="btn" data-up-add>+ Add an expense</button>';
    b._opt=opt;
    d.showModal();
    $('#plan-hint').textContent='Saved to the Plan tab of your sheet'+(L.S.planMissing?' (it will be created).':'.');
    $('#plan-hint').classList.remove('bad');
    setTimeout(function(){var t=focusUp?$('#pl-up-h'):$('#pl-min');if(t){if(focusUp) t.scrollIntoView({block:'start'});else if(!$('#pl-min').value) t.focus();}},40);
  }
  function upRow(u,opt){
    u=u||{};
    return '<div class="up-row"><select aria-label="Month">'+opt(u.month)+'</select><input class="up-item" placeholder="What" value="'+esc(u.item||'')+'" aria-label="Item"><span class="pf-in"><i>Rs</i><input class="up-amt" inputmode="numeric" placeholder="0" value="'+(u.amount?Math.round(u.amount):'')+'" aria-label="Amount"></span><button type="button" class="x" data-up-del aria-label="Remove">×</button></div>';
  }
  function readPlanForm(){
    function n(id){var v=$('#'+id).value.trim();if(v==='') return '';var x=Logic.num(v);return isNaN(x)?'':x;}
    var p={minPay:n('pl-min'),extra:n('pl-extra'),family:n('pl-fam'),touheed:n('pl-tou'),otherFixed:n('pl-oth'),balance:n('pl-bal'),goal:n('pl-goal'),goalDate:$('#pl-gd').value,upcoming:[]};
    $$('#pl-up .up-row').forEach(function(r){
      var amt=Logic.num($('.up-amt',r).value),item=$('.up-item',r).value.trim();
      if(!isNaN(amt)&&amt>0) p.upcoming.push({month:$('select',r).value,item:item||'Expense',amount:amt});
    });
    return p;
  }
  var saving=false;
  function savePlan(){
    if(saving) return;
    var p=readPlanForm();
    if(p.minPay===''){$('#plan-hint').textContent='Enter your minimum pay first.';$('#plan-hint').classList.add('bad');$('#pl-min').focus();return;}
    saving=true;var btn=$('#plan-save');btn.disabled=true;btn.textContent='Saving…';
    (L.hasToken()?Promise.resolve():L.signIn()).then(function(){return L.savePlan(planRows(p));}).then(function(){
      saving=false;btn.disabled=false;btn.textContent='Save plan';
      $('#plan-dlg').close();
    }).catch(function(e){
      saving=false;btn.disabled=false;btn.textContent='Save plan';
      $('#plan-hint').textContent=L.errMsg(e);$('#plan-hint').classList.add('bad');
    });
  }

  document.addEventListener('click',function(e){
    var t=e.target.closest?e.target.closest('button'):null;
    if(!t) return;
    if(t.hasAttribute('data-fc-scen')){UIS.scen=t.getAttribute('data-fc-scen');saveUIS();window.LedgerUI.rerender();return;}
    if(t.hasAttribute('data-fc-h')){UIS.horizon=+t.getAttribute('data-fc-h');saveUIS();window.LedgerUI.rerender();return;}
    if(t.hasAttribute('data-fc-plan')){openPlan(t.getAttribute('data-fc-plan')==='up');return;}
    if(t.hasAttribute('data-sug')){$('#'+t.getAttribute('data-sug')).value=t.getAttribute('data-v');return;}
    if(t.hasAttribute('data-up-add')){var box=$('#pl-up');box.insertAdjacentHTML('beforeend',upRow({month:R.cycles[0].key},$('#plan-body')._opt));var rows=$$('.up-row',box);$('.up-item',rows[rows.length-1]).focus();return;}
    if(t.hasAttribute('data-up-del')){t.closest('.up-row').remove();return;}
    if(t.id==='plan-save'){savePlan();return;}
  });
  document.addEventListener('DOMContentLoaded',function(){
    var d=document.getElementById('plan-dlg');
    if(d) d.addEventListener('click',function(e){if(e.target===d) d.close();});
  });

  return {view:view,draw:draw,openPlan:openPlan,_analyse:analyse,_parsePlan:parsePlan,_planRows:planRows,_backtest:backtest,_bucket:bucket};
})();
