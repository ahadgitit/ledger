/* Forecast: can this month's Pay myself stay untouched until payday?

   A small budget for the rest of the current payday cycle (today until the 20th of
   next month, the latest payday). Column G's Remaining is the money there is, Pay
   myself already set aside. From it come:
   - bills and subscriptions still to pay (amounts editable, defaults from the sheet);
   - monthly essentials (laundry, grooming and any you add), predicted from
     past months and editable;
   - InDrive, at your low, average or high rate from past months;
   - and either a shopping cap, leaving the food budget, or a food cap, leaving the
     shopping budget. The cap is yours to set; there is no default.
   Advances to Touheed or Mama come out of Pay myself, not this budget, and come back
   at the next payday, when that much less is owed.
   Inputs are kept in this browser. */
var Forecast=(function(){
  var L=window.Ledger,esc=L.esc,fmt=L.fmt,fmtS=L.fmtS,K=Viz.kfmt,DAY=Logic.DAY,MON=Logic.MON;
  function $(s,r){return (r||document).querySelector(s);}
  function $$(s,r){return Array.prototype.slice.call((r||document).querySelectorAll(s));}
  var KEY='ledger.forecast.v3';
  var PEOPLE=[{key:'touheed',label:'Touheed',what:'transport fee',fee:27000},{key:'mama',label:'Mama',what:'groceries',fee:35000}];
  var RIDE_LV=[{k:'low',t:'Low'},{k:'avg',t:'Average'},{k:'high',t:'High'}];
  var ESS=[
    {k:'laundry',t:'Laundry',re:/laund|laubdry|dry ?clean/},
    {k:'groom',t:'Grooming and toiletries',re:/razor|blade|gill?ett?e|gellete|shav|groom|deod|shampoo|haircut|body ?wash|tooth|oral ?max/}
  ];
  var BILL_RE=/claude|internet|amazon|youtube|netflix|subscri/;

  // ---------------------------------------------------------------- saved inputs
  var st=null;
  function load(){
    if(st) return st;
    try{st=JSON.parse(localStorage.getItem(KEY)||'null');}catch(e){st=null;}
    if(!st||typeof st!=='object') st={};
    st.bills=st.bills||{};st.adv=st.adv||{};st.fees=st.fees||{};st.ess=st.ess||{};
    return st;
  }
  function save(){try{localStorage.setItem(KEY,JSON.stringify(st));}catch(e){}}
  // a typed amount; null when the box is empty
  function amt(v){if(String(v==null?'':v).trim()==='') return null;var n=Logic.num(v);return n==null||!isFinite(n)?null:Math.max(0,Math.round(n));}
  function r100(x){return Math.round(x/100)*100;}
  function fmtDay(n){var d=new Date(n*DAY);return d.getUTCDate()+' '+MON[d.getUTCMonth()];}
  function mean(a){return a.length?a.reduce(function(s,x){return s+x;},0)/a.length:0;}

  // ---------------------------------------------------------------- history
  // What each closed cycle spent on food, shopping, InDrive and each essential.
  function history(cyc,rides){
    var out=[];
    for(var i=Math.max(0,cyc.length-7);i<cyc.length-1;i++){
      var c=cyc[i],len=cyc[i+1].start-c.start;
      if(len<14) continue;
      var h={name:c.name,len:len,food:0,shop:0,untracked:0,ride:rides[i].total,ess:{},lumps:[]};
      ESS.forEach(function(e){h.ess[e.k]=0;});
      c.tx.forEach(function(t){
        if(!(t.amt>0)) return;
        var cat=t.cat,s=(t.name+' '+t.desc).toLowerCase();
        if(cat==='food'){h.food+=t.amt;return;}
        if(cat==='shopping'){h.shop+=t.amt;return;}
        if(cat==='untracked'){h.untracked+=t.amt;return;}
        // not everyday spending: savings, money moved, Touheed, Mama, renovation, bills, rides
        if(/^(savings|transfer|influx|loaned|family\/home|renovation)$/.test(cat)) return;
        if(/tou?heed|tohid|\bmama\b|advance pay|\btransport\b/.test(s)||BILL_RE.test(s)) return;
        if(/in\s*-?\s*drive/.test(s)||cat==='transport') return;
        var e=ESS.find(function(x){return x.re.test(s);});
        if(e) h.ess[e.k]+=t.amt;
        // one-off buys of 10,000 or more (an oven, a course), for the savings outlook
        else if(t.amt>=10000) h.lumps.push(t.amt);
      });
      // everyday spending the outlook scales month to month
      h.vari=h.food+h.shop+h.ride+ESS.reduce(function(a,e){return a+h.ess[e.k];},0);
      out.push(h);
    }
    return out;
  }
  function perDay(h,f){return mean(h.map(function(x){return f(x)/x.len;}));}
  // low / high: the average of the cheaper and of the dearer half of past months
  function rideLevels(h){
    var a=h.map(function(x){return x.ride/x.len;}).sort(function(x,y){return x-y;}),n=a.length,half=Math.max(1,Math.floor(n/2));
    return {low:mean(a.slice(0,half)),avg:mean(a),high:mean(a.slice(n-half))};
  }

  // ---------------------------------------------------------------- model
  function paydayAfter(p,today){
    var d=new Date(p.start*DAY),y=d.getUTCFullYear(),m=d.getUTCMonth()+1;
    var pay=Math.round(Date.UTC(y,m,Logic.PAYDAY_DOM)/DAY);
    while(pay<=today){m++;pay=Math.round(Date.UTC(y,m,Logic.PAYDAY_DOM)/DAY);}
    return pay;
  }
  function model(M){
    var cyc=Logic.cyclePeriods(M.parsed,M.today);
    if(!cyc.length) return {msg:'No payday cycles in the Tracking tab yet.'};
    var i=cyc.length-1,cur=cyc[i];
    if(!cur.bal) return {msg:'This needs the Remaining row in column G of '+cur.name+'.'};
    var pay=paydayAfter(cur,M.today),days=Math.max(1,pay-Math.max(M.today,cur.start));
    if(pay-cur.start>45) return {msg:'Payday has passed. Add the new month to the sheet to see its forecast.'};
    var s=load(),id=String(cur.start);
    var h=history(cyc,Logic.rides(cyc));
    if(!h.length) return {msg:'Not enough history yet: the forecast needs at least one full month of entries.'};
    var saved=cur.tx.filter(function(t){return t.cat==='savings';}).reduce(function(a,t){return a+t.amt;},0);
    var sub=Logic.subscriptions(cyc,i),bs=s.bills[id]||{};
    var bills=sub.rows.map(function(r){
      var o=bs[r.key]||{};
      return {key:r.key,label:r.label,paid:r.status==='paid',when:r.when,
        amt:o.amt!=null?o.amt:Math.round(r.amount),on:o.on!=null?o.on:r.status!=='paid'};
    });
    (bs._extra||[]).forEach(function(x,j){bills.push({key:'x'+j,label:x.label||'',extra:true,amt:x.amt||0,on:true});});
    var ess=ESS.map(function(e){
      var d=r100(perDay(h,function(x){return x.ess[e.k];})*days);
      return {key:e.k,label:e.t,def:d,amt:s.ess[e.k]!=null?s.ess[e.k]:d,
        months:h.filter(function(x){return x.ess[e.k]>0;}).length};
    });
    (s.essExtra||[]).forEach(function(x,j){ess.push({key:'x'+j,label:x.label||'',extra:true,amt:x.amt||0});});
    var past=cyc.map(function(c){
      return {day:c.start,full:c.name,label:c.name.slice(0,3),saved:c.tx.filter(function(t){return t.cat==='savings';}).reduce(function(a,t){return a+t.amt;},0)};
    }).filter(function(p){return p.saved>0;});
    var prevId=i>0?String(cyc[i-1].start):null;
    // food per day, for the daily chart and for what is already spent this cycle and today
    var fd={},fi={},logged={},today=M.today,soFar=0;
    M.all.forEach(function(t){
      if(t.day==null) return;
      logged[t.day]=true;
      if(t.cat==='food'&&t.amt>0){fd[t.day]=(fd[t.day]||0)+t.amt;(fi[t.day]=fi[t.day]||[]).push(t.name+' '+K(t.amt));}
    });
    for(var dd=cur.start;dd<=today;dd++) soFar+=fd[dd]||0;
    var food={byDay:fd,items:fi,logged:logged,today:fd[today]||0,soFar:soFar,passed:Math.max(0,today-cur.start),now:today};
    return {food:food,past:past,cur:cur,id:id,prev:i>0?cyc[i-1]:null,prevAdv:prevId?s.adv[prevId]||null:null,days:days,pay:pay,lastDay:pay-1,
      remaining:cur.bal.remaining,saved:saved,bills:bills,ess:ess,hist:h,lv:rideLevels(h),
      usual:{food:perDay(h,function(x){return x.food;}),shop:perDay(h,function(x){return x.shop;})}};
  }
  function inputs(R){
    var s=load();
    return {mode:s.mode==='shop'?'shop':'food',ride:s.ride||'avg',
      shopCap:s.shopCap!=null?s.shopCap:null,foodCap:s.foodCap!=null?s.foodCap:null,
      adv:s.adv[R.id]||{},fees:s.fees};
  }
  // the whole budget, from Remaining down to what food (or shopping) can use
  function compute(R,I){
    var bills=R.bills.reduce(function(a,b){return a+(b.on?b.amt:0);},0);
    var ess=R.ess.reduce(function(a,e){return a+(e.amt||0);},0);
    var ride=r100(R.lv[I.ride]*R.days);
    var advIn=0,adv=0;
    PEOPLE.forEach(function(p){var a=I.adv[p.key]||{};adv+=a.amt||0;if(a.logged) advIn+=a.amt||0;});
    // an advance already logged in the sheet lowered Remaining, but it is paid out of Pay myself
    var money=R.remaining+advIn,base=money-bills-ess-ride;
    var cap=I.mode==='food'?I.shopCap:I.foodCap,ft=R.food.today;
    // a food cap covers the days left, today included, and today's logged food is already out of Remaining
    var need=cap==null?null:I.mode==='food'?cap:Math.max(0,cap-ft);
    var left=need==null?null:base-need;
    var dayLimit=I.mode==='food'?(left==null?null:(left+ft)/R.days):(cap==null?null:cap/R.days);
    return {need:need,dayLimit:dayLimit,foodToday:ft,money:money,advIn:advIn,adv:adv,bills:bills,ess:ess,ride:ride,base:base,cap:cap,left:left,kept:R.saved-adv};
  }

  // ---------------------------------------------------------------- view
  var R=null;
  function money(v,cls,ph){
    return '<span class="fp-in'+(cls?' '+cls:'')+'"><span>Rs</span><input class="inline" inputmode="numeric" enterkeyhint="done" autocomplete="off" value="'+
      (v==null?'':esc(Math.round(v).toLocaleString('en-US')))+'"'+(ph?' placeholder="'+esc(ph)+'"':'')+'></span>';
  }
  function itemRow(kind,x,sub,check){
    return '<div class="fp-row'+(check&&!x.on?' off':'')+'" data-'+kind+'="'+esc(x.key)+'">'+
      (check?'<label class="fp-chk"><input type="checkbox"'+(x.on?' checked':'')+' aria-label="Still to pay"></label>':'')+
      '<div class="fp-name">'+(x.extra?'<input class="inline fp-lbl" value="'+esc(x.label)+'" placeholder="Name" aria-label="Name">':esc(x.label))+
        '<small>'+sub+'</small></div>'+money(x.amt)+(x.extra?'<button type="button" class="x fp-del" aria-label="Remove">&times;</button>':'')+'</div>';
  }
  // food per past month, with a line for the cap (or the predicted budget)
  function foodChart(){
    var h=R.hist,mx=Math.max.apply(null,h.map(function(x){return x.food;}).concat([1]))*1.18;
    var bars=h.map(function(x){
      var pct=x.food/mx*100,note=x.untracked>=3000?'\n'+fmt(x.untracked)+' logged as untracked that month, some of it food':'';
      return '<div class="fc-bar" data-tip="'+esc(x.name+'\nFood '+fmt(x.food)+'\n'+x.len+' days \u00b7 '+fmt(x.food/x.len)+' a day'+note)+'">'+
        '<span class="fc-v" style="bottom:'+pct.toFixed(1)+'%">'+esc(K(x.food))+'</span><i style="height:'+pct.toFixed(1)+'%"'+(note?' class="part"':'')+'></i></div>';
    }).join('');
    var axis=h.map(function(x){return '<span>'+esc(x.name.slice(0,3))+'<small>'+x.len+' days</small></span>';}).join('');
    return '<div class="fc-chart" id="fp-fchart" data-max="'+mx+'"><div class="fc-plot">'+bars+
      '<div class="fc-cap" id="fp-capline" hidden><span></span></div></div><div class="fc-axis">'+axis+'</div></div>'+
      '<div class="legend sm"><span><i class="sw c1"></i>Food each month</span><span><i class="sw fc-capsw"></i><span id="fp-capleg">Your cap</span></span></div>';
  }
  function view(M,ui){
    ui0=ui;
    R=model(M);
    if(R.msg) return '<section class="pnl"><div class="pnl-b"><div class="empty">'+esc(R.msg)+(/payday has passed/i.test(R.msg)?'<p><button type="button" class="btn primary" data-open-cycle>Start the new pay cycle</button></p>':'')+'</div></div></section>';
    var I=inputs(R),until=fmtDay(R.lastDay),foodMode=I.mode==='food',d=R.days;
    var usualFood=r100(R.usual.food*d),usualShop=r100(R.usual.shop*d);
    var bills=R.bills.map(function(b){
      return itemRow('bill',b,b.paid?'paid'+(b.when!=null?' '+esc(fmtDay(b.when)):'')+' · already out of Remaining':b.extra?'added by you':'due'+(b.when!=null?' '+esc(fmtDay(b.when)):''),true);
    }).join('');
    var ess=R.ess.map(function(e){
      return itemRow('ess',e,e.extra?'added by you':'usually '+esc(fmt(e.def))+(e.months<R.hist.length?' · in '+e.months+' of '+R.hist.length+' months':''));
    }).join('');
    var lv=R.lv,rideSeg='<div class="seg fp-seg" role="group" aria-label="InDrive estimate">'+RIDE_LV.map(function(x){
      return '<button type="button" data-ride="'+x.k+'" aria-pressed="'+(I.ride===x.k)+'">'+x.t+'<small>'+esc(fmt(r100(lv[x.k]*d)))+'</small></button>';}).join('')+'</div>';
    var rhist=R.hist.map(function(x){return '<span>'+esc(x.name.slice(0,3))+' <b>'+esc(fmt(x.ride))+'</b></span>';}).join('');
    var shist=R.hist.map(function(x){return '<span>'+esc(x.name.slice(0,3))+' <b>'+esc(fmt(x.shop))+'</b></span>';}).join('');
    var adv=PEOPLE.map(function(p){
      var a=I.adv[p.key]||{},fee=I.fees[p.key]!=null?I.fees[p.key]:p.fee;
      return '<div class="fp-adv" data-adv="'+p.key+'">'+
        '<div class="fp-name">'+esc(p.label)+'<small>'+esc(p.what)+'</small></div>'+
        '<div class="fld"><span class="lbl">Usual payment</span>'+money(fee,'fp-fee')+'</div>'+
        '<div class="fld"><span class="lbl">Advance this month</span>'+money(a.amt||0,'fp-amt')+'</div>'+
        '<label class="fp-logged"><input type="checkbox"'+(a.logged?' checked':'')+'> Already logged in the sheet</label>'+
        '<p class="fp-next" data-next="'+p.key+'"></p></div>';
    }).join('');
    var prev='';
    if(R.prevAdv){
      prev=PEOPLE.map(function(p){var a=R.prevAdv[p.key];if(!a||!a.amt) return '';
        var fee=I.fees[p.key]!=null?I.fees[p.key]:p.fee;
        return '<li>'+esc(p.label)+' got '+esc(fmt(a.amt))+' in advance in '+esc(R.prev.name)+', so this payday’s '+esc(p.what)+' was '+esc(fmt(Math.max(0,fee-a.amt)))+' instead of '+esc(fmt(fee))+'.</li>';}).join('');
      if(prev) prev='<ul class="fp-prev">'+prev+'</ul>';
    }
    var capBox=function(which,usual){
      var cap=I[which+'Cap'],food=which==='food';
      // the food cap can also be set as a daily limit until payday
      return '<div class="fp-cap'+(food?' fp-cap2':'')+'" data-cap="'+which+'"><div class="fld"><span class="lbl">'+(food?'Food':'Your shopping')+' cap until '+esc(until)+' <em>required</em></span>'+
        money(cap,'fp-total','Enter a cap')+'</div>'+
        (food?'<div class="fld"><span class="lbl">Or per day</span>'+money(cap==null?null:Math.round(cap/d),'fp-perday','Per day')+'</div>':'')+
        '<button type="button" class="btn sm fp-use" data-use="'+usual+'">Use my usual, '+esc(fmt(usual))+'</button>'+
        '<p class="fp-capd" data-capd="'+which+'"></p></div>';
    };
    var result=function(which){return '<div class="fp-pred"><span class="lbl">Predicted '+(which==='food'?'food':'shopping')+' budget</span><b id="fp-pred"></b><small id="fp-pred-d"></small></div>';};
    return '<div class="plan" id="fp">'+cycAsk(M)+cfPrompt()+
      '<section class="pnl m-hero fp-hero" id="fp-hero"><div class="pnl-b">'+
        '<div class="fp-top"><div class="m-q">Can your Pay myself of <b>'+esc(fmt(R.saved))+'</b> stay untouched until '+esc(until)+'?</div>'+
          '<div class="fp-mode"><span class="lbl">Predict</span><div class="seg" role="group" aria-label="What to predict"><button type="button" data-pmode="food" aria-pressed="'+foodMode+'">Food</button><button type="button" data-pmode="shop" aria-pressed="'+!foodMode+'">Shopping</button></div></div></div>'+
        '<div class="m-v"><span class="m-pill"><b id="fp-icon"></b><span id="fp-word"></span></span></div>'+
        '<div class="m-k" id="fp-ans-k"></div><div class="m-big" id="fp-ans"></div><div class="m-day" id="fp-ans-d"></div>'+
        '<p class="m-lead" id="fp-lead"></p>'+
        '<dl class="ledger fp-sum" id="fp-sum"></dl>'+
      '</div></section>'+
      ui.pnl('fp-daily','Food per day','what you spent each day against your daily limit','<div class="fd-stats" id="fd-stats"></div><div class="fd-chart" id="fd-chart"></div>'+
        '<div class="legend sm"><span><i class="sw c1"></i>Food spent</span><span><i class="sw fd-oversw"></i>Over the limit</span><span><i class="sw fd-limsw"></i>Daily limit</span><span><i class="sw fd-usesw"></i>Your usual</span></div>',
        {cls:'',tools:'<div class="seg sm" role="group" aria-label="Days shown"><button type="button" data-frange="cycle" aria-pressed="'+(load().frange!=='60')+'">This cycle</button><button type="button" data-frange="60" aria-pressed="'+(load().frange==='60')+'">Last 60 days</button></div>'})+
      // two columns that stack on their own, so a short card leaves no gap beside a tall one
      '<div class="fp-grid"><div class="fp-col">'+
      ui.pnl('fp-food','Food','what you spent each month',
        (foodMode?result('food'):capBox('food',usualFood))+foodChart()+
        '<p class="fc-note">You usually spend about '+esc(fmt(R.usual.food))+' a day on food, about '+esc(fmt(usualFood))+' over these '+d+' days. Lighter bars are months with untracked catch-up rows, so they were really higher.</p>',{cls:''})+
      ui.pnl('fp-bills','Bills and subscriptions','tick the ones still to pay',bills+
        '<div class="fp-foot"><button type="button" class="btn sm" data-add="bill">+ Add bill</button><span class="fp-tot">Still to pay <b id="fp-bills-t"></b></span></div>',{cls:''})+
      ui.pnl('fp-ride','InDrive','your rate from past months × '+d+' days',rideSeg+'<div class="fp-hist">'+rhist+'</div>'+
        '<p class="fc-note">Low and high are the averages of your cheaper and dearer months. Rides you already took this month are in Remaining.</p>',{cls:''})+
      '</div><div class="fp-col">'+
      ui.pnl('fp-shop','Shopping and outfits','clothes, perfume, gifts, gadgets',
        (foodMode?capBox('shop',usualShop):result('shop'))+
        '<div class="fp-hist">'+shist+'</div><p class="fc-note">About '+esc(fmt(usualShop))+' over '+d+' days, going by your past months.</p>',{cls:''})+
      ui.pnl('fp-ess','Monthly essentials','predicted from past months · edit any',ess+
        '<div class="fp-foot"><button type="button" class="btn sm" data-add="ess">+ Add expense</button><span class="fp-tot">Total <b id="fp-ess-t"></b></span></div>',{cls:''})+
      ui.pnl('fp-adv','Advance payments','paid from Pay myself, back next payday',prev+adv,{cls:''})+
      '</div></div>'+
      '<div class="fp-reset"><button type="button" class="btn ghost sm" id="fp-reset">Reset to defaults</button></div>'+
      '<details class="notes"><summary>How this is worked out</summary>'+
        '<p>Remaining comes from column G of '+esc(R.cur.name)+', with your Pay myself already set aside. Payday is taken as the 20th, the latest you usually get paid, so this covers '+d+' days, today to '+esc(until)+'.</p>'+
        '<p>Bills you tick, your monthly essentials and InDrive are taken off. Paid bills are already out of Remaining, so they start unticked. Essentials and InDrive start at your average per day over your last '+R.hist.length+' full months, times the days left.</p>'+
        '<p>Predict food: your shopping cap is taken off too, and what is left is for food. Predict shopping: your food cap is taken off, and what is left is for shopping.</p>'+
        '<p>An advance to Touheed or Mama is paid out of Pay myself, so it lowers what you keep this month but not this budget, and at the next payday you owe that much less. If you already logged it in the sheet, Remaining went down by it, so it is added back here.</p>'+
        '<p>What you enter here is kept in this browser.</p></details>'+
      cfView(M)+outlookView()+
    '</div>';
  }

  function draw(ui){
    UIref=ui||UIref;
    var root=$('#fp');if(!root||!R||R.msg) return;
    var s=load(),id=R.id;
    function bucket(){return s.bills[id]=s.bills[id]||{};}
    function adv(k){var a=s.adv[id]=s.adv[id]||{};return a[k]=a[k]||{};}
    function storeBill(b){
      var o=bucket();
      if(b.extra){var j=+b.key.slice(1);o._extra=o._extra||[];o._extra[j]={label:b.label,amt:b.amt};}
      else o[b.key]={amt:b.amt,on:b.on};
    }
    function storeEss(e){
      if(e.extra){var j=+e.key.slice(1);s.essExtra=s.essExtra||[];s.essExtra[j]={label:e.label,amt:e.amt};}
      else s.ess[e.key]=e.amt;
    }
    root.addEventListener('input',function(e){
      var t=e.target,o=t.closest('[data-out]'),pl=t.closest('[data-plan]');
      if(o){
        var ov=amt(t.value);
        if(o.dataset.out==='base') s.base=ov;
        else if(o.dataset.out==='next') s.next=ov==null?null:{id:id,amt:ov};
        else if(o.dataset.out==='shop') s.shopLimit=ov;
        else if(o.dataset.out==='lumplim') s.lumpLimit=ov;
        else if(o.dataset.out==='groom') s.groomAlt=t.checked;
        else s.lumps=t.checked;
        save();update();return;
      }
      if(pl){
        var P=s.planned[+pl.dataset.plan];
        if(t.classList.contains('ol-m')) P.ym=t.value;else if(t.classList.contains('fp-lbl')) P.label=t.value;else P.amt=amt(t.value)||0;
        save();update();return;
      }
      var row=t.closest('[data-bill],[data-ess],[data-cap],[data-adv]');
      if(!row) return;
      var v=amt(t.value),isLbl=t.classList.contains('fp-lbl');
      if(row.dataset.bill!=null){
        var b=R.bills.find(function(x){return x.key===row.dataset.bill;});
        if(isLbl) b.label=t.value;else if(t.type!=='checkbox') b.amt=v||0;
        storeBill(b);
      }else if(row.dataset.ess!=null){
        var x=R.ess.find(function(y){return y.key===row.dataset.ess;});
        if(isLbl) x.label=t.value;else x.amt=v||0;
        storeEss(x);
      }else if(row.dataset.cap){
        var other;
        if(t.closest('.fp-perday')){s.foodCap=v==null?null:v*R.days;other=$('.fp-total input',row);if(other) other.value=v==null?'':(v*R.days).toLocaleString('en-US');}
        else{s[row.dataset.cap+'Cap']=v;other=$('.fp-perday input',row);if(other) other.value=v==null?'':Math.round(v/R.days).toLocaleString('en-US');}
      }
      else{
        var a=adv(row.dataset.adv);
        if(t.type==='checkbox') a.logged=t.checked;
        else if(t.closest('.fp-fee')) s.fees[row.dataset.adv]=v||0;
        else a.amt=v||0;
      }
      save();update();
    });
    root.addEventListener('change',function(e){
      var t=e.target;
      if(t.type==='checkbox'&&t.closest('[data-bill]')){
        var b=R.bills.find(function(x){return x.key===t.closest('[data-bill]').dataset.bill;});
        b.on=t.checked;t.closest('.fp-row').classList.toggle('off',!b.on);storeBill(b);save();update();
      }
      // tidy the number once you leave the box
      if(t.matches('.fp-in input')){var v=amt(t.value);t.value=v==null?'':v.toLocaleString('en-US');}
    });
    root.addEventListener('click',function(e){
      var c=e.target.closest('[data-cf]'),sv=e.target.closest('[data-cf-save]');
      if(sv){saveIncome(sv);return;}
      if(c){s.cfSel=c.dataset.cf;save();drawCf();return;}
      var t=e.target.closest('button');if(!t) return;
      if(t.dataset.pmode){if(s.mode!==t.dataset.pmode){s.mode=t.dataset.pmode;save();rerender();}}
      else if(t.dataset.ride){s.ride=t.dataset.ride;save();$$('[data-ride]',root).forEach(function(x){x.setAttribute('aria-pressed',String(x===t));});update();}
      else if(t.dataset.use){
        var box=t.closest('[data-cap]'),inp=$('.fp-total input',box),pd=$('.fp-perday input',box),u=+t.dataset.use;
        inp.value=u.toLocaleString('en-US');if(pd) pd.value=Math.round(u/R.days).toLocaleString('en-US');
        s[box.dataset.cap+'Cap']=u;save();update();
      }
      else if(t.dataset.frange){s.frange=t.dataset.frange;save();$$('[data-frange]',root).forEach(function(x){x.setAttribute('aria-pressed',String(x===t));});update();}
      else if(t.dataset.level){s.level=t.dataset.level;save();$$('[data-level]',root).forEach(function(x){x.setAttribute('aria-pressed',String(x===t));});update();}
      else if(t.dataset.hz){s.hz=+t.dataset.hz;save();$$('[data-hz]',root).forEach(function(x){x.setAttribute('aria-pressed',String(x===t));});update();}
      else if(t.dataset.add==='plan'){var M=months(1);s.planned=(s.planned||[]).concat([{ym:M[0].ym,label:'',amt:0}]);save();rerender(function(){focusLast('.ol-plan .fp-lbl');});}
      else if(t.classList.contains('fp-del')&&t.closest('[data-plan]')){s.planned.splice(+t.closest('[data-plan]').dataset.plan,1);save();rerender();}
      else if(t.dataset.add==='bill'){var o=bucket();o._extra=(o._extra||[]).concat([{label:'',amt:0}]);save();rerender(function(){focusLast('[data-bill] .fp-lbl');});}
      else if(t.dataset.add==='ess'){s.essExtra=(s.essExtra||[]).concat([{label:'',amt:0}]);save();rerender(function(){focusLast('[data-ess] .fp-lbl');});}
      else if(t.classList.contains('fp-del')){
        var r=t.closest('[data-bill],[data-ess]'),k=r.dataset.bill!=null?r.dataset.bill:r.dataset.ess,j=+k.slice(1);
        if(r.dataset.bill!=null) bucket()._extra.splice(j,1);else s.essExtra.splice(j,1);
        save();rerender();
      }
      else if(t.id==='fp-reset'){
        if(!confirm('Reset bills, essentials, caps and the InDrive choice to the defaults? Advances stay.')) return;
        delete s.bills[id];s.ess={};delete s.essExtra;delete s.shopCap;delete s.foodCap;delete s.ride;save();rerender();
      }
    });
    root.addEventListener('keydown',function(e){
      var f=e.target.closest('[data-cf-month]');
      if(f&&e.key==='Enter'){e.preventDefault();saveIncome($('[data-cf-save]',f));}
    });
    update();
    drawCf();
  }
  function focusLast(sel){var l=$$('#fp '+sel);if(l.length) l[l.length-1].focus();}
  function rerender(then){
    var y=window.scrollY;if(window.LedgerUI) LedgerUI.rerender();window.scrollTo(0,y);if(then) then();
  }

  function update(){
    var I=inputs(R),C=compute(R,I),d=R.days,food=I.mode==='food';
    var what=food?'food':'shopping',capWhat=food?'shopping':'food';
    var lv,word,k,big,per,lead,usual=food?R.usual.food:R.usual.shop;
    if(C.left==null){
      lv='none';word='Set your '+capWhat+' cap';k='';big=null;per='';
      lead='Enter how much you will allow yourself for '+capWhat+' until '+fmtDay(R.lastDay)+', and this works out what is left for '+what+'.';
    }else{
      var pd=food?C.dayLimit:C.left/d;
      lv=C.left<=0?'critical':pd>=usual?'good':pd>=usual*0.6?'warning':'critical';
      word=C.left<=0?'Pay myself will be touched':lv==='good'?'Pay myself stays untouched':lv==='warning'?'Tight, but doable':'Too little left for '+what;
      k=C.left<=0?'Short by':'You can spend on '+what+' until '+fmtDay(R.lastDay);
      big=Math.abs(C.left);per=C.left>0?fmt(pd)+' a day':'nothing left for '+what;
      lead=C.left<=0
        ?'Your bills, essentials, InDrive and '+capWhat+' cap already come to '+fmt(-C.left)+' more than you have. That, and any '+what+', would come out of Pay myself. Lower a cap or an estimate to make room.'
        :lv==='good'?'Keep '+what+' under '+fmt(C.left)+' ('+fmt(pd)+' a day) and stick to your '+capWhat+' cap, and Pay myself stays untouched. You usually spend about '+fmt(usual)+' a day on '+what+'.'
        :'That is '+fmt(pd)+' a day for '+what+', less than the '+fmt(usual)+' a day you usually spend. Stay under it, or lower your '+capWhat+' cap, to keep Pay myself untouched.';
    }
    $('#fp-hero').className='pnl m-hero fp-hero m-'+lv;
    $('#fp-icon').textContent={good:'✓',warning:'!',critical:'✕',none:'?'}[lv];
    $('#fp-word').textContent=word;$('#fp-ans-k').textContent=k;
    var a=$('#fp-ans');a.textContent=big==null?'':fmt(big);a.classList.toggle('neg',C.left!=null&&C.left<=0);
    $('#fp-ans-d').textContent=per;$('#fp-lead').textContent=lead;
    var row=function(t,v,cls){return '<div'+(cls?' class="'+cls+'"':'')+'><dt>'+esc(t)+'</dt><dd>'+v+'</dd></div>';},neg=function(v){return '−'+esc(fmt(v));};
    $('#fp-sum').innerHTML=
      row('Remaining (column G)',esc(fmtS(R.remaining)))+
      (C.advIn?row('Advances already logged, paid from Pay myself','+'+esc(fmt(C.advIn))):'')+
      row('Bills still to pay',neg(C.bills))+
      row('Monthly essentials',neg(C.ess))+
      row('InDrive ('+{low:'low',avg:'average',high:'high'}[I.ride]+')',neg(C.ride))+
      (food||C.cap==null?row('Your '+capWhat+' cap',C.cap==null?'<span class="fp-miss">not set</span>':neg(C.cap))
        :row('Food: '+fmt(C.dayLimit)+' a day \u00d7 '+d+' days'+(C.foodToday?', less '+fmt(C.foodToday)+' already spent today':''),neg(C.need)))+
      row('Left for '+what,C.left==null?'–':esc(fmtS(C.left)),'tot'+(C.left!=null&&C.left<0?' neg':''))+
      row('Pay myself kept'+(C.adv?', after '+fmt(C.adv)+' in advances (back next payday)':''),esc(fmt(C.kept)));
    $('#fp-bills-t').textContent=fmt(C.bills);
    $('#fp-ess-t').textContent=fmt(C.ess);
    // the predicted side
    var pv=$('#fp-pred');
    pv.textContent=C.left==null?'Set your '+capWhat+' cap first':fmtS(C.left);
    pv.classList.toggle('neg',C.left!=null&&C.left<=0);pv.classList.toggle('miss',C.left==null);
    $('#fp-pred-d').textContent=C.left!=null&&C.left>0?fmt(food?C.dayLimit:C.left/d)+' a day'+(food?' for the '+d+' days left':''):'';
    var cd=$('[data-capd]');
    if(cd) cd.textContent=C.cap==null?'':cd.dataset.capd==='food'
      ?fmt(C.cap)+' for the '+d+' days left, today to '+fmtDay(R.lastDay)+(C.foodToday?', counting the '+fmt(C.foodToday)+' already spent on food today':'')+'.'
      :fmt(C.cap/d)+' a day over '+d+' days';
    drawDaily(C.dayLimit);
    // the line on the food chart: your food cap, or the food budget it predicts
    var line=$('#fp-capline'),mx=+$('#fp-fchart').dataset.max,fv=food?C.left:C.cap;
    line.hidden=!(fv>0);
    if(fv>0){line.style.bottom=Math.min(100,fv/mx*100).toFixed(1)+'%';$('span',line).textContent=(food?'Budget ':'Cap ')+K(fv);}
    $('#fp-capleg').textContent=food?'Predicted food budget':'Your food cap';
    PEOPLE.forEach(function(p){
      var ad=I.adv[p.key]||{},fee=I.fees[p.key]!=null?I.fees[p.key]:p.fee,n=$('[data-next="'+p.key+'"]');
      n.textContent=ad.amt?'Next payday you pay '+fmt(Math.max(0,fee-ad.amt))+' instead of '+fmt(fee)+', and '+fmt(Math.min(ad.amt,fee))+' goes back to Pay myself.':'No advance this month.';
    });
    drawOutlook(I,C);
  }


  // ---------------------------------------------------------------- food per day
  function drawDaily(limit){
    var box=$('#fd-chart');if(!box) return;
    var F=R.food,cyc=load().frange!=='60',now=F.now;
    var a=cyc?R.cur.start:now-59,b=cyc?R.lastDay:now,n=b-a+1;
    var W=Math.max(280,box.clientWidth),H=W<520?180:200,pl=40,pr=10,pt=16,pb=24,iw=W-pl-pr,ih=H-pt-pb;
    var usual=R.usual.food,mx=usual;
    for(var d=a;d<=Math.min(b,now);d++) mx=Math.max(mx,F.byDay[d]||0);
    if(limit>0) mx=Math.max(mx,limit);
    // round gridlines: a nice step, four or so of them
    var stp=Viz.niceMax(mx*1.1/4),nt=Math.ceil(mx*1.1/stp),top=stp*nt,Y=function(v){return pt+ih*(1-v/top);},bw=iw/n,gap=Math.min(2,bw*0.25);
    var g='';
    for(var t=0;t<=nt;t++){var v=stp*t;g+='<line class="ol-grid'+(t===0?' zero':'')+'" x1="'+pl+'" x2="'+(W-pr)+'" y1="'+Y(v).toFixed(1)+'" y2="'+Y(v).toFixed(1)+'"/><text class="ol-ax" x="'+(pl-6)+'" y="'+(Y(v)+3.5).toFixed(1)+'" text-anchor="end">'+esc(K(v))+'</text>';}
    var bars='',over=0,spent=0,days=0,lab='',every=Math.max(1,Math.ceil(n*46/iw));
    for(var i=0;i<n;i++){
      var day=a+i,x=pl+i*bw,v2=F.byDay[day]||0,past=day<=now,isOver=past&&limit>0&&v2>limit;
      // days with nothing logged at all are gaps in the record, not days without food
      if(past&&(F.logged[day]||v2)){days++;spent+=v2;if(isOver) over++;}
      var tip=fmtDay(day)+(day===now?' (today)':'')+'\n'+(!past?'Still to come':v2?'Food '+fmt(v2)+(limit>0?(isOver?', '+fmt(v2-limit)+' over the limit':', '+fmt(limit-v2)+' under the limit'):'')+'\n'+(F.items[day]||[]).slice(0,4).join('\n'):F.logged[day]?'No food logged':'Nothing logged this day');
      if(past&&v2>0) bars+='<rect class="fd-bar'+(isOver?' over':'')+(day===now?' now':'')+'" x="'+(x+gap/2).toFixed(1)+'" y="'+Y(v2).toFixed(1)+'" width="'+Math.max(1,bw-gap).toFixed(1)+'" height="'+(pt+ih-Y(v2)).toFixed(1)+'" rx="'+Math.min(3,bw/4).toFixed(1)+'"/>';
      else if(!past) bars+='<rect class="fd-future" x="'+(x+gap/2).toFixed(1)+'" y="'+(pt+ih-2)+'" width="'+Math.max(1,bw-gap).toFixed(1)+'" height="2"/>';
      bars+='<rect class="fd-hit" data-tip="'+esc(tip)+'" x="'+x.toFixed(1)+'" y="'+pt+'" width="'+bw.toFixed(1)+'" height="'+ih+'"/>';
      if(day===now||(i%every===0&&Math.abs(day-now)>=every)) lab+='<text class="ol-ax'+(day===now?' ol-cur':'')+'" x="'+(x+bw/2).toFixed(1)+'" y="'+(H-6)+'" text-anchor="middle">'+esc(day===now?'Today':fmtDay(day))+'</text>';
    }
    var lines='<line class="fd-use" x1="'+pl+'" x2="'+(W-pr)+'" y1="'+Y(usual).toFixed(1)+'" y2="'+Y(usual).toFixed(1)+'"/>';
    if(limit>0) lines+='<line class="fd-lim" x1="'+pl+'" x2="'+(W-pr)+'" y1="'+Y(limit).toFixed(1)+'" y2="'+Y(limit).toFixed(1)+'"/><text class="fd-limt" x="'+(W-pr)+'" y="'+(Y(limit)-4).toFixed(1)+'" text-anchor="end">Limit '+esc(fmt(limit))+'</text>';
    box.innerHTML='<svg width="'+W+'" height="'+H+'" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Food spent per day against the daily limit">'+g+bars+lines+lab+'</svg>';
    var st=(cyc?'This cycle: ':'Last 60 days: ')+fmt(spent)+' on food, '+fmt(spent/Math.max(1,days))+' a day over the '+days+(days===1?' day':' days')+' you logged';
    st+=limit>0?' · over your '+fmt(limit)+' limit on '+over+' of them':' · set a food limit to compare';
    if(cyc) st+=' · '+R.days+(R.days===1?' day':' days')+' left, today included';
    $('#fd-stats').textContent=st;
  }

  // ---------------------------------------------------------------- money in, out and saved
  /* One column per month since January: what you were paid (Income tab), split into
     what went to Pay myself and what was spent (Tracking tab), with what was left over,
     or what came from earlier money when spending and saving came to more than the pay.
     Saved is how much Pay myself grew that cycle; Pay myself is a running total, so the
     first recorded month counts in full. Months the Tracking tab does not cover use the
     Saved column of the Income tab. */
  var FULLMON=['January','February','March','April','May','June','July','August','September','October','November','December'];
  function ymKey(day){var d=new Date(day*DAY);return d.getUTCFullYear()+'-'+('0'+(d.getUTCMonth()+1)).slice(-2);}
  function ymName(k,full){var y=+k.slice(0,4),m=+k.slice(5)-1;return full?FULLMON[m]+' '+y:MON[m];}
  function cashflow(M){
    var inc=L.S.income||{},cyc=Logic.cyclePeriods(M.parsed,M.today),byYm={};
    cyc.forEach(function(c){byYm[ymKey(c.start)]=c;});
    var keys=Object.keys(inc).concat(Object.keys(byYm)).filter(function(k){return k>='2026-01';}).sort();
    if(!keys.length) return [];
    var out=[],y=+keys[0].slice(0,4),m=+keys[0].slice(5),end=keys[keys.length-1],prevPM=null,runPM=null;
    for(;;){
      var k=y+'-'+('0'+m).slice(-2);
      if(k>end) break;
      var c=byYm[k],i=inc[k]||{},row={key:k,received:i.received!=null?i.received:null,note:i.note||''};
      if(c){
        var A=Logic.aggregate(c),pm=c.tx.filter(function(t){return t.cat==='savings';}).reduce(function(a,t){return a+t.amt;},0);
        row.kind=c.open?'open':'tracked';row.spent=A.spent;row.by=A.by;row.other=A.other;
        row.saved=i.saved!=null?i.saved:pm>0?(prevPM!=null?pm-prevPM:pm):0;
        row.first=pm>0&&prevPM==null&&i.saved==null;row.pm=pm>0?pm:null;
        prevPM=pm>0?pm:prevPM;runPM=null;
      }else{
        row.saved=i.saved!=null?i.saved:null;
        row.kind=row.saved!=null&&row.received!=null?'partial':'untracked';
        // no spending record: whatever was not saved is taken as spent
        row.spent=row.kind==='partial'?Math.max(0,row.received-row.saved):null;
        // months before the Tracking tab: Pay myself builds up from the Saved column
        runPM=row.saved!=null?(runPM||0)+row.saved:null;row.pm=runPM;row.pmEst=runPM!=null;
        prevPM=null;
      }
      row.left=row.received!=null&&row.spent!=null&&row.saved!=null?row.received-row.spent-row.saved:null;
      out.push(row);
      if(++m>12){m=1;y++;}
    }
    return out;
  }

  var CF=null;
  // late in a cycle, offer to start the next one from here
  function cycAsk(M){
    if(M.today-R.cur.start<24) return '';
    var i=FULLMON.map(function(m){return m.toLowerCase();}).indexOf(String(R.cur.name).toLowerCase()),next=i<0?'the next':FULLMON[(i+1)%12];
    return '<section class="pnl cf-ask"><div class="pnl-b"><div class="cf-ask-t"><b>Got paid? Start '+esc(next)+'’s pay cycle</b><span>Adds the new month to the sheet with your Pay myself and balances, records the salary, and closes '+esc(R.cur.name)+'’s totals.</span></div>'+
      '<button type="button" class="btn primary sm" data-open-cycle>Start '+esc(next)+'</button></div></section>';
  }
  function cfPrompt(){
    var k=ymKey(R.cur.start),i=(L.S.income||{})[k];
    if(i&&i.received!=null) return '';
    return '<section class="pnl cf-ask" id="cf-ask"><div class="pnl-b"><div class="cf-ask-t"><b>New pay cycle · '+esc(ymName(k,true))+'</b><span>How much did you receive this payday? It keeps your money-in chart up to date.</span></div>'+
      '<div class="cf-ask-f" data-cf-month="'+k+'"><span class="fp-in"><span>Rs</span><input class="inline" inputmode="numeric" enterkeyhint="done" autocomplete="off" placeholder="Salary received" aria-label="Salary received"></span>'+
      '<button type="button" class="btn primary sm" data-cf-save>Save</button></div></div></section>';
  }
  function cfView(M){
    CF=cashflow(M);
    if(!CF.length) return '';
    return ui0.pnl('cf','Money in, out and saved','each pay cycle since '+esc(ymName(CF[0].key,true)),
      '<div class="cf-kpis" id="cf-kpis"></div>'+
      '<div class="cf-chart" id="cf-chart"></div>'+
      '<div class="legend sm"><span><i class="sw cf-sav"></i>Saved to Pay myself</span><span><i class="sw cf-sp"></i>Spent</span><span><i class="sw cf-lo"></i>Left over</span><span><i class="sw cf-ex"></i>From earlier money</span><span><i class="sw cf-rc"></i>Pay received</span><span><i class="sw cf-pmsw"></i>Pay myself balance</span><span><i class="sw cf-nt"></i>Not tracked</span></div>'+
      '<div class="cf-detail" id="cf-detail"></div>',{cls:'cf-pnl'});
  }
  var ui0=null;
  function cfSel(){var s=load().cfSel;return CF.some(function(r){return r.key===s;})?s:CF[CF.length-1].key;}
  function drawCf(){
    var box=$('#cf-chart');if(!box||!CF||!CF.length) return;
    var sel=cfSel(),n=CF.length;
    // the year so far
    // Pay myself carries over month to month, so the latest figure is everything saved
    var rec=0,spent=0,pm=null,pmAt=null;
    CF.forEach(function(r){if(r.received!=null) rec+=r.received;if(r.kind==='tracked'||r.kind==='open') spent+=r.spent;if(r.pm!=null){pm=r.pm;pmAt=r.key;}});
    var tile=function(k,v,sub,cls){return '<div><span>'+esc(k)+'</span><b class="'+(cls||'')+'">'+v+'</b><small>'+sub+'</small></div>';};
    $('#cf-kpis').innerHTML=
      tile('Received',esc(fmt(rec)),CF.filter(function(r){return r.received!=null;}).length+' paydays')+
      tile('Spent',esc(fmt(spent)),'in the months you tracked')+
      tile('Saved',pm!=null?esc(fmt(pm)):'\u2013',pm!=null?'Pay myself now, as of '+esc(ymName(pmAt,true)):'no Pay myself row yet')+
      tile('Kept',pm!=null&&rec?Math.round(pm/rec*100)+'<small>%</small>':'\u2013','of everything you were paid');
    var W=Math.max(300,box.clientWidth),H=W<520?240:300,pl=46,pr=8,pt=26,pb=40,iw=W-pl-pr,ih=H-pt-pb;
    var mx=1;CF.forEach(function(r){mx=Math.max(mx,r.received||0,(r.spent||0)+Math.max(0,r.saved||0),r.pm||0);});
    var stp=Viz.niceMax(mx*1.08/4),nt=Math.ceil(mx*1.08/stp),top=stp*nt,Y=function(v){return pt+ih*(1-v/top);},hY=function(v){return ih*v/top;};
    var slot=iw/n,bw=Math.min(54,slot*0.62),g='';
    for(var t=0;t<=nt;t++){var v=stp*t;g+='<line class="ol-grid'+(t===0?' zero':'')+'" x1="'+pl+'" x2="'+(W-pr)+'" y1="'+Y(v).toFixed(1)+'" y2="'+Y(v).toFixed(1)+'"/><text class="ol-ax" x="'+(pl-6)+'" y="'+(Y(v)+3.5).toFixed(1)+'" text-anchor="end">'+esc(K(v))+'</text>';}
    var cols='',vals='';
    CF.forEach(function(r,i){
      var cx=pl+slot*i+slot/2,x=cx-bw/2,base=pt+ih,parts='',tip=ymName(r.key,true)+(r.kind==='open'?' (so far)':'');
      if(r.key===sel) cols+='<rect class="cf-selbg" x="'+(pl+slot*i+1).toFixed(1)+'" y="'+(pt-20)+'" width="'+(slot-2).toFixed(1)+'" height="'+(ih+20)+'" rx="3"/>';
      if(r.kind==='untracked'){
        if(r.received!=null) parts+='<rect class="cf-nt" x="'+x.toFixed(1)+'" y="'+Y(r.received).toFixed(1)+'" width="'+bw.toFixed(1)+'" height="'+hY(r.received).toFixed(1)+'" rx="3"/><text class="cf-q" x="'+cx.toFixed(1)+'" y="'+(Y(r.received/2)+4).toFixed(1)+'" text-anchor="middle">?</text>';
        tip+='\nReceived '+(r.received!=null?fmt(r.received):'not entered')+'\nSpending and saving not tracked';
      }else{
        var y=base,sv=Math.max(0,r.saved||0),sp=r.spent||0,cap=r.received!=null?r.received:sv+sp;
        var seg=function(cls,v){if(!(v>0)) return;var h=hY(v);parts+='<rect class="'+cls+'" x="'+x.toFixed(1)+'" y="'+(y-h).toFixed(1)+'" width="'+bw.toFixed(1)+'" height="'+Math.max(0,h-1).toFixed(1)+'"/>';y-=h;};
        seg('cf-sav',sv);
        // spending up to the pay, and any beyond it, which came from earlier money
        var within=Math.max(0,Math.min(sp,cap-sv));
        seg('cf-sp'+(r.kind==='partial'?' est':''),within);
        seg('cf-ex',sp-within);
        if(r.left>0) seg('cf-lo',r.left);
        tip+='\nReceived '+(r.received!=null?fmt(r.received):'not entered')+'\nSaved '+fmtS(r.saved)+(r.first?' (first record of Pay myself)':'')+'\nSpent '+fmt(sp)+(r.kind==='partial'?' (estimate: pay minus saved)':'')+
          (r.left!=null?'\n'+(r.left>=0?'Left over '+fmt(r.left):'From earlier money '+fmt(-r.left)):'')+(r.received?'\nSavings rate '+Math.round((r.saved||0)/r.received*100)+'%':'');
      }
      if(r.received!=null) parts+='<line class="cf-rc" x1="'+(x-3).toFixed(1)+'" x2="'+(x+bw+3).toFixed(1)+'" y1="'+Y(r.received).toFixed(1)+'" y2="'+Y(r.received).toFixed(1)+'"/>';
      // pay labels go on top of everything, the balance line included
      if(r.received!=null) vals+='<text class="cf-v" x="'+cx.toFixed(1)+'" y="'+(Y(Math.max(r.received,(r.spent||0)+Math.max(0,r.saved||0)))-6).toFixed(1)+'" text-anchor="middle">'+esc(K(r.received))+'</text>';
      var rate=r.pm!=null?K(r.pm):'–';
      if(r.pm!=null) tip+='\nPay myself balance '+fmt(r.pm)+(r.pmEst?' (from the Income tab)':'');
      cols+='<g class="cf-col'+(r.key===sel?' on':'')+'" data-cf="'+r.key+'" data-tip="'+esc(tip)+'">'+parts+
        '<text class="ol-ax cf-m'+(r.key===sel?' ol-cur':'')+'" x="'+cx.toFixed(1)+'" y="'+(H-22)+'" text-anchor="middle">'+esc(ymName(r.key))+'</text>'+
        '<text class="cf-r" x="'+cx.toFixed(1)+'" y="'+(H-8)+'" text-anchor="middle">'+rate+'</text>'+
        '<rect class="cf-hit" x="'+(pl+slot*i).toFixed(1)+'" y="0" width="'+slot.toFixed(1)+'" height="'+H+'"/></g>';
    });
    // Pay myself balance: a line through the months it is known, broken where it is not
    var pmLine='',seg=[],flush=function(){if(seg.length>1) pmLine+='<path class="cf-pm" d="M'+seg.join('L')+'"/>';seg=[];};
    CF.forEach(function(r,i){
      var cx=pl+slot*i+slot/2;
      if(r.pm==null){flush();return;}
      seg.push(cx.toFixed(1)+','+Y(r.pm).toFixed(1));
    });
    flush();
    CF.forEach(function(r,i){if(r.pm!=null) pmLine+='<circle class="cf-pmd'+(r.pmEst?' est':'')+'" cx="'+(pl+slot*i+slot/2).toFixed(1)+'" cy="'+Y(r.pm).toFixed(1)+'" r="4.5"/>';});
    box.innerHTML='<svg width="'+W+'" height="'+H+'" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Pay received each month, split into saved, spent and left over">'+
      '<defs><pattern id="cf-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" class="cf-hb"/><line x1="0" y1="0" x2="0" y2="6" class="cf-hl"/></pattern></defs>'+
      g+cols+pmLine+vals+'</svg>';
    drawCfDetail(sel);
  }
  function drawCfDetail(key){
    var r=CF.find(function(x){return x.key===key;}),box=$('#cf-detail');if(!r||!box) return;
    var y=+key.slice(0,4),m=+key.slice(5);
    var stat=function(k,v,cls,sub){return '<div class="cf-st'+(cls?' '+cls:'')+'"><span><i class="sw '+(cls||'')+'"></i>'+esc(k)+'</span><b>'+v+'</b>'+(sub?'<small>'+sub+'</small>':'')+'</div>';};
    var stats='<div class="cf-sts">'+
      '<div class="cf-st cf-rcv" data-cf-month="'+key+'"><span>Received</span><div class="cf-edit"><span class="fp-in"><span>Rs</span><input class="inline" inputmode="numeric" enterkeyhint="done" autocomplete="off" value="'+(r.received!=null?esc(Math.round(r.received).toLocaleString('en-US')):'')+'" placeholder="Not entered" aria-label="Received in '+esc(ymName(key,true))+'"></span><button type="button" class="btn sm" data-cf-save>Save</button></div>'+(r.note?'<small>'+esc(r.note)+'</small>':'')+'</div>'+
      (r.kind==='untracked'?'<p class="cf-none">'+esc(ymName(key,true))+' is not in your Tracking tab, so what you spent and saved is unknown. Add a Saved figure for it in the Income tab of the sheet to fill it in.</p>':
        stat('Saved to Pay myself',esc(fmtS(r.saved)),'cf-sav',r.first?'first record of Pay myself':r.kind==='partial'?'from the Income tab':'Pay myself grew by this')+
        (r.pm!=null?stat('Pay myself balance',esc(fmt(r.pm)),'cf-pmsw',r.pmEst?'built up from the Saved column of the Income tab':'logged in this cycle'):'')+
        stat('Spent',esc(fmt(r.spent)),'cf-sp',r.kind==='partial'?'estimate: pay minus saved':r.kind==='open'?'so far this cycle':'')+
        (r.left!=null?(r.left>=0?stat('Left over',esc(fmt(r.left)),'cf-lo','not spent or saved'):stat('From earlier money',esc(fmt(-r.left)),'cf-ex','spending and saving beyond the pay')):'')+
        (r.received?stat('Savings rate',Math.round((r.saved||0)/r.received*100)+'%','',''):''))+
      '</div>';
    // where the pay went: received (and earlier money) into saved, each category and left over
    var flow='';
    if(r.kind!=='untracked'&&r.received){
      var src=[{id:'rcv',label:'Received',v:r.received,cls:'acct'}];
      if(r.left<0) src.push({id:'old',label:'Earlier money',v:-r.left,cls:'cn'});
      var dst=[];
      if(r.saved>0) dst.push({id:'sav',label:'Pay myself',v:r.saved,cls:'cf-n-sav'});
      if(r.by){
        // categories under 5% of the pay go together, so the small ones stay readable
        var small=r.other>0?r.other:0,few=[];
        Object.keys(r.by).filter(function(c){return r.by[c]>0;}).sort(function(a,b){return r.by[b]-r.by[a];}).forEach(function(c){
          if(r.by[c]>=r.received*0.05) dst.push({id:'c:'+c,label:c,v:r.by[c],cls:'cf-n-sp'});else{small+=r.by[c];few.push(c);}
        });
        if(small>0) dst.push({id:'c:Other',label:few.length>1?'Other spending':few[0]||'Other',v:small,cls:'cf-n-sp',more:few});
      }
      else if(r.spent>0) dst.push({id:'sp',label:'Spent (not itemised)',v:r.spent,cls:'cf-n-sp'});
      if(r.left>0) dst.push({id:'lo',label:'Left over',v:r.left,cls:'cf-n-lo'});
      // links: received pays for things in order, earlier money covers the rest
      var links=[],avail=src.map(function(s){return {id:s.id,v:s.v};}),si=0;
      dst.forEach(function(d){var need=d.v;while(need>0.5&&si<avail.length){var take=Math.min(need,avail[si].v);if(take>0) links.push({s:avail[si].id,t:d.id,v:take,cls:d.cls});avail[si].v-=take;need-=take;if(avail[si].v<=0.5) si++;}});
      var fw=Math.max(280,(box.clientWidth||600)-(box.clientWidth>760?320:0)),labW=fw<520?92:130,fh=Math.max(200,Math.min(380,dst.length*30));
      var lay=Viz.sankey([src,dst],links,fw-labW*2,fh,{nodeW:10,pad:6});
      var sv='<svg width="'+fw+'" height="'+(fh+24)+'" viewBox="0 0 '+fw+' '+(fh+24)+'" role="img" aria-label="Where '+esc(ymName(key,true))+' pay went"><g transform="translate('+labW+',3)">';
      lay.links.forEach(function(l){sv+='<path class="cf-lk '+l.cls+'" d="'+l.d+'" data-tip="'+esc(l.sn.label+' → '+l.tn.label+'\n'+fmt(l.v))+'"/>';});
      // labels keep at least 24px apart, top to bottom, even when bars are thin
      var lastY=[-1e9,-1e9];
      Object.keys(lay.nodes).map(function(id){return lay.nodes[id];}).sort(function(x,y){return x.y-y.y;}).forEach(function(nd){var left=nd.col===0,ty=Math.max(nd.y+nd.h/2,lastY[nd.col]+24);lastY[nd.col]=ty;
        sv+='<g data-tip="'+esc(nd.label+'\n'+fmt(nd.v)+(nd.more&&nd.more.length>1?'\n'+nd.more.map(function(c){return c+' '+fmt(r.by[c]);}).join('\n'):''))+'"><rect class="nd-r '+nd.cls+'" x="'+Viz.r1(nd.x)+'" y="'+Viz.r1(nd.y)+'" width="'+nd.w+'" height="'+Viz.r1(nd.h)+'" rx="1.5"/>'+
          '<text class="nd-t" x="'+Viz.r1(left?nd.x-8:nd.x+nd.w+8)+'" y="'+Viz.r1(ty-1)+'" text-anchor="'+(left?'end':'start')+'">'+esc(nd.label)+'</text>'+
          '<text class="nd-v" x="'+Viz.r1(left?nd.x-8:nd.x+nd.w+8)+'" y="'+Viz.r1(ty+11)+'" text-anchor="'+(left?'end':'start')+'">'+esc(K(nd.v))+'</text></g>';});
      flow='<div class="cf-flow">'+sv+'</g></svg></div>';
    }
    box.innerHTML='<div class="cf-dh"><b>'+esc(ymName(key,true))+'</b>'+(r.kind==='open'?'<span class="pill">so far</span>':r.kind==='partial'?'<span class="pill">spending estimated</span>':r.kind==='untracked'?'<span class="pill">not tracked</span>':'')+'</div><div class="cf-db">'+stats+flow+'</div>';
  }
  function saveIncome(btn){
    var box=btn.closest('[data-cf-month]'),k=box.dataset.cfMonth,inp=$('input',box),v=amt(inp.value),E=window.LedgerEditor;
    if(v==null||!(v>0)){inp.focus();if(E) E.toast('Enter the amount you received.');return;}
    btn.disabled=true;
    (L.hasToken()?Promise.resolve():L.signIn()).then(function(){return L.saveIncome(+k.slice(0,4),+k.slice(5),v);}).then(function(){
      if(E) E.toast('Saved '+fmt(v)+' as received in '+ymName(k,true)+'.');
    }).catch(function(e){btn.disabled=false;if(E) E.toast(L.errMsg(e));});
  }

  // ---------------------------------------------------------------- savings outlook
  /* Where Pay myself goes over the coming months. Each month: salary in, then Mama,
     Touheed, bills and the month's spending out; what is left is added to Pay myself.
     Spending starts from this month's plan above (your caps, essentials, InDrive and
     bills, scaled to a month) and moves up or down with the level you pick. Around
     that, 3,000 simulated futures: each month's everyday spending is scaled by how
     much one of your past months ran over or under your average (resampled), and
     one-off buys of Rs 10,000 or more turn up as often, and as big, as they have. */
  var OSIMS=3000,MDAYS=30.4;
  var LEVELS=[{k:'lower',t:'Lower',f:0.9,s:'−10%'},{k:'same',t:'Same',f:1,s:'as now'},{k:'higher',t:'Higher',f:1.1,s:'+10%'}];
  function rng(seed){var a=seed>>>0;return function(){a=(a+0x6D2B79F5)>>>0;var t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};}
  function poisson(lam,r){if(lam<=0) return 0;var Lm=Math.exp(-lam),k=0,p=1;do{k++;p*=r();}while(p>Lm&&k<40);return k-1;}
  function q(sorted,p){if(!sorted.length) return 0;var i=(sorted.length-1)*p,lo=Math.floor(i),hi=Math.ceil(i);return sorted[lo]+(sorted[hi]-sorted[lo])*(i-lo);}
  function ymOf(day){var d=new Date(day*DAY);return d.getUTCFullYear()+'-'+('0'+(d.getUTCMonth()+1)).slice(-2);}
  // the coming payday cycles: the one starting next payday, then one a month
  function months(n){
    var d=new Date(R.pay*DAY),out=[];
    for(var m=0;m<n;m++){
      var day=Math.round(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+m,Logic.PAYDAY_DOM)/DAY),dd=new Date(day*DAY);
      out.push({day:day,ym:ymOf(day),name:MON[dd.getUTCMonth()],year:dd.getUTCFullYear()});
    }
    return out;
  }
  function oInputs(){
    var s=load();
    return {base:s.base!=null?s.base:130000,next:s.next&&s.next.id===R.id?s.next.amt:null,
      level:s.level||'same',hz:s.hz===12?12:6,lumps:s.lumps!==false,planned:s.planned||[],shopLimit:s.shopLimit!=null?s.shopLimit:null,
      lumpLimit:s.lumpLimit!=null?s.lumpLimit:null,groomAlt:s.groomAlt!==false};
  }
  // one month of spending, from this month's plan
  function monthPlan(I,C){
    var k=MDAYS/R.days,food=I.mode==='food';
    var bills=R.bills.reduce(function(a,b){return a+(b.amt||0);},0);
    var parts={
      food:!food&&I.foodCap!=null?I.foodCap*k:R.usual.food*MDAYS,
      shop:food&&I.shopCap!=null?I.shopCap*k:R.usual.shop*MDAYS,
      ess:C.ess*k,ride:R.lv[I.ride]*MDAYS};
    var fee=function(p){return I.fees[p.key]!=null?I.fees[p.key]:p.fee;};
    return {bills:bills,parts:parts,variable:parts.food+parts.shop+parts.ess+parts.ride,
      mama:fee(PEOPLE[1]),touheed:fee(PEOPLE[0]),
      foodSrc:!food&&I.foodCap!=null?'your cap':'your usual',shopSrc:food&&I.shopCap!=null?'your cap':'your usual'};
  }
  // the projection starts from this cycle's Pay myself (less any advance paid from it);
  // the next payday's salary is then added and that month's expenses taken off
  function startBalance(I,C){
    return {bal:C.kept,dip:0};
  }
  /* Shopping each month: you try to stay under your limit, so most months land
     somewhere between 40% and all of it (more often near the top), and about one
     month in ten goes a little over, by up to a fifth. */
  var SHOP_OVER=0.1;
  function drawShop(limit,r){
    if(!(limit>0)) return 0;
    return r()<SHOP_OVER?limit*(1+0.2*r()):limit*(0.4+0.6*Math.pow(r(),0.6));
  }
  function shopMean(limit){return limit>0?limit*((1-SHOP_OVER)*(0.4+0.6/1.6)+SHOP_OVER*1.1):0;}
  function simulate(I,C){
    var O=oInputs(),P=monthPlan(I,C),lv=LEVELS.find(function(x){return x.k===O.level;}).f;
    // the limit you set, or your usual shopping for a month to start with
    var limit=O.shopLimit!=null?O.shopLimit:Math.ceil(P.parts.shop/1000)*1000,other=(P.variable-P.parts.shop)*lv;
    var H=O.hz,M=months(12).slice(0,H),st0=startBalance(I,C);
    var plan={};O.planned.forEach(function(p){if(p.amt>0) plan[p.ym]=(plan[p.ym]||0)+p.amt;});
    var advT=(I.adv.touheed||{}).amt||0,advM=(I.adv.mama||{}).amt||0;
    // how each past month's everyday spending ran against the average
    // (shopping is drawn on its own below, so it is left out here)
    var per=R.hist.map(function(x){return (x.vari-x.shop)/x.len;}),avg=mean(per)||1;
    var ratios=per.map(function(v){return v/avg;});
    var lumps=[];R.hist.forEach(function(x){lumps=lumps.concat(x.lumps);});
    var lam=O.lumps?lumps.length/R.hist.length:0;
    // with a limit of your own, a surprise month costs a random amount up to it, as often as they have happened
    var pSurprise=1-Math.exp(-lam),lumpLim=O.lumps&&O.lumpLimit>0?O.lumpLimit:null;
    var surprise=function(r){
      if(lumpLim!=null) return r()<pSurprise?lumpLim*(0.3+0.7*r()):0;
      var l=0,n=poisson(lam,r);for(var k=0;k<n;k++) l+=lumps[Math.floor(r()*lumps.length)];return l;
    };
    // toiletries every other month: counted from the last cycle you bought them
    var g=(R.ess.filter(function(e){return e.key==='groom';})[0]||{}).amt||0,gMonth=g*MDAYS/R.days*lv,since=1;
    var grRe=ESS.filter(function(e){return e.k==='groom';})[0].re;
    // this cycle has toiletries if they are logged already or planned in its budget, so the next one skips them
    if(g>0||R.cur.tx.some(function(t){return t.amt>0&&grRe.test((t.name+' '+t.desc).toLowerCase());})) since=0;
    else for(var hi=R.hist.length-1;hi>=0;hi--){if(R.hist[hi].ess.groom>0){since=R.hist.length-hi;break;}}
    // one realistic shopping figure per month for the table, the same each time you look
    var rt=rng(R.id*17+7);
    var rows=M.map(function(m,i){
      var sal=i===0&&O.next!=null?O.next:O.base;
      var mama=Math.max(0,P.mama-(i===0?advM:0)),tou=Math.max(0,P.touheed-(i===0?advT:0));
      var shop=r100(drawShop(limit,rt));
      var groom=!O.groomAlt||(since+i+1)%2===0?gMonth:0,spend=other-gMonth+groom;
      return {m:m,salary:sal,mama:mama,touheed:tou,bills:P.bills,spend:spend,groom:groom,shop:shop,planned:plan[m.ym]||0,
        save:sal-mama-tou-P.bills-spend-shop-(plan[m.ym]||0)};
    });
    var planMonthly=O.base-P.mama-P.touheed-P.bills-other+(O.groomAlt?gMonth/2:0)-shopMean(limit);
    var r=rng(R.id*31+H),paths=[];for(var j=0;j<H;j++) paths.push([]);
    for(var s=0;s<OSIMS;s++){
      var bal=st0.bal;
      for(var i=0;i<H;i++){
        var row=rows[i],v=row.spend*ratios[Math.floor(r()*ratios.length)],l=surprise(r);
        var sv=row.salary-row.mama-row.touheed-row.bills-v-drawShop(limit,r)-l-row.planned;
        bal+=sv;paths[i].push(bal);
      }
    }
    var asc=function(a,b){return a-b;};
    var band=paths.map(function(a){a.sort(asc);return {p10:q(a,0.1),p25:q(a,0.25),p50:q(a,0.5),p75:q(a,0.75),p90:q(a,0.9)};});
    // saved each month is the step between likely balances, so last month's Pay myself plus this month's saving is this month's Pay myself
    rows.forEach(function(row,i){row.saveP50=r100(band[i].p50)-r100(i?band[i-1].p50:st0.bal);});
    return {O:O,P:P,lv:lv,rows:rows,band:band,start:st0,lam:lam,pSurprise:pSurprise,lumpLim:lumpLim,lumpAvg:lumps.length?mean(lumps):0,spread:ratios,limit:limit,planMonthly:planMonthly};
  }

  function outlookView(){
    var O=oInputs(),M=months(12),nm=M[0];
    var lvSeg='<div class="seg fp-seg" role="group" aria-label="Spending in the coming months">'+LEVELS.map(function(x){
      return '<button type="button" data-level="'+x.k+'" aria-pressed="'+(O.level===x.k)+'">'+x.t+'<small>'+x.s+'</small></button>';}).join('')+'</div>';
    var hz='<div class="seg sm" role="group" aria-label="How far ahead"><button type="button" data-hz="6" aria-pressed="'+(O.hz===6)+'">6 months</button><button type="button" data-hz="12" aria-pressed="'+(O.hz===12)+'">12 months</button></div>';
    var opts=function(sel){return M.map(function(m){return '<option value="'+m.ym+'"'+(m.ym===sel?' selected':'')+'>'+m.name+' '+m.year+'</option>';}).join('');};
    var planned=O.planned.map(function(p,j){
      return '<div class="fp-row ol-plan" data-plan="'+j+'"><select class="inline ol-m" aria-label="Month">'+opts(p.ym)+'</select>'+
        '<div class="fp-name"><input class="inline fp-lbl" value="'+esc(p.label||'')+'" placeholder="What for" aria-label="What for"></div>'+
        money(p.amt)+'<button type="button" class="x fp-del" aria-label="Remove">&times;</button></div>';
    }).join('');
    return '<section class="pnl ol" id="fp-out"><header class="pnl-h"><span class="pnl-t"><i class="pnl-dot"></i>Savings outlook</span><span class="pnl-m">where Pay myself is heading</span><span class="pnl-tools">'+hz+'</span></header><div class="pnl-b">'+
      '<div class="ol-in">'+
        '<div class="fld" data-out="base"><span class="lbl">Base salary</span>'+money(O.base)+'</div>'+
        '<div class="fld" data-out="next"><span class="lbl">Salary on 20 '+esc(nm.name)+'</span>'+money(O.next,'','Same as base')+'</div>'+
        '<div class="fld" data-out="shop"><span class="lbl">Shopping limit a month</span>'+money(O.shopLimit,'','Your usual')+'<small class="ol-hint" id="ol-shop-hint"></small></div>'+
        '<div class="fld"><span class="lbl">Spending in the coming months, against this month</span>'+lvSeg+'</div>'+
      '</div>'+
      '<div class="ol-stats" id="ol-stats"></div>'+
      '<div class="ol-chart" id="ol-chart"></div>'+
      '<div class="legend sm"><span><i class="sw ol-actsw"></i>Recorded Pay myself</span><span><i class="sw c1"></i>Most likely</span><span><i class="sw ol-bandsw"></i>Likely range (8 in 10 futures)</span><span><i class="sw ol-plansw"></i>Planned expense</span></div>'+
      '<p class="ol-month" id="ol-hist"></p><p class="ol-month" id="ol-month"></p>'+
      '<div class="ol-sub"><div class="ol-subh"><span class="lbl">Planned and surprise expenses</span><label class="fp-logged ol-lumps" data-out="lumps"><input type="checkbox"'+(O.lumps?' checked':'')+'> Allow for surprise buys</label></div>'+
        '<div class="ol-opts"><div class="fld" data-out="lumplim"><span class="lbl">Surprise buys limit a month</span>'+money(O.lumpLimit,'','From your history')+'</div>'+
          '<label class="fp-logged" data-out="groom"><input type="checkbox"'+(O.groomAlt?' checked':'')+'> Toiletries every other month</label></div>'+
        planned+'<div class="fp-foot"><button type="button" class="btn sm" data-add="plan">+ Add planned expense</button><span class="fp-tot" id="ol-lumpnote"></span></div></div>'+
      '<details class="notes ol-tbl"><summary>Month by month</summary><div class="tbl-w"><table class="tbl" id="ol-table"></table></div></details>'+
    '</div></section>';
  }

  var UIref=null;
  function drawOutlook(I,C){
    var box=$('#ol-chart');if(!box) return;
    var S=simulate(I,C),O=S.O,P=S.P,B=S.band,rows=S.rows,H=rows.length,last=B[H-1];
    var monthly=S.planMonthly;
    // the typical month, from where the most likely line goes (planned expenses left out)
    var gain=(last.p50-S.start.bal+rows.reduce(function(a,r){return a+r.planned;},0)-(rows[0].salary-O.base))/H;
    var tile=function(k,v,sub,cls){return '<div><span>'+esc(k)+'</span><b class="'+(cls||'')+'">'+v+'</b><small>'+sub+'</small></div>';};
    $('#ol-stats').innerHTML=
      tile('Pay myself by '+rows[H-1].m.name+' '+rows[H-1].m.year,esc(fmt(r100(last.p50))),'likely, from '+esc(fmt(r100(S.start.bal)))+' now')+
      tile('Saved a month, likely',esc(fmtS(r100(gain))),'plan alone: '+esc(fmtS(r100(monthly)))+(O.lumps&&S.lam>0?', before surprise buys':''),gain<0?'neg':'')+
      tile('Likely range',esc(K(last.p10))+' – '+esc(K(last.p90)),'8 in 10 futures land here');
    $('#ol-month').innerHTML='Each month: salary '+esc(fmt(O.base))+' − Mama '+esc(fmt(P.mama))+' − Touheed '+esc(fmt(P.touheed))+' − bills '+esc(fmt(P.bills))+
      ' − food '+esc(fmt(r100(P.parts.food*S.lv)))+' ('+P.foodSrc+') − shopping up to '+esc(fmt(S.limit))+' (it varies month to month, see the table) − essentials '+esc(fmt(r100(P.parts.ess*S.lv)))+' − InDrive '+esc(fmt(r100(P.parts.ride*S.lv)))+
      ' = <b>'+esc(fmtS(r100(monthly+0)))+'</b> saved'+(S.start.dip<0?'. This month’s shortfall of about '+esc(fmt(r100(-S.start.dip)))+' comes out first.':'.');
    var sh=$('#ol-shop-hint');if(sh) sh.textContent=(O.shopLimit==null?'Using your usual, '+fmt(S.limit)+'. ':'')+'Most months land at '+K(S.limit*0.4)+'\u2013'+K(S.limit)+', now and then a little over.';
    $('#ol-lumpnote').textContent=!O.lumps||!(S.lam>0)?'':S.lumpLim!=null?'A surprise month about '+Math.round(S.pSurprise*10)+' in 10 months, up to '+K(S.lumpLim)+' each':'Surprise buys of Rs 10,000+: about '+(Math.round(S.lam*10)/10)+' a month, '+K(S.lumpAvg)+' each (from your history)';
    // chart: recorded Pay myself for past cycles, then the projection from this cycle on
    var past=R.past,A=past.length,isCur=A>0&&past[A-1].day===R.cur.start,s0=isCur?A-1:A,N=s0+H;
    var W=Math.max(280,box.clientWidth),Hh=W<520?220:260,pl=46,pr=14,pt=14,pb=28,iw=W-pl-pr,ih=Hh-pt-pb;
    var vals=past.map(function(p){return p.saved;}).concat([S.start.bal]);
    var lo=Math.min(0,Math.min.apply(null,vals.concat(B.map(function(b){return b.p10;})))),hi=Math.max.apply(null,vals.concat(B.map(function(b){return b.p90;})));
    var top=Viz.niceMax(hi*1.05),bot=lo<0?-Viz.niceMax(-lo*1.1):0;
    var X=function(i){return pl+iw*i/Math.max(1,N);},Y=function(v){return pt+ih*(1-(v-bot)/(top-bot));};
    var g='',ticks=4;
    for(var t=0;t<=ticks;t++){var v=bot+(top-bot)*t/ticks;g+='<line class="ol-grid'+(Math.abs(v)<1e-6?' zero':'')+'" x1="'+pl+'" x2="'+(W-pr)+'" y1="'+Y(v).toFixed(1)+'" y2="'+Y(v).toFixed(1)+'"/><text class="ol-ax" x="'+(pl-6)+'" y="'+(Y(v)+3.5).toFixed(1)+'" text-anchor="end">'+esc(K(v))+'</text>';}
    if(bot<0) g+='<line class="ol-grid zero" x1="'+pl+'" x2="'+(W-pr)+'" y1="'+Y(0).toFixed(1)+'" y2="'+Y(0).toFixed(1)+'"/>';
    // a divider where the record ends and the projection begins
    g+='<line class="ol-now" x1="'+X(s0).toFixed(1)+'" x2="'+X(s0).toFixed(1)+'" y1="'+pt+'" y2="'+(pt+ih)+'"/><text class="ol-ax ol-nowt" x="'+(X(s0)+5).toFixed(1)+'" y="'+(pt+9)+'">PROJECTED →</text>';
    var pts=[{x:X(s0),p10:S.start.bal,p90:S.start.bal,p50:S.start.bal}].concat(B.map(function(b,i){return {x:X(s0+i+1),p10:b.p10,p90:b.p90,p50:b.p50};}));
    var band='M'+pts.map(function(p){return p.x.toFixed(1)+','+Y(p.p90).toFixed(1);}).join('L')+'L'+pts.slice().reverse().map(function(p){return p.x.toFixed(1)+','+Y(p.p10).toFixed(1);}).join('L')+'Z';
    var line='M'+pts.map(function(p){return p.x.toFixed(1)+','+Y(p.p50).toFixed(1);}).join('L');
    var act=A?'<path class="ol-act" d="M'+past.map(function(p,i){return X(i).toFixed(1)+','+Y(p.saved).toFixed(1);}).join('L')+'"/>'+
      past.map(function(p,i){return '<circle class="ol-actdot" cx="'+X(i).toFixed(1)+'" cy="'+Y(p.saved).toFixed(1)+'" r="4"/>';}).join(''):'';
    // this cycle's shortfall: from the recorded figure down to where the projection starts
    var drop=isCur&&Math.abs(past[A-1].saved-S.start.bal)>=1?'<line class="ol-drop" x1="'+X(s0).toFixed(1)+'" x2="'+X(s0).toFixed(1)+'" y1="'+Y(past[A-1].saved).toFixed(1)+'" y2="'+Y(S.start.bal).toFixed(1)+'"/>':'';
    var labs=past.map(function(p){return p.label;}).concat(isCur?[]:['Now']).concat(rows.map(function(r){return r.m.name+(r.m.name==='Jan'?' ’'+String(r.m.year).slice(2):'');}));
    // as many month labels as fit, always keeping the last one
    var step=Math.max(1,Math.ceil(N*48/iw)),xl='';
    labs.forEach(function(lab,i){if(i!==N&&(i%step||N-i<step)) return;xl+='<text class="ol-ax'+(i===s0?' ol-cur':'')+'" x="'+X(i).toFixed(1)+'" y="'+(Hh-8)+'" text-anchor="'+(i===0?'start':i===N?'end':'middle')+'">'+esc(lab)+'</text>';});
    var marks=rows.map(function(r,i){if(!r.planned) return '';var x=X(s0+i+1).toFixed(1);
      return '<line class="ol-pl" x1="'+x+'" x2="'+x+'" y1="'+pt+'" y2="'+(pt+ih)+'"/><rect class="ol-plm" x="'+(+x-4)+'" y="'+(pt+ih-4)+'" width="8" height="8" rx="1" transform="rotate(45 '+x+' '+(pt+ih)+')"/>';}).join('');
    box.innerHTML='<svg width="'+W+'" height="'+Hh+'" viewBox="0 0 '+W+' '+Hh+'" role="img" aria-label="Recorded and projected Pay myself balance">'+g+marks+
      '<path class="ol-band" d="'+band+'"/>'+act+drop+'<path class="ol-line" d="'+line+'"/>'+
      '<circle class="ol-dot" cx="'+X(s0).toFixed(1)+'" cy="'+Y(S.start.bal).toFixed(1)+'" r="4"/>'+
      '<circle class="ol-end" cx="'+X(N).toFixed(1)+'" cy="'+Y(last.p50).toFixed(1)+'" r="4"/>'+
      '<line class="ol-cross" id="ol-cross" y1="'+pt+'" y2="'+(pt+ih)+'" hidden/><circle class="ol-hov" id="ol-hov" r="5" hidden/>'+
      xl+'<rect class="ol-hit" x="'+pl+'" y="0" width="'+iw+'" height="'+(pt+ih)+'"/></svg>';
    var hit=$('.ol-hit',box),cross=$('#ol-cross'),hov=$('#ol-hov');
    var move=function(e){
      var rc=box.getBoundingClientRect(),x=e.clientX-rc.left,i=Math.max(0,Math.min(N,Math.round((x-pl)/iw*N)));
      var cx=X(i).toFixed(1),cy,h;
      if(i<s0||(i===s0&&isCur)){
        var p=past[i],prev=i>0?past[i-1]:null;cy=Y(p.saved);
        h='<div class="tt-h">'+esc(p.full)+' · recorded</div><div class="tt-b">Pay myself '+esc(fmt(p.saved))+(prev?'<br>'+(p.saved===prev.saved?'no change since '+esc(prev.full):(p.saved>prev.saved?'+':'\u2212')+esc(fmt(Math.abs(p.saved-prev.saved)))+' since '+esc(prev.full)):'')+
          (i===s0?'<br>Likely '+esc(fmt(r100(S.start.bal)))+' by '+esc(fmtDay(R.lastDay))+(S.start.dip<0?', after this month’s shortfall':''):'')+'</div>';
      }else if(i===s0){cy=Y(S.start.bal);h='<div class="tt-h">Now</div><div class="tt-b">Pay myself '+esc(fmt(S.start.bal))+'</div>';}
      else{var j=i-s0-1,r=rows[j],b=B[j];cy=Y(b.p50);
        // that month's expected spending, item by item (the same plan the forecast uses)
        var k=MDAYS/R.days,f=S.lv,items=[['Groceries (to Mama)',r.mama],['Transport (to Touheed)',r.touheed],['Food',P.parts.food*f]]
          .concat(R.ess.map(function(e){return [e.key==='groom'?'Toiletries':e.label||'Other',e.key==='groom'?r.groom:(e.amt||0)*k*f];}))
          .concat([['InDrive',P.parts.ride*f],['Shopping',r.shop],['Bills and subscriptions',r.bills]]).concat(r.planned?[['Planned expense',r.planned]]:[]);
        var tot=items.reduce(function(a2,x){return a2+x[1];},0);
        h='<div class="tt-h">'+esc(r.m.name+' '+r.m.year)+' cycle</div><div class="tt-b">Pay myself likely '+esc(fmt(r100(b.p50)))+' <span class="tt-r">('+esc(K(b.p10))+'\u2013'+esc(K(b.p90))+')</span><br>Salary '+esc(fmt(r.salary))+'</div>'+
          '<dl class="tt-g">'+items.filter(function(x){return x[1]>0;}).map(function(x){return '<dt>'+esc(x[0])+'</dt><dd>'+esc(fmt(r100(x[1])))+'</dd>';}).join('')+
          (Math.abs(r.salary-tot-r.saveP50)>=100?'<dt>'+(r.salary-tot-r.saveP50>0?'Ups and downs, surprise buys':'Likely a bit under plan')+'</dt><dd>'+esc(fmtS(r100(r.salary-tot-r.saveP50)))+'</dd>':'')+
          '<dt class="tt-t">Expenses</dt><dd class="tt-t">'+esc(fmt(r100(r.salary-r.saveP50)))+'</dd><dt class="tt-t">Saved about</dt><dd class="tt-t">'+esc(fmtS(r100(r.saveP50)))+'</dd></dl>';}
      cross.setAttribute('x1',cx);cross.setAttribute('x2',cx);cross.removeAttribute('hidden');
      hov.setAttribute('cx',cx);hov.setAttribute('cy',cy.toFixed(1));hov.removeAttribute('hidden');
      if(UIref) UIref.showTip(h,e.clientX,e.clientY);
    };
    hit.addEventListener('pointermove',move);hit.addEventListener('pointerdown',move);
    hit.addEventListener('pointerleave',function(){cross.setAttribute('hidden','');hov.setAttribute('hidden','');if(UIref) UIref.hideTip();});
    // what the record says, next to what the projection says
    if(A>1){
      var f=past[0],l=past[A-1],per=(l.saved-f.saved)/(A-1);
      $('#ol-hist').innerHTML='Recorded: Pay myself went from <b>'+esc(fmt(f.saved))+'</b> in '+esc(f.full)+' to <b>'+esc(fmt(l.saved))+'</b> in '+esc(l.full)+', about <b>'+esc(fmtS(r100(per)))+'</b> a month. The projection expects about <b>'+esc(fmtS(r100(gain)))+'</b> a month from here.';
    }else $('#ol-hist').textContent='';
    // month by month
    $('#ol-table').innerHTML='<thead><tr><th>Cycle</th><th class="n">Salary</th><th class="n">Mama + Touheed</th><th class="n">Bills</th><th class="n">Spending</th><th class="n">Shopping</th><th class="n">Planned</th><th class="n">Saved (likely)</th><th class="n">Pay myself</th></tr></thead><tbody>'+
      R.past.filter(function(p){return p.day!==R.cur.start;}).map(function(p){return '<tr class="ol-rec"><td>'+esc(p.full)+' <small>recorded</small></td><td class="n" colspan="7"></td><td class="n">'+esc(fmt(p.saved))+'</td></tr>';}).join('')+
      rows.map(function(r,i){return '<tr><td>'+esc(r.m.name+' '+r.m.year)+'</td><td class="n">'+esc(fmt(r.salary))+'</td><td class="n">'+esc(fmt(r.mama+r.touheed))+'</td><td class="n">'+esc(fmt(r.bills))+'</td><td class="n">'+esc(fmt(r100(r.spend)))+'</td><td class="n'+(r.shop>S.limit?' ol-over':'')+'">'+esc(fmt(r.shop))+'</td><td class="n">'+(r.planned?esc(fmt(r.planned)):'–')+'</td><td class="n">'+esc(fmtS(r100(r.saveP50)))+'</td><td class="n">'+esc(fmt(r100(B[i].p50)))+'</td></tr>';}).join('')+'</tbody>';
  }

  // a bill's estimate for a cycle, shared with the Overview
  function billAmt(cycleStart,key){var o=(load().bills[String(cycleStart)]||{})[key];return o&&o.amt!=null?o.amt:null;}
  function setBillAmt(cycleStart,key,v){var s=load(),b=s.bills[String(cycleStart)]=s.bills[String(cycleStart)]||{};b[key]=b[key]||{};b[key].amt=v;save();}

  return {billAmt:billAmt,setBillAmt:setBillAmt,view:view,draw:draw,_model:model,_compute:compute,_inputs:inputs};
})();
