/* Chart primitives: scales, a squarified treemap, a layered flow (sankey) layout,
   sparklines and the sequential ramp. Everything returns plain numbers or SVG strings. */
var Viz=(function(){
  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function niceMax(v){
    if(!(v>0)) return 1;
    var p=Math.pow(10,Math.floor(Math.log10(v))),f=v/p;
    return (f<=1?1:f<=2?2:f<=2.5?2.5:f<=5?5:10)*p;
  }
  function kfmt(n){
    var a=Math.abs(Math.round(n)),s=n<0?'−':'';
    if(a>=1e6) return s+(Math.round(a/1e5)/10)+'M';
    if(a>=1000){var v=a/1000;return s+(v>=10?Math.round(v):Math.round(v*10)/10)+'k';}
    return s+String(a);
  }
  function r1(n){return Math.round(n*10)/10;}

  // Squarified treemap (Bruls et al.). items: [{v,...}] sorted desc. Returns items with x,y,w,h.
  function treemap(items,W,H){
    var total=items.reduce(function(s,i){return s+i.v;},0);
    var out=[];
    if(!(total>0)) return out;
    var scale=W*H/total;
    var rest=items.map(function(i){return Object.assign({},i,{a:i.v*scale});});
    var x=0,y=0,w=W,h=H;
    function worst(row,side){
      var s=row.reduce(function(t,r){return t+r.a;},0),mx=0,mn=Infinity;
      row.forEach(function(r){mx=Math.max(mx,r.a);mn=Math.min(mn,r.a);});
      return Math.max(side*side*mx/(s*s),(s*s)/(side*side*mn));
    }
    function lay(row){
      var s=row.reduce(function(t,r){return t+r.a;},0);
      if(w>=h){var cw=s/h,cy=y;row.forEach(function(r){var rh=r.a/cw;out.push(Object.assign(r,{x:x,y:cy,w:cw,h:rh}));cy+=rh;});x+=cw;w-=cw;}
      else{var ch=s/w,cx=x;row.forEach(function(r){var rw=r.a/ch;out.push(Object.assign(r,{x:cx,y:y,w:rw,h:ch}));cx+=rw;});y+=ch;h-=ch;}
    }
    var row=[];
    while(rest.length){
      var side=Math.min(w,h),c=rest[0];
      if(!row.length||worst(row.concat([c]),side)<=worst(row,side)){row.push(c);rest.shift();}
      else{lay(row);row=[];}
    }
    if(row.length) lay(row);
    return out;
  }

  // Layered flow layout. cols: [[{id,v,...}],...]; links: [{s,t,v,...}] between adjacent columns.
  function sankey(cols,links,W,H,o){
    o=o||{};
    var nw=o.nodeW||10,pad=o.pad||10;
    var byId={};
    var k=Infinity;
    cols.forEach(function(col){
      var tot=col.reduce(function(s,n){return s+n.v;},0);
      if(tot>0) k=Math.min(k,(H-pad*(col.length-1))/tot);
    });
    if(!isFinite(k)) k=0;
    cols.forEach(function(col,ci){
      var used=col.reduce(function(s,n){return s+n.v*k;},0)+pad*(col.length-1);
      var y=(H-used)/2;
      var x=cols.length===1?0:ci*(W-nw)/(cols.length-1);
      col.forEach(function(n){
        n.x=x;n.y=y;n.h=Math.max(1,n.v*k);n.w=nw;n.col=ci;n.so=0;n.to=0;
        byId[n.id]=n;y+=n.h+pad;
      });
    });
    // order each node's links by the far end's position so bands do not cross needlessly
    links.forEach(function(l){l.sn=byId[l.s];l.tn=byId[l.t];l.w=l.v*k;});
    links=links.filter(function(l){return l.sn&&l.tn&&l.w>0;});
    links.slice().sort(function(a,b){return a.tn.y-b.tn.y;}).forEach(function(l){l.sy=l.sn.y+l.sn.so;l.sn.so+=l.w;});
    links.slice().sort(function(a,b){return a.sn.y-b.sn.y;}).forEach(function(l){l.ty=l.tn.y+l.tn.to;l.tn.to+=l.w;});
    links.forEach(function(l){
      var x0=l.sn.x+l.sn.w,x1=l.tn.x,xm=(x0+x1)/2;
      var a=l.sy,b=l.ty,c=l.sy+l.w,d=l.ty+l.w;
      l.d='M'+r1(x0)+','+r1(a)+' C'+r1(xm)+','+r1(a)+' '+r1(xm)+','+r1(b)+' '+r1(x1)+','+r1(b)+
        ' L'+r1(x1)+','+r1(d)+' C'+r1(xm)+','+r1(d)+' '+r1(xm)+','+r1(c)+' '+r1(x0)+','+r1(c)+' Z';
    });
    return {nodes:byId,links:links,k:k};
  }

  // Sequential blue ramp for the dark surface; step 0 is "nothing" and sits near the surface.
  var SEQ=['#252a31','#104281','#1c5cab','#2a78d6','#5598e7','#86b6ef'];
  function seq(t){
    if(!(t>0)) return SEQ[0];
    return SEQ[Math.min(SEQ.length-1,1+Math.floor(t*(SEQ.length-1)*0.9999))];
  }

  function spark(vals,W,H,o){
    o=o||{};
    if(!vals.length) return '';
    var mx=Math.max.apply(null,vals.concat([0])),mn=Math.min.apply(null,vals.concat([0]));
    var span=mx-mn||1;
    var pts=vals.map(function(v,i){return [vals.length===1?W:i*W/(vals.length-1),H-2-(v-mn)/span*(H-4)];});
    var line=pts.map(function(p,i){return (i?'L':'M')+r1(p[0])+','+r1(p[1]);}).join(' ');
    var area=line+' L'+r1(pts[pts.length-1][0])+','+H+' L'+r1(pts[0][0])+','+H+' Z';
    var last=pts[pts.length-1];
    return '<svg class="spark" viewBox="0 0 '+W+' '+H+'" width="'+W+'" height="'+H+'" aria-hidden="true" preserveAspectRatio="none">'+
      (o.area!==false?'<path d="'+area+'" class="spark-a"/>':'')+'<path d="'+line+'" class="spark-l"/>'+
      '<circle cx="'+r1(last[0])+'" cy="'+r1(last[1])+'" r="2.5" class="spark-d"/></svg>';
  }

  // Round-topped bar anchored to a baseline (4px data-end, square base).
  function bar(x,base,w,h,cls,extra){
    if(h<=0) return '';
    var r=Math.min(3,h,w/2),top=base-h;
    return '<path class="'+cls+'" d="M'+r1(x)+','+r1(base)+' V'+r1(top+r)+' Q'+r1(x)+','+r1(top)+' '+r1(x+r)+','+r1(top)+' H'+r1(x+w-r)+' Q'+r1(x+w)+','+r1(top)+' '+r1(x+w)+','+r1(top+r)+' V'+r1(base)+' Z"'+(extra||'')+'/>';
  }
  // Horizontal bar growing right from x0 (or left when w<0), rounded at the data end.
  function hbar(x0,y,w,h,cls,extra){
    if(!w) return '';
    var a=Math.abs(w),r=Math.min(3,a,h/2);
    if(w>0) return '<path class="'+cls+'" d="M'+r1(x0)+','+r1(y)+' H'+r1(x0+a-r)+' Q'+r1(x0+a)+','+r1(y)+' '+r1(x0+a)+','+r1(y+r)+' V'+r1(y+h-r)+' Q'+r1(x0+a)+','+r1(y+h)+' '+r1(x0+a-r)+','+r1(y+h)+' H'+r1(x0)+' Z"'+(extra||'')+'/>';
    return '<path class="'+cls+'" d="M'+r1(x0)+','+r1(y)+' H'+r1(x0-a+r)+' Q'+r1(x0-a)+','+r1(y)+' '+r1(x0-a)+','+r1(y+r)+' V'+r1(y+h-r)+' Q'+r1(x0-a)+','+r1(y+h)+' '+r1(x0-a+r)+','+r1(y+h)+' H'+r1(x0)+' Z"'+(extra||'')+'/>';
  }

  return {esc:esc,niceMax:niceMax,kfmt:kfmt,r1:r1,treemap:treemap,sankey:sankey,seq:seq,SEQ:SEQ,spark:spark,bar:bar,hbar:hbar};
})();
