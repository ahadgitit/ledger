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
    return {past:past,cur:cur,id:id,prev:i>0?cyc[i-1]:null,prevAdv:prevId?s.adv[prevId]||null:null,days:days,pay:pay,lastDay:pay-1,
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
    var cap=I.mode==='food'?I.shopCap:I.foodCap;
    var left=cap==null?null:base-cap;
    return {money:money,advIn:advIn,adv:adv,bills:bills,ess:ess,ride:ride,base:base,cap:cap,left:left,kept:R.saved-adv};
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
    R=model(M);
    if(R.msg) return '<section class="pnl"><div class="pnl-b"><div class="empty">'+esc(R.msg)+'</div></div></section>';
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
      return '<div class="fp-cap" data-cap="'+which+'"><div class="fld"><span class="lbl">Your '+(which==='food'?'food':'shopping')+' cap until '+esc(until)+' <em>required</em></span>'+
        money(I[which+'Cap'],'','Enter a cap')+'</div>'+
        '<button type="button" class="btn sm fp-use" data-use="'+usual+'">Use my usual, '+esc(fmt(usual))+'</button>'+
        '<p class="fp-capd" data-capd="'+which+'"></p></div>';
    };
    var result=function(which){return '<div class="fp-pred"><span class="lbl">Predicted '+(which==='food'?'food':'shopping')+' budget</span><b id="fp-pred"></b><small id="fp-pred-d"></small></div>';};
    return '<div class="plan" id="fp">'+
      '<section class="pnl m-hero fp-hero" id="fp-hero"><div class="pnl-b">'+
        '<div class="fp-top"><div class="m-q">Can your Pay myself of <b>'+esc(fmt(R.saved))+'</b> stay untouched until '+esc(until)+'?</div>'+
          '<div class="fp-mode"><span class="lbl">Predict</span><div class="seg" role="group" aria-label="What to predict"><button type="button" data-pmode="food" aria-pressed="'+foodMode+'">Food</button><button type="button" data-pmode="shop" aria-pressed="'+!foodMode+'">Shopping</button></div></div></div>'+
        '<div class="m-v"><span class="m-pill"><b id="fp-icon"></b><span id="fp-word"></span></span></div>'+
        '<div class="m-k" id="fp-ans-k"></div><div class="m-big" id="fp-ans"></div><div class="m-day" id="fp-ans-d"></div>'+
        '<p class="m-lead" id="fp-lead"></p>'+
        '<dl class="ledger fp-sum" id="fp-sum"></dl>'+
      '</div></section>'+
      '<div class="fp-grid">'+
      ui.pnl('fp-food','Food','what you spent each month',
        (foodMode?result('food'):capBox('food',usualFood))+foodChart()+
        '<p class="fc-note">You usually spend about '+esc(fmt(R.usual.food))+' a day on food, about '+esc(fmt(usualFood))+' over these '+d+' days. Lighter bars are months with untracked catch-up rows, so they were really higher.</p>',{cls:''})+
      ui.pnl('fp-shop','Shopping and outfits','clothes, perfume, gifts, gadgets',
        (foodMode?capBox('shop',usualShop):result('shop'))+
        '<div class="fp-hist">'+shist+'</div><p class="fc-note">About '+esc(fmt(usualShop))+' over '+d+' days, going by your past months.</p>',{cls:''})+
      ui.pnl('fp-bills','Bills and subscriptions','tick the ones still to pay',bills+
        '<div class="fp-foot"><button type="button" class="btn sm" data-add="bill">+ Add bill</button><span class="fp-tot">Still to pay <b id="fp-bills-t"></b></span></div>',{cls:''})+
      ui.pnl('fp-ess','Monthly essentials','predicted from past months · edit any',ess+
        '<div class="fp-foot"><button type="button" class="btn sm" data-add="ess">+ Add expense</button><span class="fp-tot">Total <b id="fp-ess-t"></b></span></div>',{cls:''})+
      ui.pnl('fp-ride','InDrive','your rate from past months × '+d+' days',rideSeg+'<div class="fp-hist">'+rhist+'</div>'+
        '<p class="fc-note">Low and high are the averages of your cheaper and dearer months. Rides you already took this month are in Remaining.</p>',{cls:''})+
      ui.pnl('fp-adv','Advance payments','paid from Pay myself, back next payday',prev+adv,{cls:''})+
      '</div>'+
      '<div class="fp-reset"><button type="button" class="btn ghost sm" id="fp-reset">Reset to defaults</button></div>'+
      '<details class="notes"><summary>How this is worked out</summary>'+
        '<p>Remaining comes from column G of '+esc(R.cur.name)+', with your Pay myself already set aside. Payday is taken as the 20th, the latest you usually get paid, so this covers '+d+' days, today to '+esc(until)+'.</p>'+
        '<p>Bills you tick, your monthly essentials and InDrive are taken off. Paid bills are already out of Remaining, so they start unticked. Essentials and InDrive start at your average per day over your last '+R.hist.length+' full months, times the days left.</p>'+
        '<p>Predict food: your shopping cap is taken off too, and what is left is for food. Predict shopping: your food cap is taken off, and what is left is for shopping.</p>'+
        '<p>An advance to Touheed or Mama is paid out of Pay myself, so it lowers what you keep this month but not this budget, and at the next payday you owe that much less. If you already logged it in the sheet, Remaining went down by it, so it is added back here.</p>'+
        '<p>What you enter here is kept in this browser.</p></details>'+
      outlookView()+
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
      }else if(row.dataset.cap){s[row.dataset.cap+'Cap']=v;}
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
      var t=e.target.closest('button');if(!t) return;
      if(t.dataset.pmode){if(s.mode!==t.dataset.pmode){s.mode=t.dataset.pmode;save();rerender();}}
      else if(t.dataset.ride){s.ride=t.dataset.ride;save();$$('[data-ride]',root).forEach(function(x){x.setAttribute('aria-pressed',String(x===t));});update();}
      else if(t.dataset.use){
        var box=t.closest('[data-cap]'),inp=$('input',box),u=+t.dataset.use;
        inp.value=u.toLocaleString('en-US');s[box.dataset.cap+'Cap']=u;save();update();
      }
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
    update();
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
      var pd=C.left/d;
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
      row('Your '+capWhat+' cap',C.cap==null?'<span class="fp-miss">not set</span>':neg(C.cap))+
      row('Left for '+what,C.left==null?'–':esc(fmtS(C.left)),'tot'+(C.left!=null&&C.left<0?' neg':''))+
      row('Pay myself kept'+(C.adv?', after '+fmt(C.adv)+' in advances (back next payday)':''),esc(fmt(C.kept)));
    $('#fp-bills-t').textContent=fmt(C.bills);
    $('#fp-ess-t').textContent=fmt(C.ess);
    // the predicted side
    var pv=$('#fp-pred');
    pv.textContent=C.left==null?'Set your '+capWhat+' cap first':fmtS(C.left);
    pv.classList.toggle('neg',C.left!=null&&C.left<=0);pv.classList.toggle('miss',C.left==null);
    $('#fp-pred-d').textContent=C.left!=null&&C.left>0?fmt(C.left/d)+' a day':'';
    var cd=$('[data-capd]');
    if(cd) cd.textContent=C.cap!=null?fmt(C.cap/d)+' a day over '+d+' days':'';
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
      level:s.level||'same',hz:s.hz===12?12:6,lumps:s.lumps!==false,planned:s.planned||[]};
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
  // what is left of this cycle when it ends: a shortfall comes out of Pay myself
  function startBalance(I,C){
    var d=R.days,food=I.mode==='food',usualFood=R.usual.food*d,usualShop=R.usual.shop*d;
    var end=C.left!=null?C.left-(food?usualFood:usualShop):C.base-usualFood-usualShop;
    return {bal:C.kept+Math.min(0,end),dip:Math.min(0,end)};
  }
  function simulate(I,C){
    var O=oInputs(),P=monthPlan(I,C),lv=LEVELS.find(function(x){return x.k===O.level;}).f;
    var H=O.hz,M=months(12).slice(0,H),st0=startBalance(I,C);
    var plan={};O.planned.forEach(function(p){if(p.amt>0) plan[p.ym]=(plan[p.ym]||0)+p.amt;});
    var advT=(I.adv.touheed||{}).amt||0,advM=(I.adv.mama||{}).amt||0;
    // how each past month's everyday spending ran against the average
    var per=R.hist.map(function(x){return x.vari/x.len;}),avg=mean(per)||1;
    var ratios=per.map(function(v){return v/avg;});
    var lumps=[];R.hist.forEach(function(x){lumps=lumps.concat(x.lumps);});
    var lam=O.lumps?lumps.length/R.hist.length:0;
    var rows=M.map(function(m,i){
      var sal=i===0&&O.next!=null?O.next:O.base;
      var mama=Math.max(0,P.mama-(i===0?advM:0)),tou=Math.max(0,P.touheed-(i===0?advT:0));
      var spend=P.variable*lv;
      return {m:m,salary:sal,mama:mama,touheed:tou,bills:P.bills,spend:spend,planned:plan[m.ym]||0,
        save:sal-mama-tou-P.bills-spend-(plan[m.ym]||0)};
    });
    var r=rng(R.id*31+H),paths=[];for(var j=0;j<H;j++) paths.push([]);
    var saves=[];for(var j2=0;j2<H;j2++) saves.push([]);
    for(var s=0;s<OSIMS;s++){
      var bal=st0.bal;
      for(var i=0;i<H;i++){
        var row=rows[i],v=row.spend*ratios[Math.floor(r()*ratios.length)],l=0,n=poisson(lam,r);
        for(var k=0;k<n;k++) l+=lumps[Math.floor(r()*lumps.length)];
        var sv=row.salary-row.mama-row.touheed-row.bills-v-l-row.planned;
        bal+=sv;paths[i].push(bal);saves[i].push(sv);
      }
    }
    var asc=function(a,b){return a-b;};
    var band=paths.map(function(a){a.sort(asc);return {p10:q(a,0.1),p25:q(a,0.25),p50:q(a,0.5),p75:q(a,0.75),p90:q(a,0.9)};});
    saves.forEach(function(a,i){a.sort(asc);rows[i].saveP50=q(a,0.5);});
    return {O:O,P:P,lv:lv,rows:rows,band:band,start:st0,lam:lam,lumpAvg:lumps.length?mean(lumps):0,spread:ratios};
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
        '<div class="fld"><span class="lbl">Spending in the coming months, against this month</span>'+lvSeg+'</div>'+
      '</div>'+
      '<div class="ol-stats" id="ol-stats"></div>'+
      '<div class="ol-chart" id="ol-chart"></div>'+
      '<div class="legend sm"><span><i class="sw ol-actsw"></i>Recorded Pay myself</span><span><i class="sw c1"></i>Most likely</span><span><i class="sw ol-bandsw"></i>Likely range (8 in 10 futures)</span><span><i class="sw ol-plansw"></i>Planned expense</span></div>'+
      '<p class="ol-month" id="ol-hist"></p><p class="ol-month" id="ol-month"></p>'+
      '<div class="ol-sub"><div class="ol-subh"><span class="lbl">Planned expenses</span><label class="fp-logged ol-lumps" data-out="lumps"><input type="checkbox"'+(O.lumps?' checked':'')+'> Allow for surprise buys</label></div>'+
        planned+'<div class="fp-foot"><button type="button" class="btn sm" data-add="plan">+ Add planned expense</button><span class="fp-tot" id="ol-lumpnote"></span></div></div>'+
      '<details class="notes ol-tbl"><summary>Month by month</summary><div class="tbl-w"><table class="tbl" id="ol-table"></table></div></details>'+
    '</div></section>';
  }

  var UIref=null;
  function drawOutlook(I,C){
    var box=$('#ol-chart');if(!box) return;
    var S=simulate(I,C),O=S.O,P=S.P,B=S.band,rows=S.rows,H=rows.length,last=B[H-1];
    var monthly=rows[H>1?1:0].save;
    // the typical month, from where the most likely line goes (planned expenses left out)
    var gain=(last.p50-S.start.bal+rows.reduce(function(a,r){return a+r.planned;},0)-(rows[0].salary-O.base))/H;
    var tile=function(k,v,sub,cls){return '<div><span>'+esc(k)+'</span><b class="'+(cls||'')+'">'+v+'</b><small>'+sub+'</small></div>';};
    $('#ol-stats').innerHTML=
      tile('Pay myself by '+rows[H-1].m.name+' '+rows[H-1].m.year,esc(fmt(r100(last.p50))),'likely, from '+esc(fmt(r100(S.start.bal)))+' now')+
      tile('Saved a month, likely',esc(fmtS(r100(gain))),'plan alone: '+esc(fmtS(r100(monthly)))+(O.lumps&&S.lam>0?', before surprise buys':''),gain<0?'neg':'')+
      tile('Likely range',esc(K(last.p10))+' – '+esc(K(last.p90)),'8 in 10 futures land here');
    $('#ol-month').innerHTML='Each month: salary '+esc(fmt(O.base))+' − Mama '+esc(fmt(P.mama))+' − Touheed '+esc(fmt(P.touheed))+' − bills '+esc(fmt(P.bills))+
      ' − food '+esc(fmt(r100(P.parts.food*S.lv)))+' ('+P.foodSrc+') − shopping '+esc(fmt(r100(P.parts.shop*S.lv)))+' ('+P.shopSrc+') − essentials '+esc(fmt(r100(P.parts.ess*S.lv)))+' − InDrive '+esc(fmt(r100(P.parts.ride*S.lv)))+
      ' = <b>'+esc(fmtS(r100(monthly+0)))+'</b> saved'+(S.start.dip<0?'. This month’s shortfall of about '+esc(fmt(r100(-S.start.dip)))+' comes out first.':'.');
    $('#ol-lumpnote').textContent=O.lumps&&S.lam>0?'Surprise buys of Rs 10,000+: about '+(Math.round(S.lam*10)/10)+' a month, '+K(S.lumpAvg)+' each':'';
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
        h='<div class="tt-h">End of '+esc(r.m.name+' '+r.m.year)+' cycle</div><div class="tt-b">Likely '+esc(fmt(r100(b.p50)))+'<br>Range '+esc(fmt(r100(b.p10)))+' – '+esc(fmt(r100(b.p90)))+
        '<br>Salary '+esc(fmt(r.salary))+' · saved about '+esc(fmtS(r100(r.saveP50)))+(r.planned?'<br>Planned: '+esc(fmt(r.planned)):'')+'</div>';}
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
    $('#ol-table').innerHTML='<thead><tr><th>Cycle</th><th class="n">Salary</th><th class="n">Mama + Touheed</th><th class="n">Bills</th><th class="n">Spending</th><th class="n">Planned</th><th class="n">Saved (likely)</th><th class="n">Pay myself</th></tr></thead><tbody>'+
      R.past.filter(function(p){return p.day!==R.cur.start;}).map(function(p){return '<tr class="ol-rec"><td>'+esc(p.full)+' <small>recorded</small></td><td class="n" colspan="6"></td><td class="n">'+esc(fmt(p.saved))+'</td></tr>';}).join('')+
      rows.map(function(r,i){return '<tr><td>'+esc(r.m.name+' '+r.m.year)+'</td><td class="n">'+esc(fmt(r.salary))+'</td><td class="n">'+esc(fmt(r.mama+r.touheed))+'</td><td class="n">'+esc(fmt(r.bills))+'</td><td class="n">'+esc(fmt(r100(r.spend)))+'</td><td class="n">'+(r.planned?esc(fmt(r.planned)):'–')+'</td><td class="n">'+esc(fmtS(r100(r.saveP50)))+'</td><td class="n">'+esc(fmt(r100(B[i].p50)))+'</td></tr>';}).join('')+'</tbody>';
  }

  // a bill's estimate for a cycle, shared with the Overview
  function billAmt(cycleStart,key){var o=(load().bills[String(cycleStart)]||{})[key];return o&&o.amt!=null?o.amt:null;}
  function setBillAmt(cycleStart,key,v){var s=load(),b=s.bills[String(cycleStart)]=s.bills[String(cycleStart)]||{};b[key]=b[key]||{};b[key].amt=v;save();}

  return {billAmt:billAmt,setBillAmt:setBillAmt,view:view,draw:draw,_model:model,_compute:compute,_inputs:inputs};
})();
