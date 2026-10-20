/* Forecast: can this month's Pay myself stay untouched until payday?

   A small budget for the rest of the current payday cycle (today until the 20th of
   next month, the latest payday). Column G's Remaining is the money there is, Pay
   myself already set aside. From it come:
   - bills and subscriptions still to pay (amounts editable, defaults from the sheet);
   - InDrive, at your low, average or high rate from past months;
   - a cap for shopping and personal care, and one for everything else;
   and what is left is the food budget. Or set the food budget and the rest is what
   shopping can use.
   Advances to Touheed or Mama come out of Pay myself, not this budget, and come back
   at the next payday, when that much less is owed.
   Inputs are kept in this browser. */
var Forecast=(function(){
  var L=window.Ledger,esc=L.esc,fmt=L.fmt,fmtS=L.fmtS,DAY=Logic.DAY,MON=Logic.MON;
  function $(s,r){return (r||document).querySelector(s);}
  function $$(s,r){return Array.prototype.slice.call((r||document).querySelectorAll(s));}
  var KEY='ledger.forecast.v2';
  var PEOPLE=[{key:'touheed',label:'Touheed',what:'transport fee',fee:27000},{key:'mama',label:'Mama',what:'groceries',fee:35000}];
  var RIDE_LV=[{k:'low',t:'Low'},{k:'avg',t:'Average'},{k:'high',t:'High'}];
  var BILL_RE=/claude|internet|amazon|youtube|netflix|subscri/;

  // ---------------------------------------------------------------- saved inputs
  var st=null;
  function load(){
    if(st) return st;
    try{st=JSON.parse(localStorage.getItem(KEY)||'null');}catch(e){st=null;}
    if(!st||typeof st!=='object') st={};
    st.bills=st.bills||{};st.adv=st.adv||{};st.fees=st.fees||{};
    return st;
  }
  function save(){try{localStorage.setItem(KEY,JSON.stringify(st));}catch(e){}}
  function amt(v){var n=Logic.num(v);return n==null||!isFinite(n)?0:Math.max(0,Math.round(n));}
  function r100(x){return Math.round(x/100)*100;}
  function fmtDay(n){var d=new Date(n*DAY);return d.getUTCDate()+' '+MON[d.getUTCMonth()];}
  function median(a){if(!a.length) return 0;a=a.slice().sort(function(x,y){return x-y;});var m=a.length>>1;return a.length%2?a[m]:(a[m-1]+a[m])/2;}
  function mean(a){return a.length?a.reduce(function(s,x){return s+x;},0)/a.length:0;}

  // ---------------------------------------------------------------- history
  // Per-day spend of each closed cycle, for food, shopping, InDrive and everything else.
  function rates(cyc,rides){
    var out=[];
    for(var i=Math.max(0,cyc.length-7);i<cyc.length-1;i++){
      var c=cyc[i],len=cyc[i+1].start-c.start;
      if(len<14) continue;
      var food=0,shop=0,other=0;
      c.tx.forEach(function(t){
        if(!(t.amt>0)) return;
        var cat=t.cat,s=(t.name+' '+t.desc).toLowerCase();
        if(cat==='food'){food+=t.amt;return;}
        if(cat==='shopping'){shop+=t.amt;return;}
        // not everyday spending: savings, money moved, Touheed, Mama, renovation, catch-up rows, bills
        if(/^(savings|transfer|influx|loaned|family\/home|renovation|untracked)$/.test(cat)) return;
        if(/tou?heed|tohid|\bmama\b|advance pay|\btransport\b/.test(s)||BILL_RE.test(s)) return;
        // one-off buys of 10,000 or more (an oven, a course) are not the usual month
        if(t.amt>=10000) return;
        if(/in\s*-?\s*drive/.test(s)||cat==='transport') return;
        other+=t.amt;
      });
      out.push({name:c.name,len:len,food:food/len,shop:shop/len,other:other/len,ride:rides[i].total/len,rideTot:rides[i].total});
    }
    return out;
  }
  // low / high average: the mean of the cheaper and of the dearer half of past months
  function rideLevels(h){
    var a=h.map(function(x){return x.ride;}).sort(function(x,y){return x-y;}),n=a.length,half=Math.max(1,Math.floor(n/2));
    return {low:mean(a.slice(0,half)),avg:mean(a),high:mean(a.slice(n-half))};
  }

  // ---------------------------------------------------------------- model
  function model(M){
    var cyc=Logic.cyclePeriods(M.parsed,M.today);
    if(!cyc.length) return {msg:'No payday cycles in the Tracking tab yet.'};
    var i=cyc.length-1,cur=cyc[i];
    if(!cur.bal) return {msg:'This needs the Remaining row in column G of '+cur.name+'.'};
    var pay=paydayAfter(cur,M.today),days=Math.max(1,pay-Math.max(M.today,cur.start));
    if(pay-cur.start>45) return {msg:'Payday has passed. Add the new month to the sheet to see its forecast.'};
    var s=load(),id=String(cur.start);
    var h=rates(cyc,Logic.rides(cyc));
    if(!h.length) return {msg:'Not enough history yet: the forecast needs at least one full month of entries.'};
    var saved=cur.tx.filter(function(t){return t.cat==='savings';}).reduce(function(a,t){return a+t.amt;},0);
    var sub=Logic.subscriptions(cyc,i),bs=s.bills[id]||{};
    var bills=sub.rows.map(function(r){
      var o=bs[r.key]||{};
      return {key:r.key,label:r.label,paid:r.status==='paid',when:r.when,def:Math.round(r.amount),
        amt:o.amt!=null?o.amt:Math.round(r.amount),on:o.on!=null?o.on:r.status!=='paid'};
    });
    (bs._extra||[]).forEach(function(x,j){bills.push({key:'x'+j,label:x.label||'',extra:true,amt:x.amt||0,on:true});});
    var lv=rideLevels(h),usual={food:median(h.map(function(x){return x.food;})),shop:mean(h.map(function(x){return x.shop;})),other:median(h.map(function(x){return x.other;}))};
    var prevId=i>0?String(cyc[i-1].start):null;
    return {cur:cur,id:id,prev:i>0?cyc[i-1]:null,prevAdv:prevId?s.adv[prevId]||null:null,days:days,pay:pay,lastDay:pay-1,
      remaining:cur.bal.remaining,saved:saved,bills:bills,hist:h,lv:lv,usual:usual,
      def:{shop:r100(usual.shop*days),other:r100(usual.other*days),foodDay:r100(usual.food)}};
  }
  function paydayAfter(p,today){
    var d=new Date(p.start*DAY),y=d.getUTCFullYear(),m=d.getUTCMonth()+1;
    var pay=Math.round(Date.UTC(y,m,Logic.PAYDAY_DOM)/DAY);
    while(pay<=today){m++;pay=Math.round(Date.UTC(y,m,Logic.PAYDAY_DOM)/DAY);}
    return pay;
  }
  function inputs(R){
    var s=load();
    return {mode:s.mode==='shop'?'shop':'food',ride:s.ride||'avg',
      shop:s.shop!=null?s.shop:R.def.shop,other:s.other!=null?s.other:R.def.other,foodDay:s.foodDay!=null?s.foodDay:R.def.foodDay,
      adv:s.adv[R.id]||{},fees:s.fees};
  }
  // the whole budget, from Remaining down to what food (or shopping) can use
  function compute(R,I){
    var bills=R.bills.reduce(function(a,b){return a+(b.on?b.amt:0);},0);
    var ride=r100(R.lv[I.ride]*R.days);
    var advIn=0,adv=0;
    PEOPLE.forEach(function(p){var a=I.adv[p.key]||{};adv+=a.amt||0;if(a.logged) advIn+=a.amt||0;});
    // an advance already logged in the sheet lowered Remaining, but it is paid out of Pay myself
    var money=R.remaining+advIn;
    var base=money-bills-ride-I.other;
    var food,shop,left;
    if(I.mode==='food'){shop=I.shop;food=base-shop;left=food;}
    else{food=I.foodDay*R.days;shop=base-food;left=shop;}
    return {money:money,advIn:advIn,adv:adv,bills:bills,ride:ride,other:I.other,shop:shop,food:food,left:left,kept:R.saved-adv};
  }

  // ---------------------------------------------------------------- view
  var R=null;
  function money(v,cls){return '<span class="fp-in'+(cls?' '+cls:'')+'"><span>Rs</span><input class="inline" inputmode="numeric" autocomplete="off" value="'+esc(v?Math.round(v).toLocaleString('en-US'):'0')+'"></span>';}
  function view(M,ui){
    R=model(M);
    if(R.msg) return '<section class="pnl"><div class="pnl-b"><div class="empty">'+esc(R.msg)+'</div></div></section>';
    var I=inputs(R),until=fmtDay(R.lastDay);
    var bills=R.bills.map(function(b){
      return '<div class="fp-row fp-bill'+(b.on?'':' off')+'" data-bill="'+esc(b.key)+'">'+
        '<label class="fp-chk"><input type="checkbox"'+(b.on?' checked':'')+' aria-label="Still to pay"></label>'+
        '<div class="fp-name">'+(b.extra?'<input class="inline fp-lbl" value="'+esc(b.label)+'" placeholder="Bill name" aria-label="Bill name">':esc(b.label))+
          '<small>'+(b.paid?'paid'+(b.when!=null?' '+esc(fmtDay(b.when)):'')+' · already out of Remaining':b.extra?'added by you':'due'+(b.when!=null?' '+esc(fmtDay(b.when)):''))+'</small></div>'+
        money(b.amt)+(b.extra?'<button type="button" class="x fp-del" aria-label="Remove">&times;</button>':'')+'</div>';
    }).join('');
    var lv=R.lv,rideSeg='<div class="seg fp-seg" role="group" aria-label="InDrive estimate">'+RIDE_LV.map(function(x){
      return '<button type="button" data-ride="'+x.k+'" aria-pressed="'+(I.ride===x.k)+'">'+x.t+'<small>'+esc(fmt(r100(lv[x.k]*R.days)))+'</small></button>';}).join('')+'</div>';
    var hist=R.hist.map(function(x){return '<span>'+esc(x.name.slice(0,3))+' <b>'+esc(fmt(x.rideTot))+'</b> <small>'+esc(fmt(x.ride))+'/day</small></span>';}).join('');
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
    return '<div class="plan" id="fp">'+
      '<section class="pnl m-hero fp-hero" id="fp-hero"><div class="pnl-b">'+
        '<div class="fp-top"><div class="m-q">Can your Pay myself of <b id="fp-saved">'+esc(fmt(R.saved))+'</b> stay untouched until '+esc(until)+'?</div>'+
          '<div class="seg" role="group" aria-label="What to work out"><button type="button" data-mode="food" aria-pressed="'+(I.mode==='food')+'">Food budget</button><button type="button" data-mode="shop" aria-pressed="'+(I.mode==='shop')+'">Shopping budget</button></div></div>'+
        '<div class="m-v"><span class="m-pill"><b id="fp-icon"></b><span id="fp-word"></span></span></div>'+
        '<div class="fp-ans"><div><div class="m-k" id="fp-ans-k"></div><div class="m-big" id="fp-ans"></div><div class="m-day" id="fp-ans-d"></div></div>'+
          '<div class="fp-food"'+(I.mode==='shop'?'':' hidden')+'><div class="fld"><span class="lbl">Food per day</span>'+money(I.foodDay,'food')+'</div><small>You usually spend about '+esc(fmt(R.usual.food))+' a day.</small></div></div>'+
        '<p class="m-lead" id="fp-lead"></p>'+
        '<dl class="ledger fp-sum" id="fp-sum"></dl>'+
      '</div></section>'+
      '<div class="fp-grid">'+
      ui.pnl('fp-bills','Bills and subscriptions','tick the ones still to pay',bills+
        '<div class="fp-foot"><button type="button" class="btn sm" id="fp-add-bill">+ Add bill</button><span class="fp-tot">Still to pay <b id="fp-bills-t"></b></span></div>',{cls:''})+
      ui.pnl('fp-caps','Caps','your limits until '+esc(until),
        '<div class="fp-row" data-cap="shop"><div class="fp-name">Shopping and personal care<small>outfits, toiletries, gifts · you usually spend about '+esc(fmt(r100(R.usual.shop*R.days)))+'</small></div>'+money(I.shop)+'<span class="fp-calc" hidden></span></div>'+
        '<div class="fp-row" data-cap="other"><div class="fp-name">Everything else<small>laundry, meds, repairs, fun · usually about '+esc(fmt(R.def.other))+'</small></div>'+money(I.other)+'</div>',{cls:''})+
      ui.pnl('fp-ride','InDrive','your rate from past months × '+R.days+' days',rideSeg+'<div class="fp-hist">'+hist+'</div>'+
        '<p class="fc-note">Low and high are the averages of your cheaper and dearer months. Rides you already took this month are in Remaining.</p>',{cls:''})+
      ui.pnl('fp-adv','Advance payments','paid from Pay myself, back next payday',prev+adv,{cls:''})+
      '</div>'+
      '<div class="fp-reset"><button type="button" class="btn ghost sm" id="fp-reset">Reset to defaults</button></div>'+
      '<details class="notes"><summary>How this is worked out</summary>'+
        '<p>Remaining comes from column G of '+esc(R.cur.name)+', with your Pay myself already set aside. Payday is taken as the 20th, the latest you usually get paid, so this covers '+R.days+' days, today to '+esc(until)+'.</p>'+
        '<p>Bills you tick are taken off. Paid ones are already out of Remaining, so they start unticked. InDrive is your per-day rate from your last '+R.hist.length+' full months times the days left. The caps start at your usual spending for this many days, then whatever you set.</p>'+
        '<p>An advance to Touheed or Mama is paid out of Pay myself, so it lowers what you keep this month but not this budget, and at the next payday you owe that much less. If you already logged it in the sheet, Remaining went down by it, so it is added back here.</p>'+
        '<p>What you enter here is kept in this browser.</p></details>'+
    '</div>';
  }

  function draw(){
    var root=$('#fp');if(!root||!R||R.msg) return;
    var s=load(),id=R.id;
    function bucket(){return s.bills[id]=s.bills[id]||{};}
    function adv(k){var a=s.adv[id]=s.adv[id]||{};return a[k]=a[k]||{};}
    root.addEventListener('input',function(e){
      var t=e.target,row=t.closest('[data-bill],[data-cap],[data-adv],.fp-food');
      if(!row) return;
      var v=amt(t.value);
      if(row.dataset.bill!=null){
        var k=row.dataset.bill,b=R.bills.find(function(x){return x.key===k;});
        if(t.classList.contains('fp-lbl')){b.label=t.value;}else if(t.type!=='checkbox'){b.amt=v;}
        storeBill(b);
      }else if(row.dataset.cap){s[row.dataset.cap]=v;}
      else if(row.dataset.adv){
        var a=adv(row.dataset.adv);
        if(t.type==='checkbox') a.logged=t.checked;
        else if(t.closest('.fp-fee')) s.fees[row.dataset.adv]=v;
        else a.amt=v;
      }else s.foodDay=v;
      save();update();
    });
    root.addEventListener('change',function(e){
      var t=e.target;
      if(t.type==='checkbox'&&t.closest('[data-bill]')){
        var k=t.closest('[data-bill]').dataset.bill,b=R.bills.find(function(x){return x.key===k;});
        b.on=t.checked;t.closest('.fp-row').classList.toggle('off',!b.on);storeBill(b);save();update();
      }
      // tidy the number once you leave the box
      if(t.matches('.fp-in input')) t.value=amt(t.value).toLocaleString('en-US');
    });
    function storeBill(b){
      var o=bucket();
      if(b.extra){var j=+b.key.slice(1);o._extra=o._extra||[];o._extra[j]={label:b.label,amt:b.amt};}
      else o[b.key]={amt:b.amt,on:b.on};
    }
    root.addEventListener('click',function(e){
      var t=e.target.closest('button');if(!t) return;
      if(t.dataset.mode){s.mode=t.dataset.mode;save();rerender();}
      else if(t.dataset.ride){s.ride=t.dataset.ride;save();$$('[data-ride]',root).forEach(function(x){x.setAttribute('aria-pressed',String(x===t));});update();}
      else if(t.id==='fp-add-bill'){var o=bucket();o._extra=(o._extra||[]).concat([{label:'',amt:0}]);save();rerender(function(){var l=$$('.fp-lbl');if(l.length) l[l.length-1].focus();});}
      else if(t.classList.contains('fp-del')){var j=+t.closest('[data-bill]').dataset.bill.slice(1),o2=bucket();o2._extra.splice(j,1);save();rerender();}
      else if(t.id==='fp-reset'){
        if(!confirm('Reset bills, caps and the InDrive choice to the defaults? Advances stay.')) return;
        delete s.bills[id];delete s.shop;delete s.other;delete s.ride;delete s.foodDay;save();rerender();
      }
    });
    update();
  }
  function rerender(then){
    var y=window.scrollY;if(window.LedgerUI) LedgerUI.rerender();window.scrollTo(0,y);if(then) then();
  }

  function update(){
    var I=inputs(R),C=compute(R,I),d=R.days,shopMode=I.mode==='shop';
    var lv,word,icon,lead,k,big,per;
    if(!shopMode){
      var fd=C.food/d,u=R.usual.food;
      lv=C.food<=0?'critical':fd>=u?'good':fd>=u*0.6?'warning':'critical';
      word=C.food<=0?'Pay myself will be touched':lv==='good'?'Pay myself stays untouched':lv==='warning'?'Tight, but doable':'Food money is too thin';
      k=C.food<=0?'Short by':'Food budget until '+fmtDay(R.lastDay);
      big=Math.abs(C.food);per=C.food>0?fmt(fd)+' a day':'nothing left for food';
      lead=C.food<=0
        ?'Your bills, InDrive and caps already need '+fmt(-C.food)+' more than you have. That, and all your food, would come out of Pay myself. Lower a cap to make room.'
        :lv==='good'?'Keep food under '+fmt(fd)+' a day and stick to your caps, and Pay myself stays untouched. You usually spend about '+fmt(u)+' a day on food.'
        :'That is '+fmt(fd)+' a day for food, less than the '+fmt(u)+' you usually spend. Stay under it, or lower a cap, to keep Pay myself untouched.';
    }else{
      lv=C.shop<0?'critical':C.shop<r100(R.usual.shop*d)*0.5?'warning':'good';
      word=C.shop<0?'Pay myself will be touched':lv==='good'?'Pay myself stays untouched':'Tight, but doable';
      k=C.shop<0?'Short by':'Shopping and personal care until '+fmtDay(R.lastDay);
      big=Math.abs(C.shop);per=C.shop>0?fmt(C.shop/d)+' a day':'nothing left for shopping';
      lead=C.shop<0
        ?'Food at '+fmt(I.foodDay)+' a day plus your bills, InDrive and other spending come to '+fmt(-C.shop)+' more than you have. That would come out of Pay myself, before any shopping.'
        :'With food at '+fmt(I.foodDay)+' a day, you can spend up to '+fmt(C.shop)+' on outfits and personal care and keep Pay myself untouched.';
    }
    var hero=$('#fp-hero');hero.className='pnl m-hero fp-hero m-'+lv;
    $('#fp-icon').textContent={good:'✓',warning:'!',critical:'✕'}[lv];
    $('#fp-word').textContent=word;$('#fp-ans-k').textContent=k;
    var a=$('#fp-ans');a.textContent=fmt(big);a.classList.toggle('neg',shopMode?C.shop<0:C.food<=0);
    $('#fp-ans-d').textContent=per;$('#fp-lead').textContent=lead;
    var row=function(t,v,cls){return '<div'+(cls?' class="'+cls+'"':'')+'><dt>'+esc(t)+'</dt><dd>'+v+'</dd></div>';},neg=function(v){return '−'+esc(fmt(v));};
    $('#fp-sum').innerHTML=
      row('Remaining (column G)',esc(fmtS(R.remaining)))+
      (C.advIn?row('Advances already logged, paid from Pay myself','+'+esc(fmt(C.advIn))):'')+
      row('Bills still to pay',neg(C.bills))+
      row('InDrive ('+{low:'low',avg:'average',high:'high'}[I.ride]+')',neg(C.ride))+
      row('Everything else',neg(C.other))+
      (shopMode?row('Food, '+fmt(I.foodDay)+' a day × '+d,neg(C.food))+row('Left for shopping and personal care',esc(fmtS(C.shop)),'tot'+(C.shop<0?' neg':''))
               :row('Shopping and personal care',neg(C.shop))+row('Left for food',esc(fmtS(C.food)),'tot'+(C.food<0?' neg':'')))+
      row('Pay myself kept'+(C.adv?', after '+fmt(C.adv)+' in advances (back next payday)':''),esc(fmt(C.kept)));
    $('#fp-bills-t').textContent=fmt(C.bills);
    var sc=$('[data-cap="shop"]');
    $('.fp-in',sc).hidden=shopMode;var calc=$('.fp-calc',sc);calc.hidden=!shopMode;calc.textContent=fmtS(C.shop);calc.classList.toggle('neg',C.shop<0);
    $('.fp-food').hidden=!shopMode;
    PEOPLE.forEach(function(p){
      var a=I.adv[p.key]||{},fee=I.fees[p.key]!=null?I.fees[p.key]:p.fee,n=$('[data-next="'+p.key+'"]');
      n.textContent=a.amt?'Next payday you pay '+fmt(Math.max(0,fee-a.amt))+' instead of '+fmt(fee)+', and '+fmt(Math.min(a.amt,fee))+' goes back to Pay myself.':'No advance this month.';
    });
  }

  return {view:view,draw:draw,_model:model,_compute:compute,_inputs:inputs};
})();
