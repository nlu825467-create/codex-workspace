import {wrapText} from './route_core.mjs';
import {anchor,routedPath,segmentHitsBox} from './route_geometry.mjs';

// Geometry checks are evidence about readability, not an aesthetic score.
export function inspectCustomLayout(route,spec){
  const issues=[],warnings=[],positions=spec.positions;
  const ids=new Set(route.nodes.map(n=>n.id));
  for(const id of Object.keys(positions))if(!ids.has(id))issues.push(`布局包含未知节点 ${id}`);
  const overlaps=(a,b)=>a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
  const labels=[],paths=[];let rising=0;
  for(const edge of route.edges){
    const r=spec.routing?.[edge.id];
    if(!r){issues.push(`自定义布局缺少关系路由 ${edge.id}`);continue;}
    const a=positions[edge.from],b=positions[edge.to];
    const start=anchor(a,r.fromSide),end=anchor(b,r.toSide);
    if(!start||!end){issues.push(`关系端点方向无效 ${edge.id}`);continue;}
    const points=routedPath(a,b,r);
    paths.push({id:edge.id,points});
    const last=points.at(-1),prior=points.at(-2);
    if(prior){
      const terminal=Math.hypot(last[0]-prior[0],last[1]-prior[1]);
      const minimum=Math.max(12,(r.width??spec.edgeWidth??1.8)*6);
      if(terminal<minimum)issues.push(`${edge.id} 箭头末段过短 ${terminal.toFixed(1)}，至少预留 ${minimum.toFixed(1)} CSS像素`);
    }
    for(let i=0;i<points.length-1;i++){
      const [x1,y1]=points[i],[x2,y2]=points[i+1];
      for(const [id,p] of Object.entries(positions)){
        if(id===edge.from||id===edge.to)continue;
        const insideX=x=>x>p.x+1&&x<p.x+p.width-1,insideY=y=>y>p.y+1&&y<p.y+p.height-1;
        if(Math.abs(x1-x2)<1&&insideX(x1)&&Math.max(Math.min(y1,y2),p.y+1)<Math.min(Math.max(y1,y2),p.y+p.height-1))issues.push(`${edge.id} 穿过节点 ${id}`);
        else if(Math.abs(y1-y2)<1&&insideY(y1)&&Math.max(Math.min(x1,x2),p.x+1)<Math.min(Math.max(x1,x2),p.x+p.width-1))issues.push(`${edge.id} 穿过节点 ${id}`);
        else if(Math.abs(x1-x2)>=1&&Math.abs(y1-y2)>=1)warnings.push(`${edge.id} 含斜线路径，需要视觉核对`);
      }
    }
    const label=(edge.certainty==='inferred'?'推断：':edge.certainty==='proposed'?'建议：':'')+(edge.label??'');
    if(label){
      if(!r.label){issues.push(`带文字的关系未指定标签位置 ${edge.id}`);continue;}
      const size=r.label.size??spec.edgeLabelSize??18;
      const text=wrapText(label,r.label.width,size);
      const box={id:edge.id,x:r.label.x,y:r.label.y,width:r.label.width,height:Math.max(38,text.split('\n').length*size*1.35+24)};
      if(![box.x,box.y,box.width].every(Number.isFinite)||box.x<0||box.y<0||box.x+box.width>spec.width||box.y+box.height>spec.height)issues.push(`标签越界 ${edge.id}`);
      for(const [id,p] of Object.entries(positions))if(overlaps(box,p))issues.push(`${edge.id} 标签压住节点 ${id}`);
      for(const ann of spec.annotations??[])if(overlaps(box,ann))issues.push(`${edge.id} 标签压住说明 ${ann.id}`);
      labels.push(box);
    }
    if((spec.direction??'vertical')==='vertical'&&edge.type!=='feedback'&&b.y+b.height/2<a.y+a.height/2-Math.max(a.height,b.height))rising++;
  }
  for(let i=0;i<labels.length;i++)for(let j=i+1;j<labels.length;j++)if(overlaps(labels[i],labels[j]))issues.push(`关系标签重叠 ${labels[i].id}/${labels[j].id}`);
  for(const path of paths)for(const label of labels)for(let i=0;i<path.points.length-1;i++){
    if(segmentHitsBox(path.points[i],path.points[i+1],label,spec.labelClearance??3))issues.push(`${path.id} 连线被关系标签 ${label.id} 遮挡或贴字`);
  }
  if(rising)warnings.push(`${rising} 条非反馈关系明显逆向，检查是否把主线拆成了折返长列`);
  if(issues.length)throw new Error([...new Set(issues)].join('\n'));
  return {warnings:[...new Set(warnings)],review:'实际路由、节点穿线、标签遮线及箭头末段检查；不等于美观评价或所有连线交叉检查'};
}
