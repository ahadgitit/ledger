const Logic=(function(){
  const DAY=86400000;
  const MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const CATS=['Food','Utilities','Family/Home','Renovation','InDrive','Transport','Shopping','Fun','Loans given','Untracked'];
  const CAT_KEY={food:'Food',utilities:'Utilities','family/home':'Family/Home',renovation:'Renovation',indrive:'InDrive',transport:'Transport',shopping:'Shopping',fun:'Fun',loaned:'Loans given',untracked:'Untracked'};
  const MONTH_RE=/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*$/i;

  function num(s){
    if(typeof s==='number') return s;
    const t=String(s==null?'':s).trim();
    if(!t) return NaN;
    const neg=/^\(.*\)$/.test(t)||/^-/.test(t);
    const d=t.replace(/[^0-9.]/g,'');
    if(!d) return NaN;
    const n=parseFloat(d);
    return neg?-n:n;
  }
  function parseDate(s){
    const m=/^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/.exec(String(s==null?'':s));
    if(!m) return null;
    const d=+m[1],mo=+m[2],y=+m[3];
    if(mo<1||mo>12||d<1||d>31) return null;
    return Math.round(Date.UTC(y,mo-1,d)/DAY);
  }
  function todayNum(){
    const t=new Date();
    return Math.round(Date.UTC(t.getFullYear(),t.getMonth(),t.getDate())/DAY);
  }
  function balanceOf(g){
    function after(label){
      for(var i=0;i<g.length-1;i++){
        if(g[i].toLowerCase().replace(/:$/,'')===label){
          if(String(g[i+1]).trim()==='-') return 0;
          var v=num(g[i+1]);
          return isNaN(v)?null:v;
        }
      }
      return null;
    }
    var r=after('remaining');
    if(r==null) return null;
    // Account balances and the sheet's own reconciliation: offset = (Total - savings) - Remaining.
    var acc={};
    [['ABL','abl'],['Sadapay','sadapay'],['Cash','cash'],['At home','at home']].forEach(function(x){
      var v=after(x[1]);
      if(v==null&&x[1]==='sadapay') v=after('sada pay');
      if(v!=null) acc[x[0]]=v;
    });
    return {remaining:r,start:after('month start'),spent:after('spent'),acc:acc,
      total:after('total'),net:after('total - savings'),offset:after('offset')};
  }
  // "Sada Pay", "sadapay" and "Sadapay" are the same account.
  function normMode(m){
    const t=String(m==null?'':m).trim();
    if(/^sada\s*pay$/i.test(t)) return 'Sadapay';
    if(/^abl$/i.test(t)) return 'ABL';
    if(/^cash$/i.test(t)) return 'Cash';
    return t||'Other';
  }
  function isHeading(r){
    r=r||[];
    const a=String(r[0]==null?'':r[0]).trim();
    return !!a&&MONTH_RE.test(a)&&!r.slice(1,6).some(function(x){return String(x==null?'':x).trim()!=='';});
  }
  function parseTracking(rows){
    const cycles=[],all=[];
    let cur=null;
    (rows||[]).forEach(function(r,i){
      r=r||[];
      const a=String(r[0]==null?'':r[0]).trim();
      if(isHeading(r)){cur={name:a,tx:[],g:[]};cycles.push(cur);return;}
      const g=String(r[6]==null?'':r[6]).trim();
      if(cur&&g) cur.g.push(g);
      if(!a||a.toLowerCase()==='expense') return;
      const amt=num(r[1]);
      const cat=String(r[5]==null?'':r[5]).trim().toLowerCase();
      if(isNaN(amt)||!cat) return;
      const tx={name:a,desc:String(r[2]==null?'':r[2]),amt:amt,day:parseDate(r[3]),mode:normMode(r[4]),cat:cat,row:i+1,cycle:cur?cur.name:''};
      all.push(tx);
      if(cur) cur.tx.push(tx);
    });
    cycles.forEach(function(c){c.bal=balanceOf(c.g||[]);});
    return {cycles:cycles,all:all};
  }
  function cyclePeriods(parsed,today){
    const out=[];
    parsed.cycles.forEach(function(c){
      const days=c.tx.filter(function(t){return t.day!=null;}).map(function(t){return t.day;});
      if(!days.length) return;
      const sv=c.tx.find(function(t){return t.cat==='savings'&&t.day!=null;});
      out.push({kind:'cycle',label:c.name.slice(0,3),name:c.name,tx:c.tx,bal:c.bal,start:sv?sv.day:Math.min.apply(null,days),maxDay:Math.max.apply(null,days)});
    });
    out.sort(function(a,b){return a.start-b.start;});
    out.forEach(function(p,i){
      const n=out[i+1];
      p.end=n?Math.max(n.start-1,p.start):Math.max(today,p.maxDay);
      p.open=!n;
      p.key='c'+p.start;
    });
    return out;
  }
  function monthPeriods(parsed,today){
    const g=new Map();
    parsed.all.forEach(function(t){
      if(t.day==null) return;
      const d=new Date(t.day*DAY);
      const k=d.getUTCFullYear()*12+d.getUTCMonth();
      if(!g.has(k)) g.set(k,[]);
      g.get(k).push(t);
    });
    const out=[];
    Array.from(g.keys()).sort(function(a,b){return a-b;}).forEach(function(k){
      const tx=g.get(k);
      if(tx.length<3) return;
      const y=Math.floor(k/12),m=k%12;
      const start=Math.round(Date.UTC(y,m,1)/DAY);
      const last=Math.round(Date.UTC(y,m+1,0)/DAY);
      if(start>today) return;
      out.push({kind:'month',label:MON[m],name:MON[m]+' '+y,tx:tx,start:start,end:Math.min(last,today),open:today<=last,key:'m'+k});
    });
    return out;
  }
  function aggregate(p){
    const by={};
    CATS.forEach(function(c){by[c]=0;});
    let other=0,saved=0,back=0,outside=0;
    const mode={},days=new Map(),top=[];
    p.tx.forEach(function(t){
      const k=t.cat;
      if(k==='savings'){saved+=t.amt;return;}
      if(k==='influx'){back+=-t.amt;return;}
      if(k==='transfer') return;
      const c=CAT_KEY[k];
      if(c) by[c]+=t.amt; else other+=t.amt;
      mode[t.mode]=(mode[t.mode]||0)+t.amt;
      top.push(t);
      if(t.day==null||t.day<p.start||t.day>p.end) outside++;
      else days.set(t.day,(days.get(t.day)||0)+t.amt);
    });
    let spent=other;
    CATS.forEach(function(c){spent+=by[c];});
    const daily=[];
    for(let d=p.start;d<=p.end;d++) daily.push({day:d,v:days.get(d)||0});
    return {by:by,other:other,spent:spent,saved:saved,back:back,mode:mode,top:top,daily:daily,outside:outside,count:top.length,dayCount:p.end-p.start+1};
  }
  // The Income tab: Year | Month | Received | Saved | Note, one row per payday cycle,
  // keyed 'YYYY-MM' by the month the cycle starts in. Saved is only for months the
  // Tracking tab does not cover; row is the sheet row, for writing back.
  function parseIncome(rows){
    const out={};
    rows=rows||[];
    for(let j=0;j<rows.length;j++){
      const r=rows[j]||[],y=num(r[0]),m=num(r[1]);
      if(!(y>2000&&m>=1&&m<=12)) continue;
      const rec=num(r[2]),sav=num(r[3]);
      out[y+'-'+('0'+m).slice(-2)]={received:isFinite(rec)?rec:null,saved:isFinite(sav)?sav:null,note:String(r[4]==null?'':r[4]),row:j+1};
    }
    return out;
  }
  const SUBS=[
    {key:'claude',label:'Claude',re:/claude/},
    {key:'internet',label:'Internet bill',re:/internet/},
    {key:'amazon',label:'Amazon',re:/amazon/},
    {key:'foodpanda',label:'foodpanda',re:/foodpanda/,notCat:'food'},
    {key:'youtube',label:'YouTube',re:/youtube/},
    {key:'netflix',label:'Netflix',re:/netflix/}
  ];
  function subKey(t){
    if(t.cat==='savings'||t.cat==='influx'||t.cat==='transfer'||t.cat==='loaned') return null;
    const s=(t.name+' '+t.desc).toLowerCase();
    for(let i=0;i<SUBS.length;i++){
      const x=SUBS[i];
      if(x.re.test(s)&&!(x.notCat&&t.cat===x.notCat)) return x.key;
    }
    return null;
  }
  function domOf(day){return new Date(day*DAY).getUTCDate();}
  function windowEnd(p){
    if(p.kind==='month'){
      const d=new Date(p.start*DAY);
      return Math.round(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)/DAY);
    }
    return p.start+34;
  }
  function dueDate(p,dom){
    const end=windowEnd(p);
    for(let d=p.start;d<=end;d++){ if(domOf(d)===dom) return d; }
    return null;
  }
  function subscriptions(periods,idx){
    const p=periods[idx];
    const cols=[];
    SUBS.forEach(function(s){
      const per=periods.map(function(q){
        let paid=0,n=0,last=null;
        q.tx.forEach(function(t){
          if(!(t.amt>0)||subKey(t)!==s.key) return;
          paid+=t.amt;n++;
          if(!last||(t.day!=null&&(last.day==null||t.day>=last.day))) last={day:t.day,amt:t.amt};
        });
        return {paid:paid,n:n,last:last};
      });
      const seen=per.filter(function(x){return x.n>0;}).length;
      if(!seen) return;
      const c=per[idx];
      let status=null,amount=0,when=null;
      if(c.n>0){status='paid';amount=c.paid;when=c.last?c.last.day:null;}
      else if(seen>=2){
        let ex=null;
        for(let j=idx-1;j>=0;j--){ if(per[j].n>0){ex=per[j].last;break;} }
        if(ex){
          amount=ex.amt;
          when=ex.day!=null?dueDate(p,domOf(ex.day)):null;
          status=p.open?'due':'missed';
        }
      }
      cols.push({key:s.key,label:s.label,per:per,status:status,amount:amount,when:when});
    });
    const rows=cols.filter(function(c){return c.status;});
    let paid=0,due=0;
    rows.forEach(function(r){ if(r.status==='paid') paid+=r.amount; else if(r.status==='due') due+=r.amount; });
    return {rows:rows,cols:cols,paid:paid,due:due};
  }
  const PAYDAY_DOM=20, BUFFER=0.10;
  function paydayAfter(p,today){
    const d=new Date(p.start*DAY);
    const y=d.getUTCFullYear();
    let m=d.getUTCMonth()+1;
    let pay=Math.round(Date.UTC(y,m,PAYDAY_DOM)/DAY);
    while(pay<=today){m++;pay=Math.round(Date.UTC(y,m,PAYDAY_DOM)/DAY);}
    return pay;
  }
  function foodBudget(p,bal,sub,today){
    if(!p||!p.open||p.kind!=='cycle'||!bal) return null;
    const pay=paydayAfter(p,today);
    const from=Math.max(today,p.start);
    const days=Math.max(1,pay-from);
    let due=0,later=0;
    sub.rows.forEach(function(r){
      if(r.status!=='due') return;
      if(r.when!=null&&r.when>=pay) later+=r.amount; else due+=r.amount;
    });
    const avail=bal.remaining-due;
    const buffer=avail>0?avail*BUFFER:0;
    const usable=avail>0?avail-buffer:0;
    return {remaining:bal.remaining,due:due,later:later,avail:avail,buffer:buffer,usable:usable,days:days,perDay:usable/days,payday:pay,from:from,short:avail<0?-avail:0};
  }
  const RIDE_RE=/in\s*-?\s*drive/i;
  function place(s){
    s=String(s||'').replace(/\s+/g,' ').trim();
    if(!s) return '';
    if(/^(house|my house|home)$/.test(s)) s='home';
    return s.charAt(0).toUpperCase()+s.slice(1);
  }
  function rideOf(t){
    if(!(t.amt>0)) return null;
    if(t.cat==='influx'||t.cat==='transfer'||t.cat==='savings'||t.cat==='loaned') return null;
    if(!RIDE_RE.test(t.name)&&!RIDE_RE.test(t.desc)) return null;
    let d=t.desc.toLowerCase();
    const tags=[];
    if(/\babsent\b/.test(d)) tags.push('Touheed absent');
    if(/\bweekend\b/.test(d)) tags.push('Weekend');
    d=d.replace(/\b(absent|weekend|touheed|in\s*-?\s*drive)\b/g,' ').replace(/\s+/g,' ').trim();
    let from='',to='',m;
    if((m=/^to (.+?) from (.+)$/.exec(d))){to=m[1];from=m[2];}
    else if((m=/^(?:from )?(.+?) to (.+)$/.exec(d))){from=m[1];to=m[2];}
    else if((m=/^to (.+)$/.exec(d))){to=m[1];}
    else if((m=/^from (.+)$/.exec(d))){from=m[1];}
    from=place(from);to=place(to);
    let note='';
    if(!from&&!to) note=place(d)||(RIDE_RE.test(t.name)?'':place(t.name));
    const office=/\boffice\b/.test(d)||tags.indexOf('Touheed absent')>=0;
    return {day:t.day,amt:t.amt,mode:t.mode,from:from,to:to,note:note,tags:tags,office:office};
  }
  function rides(periods){
    return periods.map(function(p){
      const list=[];
      let total=0,office=0,officeN=0;
      p.tx.forEach(function(t){
        const r=rideOf(t);
        if(!r) return;
        list.push(r);total+=r.amt;
        if(r.office){office+=r.amt;officeN++;}
      });
      list.sort(function(a,b){return (a.day==null?Infinity:a.day)-(b.day==null?Infinity:b.day);});
      return {list:list,total:total,count:list.length,office:office,officeN:officeN};
    });
  }
  /* Rides Touheed should have given: weekday InDrive rides between home and office, plus any
     ride noted "absent" (Touheed did not come). Rides noted "weekend", or on a Saturday or
     Sunday, are not his. Grouped by his pay periods, the 15th to the 14th of the next month. */
  function touheedSkips(all,today){
    const list=[];let first=null;
    all.forEach(function(t){
      const r=rideOf(t);
      if(!r||r.day==null) return;
      if(first==null||r.day<first) first=r.day;
      const wd=(r.day+4)%7;
      if(r.tags.indexOf('Weekend')>=0) return;
      const absent=r.tags.indexOf('Touheed absent')>=0;
      const ends=[r.from,r.to].map(function(x){return x.toLowerCase();});
      const office=ends.some(function(x){return /^office\b/.test(x);});
      const homeOk=ends.every(function(x){return !x||/^(office|home|house|my house)\b/.test(x);});
      if(absent||(wd!==0&&wd!==6&&office&&homeOk)) list.push(r);
    });
    if(first==null) return [];
    function startOf(day){
      const d=new Date(day*DAY);let y=d.getUTCFullYear(),m=d.getUTCMonth();
      if(d.getUTCDate()<15){m--;if(m<0){m=11;y--;}}
      return {y:y,m:m,day:Math.round(Date.UTC(y,m,15)/DAY)};
    }
    const out=[];let s=startOf(Math.max(first,startOf(today).day-400)),end=startOf(today).day;
    while(s.day<=end){
      const ny=s.m===11?s.y+1:s.y,nm=(s.m+1)%12,next=Math.round(Date.UTC(ny,nm,15)/DAY);
      const rides=list.filter(function(r){return r.day>=s.day&&r.day<next;}).sort(function(a,b){return a.day-b.day;});
      out.push({start:s.day,end:next-1,label:MON[s.m],name:'15 '+MON[s.m]+' – 14 '+MON[nm],rides:rides,count:rides.length,current:today>=s.day&&today<next});
      s={y:ny,m:nm,day:next};
    }
    return out;
  }
  function readAll(call,onCount){
    function readRows(s,e){
      return call('Tracking!A'+s+':G'+e).then(function(rows){
        var want=e-s+1;
        if(rows.length>=want||want<=10) return rows;
        var mid=s+Math.floor(want/2)-1;
        return Promise.all([readRows(s,mid),readRows(mid+1,e)]).then(function(p){return p[0].concat(p[1]);});
      });
    }
    return Promise.all([call('Tracking!A1:A1000'),call('Tracking!G1:G1000')]).then(function(cols){
      var n=Math.max(cols[0].length,cols[1].length);
      if(onCount) onCount(n);
      var jobs=[];
      for(var s=1;s<=n;s+=100) jobs.push(readRows(s,Math.min(n,s+99)));
      return Promise.all(jobs).then(function(parts){return [].concat.apply([],parts);});
    });
  }
  return {num:num,parseDate:parseDate,todayNum:todayNum,parseTracking:parseTracking,cyclePeriods:cyclePeriods,monthPeriods:monthPeriods,aggregate:aggregate,parseIncome:parseIncome,readAll:readAll,subscriptions:subscriptions,subKey:subKey,rides:rides,touheedSkips:touheedSkips,normMode:normMode,CAT_KEY:CAT_KEY,isHeading:isHeading,foodBudget:foodBudget,PAYDAY_DOM:PAYDAY_DOM,BUFFER:BUFFER,CATS:CATS,MON:MON,DAY:DAY};
})();
