/* Writing to the sheet: the Add entry form and the Balances editor.
   Rows go into columns A-F directly after the last entry of the latest month block,
   matching how entries are typed by hand: text dates (dd/mm/yyyy), numeric amounts,
   money coming in as a negative number. Balances are the cells under the ABL,
   Sadapay and Cash labels in that month's column G block. */
(function(){
  var L=window.Ledger;
  if(!L) return;
  var esc=L.esc,fmt=L.fmt;
  function $(s,root){return (root||document).querySelector(s);}
  function $$(s,root){return Array.prototype.slice.call((root||document).querySelectorAll(s));}
  function cell(r,i){r=r||[];return String(r[i]==null?'':r[i]).trim();}
  function filled(r){return (r||[]).slice(0,6).some(function(x){return String(x==null?'':x).trim()!=='';});}
  function numOr0(s){var n=Logic.num(s);return isNaN(n)?0:n;}
  function group(n){return Math.abs(Math.round(n)).toLocaleString('en-US');}
  function sheetAmt(n){return n<0?'('+group(n)+')':group(n);}

  var CATS=[
    {v:'Food'},{v:'Transport'},{v:'Utilities'},{v:'Family/Home'},{v:'Shopping'},{v:'Fun'},
    {v:'Renovation'},{v:'loaned',l:'Loaned'},{v:'untracked',l:'Untracked'},{v:'savings',l:'Savings'},
    {v:'transfer',l:'Transfer'},{v:'influx',l:'Money in'}
  ];
  var MODES=['Sadapay','Cash','ABL'];
  var GUESS=[
    [/pay myself|saving/,'savings'],
    [/transfer|cash ?out|exchange/,'transfer'],
    [/in ?drive|careem|uber|fare|transport|petrol|fuel|ride|rickshaw/,'Transport'],
    [/lunch|dinner|breakfast|snack|naan|roti|bryani|biryani|chaat|pizza|burger|cake|ice ?cream|sweet|food|yog|milk|tea|coffee|shake/,'Food'],
    [/grocer|internet|bill|subscri|claude|amazon|repair|laundry|medicine|meds|therapy|shampoo|soap|deod|groom|haircut/,'Utilities'],
    [/shirt|shoe|perfume|outfit|cloth|trouser|watch|specs|glasses/,'Shopping'],
    [/youtube|netflix|cinema|movie|ticket|gift|treat|outing/,'Fun'],
    [/loan|lent/,'loaned']
  ];
  function catLabel(v){for(var i=0;i<CATS.length;i++) if(CATS[i].v===v) return CATS[i].l||CATS[i].v;return v;}
  function catValue(lower){
    lower=String(lower||'').toLowerCase();
    for(var i=0;i<CATS.length;i++) if(CATS[i].v.toLowerCase()===lower) return CATS[i].v;
    return null;
  }

  // ---- what the sheet looks like now ----
  function headings(rows){
    var out=[];
    (rows||[]).forEach(function(r,i){if(Logic.isHeading(r)) out.push(i);});
    return out;
  }
  function placement(rows){
    var hs=headings(rows);
    if(!hs.length) return null;
    var h=hs[hs.length-1],last=h;
    for(var i=h+1;i<rows.length;i++) if(filled(rows[i])) last=i;
    return {cycle:cell(rows[h],0),row:last+2};
  }
  var ACCT={abl:'ABL',sadapay:'Sadapay','sada pay':'Sadapay',cash:'Cash','at home':'At home'};
  function blocks(rows){
    var hs=headings(rows);
    return hs.map(function(h,k){
      var end=k+1<hs.length?hs[k+1]-1:rows.length-1;
      var acc={},order=[];
      for(var i=h;i<end;i++){
        var key=ACCT[cell(rows[i],6).toLowerCase()];
        if(key&&!acc[key]){acc[key]={name:key,label:i+1,row:i+2,value:numOr0(cell(rows[i+1],6)),raw:cell(rows[i+1],6)};order.push(key);}
      }
      return {name:cell(rows[h],0),head:h+1,acc:acc,order:order};
    }).filter(function(b){return b.order.length;});
  }
  function memory(){
    var all=Logic.parseTracking(L.S.tracking||[]).all;
    var by={},recent={};
    all.forEach(function(t,i){
      var name=t.name.trim(),k=name.toLowerCase();
      if(!k) return;
      var e=by[k]||(by[k]={name:name,n:0,descs:[]});
      e.n++;e.name=name;e.cat=catValue(t.cat);e.mode=t.mode;e.neg=t.amt<0;
      var d=t.desc.trim();
      if(d){var j=e.descs.indexOf(d);if(j>=0) e.descs.splice(j,1);e.descs.push(d);}
      if(i>=all.length-150) recent[k]=(recent[k]||0)+1;
    });
    var top=Object.keys(recent).sort(function(a,b){return recent[b]-recent[a];}).slice(0,10).map(function(k){return by[k].name;});
    return {by:by,top:top};
  }

  // ---- dates in the sheet's own time zone ----
  function karachi(offsetDays){
    var d=new Date(Date.now()+(offsetDays||0)*86400000);
    var p=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Karachi',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d);
    var o={};p.forEach(function(x){o[x.type]=x.value;});
    return o.year+'-'+o.month+'-'+o.day;
  }
  function toSheetDate(iso){var m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(iso||'');return m?m[3]+'/'+m[2]+'/'+m[1]:'';}

  // ---- writing ----
  function needToken(){
    // Called straight from a click so Google's sign-in popup is allowed to open.
    return L.hasToken()?Promise.resolve():L.signIn();
  }
  function fail(e){return L.errMsg(e);}

  // ---- toast ----
  var toastTimer=0;
  function toast(msg,actions){
    var t=$('#toast');
    t.innerHTML='<span class="toast-msg">'+esc(msg)+'</span>'+(actions||[]).map(function(a,i){return '<button type="button" data-i="'+i+'">'+esc(a.label)+'</button>';}).join('')+'<button type="button" class="toast-x" aria-label="Dismiss">×</button>';
    $$('button',t).forEach(function(b){
      b.onclick=function(){
        // Only buttons with data-i are actions; the \u00d7 button just dismisses.
        var i=b.getAttribute('data-i'),a=i==null?null:(actions||[])[+i];
        hideToast();
        if(a) a.run();
      };
    });
    t.hidden=false;
    // Re-open as a popover so it sits above any open dialog.
    if(t.showPopover){try{t.hidePopover();}catch(x){}try{t.showPopover();}catch(x){}}
    requestAnimationFrame(function(){t.classList.add('on');});
    clearTimeout(toastTimer);
    toastTimer=setTimeout(hideToast,actions&&actions.length?10000:5000);
  }
  function hideToast(){var t=$('#toast');t.classList.remove('on');clearTimeout(toastTimer);setTimeout(function(){if(t.classList.contains('on')) return;t.hidden=true;if(t.hidePopover){try{t.hidePopover();}catch(x){}}},200);}

  // =====================================================================
  // Add entry
  // =====================================================================
  var F,mem={by:{},top:[]};
  function freshForm(keep){
    F={dir:'out',amount:'',name:'',desc:'',cat:null,mode:keep&&keep.mode||'Sadapay',other:'',date:keep&&keep.date||karachi(0),adjust:true,touched:{}};
  }
  function openAdd(){
    mem=memory();
    freshForm();
    drawAdd();
    var d=$('#add-dlg');
    if(!d.open) d.showModal();
    setTimeout(function(){var a=$('#f-amount');if(a&&!userFocused('#add-dlg')) a.focus();},30);
  }
  function applyName(){
    var e=mem.by[F.name.trim().toLowerCase()];
    if(e){
      if(!F.touched.cat&&e.cat) F.cat=e.cat;
      if(!F.touched.mode&&e.mode&&MODES.indexOf(e.mode)>=0) F.mode=e.mode;
      if(!F.touched.dir) F.dir=e.neg?'in':'out';
    }else if(!F.touched.cat){
      var n=F.name.toLowerCase(),g=null;
      for(var i=0;i<GUESS.length;i++) if(GUESS[i][0].test(n)){g=GUESS[i][1];break;}
      F.cat=g||(F.dir==='in'?'influx':null);
    }
    if(F.cat==='influx') F.dir='in';
  }
  function amountNum(){var n=Logic.num(F.amount);return isNaN(n)?NaN:Math.abs(n);}
  function signed(){var n=amountNum();return F.dir==='in'?-n:n;}
  function modeValue(){return F.mode==='Other'?F.other.trim():F.mode;}
  // The account this entry moves: spending lowers it, money in raises it, as in the
  // sheet's offset check. Savings rows ("Pay myself") are already counted, so skip them.
  function adjustment(rows){
    var acct=Logic.normMode(modeValue());
    if(['ABL','Sadapay','Cash'].indexOf(acct)<0) return {skip:'Only ABL, Sadapay and Cash balances are kept in column G.'};
    if(F.cat==='savings') return {skip:'Savings rows do not change the balances.'};
    var hs=headings(rows);
    if(!hs.length) return null;
    var b=blocks(rows).filter(function(x){return x.head===hs[hs.length-1]+1;})[0];
    var a=b&&b.acc[acct];
    if(!a) return {skip:'This month has no '+acct+' row in column G.'};
    var n=signed();
    return {acct:acct,row:a.row,old:a.value,next:isNaN(n)?a.value:a.value-n,cycle:b.name};
  }
  function problems(){
    var p=[];
    var n=amountNum();
    if(!(n>0)) p.push('amount');
    if(!F.name.trim()) p.push('what it was');
    if(!F.cat) p.push('category');
    if(!modeValue()) p.push('payment mode');
    if(!toSheetDate(F.date)) p.push('date');
    return p;
  }
  function pickHTML(name,items,sel){
    return items.map(function(it){
      var v=typeof it==='string'?it:it.v,l=typeof it==='string'?it:(it.l||it.v);
      return '<button type="button" class="pick" data-pick="'+name+'" data-v="'+esc(v)+'" aria-pressed="'+(v===sel)+'">'+esc(l)+'</button>';
    }).join('');
  }
  function drawAdd(){
    var e=mem.by[F.name.trim().toLowerCase()];
    var descs=e?e.descs.slice(-6).reverse():[];
    var today=karachi(0),yest=karachi(-1);
    var body=$('#add-body');
    body.innerHTML=
      '<div class="seg dir" role="group" aria-label="Direction">'+
        '<button type="button" data-dir="out" aria-pressed="'+(F.dir==='out')+'">Money out</button>'+
        '<button type="button" data-dir="in" aria-pressed="'+(F.dir==='in')+'">Money in</button></div>'+
      '<label class="amt'+(F.dir==='in'?' in':'')+'"><span>'+(F.dir==='in'?'+ Rs':'Rs')+'</span><input id="f-amount" inputmode="decimal" autocomplete="off" placeholder="0" aria-label="Amount" value="'+esc(F.amount)+'"></label>'+
      '<div class="fld"><label for="f-name">What was it?</label><input id="f-name" list="names" autocomplete="off" placeholder="lunch, indrive, groceries…" value="'+esc(F.name)+'">'+
        (mem.top.length?'<div class="picks">'+mem.top.map(function(n){return '<button type="button" class="pick soft" data-name="'+esc(n)+'" aria-pressed="'+(n.toLowerCase()===F.name.trim().toLowerCase())+'">'+esc(n)+'</button>';}).join('')+'</div>':'')+'</div>'+
      '<div class="fld"><label for="f-desc">Description</label><input id="f-desc" autocomplete="off" placeholder="'+(/drive/i.test(F.name)?'home to office':'a few words')+'" value="'+esc(F.desc)+'">'+
        (descs.length?'<div class="picks">'+descs.map(function(d){return '<button type="button" class="pick soft" data-desc="'+esc(d)+'">'+esc(d)+'</button>';}).join('')+'</div>':'')+'</div>'+
      '<div class="fld"><span class="lbl">Category</span><div class="picks">'+pickHTML('cat',CATS,F.cat)+'</div></div>'+
      '<div class="fld"><span class="lbl">Paid with</span><div class="picks">'+pickHTML('mode',MODES,F.mode)+
        (F.mode==='Other'?'<input id="f-other" class="inline" autocomplete="off" placeholder="payment mode" value="'+esc(F.other)+'">':'')+'</div>'+
        '<div id="adjust-box"></div></div>'+
      '<div class="fld"><span class="lbl">Date</span><div class="picks">'+
        '<button type="button" class="pick" data-date="'+today+'" aria-pressed="'+(F.date===today)+'">Today</button>'+
        '<button type="button" class="pick" data-date="'+yest+'" aria-pressed="'+(F.date===yest)+'">Yesterday</button>'+
        '<input id="f-date" type="date" class="inline" value="'+esc(F.date)+'" max="'+today+'" aria-label="Pick a date"></div></div>'+
      '<div class="receipt" id="receipt"></div>';
    var dl=$('#names');
    dl.innerHTML=Object.keys(mem.by).map(function(k){return '<option value="'+esc(mem.by[k].name)+'">';}).join('');
    drawReceipt();
  }
  function drawReceipt(){
    var r=$('#receipt');
    if(!r) return;
    var pl=placement(L.S.tracking||[]);
    var n=amountNum();
    var cells=[F.name.trim()||'…',n>0?sheetAmt(signed()):'…',F.desc.trim()||'–',toSheetDate(F.date)||'…',modeValue()||'…',F.cat||'…'];
    r.innerHTML='<div class="r-h">'+(pl?'Goes into <b>'+esc(pl.cycle)+'</b>, row '+pl.row:'Goes after your last entry')+'</div>'+
      '<div class="r-row">'+cells.map(function(c,i){return '<span'+(i===1?' class="r-n'+(F.dir==='in'?' in':'')+'"':'')+'>'+esc(c)+'</span>';}).join('')+'</div>';
    var box=$('#adjust-box');
    if(box){
      var adj=adjustment(L.S.tracking||[]);
      if(!adj) box.innerHTML='';
      else if(adj.skip) box.innerHTML='<div class="adjust off"><span>'+esc(adj.skip)+'</span></div>';
      else box.innerHTML='<label class="adjust'+(F.adjust?'':' off')+'"><input type="checkbox" id="f-adjust"'+(F.adjust?' checked':'')+'><span>Also update '+esc(adj.acct)+' in column G</span>'+
        '<b>'+esc(group(adj.old))+(n>0&&F.adjust?' \u2192 <span class="to">'+esc((adj.next<0?'\u2212':'')+group(adj.next))+'</span>':'')+'</b></label>';
    }
    var p=problems(),btn=$('#add-save');
    btn.disabled=!!p.length||saving;
    $('#add-hint').textContent=p.length?'Still needed: '+p.join(', ')+'.':(L.hasToken()?'':'You will be asked to sign in with Google first.');
  }

  var saving=false;
  function saveEntry(again){
    if(saving||problems().length) return;
    var row=[F.name.trim(),signed(),F.desc.trim(),toSheetDate(F.date),modeValue(),F.cat];
    var keep={mode:F.mode,date:F.date};
    var wantAdjust=F.adjust;
    saving=true;setBusy('#add-save',true,'Adding…');
    var pl,adj=null,adjNote='';
    needToken().then(function(){
      // Read the sheet fresh so the row goes after entries added anywhere else.
      return L.get('Tracking!A1:G5000');
    }).then(function(rows){
      pl=placement(rows);
      if(!pl) throw Object.assign(new Error('No month heading found in column A of the Tracking tab.'),{code:'layout'});
      var a=wantAdjust?adjustment(rows):null;
      if(a&&!a.skip) adj=a;
      var range='Tracking!A'+pl.row+':F'+pl.row;
      return L.put(range,[row]).then(function(){return L.get(range);}).then(function(back){
        var b=back[0]||[];
        if(cell(b,0)!==row[0]||Math.abs(Logic.num(b[1])-row[1])>0.001) throw Object.assign(new Error('The row was written but did not read back as expected. Check row '+pl.row+' in the sheet.'),{code:'verify'});
      });
    }).then(function(){
      if(!adj) return;
      var g='Tracking!G'+adj.row;
      // Never overwrite a formula someone put in a balance cell.
      return L.get(g,'FORMULA').then(function(f){
        var v=(f[0]||[])[0];
        if(typeof v==='string'&&v.charAt(0)==='='){adjNote=' '+adj.acct+' in column G is a formula, so it was left as it is.';adj=null;return;}
        return L.batch([{range:g,values:[[adj.next]]}]).then(function(){return L.get(g,'UNFORMATTED_VALUE');}).then(function(back){
          var v2=(back[0]||[])[0];
          if(Math.abs(+v2-adj.next)>0.001){adjNote=' '+adj.acct+' did not read back as expected; check G'+adj.row+'.';adj=null;return;}
          adjNote=' '+adj.acct+' '+group(adj.old)+' \u2192 '+(adj.next<0?'\u2212':'')+group(adj.next)+'.';
        });
      }).catch(function(e){adjNote=' The entry is in, but '+adj.acct+' could not be updated ('+fail(e)+')';adj=null;});
    }).then(function(){
      saving=false;setBusy('#add-save',false,'Add entry');
      L.refresh();
      var label=row[0]+' \u00b7 '+(row[1]<0?'+':'')+fmt(Math.abs(row[1]));
      var done={pl:pl,row:row,adj:adj};
      var acts=[{label:'Undo',run:function(){undoEntry(done);}},{label:'Balances',run:function(){openBal(pl.cycle,adj?adj.acct:null);}}];
      toast('Added '+label+' to '+pl.cycle+', row '+pl.row+'.'+adjNote,acts);
      if(again){freshForm(keep);mem=memory();drawAdd();$('#f-amount').focus();}
      else $('#add-dlg').close();
    }).catch(function(e){
      saving=false;setBusy('#add-save',false,'Add entry');
      $('#add-hint').textContent=e&&(e.code==='layout'||e.code==='verify')?e.message:fail(e);
      $('#add-hint').classList.add('bad');
    });
  }
  function undoEntry(done){
    var pl=done.pl,row=done.row,adj=done.adj,note='';
    needToken().then(function(){return L.get('Tracking!A1:G5000');}).then(function(rows){
      var r=rows[pl.row-1]||[];
      var still=cell(r,0)===row[0]&&Math.abs(Logic.num(r[1])-row[1])<0.001&&cell(r,3)===row[3];
      var later=rows.slice(pl.row).some(filled);
      if(!still) throw Object.assign(new Error('Row '+pl.row+' has changed since it was added, so it was left alone.'),{code:'undo'});
      if(later) throw Object.assign(new Error('Entries were added after row '+pl.row+'. Remove it in the sheet so no gap is left.'),{code:'undo'});
      return L.clear('Tracking!A'+pl.row+':F'+pl.row).then(function(){
        if(!adj) return;
        var now=numOr0(cell(rows[adj.row-1],6));
        if(Math.abs(now-adj.next)>0.001){note=' '+adj.acct+' was changed since, so it was left at '+group(now)+'.';return;}
        return L.batch([{range:'Tracking!G'+adj.row,values:[[adj.old]]}]).then(function(){note=' '+adj.acct+' is back to '+group(adj.old)+'.';});
      });
    }).then(function(){
      L.refresh();
      toast('Removed '+row[0]+' from row '+pl.row+'.'+note);
    }).catch(function(e){toast(e&&e.code==='undo'?e.message:fail(e));});
  }

  // =====================================================================
  // Balances
  // =====================================================================
  var B={sel:null,vals:{},focus:null};
  function openBal(cycle,focus){
    var bl=blocks(L.S.tracking||[]);
    B.sel=cycle||(bl.length?bl[bl.length-1].name+'@'+bl[bl.length-1].head:null);
    if(cycle){var m=bl.filter(function(b){return b.name===cycle;}).pop();B.sel=m?m.name+'@'+m.head:B.sel;}
    B.vals={};B.focus=focus||null;
    drawBal();
    var d=$('#bal-dlg');
    if(!d.open) d.showModal();
    setTimeout(function(){var f=$('#bal-body input[data-acct="'+(B.focus||'')+'"]')||$('#bal-body input[data-acct]');if(f&&!userFocused('#bal-dlg')){f.focus();f.select();}},30);
  }
  function curBlock(bl){
    bl=bl||blocks(L.S.tracking||[]);
    return bl.filter(function(b){return b.name+'@'+b.head===B.sel;})[0]||null;
  }
  function drawBal(){
    var bl=blocks(L.S.tracking||[]);
    var b=curBlock(bl);
    var body=$('#bal-body');
    if(!bl.length||!b){
      body.innerHTML='<div class="empty"><b>No balances found</b>Each month needs ABL, Sadapay and Cash labels in column G, with the amount in the cell below.</div>';
      $('#bal-save').disabled=true;return;
    }
    var chips=bl.slice(-6).reverse().map(function(x){var k=x.name+'@'+x.head;return '<button type="button" class="pick" data-month="'+esc(k)+'" aria-pressed="'+(k===B.sel)+'">'+esc(x.name)+'</button>';}).join('');
    var cards=b.order.map(function(k){
      var a=b.acc[k];
      var v=B.vals[k]!=null?B.vals[k]:'';
      return '<label class="acct'+(B.focus===k?' focus':'')+'"><span class="acct-n">'+esc(k)+'</span>'+
        '<span class="acct-now">Now '+esc(fmt(a.value))+'</span>'+
        '<span class="acct-in"><i>Rs</i><input data-acct="'+esc(k)+'" inputmode="decimal" autocomplete="off" placeholder="'+esc(group(a.value))+'" value="'+esc(v)+'"></span>'+
        '<span class="acct-d" data-delta="'+esc(k)+'"></span></label>';
    }).join('');
    body.innerHTML='<div class="fld"><span class="lbl">Month</span><div class="picks">'+chips+'</div></div>'+
      '<p class="hint">Type what each account really holds now. Leave a box empty to keep it as it is. Only the cells under the labels in column G change; the sheet’s Total and Remaining formulas update from them.</p>'+
      '<div class="accts">'+cards+'</div><div class="bal-total" id="bal-total"></div>';
    drawBalTotals();
  }
  function changes(b){
    var out=[];
    b.order.forEach(function(k){
      var raw=B.vals[k];
      if(raw==null||String(raw).trim()==='') return;
      var n=Logic.num(raw);
      if(isNaN(n)) return;
      if(Math.abs(n-b.acc[k].value)<0.001) return;
      out.push({k:k,acc:b.acc[k],n:n});
    });
    return out;
  }
  function drawBalTotals(){
    var b=curBlock();
    if(!b) return;
    var before=0,after=0;
    b.order.forEach(function(k){
      var a=b.acc[k];before+=a.value;
      var raw=B.vals[k],n=raw!=null&&String(raw).trim()!==''?Logic.num(raw):NaN;
      after+=isNaN(n)?a.value:n;
      var d=$('[data-delta="'+k+'"]');
      if(!d) return;
      if(isNaN(n)||Math.abs(n-a.value)<0.001){d.textContent=raw&&isNaN(n)?'Not a number':'No change';d.className='acct-d'+(raw&&isNaN(n)?' bad':'');}
      else{var df=n-a.value;d.textContent=(df>0?'+':'−')+fmt(Math.abs(df)).replace('Rs ','Rs ');d.className='acct-d '+(df>0?'up':'down');}
    });
    var ch=changes(b);
    $('#bal-total').innerHTML='<span>Total across these accounts</span><b>'+esc(fmt(after))+'</b>'+(Math.abs(after-before)>0.5?'<small>was '+esc(fmt(before))+'</small>':'');
    $('#bal-save').disabled=!ch.length||balSaving;
    $('#bal-hint').textContent=ch.length?ch.length+(ch.length===1?' balance':' balances')+' to update in '+b.name+'.':'';
    $('#bal-hint').classList.remove('bad');
  }
  var balSaving=false;
  function saveBal(){
    var b=curBlock();
    if(!b||balSaving) return;
    var ch=changes(b);
    if(!ch.length) return;
    balSaving=true;setBusy('#bal-save',true,'Saving…');
    var originals;
    needToken().then(function(){return L.get('Tracking!A1:G5000');}).then(function(rows){
      // Check the labels are still where they were before touching anything.
      var nb=blocks(rows).filter(function(x){return x.name===b.name&&x.head===b.head;})[0];
      ch.forEach(function(c){
        var a=nb&&nb.acc[c.k];
        if(!a||a.row!==c.acc.row) throw Object.assign(new Error('The '+c.k+' row in '+b.name+' moved in the sheet. Close this and try again.'),{code:'layout'});
      });
      return Promise.all(ch.map(function(c){return L.get('Tracking!G'+c.acc.row,'FORMULA');}));
    }).then(function(f){
      originals=ch.map(function(c,i){var v=(f[i][0]||[])[0];return {range:'Tracking!G'+c.acc.row,values:[[v==null?'':v]]};});
      return L.batch(ch.map(function(c){return {range:'Tracking!G'+c.acc.row,values:[[c.n]]};}));
    }).then(function(){
      return Promise.all(ch.map(function(c){return L.get('Tracking!G'+c.acc.row,'UNFORMATTED_VALUE');}));
    }).then(function(back){
      ch.forEach(function(c,i){
        var v=(back[i][0]||[])[0];
        if(Math.abs(+v-c.n)>0.001) throw Object.assign(new Error(c.k+' did not read back as '+fmt(c.n)+'. Check G'+c.acc.row+' in the sheet.'),{code:'verify'});
      });
      balSaving=false;setBusy('#bal-save',false,'Save balances');
      $('#bal-dlg').close();
      L.refresh();
      toast('Updated '+ch.map(function(c){return c.k+' to '+fmt(c.n);}).join(', ')+' for '+b.name+'.',[{label:'Undo',run:function(){
        needToken().then(function(){return L.batch(originals,'USER_ENTERED');}).then(function(){L.refresh();toast('Balances put back.');}).catch(function(e){toast(fail(e));});
      }}]);
    }).catch(function(e){
      balSaving=false;setBusy('#bal-save',false,'Save balances');
      $('#bal-hint').textContent=e&&(e.code==='layout'||e.code==='verify')?e.message:fail(e);
      $('#bal-hint').classList.add('bad');
    });
  }

  // True when the person has already put the cursor in a field of this dialog.

  // =====================================================================
  // New pay cycle: the next month's heading, its column G block, the Pay myself row,
  // optionally Mama's groceries, the pay in the Income tab, and the previous month's
  // Spent formula closed at its last row so it stops counting the new month.
  // =====================================================================
  var MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
  var C=null,cycSaving=false;
  // 1-based rows of the latest month: heading, last entry, and the last cell it uses in A:G
  function lastMonth(rows){
    var hs=headings(rows);if(!hs.length) return null;
    var h=hs[hs.length-1],lastA=h+1,lastG=h,pm=0;
    for(var i=h+1;i<rows.length;i++){
      if(filled(rows[i])){lastA=i;if(cell(rows[i],5).toLowerCase()==='savings') pm+=numOr0(cell(rows[i],1));}
      if(cell(rows[i],6)) lastG=i;
    }
    var bl=blocks(rows).filter(function(b){return b.head===h+1;})[0];
    return {name:cell(rows[h],0),head:h+1,lastEntry:lastA+1,end:Math.max(lastA,lastG)+1,acc:bl?bl.acc:{},order:bl?bl.order:[],pm:pm};
  }
  function mamaFee(){try{var s=JSON.parse(localStorage.getItem('ledger.forecast.v3')||'{}');return s.fees&&s.fees.mama!=null?s.fees.mama:35000;}catch(e){return 35000;}}
  function cycYear(){var y=+C.date.slice(0,4),m=+C.date.slice(5,7),mi=MONTHS.indexOf(C.month);return mi===0&&m===12?y+1:mi===11&&m===1?y-1:y;}
  function cnum(s){var n=Logic.num(s);return isNaN(n)?NaN:Math.abs(n);}
  function openCycle(){
    var rows=L.S.tracking||[],lm=lastMonth(rows);
    if(!lm){toast('No month heading found in column A of the Tracking tab.');return;}
    var mi=MONTHS.map(function(m){return m.toLowerCase();}).indexOf(lm.name.toLowerCase());
    var next=mi<0?MONTHS[+karachi(0).slice(5,7)-1]:MONTHS[(mi+1)%12];
    var acc={};['ABL','Sadapay','Cash'].concat(lm.order.filter(function(k){return ['ABL','Sadapay','Cash'].indexOf(k)<0;})).forEach(function(k){acc[k]=lm.acc[k]?lm.acc[k].value:0;});
    C={month:next,date:karachi(0),salary:'',pm:lm.pm?String(lm.pm):'',prev:acc,acc:{},touched:{},mama:true,mamaAmt:String(mamaFee()),mamaMode:'Sadapay',close:true,lm:lm};
    var inc=(L.S.income||{})[cycYear()+'-'+('0'+(MONTHS.indexOf(next)+1)).slice(-2)];
    if(inc&&inc.received) C.salary=String(Math.round(inc.received));
    drawCycle();
    var d=$('#cyc-dlg');if(!d.open) d.showModal();
    setTimeout(function(){var f=$('#c-salary');if(f&&!userFocused('#cyc-dlg')) f.focus();},30);
  }
  // balances after the salary: the salary lands in ABL unless you change it
  function accAfter(k){
    if(C.touched[k]) return cnum(C.acc[k]);
    var v=C.prev[k]||0,s=cnum(C.salary);
    return k==='ABL'&&s>0?v+s:v;
  }
  function cycProblems(){
    var p=[];
    if(!(cnum(C.salary)>0)) p.push('Enter the salary you received.');
    if(isNaN(cnum(C.pm))) p.push('Enter your Pay myself total.');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(C.date)) p.push('Pick the payday date.');
    Object.keys(C.prev).forEach(function(k){if(isNaN(accAfter(k))) p.push('Check the '+k+' balance.');});
    if(C.mama&&!(cnum(C.mamaAmt)>0)) p.push('Enter the amount for Mama, or untick it.');
    else if(C.mama&&accAfter(C.mamaMode)-cnum(C.mamaAmt)<0) p.push(C.mamaMode+' would go below zero after Mama\u2019s '+group(cnum(C.mamaAmt))+'. Put its balance after the salary, or pay from another account.');
    if(C.month.toLowerCase()===C.lm.name.toLowerCase()) p.push(C.month+' is already the latest month in the sheet.');
    return p;
  }
  function drawCycle(){
    var lm=C.lm,monthOpts=MONTHS.map(function(m){return '<option'+(m===C.month?' selected':'')+'>'+m+'</option>';}).join('');
    var accs=Object.keys(C.prev).map(function(k){
      var v=accAfter(k);
      return '<label class="fld cyc-acc"><span class="lbl">'+esc(k)+'</span><input class="inline" inputmode="numeric" data-c-acc="'+esc(k)+'" value="'+(isNaN(v)?esc(C.acc[k]||''):esc(group(v)))+'"><small>was '+esc(fmt(C.prev[k]||0))+(k==='ABL'&&!C.touched.ABL?' + salary':'')+'</small></label>';
    }).join('');
    $('#cyc-body').innerHTML=
      '<div class="cyc-row"><label class="fld"><span class="lbl">New month</span><select class="inline" id="c-month">'+monthOpts+'</select></label>'+
        '<label class="fld"><span class="lbl">Payday</span><input type="date" class="inline" id="c-date" value="'+esc(C.date)+'"></label></div>'+
      '<label class="fld"><span class="lbl">Salary received</span><div class="amt"><span>Rs</span><input id="c-salary" inputmode="decimal" autocomplete="off" placeholder="0" value="'+esc(C.salary)+'"></div></label>'+
      '<label class="fld"><span class="lbl">Pay myself, your total savings now</span><input class="inline" id="c-pm" inputmode="numeric" value="'+esc(C.pm?group(cnum(C.pm)):'')+'"><small class="cyc-sub" id="c-pm-d"></small></label>'+
      '<div class="fld"><span class="lbl">Balances after the salary arrived</span><div class="cyc-accs">'+accs+'</div></div>'+
      '<div class="fld"><label class="cyc-chk"><input type="checkbox" id="c-mama"'+(C.mama?' checked':'')+'> Also log Mama’s groceries</label>'+
        (C.mama?'<div class="cyc-row"><input class="inline" id="c-mama-amt" inputmode="numeric" value="'+esc(group(cnum(C.mamaAmt)||0))+'"><div class="picks">'+MODES.map(function(m){return '<button type="button" class="pick" data-c-mode="'+m+'" aria-pressed="'+(C.mamaMode===m)+'">'+m+'</button>';}).join('')+'</div></div>':'')+'</div>'+
      '<label class="cyc-chk"><input type="checkbox" id="c-close"'+(C.close?' checked':'')+'> Close '+esc(lm.name)+'’s Spent formula at its last row ('+lm.lastEntry+'), so it stops counting the new month</label>'+
      '<div class="cyc-sum" id="c-sum"></div>';
    drawCycleSum();
  }
  function drawCycleSum(){
    var lm=C.lm,H=lm.end+1,sal=cnum(C.salary),pm=cnum(C.pm),prevPM=lm.pm,start=0,mama=C.mama?cnum(C.mamaAmt):0;
    Object.keys(C.prev).forEach(function(k){start+=accAfter(k)||0;});
    var d=$('#c-pm-d');
    if(d) d.textContent=isNaN(pm)?'':pm===prevPM?'Same as '+lm.name+' ('+fmt(prevPM)+'): nothing new saved yet.':pm>prevPM?'Up '+fmt(pm-prevPM)+' from '+lm.name+'’s '+fmt(prevPM)+'.':'Down '+fmt(prevPM-pm)+' from '+lm.name+'’s '+fmt(prevPM)+'.';
    var li=function(t){return '<li>'+t+'</li>';};
    $('#c-sum').innerHTML='<b>What will be written</b><ul>'+
      li('Tracking rows '+H+'–'+(H+(C.mama?3:2))+': <i>'+esc(C.month)+'</i> heading, Pay myself '+(isNaN(pm)?'–':esc(fmt(pm)))+(C.mama&&mama>0?', groceries to mama '+esc(fmt(mama))+' ('+esc(C.mamaMode)+')':''))+
      li('Column G: month start '+esc(fmt(start))+', Remaining formula, balances'+(C.mama&&mama>0?' ('+esc(C.mamaMode)+' after Mama: '+esc(fmt((accAfter(C.mamaMode)||0)-mama))+')':''))+
      (C.close?li(esc(lm.name)+'’s Spent formula: rows '+(lm.head+2)+'–'+lm.lastEntry):'')+
      li('Income tab: '+esc(C.month)+' '+cycYear()+' received '+(sal>0?esc(fmt(sal)):'–'))+'</ul>';
    var p=cycProblems();
    $('#cyc-hint').textContent=p[0]||'';$('#cyc-hint').classList.toggle('bad',!!p.length&&sal>0);
    $('#cyc-save').disabled=!!p.length||cycSaving;
  }
  function saveCycle(){
    if(cycSaving||cycProblems().length) return;
    cycSaving=true;setBusy('#cyc-save',true,'Starting…');
    var sal=cnum(C.salary),pm=cnum(C.pm),mama=C.mama?cnum(C.mamaAmt):0,date=toSheetDate(C.date),month=C.month,year=cycYear();
    var lm,H,oldF=null,closed=false,accVals={};
    Object.keys(C.prev).forEach(function(k){accVals[k]=accAfter(k);});
    var start=Object.keys(accVals).reduce(function(a,k){return a+accVals[k];},0);
    if(mama>0) accVals[C.mamaMode]=(accVals[C.mamaMode]||0)-mama;
    needToken().then(function(){
      // read the sheet fresh: the new month goes after whatever is there now
      return L.get('Tracking!A1:G5000');
    }).then(function(rows){
      lm=lastMonth(rows);
      if(!lm) throw Object.assign(new Error('No month heading found in column A of the Tracking tab.'),{code:'layout'});
      if(lm.name.toLowerCase()===month.toLowerCase()) throw Object.assign(new Error(month+' is already in the sheet.'),{code:'layout'});
      H=lm.end+1;
      for(var i=H-1;i<H+22;i++) if((rows[i]||[]).some(function(x){return String(x==null?'':x).trim()!=='';})) throw Object.assign(new Error('Row '+(i+1)+' is not empty, so the new month was not added.'),{code:'layout'});
      if(!C.close) return;
      // only close a Spent formula that looks like the usual one
      return L.get('Tracking!G'+(lm.head+2)+':G'+(lm.head+3),'FORMULA').then(function(f){
        var lab=String((f[0]||[])[0]||'').trim().toLowerCase(),v=String((f[1]||[])[0]||'');
        if(lab==='spent'&&/^=SUM\(B\d+:B\d+\)$/i.test(v)) oldF=v;
      });
    }).then(function(){
      // the new month looks like the last one: copy its formatting first
      return L.tabs().then(function(t){
        var tr=t.filter(function(x){return x.title==='Tracking';})[0];if(!tr) return;
        var src={sheetId:tr.sheetId,startRowIndex:lm.head-1,endRowIndex:lm.head+22,startColumnIndex:0,endColumnIndex:7};
        return L.sheetBatch([{copyPaste:{source:src,destination:{sheetId:tr.sheetId,startRowIndex:H-1,endRowIndex:H+22,startColumnIndex:0,endColumnIndex:7},pasteType:'PASTE_FORMAT'}}]);
      }).catch(function(){});
    }).then(function(){
      var g=function(r,v){return {range:'Tracking!G'+r,values:[[v]]};};
      var data=[
        {range:'Tracking!A'+H,values:[[month]]},
        {range:'Tracking!A'+(H+1)+':G'+(H+1),values:[['Expense','Amount','Description','Date','Payment mode','Category','TOTAL_Dec']]},
        {range:'Tracking!A'+(H+2)+':F'+(H+2),values:[['Pay myself',pm,'savings',date,'ABL','savings']]},
        g(H+2,'Spent'),g(H+4,'month start:'),g(H+5,start),g(H+6,'Remaining'),
        g(H+9,'ABL'),g(H+10,accVals.ABL||0),g(H+11,'Sadapay'),g(H+12,accVals.Sadapay||0),g(H+13,'Cash'),g(H+14,accVals.Cash||0),
        g(H+15,'at Home'),g(H+16,accVals['At home']||0),g(H+17,'Total'),g(H+19,'Total - savings'),g(H+21,'offset')
      ];
      if(mama>0) data.push({range:'Tracking!A'+(H+3)+':F'+(H+3),values:[['groceries',mama,'to mama',date,C.mamaMode,'Family/Home']]});
      return L.batch(data);
    }).then(function(){
      var f=function(r,v){return {range:'Tracking!G'+r,values:[[v]]};};
      var data=[
        f(H+3,'=SUM(B'+(H+2)+':B'+(H+400)+')'),f(H+7,'=G'+(H+5)+'-G'+(H+3)),
        f(H+18,'=SUM(G'+(H+10)+',G'+(H+12)+',G'+(H+14)+',G'+(H+16)+')'),f(H+20,'=(G'+(H+18)+'-B'+(H+2)+')'),f(H+22,'=G'+(H+20)+'-G'+(H+7))
      ];
      if(oldF){data.push(f(lm.head+3,'=SUM(B'+(lm.head+2)+':B'+lm.lastEntry+')'));closed=true;}
      return L.batch(data,'USER_ENTERED');
    }).then(function(){
      return L.get('Tracking!A'+H+':A'+(H+2)).then(function(back){
        if(cell(back[0],0)!==month||cell(back[2],0)!=='Pay myself') throw Object.assign(new Error('The new month was written but did not read back as expected. Check row '+H+' in the sheet.'),{code:'verify'});
      });
    }).then(function(){
      return L.saveIncome(year,MONTHS.indexOf(month)+1,sal).catch(function(){});
    }).then(function(){
      cycSaving=false;setBusy('#cyc-save',false,'Start pay cycle');
      $('#cyc-dlg').close();
      var h=H,lmH=lm.head,f0=oldF;
      toast(month+' started at row '+H+(closed?', and '+lm.name+'’s Spent now ends at row '+lm.lastEntry:'')+'.',[{label:'Undo',run:function(){
        needToken().then(function(){return L.clear('Tracking!A'+h+':G'+(h+22));}).then(function(){
          return f0?L.batch([{range:'Tracking!G'+(lmH+3),values:[[f0]]}],'USER_ENTERED'):null;
        }).then(function(){L.refresh();toast(month+' removed. Its pay is still in the Income tab.');}).catch(function(e){toast(fail(e));});
      }}]);
      L.refresh();
    }).catch(function(e){
      cycSaving=false;setBusy('#cyc-save',false,'Start pay cycle');
      var hint=$('#cyc-hint');hint.textContent=fail(e);hint.classList.add('bad');
    });
  }

  function userFocused(sel){var a=document.activeElement;return !!(a&&a.tagName==='INPUT'&&a.closest(sel));}
  function setBusy(sel,on,text){var b=$(sel);if(!b) return;b.disabled=on;b.textContent=text;}

  // ---- events ----
  document.addEventListener('click',function(e){
    var t=e.target.closest&&e.target.closest('button');
    if(!t) return;
    if(t.id==='add'||t.id==='fab') return openAdd();
    if(t.id==='bal') return openBal();
    if(t.id==='cyc'||t.hasAttribute('data-open-cycle')) return openCycle();
    if(t.hasAttribute('data-open-bal')) return openBal(t.getAttribute('data-open-bal'),t.getAttribute('data-acct'));
    if(t.matches('[data-close]')){t.closest('dialog').close();return;}
    var inAdd=t.closest('#add-dlg'),inBal=t.closest('#bal-dlg');
    if(t.closest('#cyc-dlg')){
      if(t.hasAttribute('data-c-mode')){C.mamaMode=t.getAttribute('data-c-mode');$$('[data-c-mode]').forEach(function(b){b.setAttribute('aria-pressed',String(b===t));});drawCycleSum();return;}
      if(t.id==='cyc-save') return saveCycle();
    }
    if(inAdd){
      if(t.hasAttribute('data-dir')){F.dir=t.getAttribute('data-dir');F.touched.dir=true;
        if(F.dir==='in'&&F.cat!=='transfer'){F.cat='influx';}
        else if(F.dir==='out'&&F.cat==='influx'){F.cat=null;applyName();if(F.cat==='influx')F.cat=null;}
        drawAdd();$('#f-amount').focus();return;}
      if(t.hasAttribute('data-name')){F.name=t.getAttribute('data-name');applyName();drawAdd();$('#f-desc').focus();return;}
      if(t.hasAttribute('data-desc')){F.desc=t.getAttribute('data-desc');$('#f-desc').value=F.desc;drawReceipt();return;}
      var pk=t.getAttribute('data-pick');
      if(pk==='cat'){F.cat=t.getAttribute('data-v');F.touched.cat=true;if(F.cat==='influx')F.dir='in';else if(F.dir==='in'&&F.cat!=='transfer')F.dir='out';drawAdd();return;}
      if(pk==='mode'){F.mode=t.getAttribute('data-v');F.touched.mode=true;drawAdd();if(F.mode==='Other') $('#f-other').focus();return;}
      if(t.hasAttribute('data-date')){F.date=t.getAttribute('data-date');drawAdd();return;}
      if(t.id==='add-save') return saveEntry($('#add-again').checked);
    }
    if(inBal){
      if(t.hasAttribute('data-month')){B.sel=t.getAttribute('data-month');B.vals={};drawBal();return;}
      if(t.id==='bal-save') return saveBal();
    }
  });
  document.addEventListener('input',function(e){
    var t=e.target;
    if(t.id==='f-amount'){
      var v=t.value.replace(/[^0-9.,]/g,'');
      if(v!==t.value) t.value=v;
      F.amount=v;drawReceipt();
    }else if(t.id==='f-name'){
      var before=F.cat;F.name=t.value;applyName();
      if(F.cat!==before||mem.by[F.name.trim().toLowerCase()]){var pos=t.selectionStart;drawAdd();var n=$('#f-name');n.focus();try{n.setSelectionRange(pos,pos);}catch(x){}}
      else drawReceipt();
    }else if(t.id==='f-desc'){F.desc=t.value;drawReceipt();}
    else if(t.id==='f-other'){F.other=t.value;drawReceipt();}
    else if(t.id==='f-adjust'){F.adjust=t.checked;drawReceipt();}
    else if(t.id==='f-date'){F.date=t.value;$$('[data-date]').forEach(function(b){b.setAttribute('aria-pressed',String(b.getAttribute('data-date')===F.date));});drawReceipt();}
    else if(t.hasAttribute&&t.hasAttribute('data-acct')){B.vals[t.getAttribute('data-acct')]=t.value;drawBalTotals();}
    else if(t.closest&&t.closest('#cyc-dlg')&&C){
      if(t.id==='c-month') C.month=t.value;
      else if(t.id==='c-date') C.date=t.value;
      else if(t.id==='c-salary'){C.salary=t.value;var ab=$('[data-c-acc="ABL"]');if(ab&&!C.touched.ABL){var v=accAfter('ABL');ab.value=isNaN(v)?'':group(v);}}
      else if(t.id==='c-pm') C.pm=t.value;
      else if(t.hasAttribute('data-c-acc')){var k=t.getAttribute('data-c-acc');C.acc[k]=t.value;C.touched[k]=true;}
      else if(t.id==='c-mama'){C.mama=t.checked;C.mamaAmt=$('#c-mama-amt')?$('#c-mama-amt').value:C.mamaAmt;drawCycle();return;}
      else if(t.id==='c-mama-amt') C.mamaAmt=t.value;
      else if(t.id==='c-close') C.close=t.checked;
      drawCycleSum();
    }
  });
  // tidy amounts in the pay cycle form once you leave the box
  document.addEventListener('change',function(e){
    var t=e.target;
    if(!(t.closest&&t.closest('#cyc-dlg'))||t.tagName!=='INPUT'||t.type==='checkbox'||t.type==='date') return;
    var n=cnum(t.value);if(!isNaN(n)&&t.value.trim()) t.value=group(n);
  });
  document.addEventListener('keydown',function(e){
    if(e.key!=='Enter'||e.isComposing) return;
    var t=e.target;
    if(t.closest&&t.closest('#add-dlg')&&t.tagName==='INPUT'){e.preventDefault();saveEntry($('#add-again').checked);}
    else if(t.closest&&t.closest('#bal-dlg')&&t.tagName==='INPUT'){e.preventDefault();saveBal();}
    else if(t.closest&&t.closest('#cyc-dlg')&&t.tagName==='INPUT'&&t.type!=='checkbox'){e.preventDefault();saveCycle();}
  });
  ['add-dlg','bal-dlg','cyc-dlg'].forEach(function(id){
    var d=document.getElementById(id);
    // Click on the dimmed backdrop closes the sheet.
    d.addEventListener('click',function(e){if(e.target===d) d.close();});
    d.addEventListener('close',function(){var h=d.querySelector('.hint-line');if(h){h.textContent='';h.classList.remove('bad');}});
  });

  window.LedgerEditor={
    toast:toast,
    sync:function(){
      var st=L.state(),on=(st==='ready'||st==='signedout')&&!!L.S.tracking;
      $('#add').hidden=!on;$('#bal').hidden=!on;$('#cyc').hidden=!on;$('#fab').hidden=!on;
    }
  };
  LedgerEditor.sync();
})();
