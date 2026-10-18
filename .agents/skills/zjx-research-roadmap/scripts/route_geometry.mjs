// Shared by validation and drawing so the inspected path is the drawn path.
export function anchor(p,side){return ({left:[p.x,p.y+p.height/2],right:[p.x+p.width,p.y+p.height/2],top:[p.x+p.width/2,p.y],bottom:[p.x+p.width/2,p.y+p.height]})[side];}
export function normalizePath(points){
  const out=[];
  for(const p of points){
    if(out.length&&Math.hypot(p[0]-out.at(-1)[0],p[1]-out.at(-1)[1])<.01)continue;
    out.push(p);
    while(out.length>=3){
      const [a,b,c]=out.slice(-3),u=[b[0]-a[0],b[1]-a[1]],v=[c[0]-b[0],c[1]-b[1]];
      if(Math.abs(u[0]*v[1]-u[1]*v[0])<.01&&u[0]*v[0]+u[1]*v[1]>0)out.splice(out.length-2,1);
      else break;
    }
  }
  return out;
}
export function routedPath(a,b,r){
  const start=anchor(a,r.fromSide),end=anchor(b,r.toSide);
  if(!start||!end)throw new Error('关系端点方向无效');
  let points=[start,...(r.points??[]).map(p=>[p.x,p.y]),end];
  if(!r.points?.length&&(r.kind??'elbow')==='elbow'){
    if(['top','bottom'].includes(r.fromSide)&&['top','bottom'].includes(r.toSide)){
      const y=(start[1]+end[1])/2;points=[start,[start[0],y],[end[0],y],end];
    }else if(['left','right'].includes(r.fromSide)&&['left','right'].includes(r.toSide)){
      const x=(start[0]+end[0])/2;points=[start,[x,start[1]],[x,end[1]],end];
    }else throw new Error('混合方向折线须提供显式路由点');
  }
  return normalizePath(points);
}
export function segmentHitsBox(a,b,box,padding=0){
  const lo=[box.x-padding,box.y-padding],hi=[box.x+box.width+padding,box.y+box.height+padding];
  let t0=0,t1=1;
  for(let i=0;i<2;i++){
    const d=b[i]-a[i];
    if(Math.abs(d)<.0001){if(a[i]<=lo[i]||a[i]>=hi[i])return false;continue;}
    const t=[(lo[i]-a[i])/d,(hi[i]-a[i])/d].sort((x,y)=>x-y);
    t0=Math.max(t0,t[0]);t1=Math.min(t1,t[1]);if(t0>=t1)return false;
  }
  return t1>0&&t0<1;
}
