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
        var a=(actions||[])[+b.getAttribute('data-i')];
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
    F={dir:'out',amount:'',name:'',desc:'',cat:null,mode:keep&&keep.mode||'Sadapay',other:'',date:keep&&keep.date||karachi(0),touched:{}};
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
      '<div class="fld"><span class="lbl">Paid with</span><div class="picks">'+pickHTML('mode',MODES.concat(['Other']),F.mode)+
        (F.mode==='Other'?'<input id="f-other" class="inline" autocomplete="off" placeholder="payment mode" value="'+esc(F.other)+'">':'')+'</div></div>'+
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
    var p=problems(),btn=$('#add-save');
    btn.disabled=!!p.length||saving;
    $('#add-hint').textContent=p.length?'Still needed: '+p.join(', ')+'.':(L.hasToken()?'':'You will be asked to sign in with Google first.');
  }

  var saving=false;
  function saveEntry(again){
    if(saving||problems().length) return;
    var row=[F.name.trim(),signed(),F.desc.trim(),toSheetDate(F.date),modeValue(),F.cat];
    var keep={mode:F.mode,date:F.date};
    saving=true;setBusy('#add-save',true,'Adding…');
    needToken().then(function(){
      // Read the sheet fresh so the row goes after entries added anywhere else.
      return L.get('Tracking!A1:G5000');
    }).then(function(rows){
      var pl=placement(rows);
      if(!pl) throw Object.assign(new Error('No month heading found in column A of the Tracking tab.'),{code:'layout'});
      var range='Tracking!A'+pl.row+':F'+pl.row;
      return L.put(range,[row]).then(function(){return L.get(range);}).then(function(back){
        var b=back[0]||[];
        if(cell(b,0)!==row[0]||Math.abs(Logic.num(b[1])-row[1])>0.001) throw Object.assign(new Error('The row was written but did not read back as expected. Check row '+pl.row+' in the sheet.'),{code:'verify'});
        return pl;
      });
    }).then(function(pl){
      saving=false;setBusy('#add-save',false,'Add entry');
      L.refresh();
      var label=row[0]+' · '+(row[1]<0?'+':'')+fmt(Math.abs(row[1]));
      var acts=[{label:'Undo',run:function(){undoEntry(pl,row);}}];
      if(MODES.indexOf(row[4])>=0) acts.push({label:'Update '+row[4],run:function(){openBal(pl.cycle,row[4]);}});
      toast('Added '+label+' to '+pl.cycle+', row '+pl.row+'.',acts);
      if(again){freshForm(keep);mem=memory();drawAdd();$('#f-amount').focus();}
      else $('#add-dlg').close();
    }).catch(function(e){
      saving=false;setBusy('#add-save',false,'Add entry');
      $('#add-hint').textContent=e&&(e.code==='layout'||e.code==='verify')?e.message:fail(e);
      $('#add-hint').classList.add('bad');
    });
  }
  function undoEntry(pl,row){
    needToken().then(function(){return L.get('Tracking!A1:G5000');}).then(function(rows){
      var r=rows[pl.row-1]||[];
      var still=cell(r,0)===row[0]&&Math.abs(Logic.num(r[1])-row[1])<0.001&&cell(r,3)===row[3];
      var later=rows.slice(pl.row).some(filled);
      if(!still) throw Object.assign(new Error('Row '+pl.row+' has changed since it was added, so it was left alone.'),{code:'undo'});
      if(later) throw Object.assign(new Error('Entries were added after row '+pl.row+'. Remove it in the sheet so no gap is left.'),{code:'undo'});
      return L.clear('Tracking!A'+pl.row+':F'+pl.row);
    }).then(function(){
      L.refresh();
      toast('Removed '+row[0]+' from row '+pl.row+'.');
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
  function userFocused(sel){var a=document.activeElement;return !!(a&&a.tagName==='INPUT'&&a.closest(sel));}
  function setBusy(sel,on,text){var b=$(sel);if(!b) return;b.disabled=on;b.textContent=text;}

  // ---- events ----
  document.addEventListener('click',function(e){
    var t=e.target.closest&&e.target.closest('button');
    if(!t) return;
    if(t.id==='add'||t.id==='fab') return openAdd();
    if(t.id==='bal') return openBal();
    if(t.matches('[data-close]')){t.closest('dialog').close();return;}
    var inAdd=t.closest('#add-dlg'),inBal=t.closest('#bal-dlg');
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
    else if(t.id==='f-date'){F.date=t.value;$$('[data-date]').forEach(function(b){b.setAttribute('aria-pressed',String(b.getAttribute('data-date')===F.date));});drawReceipt();}
    else if(t.hasAttribute&&t.hasAttribute('data-acct')){B.vals[t.getAttribute('data-acct')]=t.value;drawBalTotals();}
  });
  document.addEventListener('keydown',function(e){
    if(e.key!=='Enter'||e.isComposing) return;
    var t=e.target;
    if(t.closest&&t.closest('#add-dlg')&&t.tagName==='INPUT'){e.preventDefault();saveEntry($('#add-again').checked);}
    else if(t.closest&&t.closest('#bal-dlg')&&t.tagName==='INPUT'){e.preventDefault();saveBal();}
  });
  ['add-dlg','bal-dlg'].forEach(function(id){
    var d=document.getElementById(id);
    // Click on the dimmed backdrop closes the sheet.
    d.addEventListener('click',function(e){if(e.target===d) d.close();});
    d.addEventListener('close',function(){var h=d.querySelector('.hint-line');if(h){h.textContent='';h.classList.remove('bad');}});
  });

  window.LedgerEditor={
    sync:function(){
      var st=L.state(),on=st==='ready'||st==='signedout';
      $('#add').hidden=!on;$('#bal').hidden=!on;$('#fab').hidden=!on;
    }
  };
  LedgerEditor.sync();
})();
