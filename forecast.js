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
      var h={name:c.name,len:len,food:0,shop:0,untracked:0,ride:rides[i].total,ess:{}};
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
      });
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
    var prevId=i>0?String(cyc[i-1].start):null;
    return {cur:cur,id:id,prev:i>0?cyc[i-1]:null,prevAdv:prevId?s.adv[prevId]||null:null,days:days,pay:pay,lastDay:pay-1,
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
          '<div class="fp-mode"><span class="lbl">Predict</span><div class="seg" role="group" aria-label="What to predict"><button type="button" data-mode="food" aria-pressed="'+foodMode+'">Food</button><button type="button" data-mode="shop" aria-pressed="'+!foodMode+'">Shopping</button></div></div></div>'+
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
    '</div>';
  }

  function draw(){
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
      var t=e.target,row=t.closest('[data-bill],[data-ess],[data-cap],[data-adv]');
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
      if(t.dataset.mode){if(s.mode!==t.dataset.mode){s.mode=t.dataset.mode;save();rerender();}}
      else if(t.dataset.ride){s.ride=t.dataset.ride;save();$$('[data-ride]',root).forEach(function(x){x.setAttribute('aria-pressed',String(x===t));});update();}
      else if(t.dataset.use){
        var box=t.closest('[data-cap]'),inp=$('input',box),u=+t.dataset.use;
        inp.value=u.toLocaleString('en-US');s[box.dataset.cap+'Cap']=u;save();update();
      }
      else if(t.dataset.add==='bill'){var o=bucket();o._extra=(o._extra||[]).concat([{label:'',amt:0}]);save();rerender(focusLast);}
      else if(t.dataset.add==='ess'){s.essExtra=(s.essExtra||[]).concat([{label:'',amt:0}]);save();rerender(focusLast);}
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
  function focusLast(){var l=$$('#fp .fp-lbl');if(l.length) l[l.length-1].focus();}
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
  }

  return {view:view,draw:draw,_model:model,_compute:compute,_inputs:inputs};
})();
