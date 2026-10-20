/* Forecast: will this month's Pay myself stay untouched until payday?

   Pay myself is the savings set aside on payday. Column G's Remaining is what is
   left after it, so the question is whether the days until the latest possible
   payday (the 20th of next month) can be paid for out of Remaining, after the
   bills still due, without dipping into Pay myself.

   Spending until payday is simulated from your own history:
   - everyday spending (food, getting around, personal) by a moving-block bootstrap:
     random 7-day stretches of your past days, recent weeks weighted more (half-life
     60 days), stretches with nothing logged skipped;
   - one-off buys of Rs 3,000 or more as a compound Poisson process (how often and
     how big, both from history).
   Touheed, Mama, savings, transfers and renovation are not part of this spending. */
var Forecast=(function(){
  var L=window.Ledger,esc=L.esc,fmt=L.fmt,fmtS=L.fmtS,K=Viz.kfmt,DAY=Logic.DAY,MON=Logic.MON;
  function $(s,r){return (r||document).querySelector(s);}
  var LUMP=3000,HL=60,SIMS=4000;
  var TOUHEED=/tou?heed|tohid/;

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
  function prep(H){
    var cum=[],c=0;H.blocks.forEach(function(b){c+=b.w;cum.push(c);});
    var lc=[],lt=0;H.lumps.forEach(function(l){lt+=l.w;lc.push(lt);});
    return {bl:H.blocks,cum:cum,tot:c,lumps:H.lumps,lc:lc,lt:lt,rate:H.rate};
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


  // ---------------------------------------------------------------- this month
  function fmtDay(n){var d=new Date(n*DAY);return d.getUTCDate()+' '+MON[d.getUTCMonth()];}
  function r100(x){return Math.round(x/100)*100;}
  function month(M){
    var cyc=Logic.cyclePeriods(M.parsed,M.today);
    if(!cyc.length) return {msg:'No payday cycles in the Tracking tab yet.'};
    var i=cyc.length-1,cur=cyc[i];
    var saved=cur.tx.filter(function(t){return t.cat==='savings';}).reduce(function(s,t){return s+t.amt;},0);
    if(!(saved>0)) return {cur:cur,msg:'Add a Pay myself row to '+cur.name+' and this tab will tell you whether you can keep it untouched until payday.'};
    if(!cur.bal) return {cur:cur,msg:'This needs the Remaining row in column G of '+cur.name+'.'};
    var sub=Logic.subscriptions(cyc,i);
    var fb=Logic.foodBudget(cur,cur.bal,sub,M.today);
    if(!fb||fb.days<1) return {cur:cur,msg:'Payday has passed. Add the new month to the sheet to see its forecast.'};
    var H=history(M);
    if(!H) return {cur:cur,msg:'Not enough history yet: the forecast needs about three weeks of entries.'};
    var days=fb.days,avail=fb.remaining-fb.due;
    var P=prep(H),r=rng(cur.start*7919+M.all.length),out=[0,0,0,0];
    var food=[],other=[],tot=[];
    for(var s=0;s<SIMS;s++){var t=simVar(P,days,r,out);food.push(out[0]);other.push(out[1]+out[2]+out[3]);tot.push(t);}
    var asc=function(a,b){return a-b;};
    food.sort(asc);other.sort(asc);tot.sort(asc);
    var ok=0;for(var k=0;k<SIMS;k++) if(tot[k]<=avail) ok++;
    var foodNeed=r100(q(food,0.5));
    // when the money cannot cover usual food, food gets all of it and nothing is left over
    var foodAlloc=Math.min(foodNeed,Math.max(0,avail)),bufAlloc=Math.max(0,avail-foodAlloc);
    var dip=function(p){return Math.max(0,q(tot,p)-avail);};
    var dueBills=sub.rows.filter(function(x){return x.status==='due'&&(x.when==null||x.when<fb.payday);});
    return {cur:cur,saved:saved,fb:fb,days:days,avail:avail,dueBills:dueBills,p:ok/SIMS,
      foodNeed:foodNeed,food:foodAlloc,buffer:bufAlloc,otherUsual:r100(q(other,0.5)),spend:{p10:q(tot,0.1),p50:q(tot,0.5),p90:q(tot,0.9)},
      dip:{p10:dip(0.1),p50:dip(0.5),p90:dip(0.9)},cap:Math.max(0,avail)/days,usualDay:q(tot,0.5)/days,
      lastDay:fb.payday-1,histDays:H.N,lumpRate:H.rate};
  }

  var R=null;
  function view(M,ui){
    R=month(M);
    if(R.msg) return '<section class="pnl"><div class="pnl-b"><div class="empty">'+esc(R.msg)+'</div></div></section>';
    var p=R.p,lv=R.avail<=0?'critical':p>=0.75?'good':p>=0.45?'warning':'critical';
    var word=R.avail<=0?'Already touched':p>=0.75?'Likely untouched':p>=0.45?'Tight':'At risk';
    var icon={good:'\u2713',warning:'!',critical:'\u2715'}[lv];
    var until=fmtDay(R.lastDay);
    var lead=R.avail<=0
      ?'Bills still due already take more than what is left, so about '+fmt(-R.avail)+' would have to come out of your Pay myself.'
      :'You have '+fmt(R.avail)+' to spend over the next '+R.days+(R.days===1?' day':' days')+' (today to '+until+'). Based on how you usually spend, there is a '+Math.round(p*100)+'% chance that is enough.'+
        (R.dip.p50>0?' Spending as usual (about '+fmt(R.spend.p50)+') would take about '+fmt(r100(R.dip.p50))+' out of your Pay myself.':'');
    var bar='';
    if(R.avail>0){
      var bpct=R.buffer/R.avail*100,fpct=R.food/R.avail*100;
      bar='<div class="m-bar"><i class="f" style="width:'+fpct.toFixed(1)+'%"></i>'+(bpct>0?'<i class="b" style="width:'+bpct.toFixed(1)+'%"></i>':'')+'</div>'+
        '<div class="legend sm"><span><i class="sw c1"></i>Food</span><span><i class="sw m-b"></i>Everything else</span></div>';
    }
    var diff=R.buffer-R.otherUsual,short=R.food<R.foodNeed;
    var foodNote=short
      ?'Your usual food over '+R.days+' days is about '+fmt(R.foodNeed)+', more than you have, so food gets all of it.'
      :'What you usually spend on food over '+R.days+' days. Keep food to this.';
    var bufNote=R.buffer<=0?'Nothing is left for anything else. You usually spend about '+fmt(R.otherUsual)+' on other things in '+R.days+' days.':diff>=0
      ?'You usually spend about '+fmt(R.otherUsual)+' on other things in '+R.days+' days, so this leaves about '+fmt(diff)+' spare.'
      :'You usually spend about '+fmt(R.otherUsual)+' on other things in '+R.days+' days. Keep it to '+fmt(R.buffer)+', about '+fmt(-diff)+' less than usual.';
    // where the likely spend sits against the money available
    var s=R.spend,mx=Math.max(s.p90,R.avail,1)*1.08,X=function(v){return Math.max(0,Math.min(100,v/mx*100));};
    var range='<div class="m-range"><div class="m-track"><i class="m-r" style="left:'+X(s.p10)+'%;width:'+(X(s.p90)-X(s.p10))+'%"></i><i class="m-m" style="left:'+X(s.p50)+'%"></i>'+
      (R.avail>0?'<i class="m-a" style="left:'+X(R.avail)+'%"><span>You have '+esc(K(R.avail))+'</span></i>':'')+'</div>'+
      '<div class="m-scale"><span>0</span><span>'+esc(K(mx))+'</span></div></div>';
    var bills=R.dueBills.length?R.dueBills.map(function(b){return esc(b.label)+(b.when!=null?' ('+esc(fmtDay(b.when))+')':'');}).join(', '):'none';
    return '<div class="month">'+
      '<section class="pnl m-hero m-'+lv+'"><div class="pnl-b">'+
        '<div class="m-q">Will your Pay myself of <b>'+esc(fmt(R.saved))+'</b> stay untouched until '+esc(until)+'?</div>'+
        '<div class="m-v"><span class="m-pill"><b>'+icon+'</b>'+esc(word)+'</span>'+(R.avail>0?'<span class="m-pct">'+Math.round(p*100)+'<small>% chance</small></span>':'')+'</div>'+
        '<p class="m-lead">'+esc(lead)+'</p>'+
      '</div></section>'+
      (R.avail>0?
      '<div class="m-split">'+
        '<section class="pnl m-tile"><div class="pnl-b"><div class="m-k"><i class="sw c1"></i>Food</div><div class="m-big">'+esc(fmt(R.food))+'</div>'+
          '<div class="m-day">'+esc(fmt(R.food/R.days))+' a day</div><p class="'+(short?'warn':'')+'">'+esc(foodNote)+'</p></div></section>'+
        '<section class="pnl m-tile"><div class="pnl-b"><div class="m-k"><i class="sw m-b"></i>Everything else</div><div class="m-big'+(R.buffer<=0?' neg':'')+'">'+esc(fmt(R.buffer))+'</div>'+
          '<div class="m-day">'+(R.buffer>0?esc(fmt(R.buffer/R.days))+' a day':'nothing left')+'</div><p class="'+(diff<0?'warn':'')+'">'+esc(bufNote)+'</p></div></section>'+
      '</div>':'')+
      '<div class="m-stats">'+
        '<div><span>Daily limit</span><b>'+esc(fmt(R.cap))+'<small> /day</small></b></div>'+
        '<div><span>You usually spend</span><b class="'+(R.usualDay>R.cap?'neg':'')+'">'+esc(fmt(R.usualDay))+'<small> /day</small></b></div>'+
        (R.dip.p50>0
          ?'<div><span>Likely taken from Pay myself</span><b class="neg">'+esc(fmt(r100(R.dip.p50)))+'</b></div>'
          :'<div><span>Likely left at payday</span><b>'+esc(fmt(r100(R.avail-R.spend.p50)))+'</b></div>')+
      '</div>'+
      ui.pnl('m-money','Money until payday',esc(R.cur.name)+' \u00b7 column G',
        '<dl class="ledger">'+
          '<div><dt>Remaining after Pay myself</dt><dd>'+esc(fmtS(R.fb.remaining))+'</dd></div>'+
          '<div><dt>Bills still due before payday</dt><dd>\u2212'+esc(fmt(R.fb.due))+'</dd></div>'+
          '<div class="tot"><dt>To spend until '+esc(until)+'</dt><dd>'+esc(fmtS(R.avail))+'</dd></div>'+
          '<div><dt>Days, today to '+esc(until)+'</dt><dd>'+R.days+'</dd></div></dl>'+bar+
        '<p class="fc-note">Bills due: '+bills+'.</p>',{cls:''})+
      ui.pnl('m-spend','Your likely spending until payday','',
        '<p class="m-s">Most likely <b>'+esc(fmt(s.p50))+'</b>, usually between '+esc(fmt(s.p10))+' and '+esc(fmt(s.p90))+'.</p>'+range+
        '<div class="legend sm"><span><i class="sw m-rs"></i>Likely range (8 in 10 months)</span><span><i class="sw m-ms"></i>Most likely</span><span><i class="sw m-as"></i>Money you have</span></div>',{cls:''})+
      '<details class="notes"><summary>How this is worked out</summary>'+
        '<p>Remaining comes from column G of '+esc(R.cur.name)+', which already has your Pay myself set aside. Bills still due before payday (Claude, internet, YouTube, Amazon, foodpanda) are taken off. Payday is taken as the 20th, the latest you usually get paid.</p>'+
        '<p>Your spending is replayed from your own last '+R.histDays+' days: random week-long stretches stitched together, recent weeks counting more, '+SIMS.toLocaleString('en-US')+' times. One-off buys of Rs 3,000 or more (about '+(R.lumpRate*30).toFixed(1)+' a month lately) are added separately. The chance is how many of those replays fit in the money you have.</p>'+
        '<p>Not counted here: Touheed\u2019s fee and loans, money for Mama, renovation and transfers. If you pay any of these before payday, they come out of the same money.</p></details>'+
    '</div>';
  }
  function draw(){}

  return {view:view,draw:draw,_month:month,_bucket:bucket};
})();
