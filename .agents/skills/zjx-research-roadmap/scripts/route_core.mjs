// Semantic records are supplied by the model; this module never invents steps.
export const LAYOUTS = ['vertical','parallel','swimlane','fusion','validation','feedback'];
const ROLES = ['input','task','method','model','validation','output','decision'];
const TYPES = ['sequence','data','supports','validates','feedback','decision'];
const CERTAINTIES = ['explicit','inferred','proposed'];
const nonempty = s => typeof s === 'string' && s.trim().length > 0;
const orderedEdges = r => r.edges.filter(e => !['feedback','supports'].includes(e.type));

export function validateRoute(r) {
  const errors=[], warnings=[];
  const check=(ok,msg)=>{if(!ok)errors.push(msg);};
  if (!r || typeof r !== 'object') throw new Error('route.json 必须是对象');
  check(r.schema_version===1,'schema_version 必须是1');
  check(nonempty(r.title),'缺少图标题');
  check(['planned','completed','unspecified'].includes(r.study_status),'研究状态无效');
  for(const key of ['sources','stages','nodes','edges']) check(Array.isArray(r[key]),`${key} 必须是数组`);
  if(errors.length) throw new Error(errors.join('\n'));
  check(r.sources.length>0,'至少需要一个实际材料来源');
  check(r.stages.length>0,'至少需要一个阶段');
  check(r.nodes.length>0,'至少需要一个研究节点');
  function unique(items,kind){
    const seen=new Set();
    for(const item of items){check(item && nonempty(item.id),`${kind} 缺少id`);check(!seen.has(item?.id),`${kind} id重复：${item?.id}`);seen.add(item?.id);}
    return seen;
  }
  const sources=unique(r.sources,'来源'), stages=unique(r.stages,'阶段'), nodes=unique(r.nodes,'节点');
  unique(r.edges,'连线');
  for(const x of [...r.sources,...r.stages])check(nonempty(x.label),`${x.id} 缺少label`);
  function evidence(x){
    check(CERTAINTIES.includes(x.certainty),`${x.id} certainty无效`);
    check(Array.isArray(x.evidence)&&x.evidence.length>0,`${x.id} 缺少材料依据`);
    for(const ref of x.evidence??[]){check(sources.has(ref.source),`${x.id} 引用未知来源 ${ref.source}`);check(nonempty(ref.locator),`${x.id} 缺少来源定位`);}
    if(x.certainty!=='explicit')check(nonempty(x.rationale),`${x.id} 推断/建议缺少解释`);
  }
  for(const n of r.nodes){
    check(nonempty(n.label)&&nonempty(n.details),`${n.id} 缺少短标签或完整说明`);
    check(stages.has(n.stage),`${n.id} 引用未知阶段 ${n.stage}`);
    check(ROLES.includes(n.role),`${n.id} role无效`);
    check(n.lane===undefined||['development','validation'].includes(n.lane),`${n.id} lane无效`);
    evidence(n);
  }
  for(const e of r.edges){
    check(nodes.has(e.from)&&nodes.has(e.to),`${e.id} 连接未知节点`);
    check(e.from!==e.to,`${e.id} 自环请展开具体反馈步骤`);
    check(TYPES.includes(e.type),`${e.id} type无效`);
    if(['feedback','decision'].includes(e.type))check(nonempty(e.label),`${e.id} 反馈/条件边必须有标签`);
    evidence(e);
  }
  const primary=r.selection?.primary??'auto';
  check(primary==='auto'||LAYOUTS.includes(primary),'primary布局无效');
  if(primary!=='auto')check(nonempty(r.selection?.reason),'显式选型必须说明原因');
  for(const motif of r.selection?.motifs??[])check(LAYOUTS.includes(motif),`未知局部结构 ${motif}`);
  if(r.selection?.motifs?.includes('feedback'))check(r.edges.some(e=>e.type==='feedback'),'反馈局部结构缺少真实反馈边');
  if(primary==='swimlane')check(r.nodes.some(n=>n.role==='method'),'三栏布局需要真实方法节点');
  const hasValidation=r.nodes.some(n=>n.lane==='validation');
  if(r.constraints?.independent_validation || primary==='validation' || hasValidation || r.selection?.motifs?.includes('validation')){
    check(r.constraints?.independent_validation===true,'验证分区缺少独立验证依据标记，普通测试划分不能当成外部验证');
    check(r.nodes.some(n=>n.lane==='validation'&&n.role==='input'),'验证分区缺少独立数据输入');
    check(r.nodes.some(n=>n.lane==='validation'&&n.role==='validation'),'验证分区缺少验证任务');
    check(r.nodes.some(n=>(n.lane??'development')==='development'&&n.role==='model'),'缺少开发模型节点');
    const byId=new Map(r.nodes.map(n=>[n.id,n]));
    for(const e of r.edges){
      const target=byId.get(e.to);
      const terminalReport=target?.role==='output'&&!r.edges.some(x=>x.from===e.to);
      if(['data','sequence'].includes(e.type))check(!(byId.get(e.from)?.lane==='validation' && (target?.lane??'development')==='development'&&!terminalReport),`${e.id} 验证数据流回开发区，请核对泄漏或明确真实反馈`);
    }
  }
  if(primary==='feedback')check(r.edges.some(e=>e.type==='feedback'),'反馈布局缺少真实反馈边');
  const app=r.appearance??{};
  check(app.target_width_mm===undefined||(Number.isFinite(app.target_width_mm)&&app.target_width_mm>=50&&app.target_width_mm<=300),'target_width_mm应为50—300毫米');
  check(app.print_profile===undefined||['general','funding','journal'].includes(app.print_profile),'print_profile无效');
  check(app.style===undefined||['academic','mono','color'].includes(app.style),'style无效');
  check(app.dpi===undefined||[300,600].includes(app.dpi),'dpi仅支持300/600');
  check(app.png_width===undefined||(Number.isInteger(app.png_width)&&app.png_width>=800&&app.png_width<=12000),'png_width应为800—12000像素');
  if(errors.length)throw new Error(errors.join('\n'));
  // Detect scientific cycles, including support relationships, without reversing edges.
  topological(r.nodes,r.edges.filter(e=>e.type!=='feedback'));
  const idx=new Map(r.stages.map((s,i)=>[s.id,i]));
  const byId=new Map(r.nodes.map(n=>[n.id,n]));
  for(const e of orderedEdges(r)){
    check(idx.get(byId.get(e.from).stage)<=idx.get(byId.get(e.to).stage),`${e.id} 主流程跨阶段倒退，请检查阶段顺序或反馈类型`);
  }
  if(errors.length)throw new Error(errors.join('\n'));
  for(const n of r.nodes){if(!r.edges.some(e=>e.from===n.id||e.to===n.id))warnings.push(`独立模块 ${n.id} 未连线，请核对是否确实独立`);}
  if(r.nodes.some(n=>n.certainty!=='explicit')||r.edges.some(e=>e.certainty!=='explicit'))warnings.push('存在推断/建议，图内必须保留标记并复核');
  return {warnings};
}

export function topological(nodes,edges){
  const incoming=new Map(nodes.map(n=>[n.id,0])), outgoing=new Map(nodes.map(n=>[n.id,[]]));
  for(const e of edges){incoming.set(e.to,incoming.get(e.to)+1);outgoing.get(e.from).push(e.to);}
  const q=nodes.filter(n=>incoming.get(n.id)===0).map(n=>n.id), result=[];
  while(q.length){const id=q.shift();result.push(id);for(const to of outgoing.get(id)){incoming.set(to,incoming.get(to)-1);if(incoming.get(to)===0)q.push(to);}}
  if(result.length!==nodes.length)throw new Error('非反馈连线形成循环；核对关系，将真实返回边标为feedback，不能为排版反转科学方向');
  return result;
}

export function chooseLayout(r){
  const motifs=new Set(r.selection?.motifs??[]), edges=orderedEdges(r);
  const incoming=id=>edges.filter(e=>e.to===id), outgoing=id=>edges.filter(e=>e.from===id);
  const branch=r.nodes.some(n=>outgoing(n.id).length>1), merge=r.nodes.some(n=>incoming(n.id).length>1);
  const roots=r.nodes.filter(n=>n.role==='input'&&(n.lane??'development')==='development');
  const rootAncestors=id=>{
    const seen=new Set(),todo=[id];while(todo.length){const current=todo.pop();for(const e of incoming(current)){if(!seen.has(e.from)){seen.add(e.from);todo.push(e.from);}}}return roots.filter(n=>seen.has(n.id)).length;
  };
  const fusion=roots.length>1&&r.nodes.some(n=>incoming(n.id).length>1&&rootAncestors(n.id)>1);
  if(branch&&merge)motifs.add('parallel');if(fusion)motifs.add('fusion');
  if(r.edges.some(e=>e.type==='feedback'))motifs.add('feedback');
  if(r.constraints?.independent_validation)motifs.add('validation');
  let primary,reason;
  if(r.selection?.primary && r.selection.primary!=='auto'){primary=r.selection.primary;reason=r.selection.reason;}
  else if(motifs.has('validation')){primary='validation';reason='独立验证数据与模型开发数据分区，同时保留内部分析关系。';}
  else if(motifs.has('feedback')){primary='feedback';reason='后续结果返回前面的具体步骤，需要清晰展示反馈对象。';}
  else if(r.selection?.intent==='stage-task-method'&&r.nodes.some(n=>n.role==='method')){primary='swimlane';reason='按研究阶段对应展示任务与方法。';}
  else if(fusion){primary='fusion';reason='多个独立输入分别处理后进入多输入联合分析。';}
  else if(branch&&merge){primary='parallel';reason='共享输入分叉为多个任务，结果随后汇合。';}
  else{primary='vertical';reason='以阶段依赖为主，纵向递进有助于连续阅读。';}
  return {primary,reason,motifs:[...motifs]};
}

export function displayLabel(n){return (n.certainty==='inferred'?'推断：':n.certainty==='proposed'?'建议：':'')+n.label;}
export function units(s){return [...s].reduce((sum,c)=>sum+(/[\u2e80-\uffff]/u.test(c)?1:/\s/u.test(c)?0.32:0.57),0);}
export function wrapText(text,width,fontSize){
  const limit=(width-28)/fontSize, result=[];
  for(const paragraph of text.split('\n')){
    let line='';const tokens=paragraph.match(/[A-Za-z0-9_./+−-]+|\s+|[^\x00-\x7F]|./gu)??[''];
    for(const token of tokens){
      if(units(token)>limit){for(const char of token){if(line&&units(line+char)>limit){result.push(line.trim());line='';}line+=char;}continue;}
      if(line&&units(line+token)>limit){result.push(line.trim());line='';}line+=token;
    }result.push(line.trim());
  }
  return result.join('\n');
}

export function planLayout(r,selection=chooseLayout(r)){
  const primary=selection.primary, fontSize=24, positions={}, rows=[], panels=[];
  const title=wrapText(r.title,primary==='swimlane'||primary==='validation'?1150:1000,34);
  const titleHeight=Math.max(70,title.split('\n').length*43+18), start=titleHeight+66;
  const nodeSize=(n,width)=>{
    const text=wrapText(displayLabel(n),width,fontSize);
    const height=Math.max(n.role==='decision'?108:78,text.split('\n').length*32+32+(n.role==='decision'?24:0));
    return {width,height,text};
  };
  let width=1180, y=start;
  if(primary==='swimlane'){
    width=1240+(r.edges.some(e=>e.type==='feedback')?180:0);
    for(const stage of r.stages){
      const task=r.nodes.filter(n=>n.stage===stage.id&&n.role!=='method'),method=r.nodes.filter(n=>n.stage===stage.id&&n.role==='method');
      const heightOf=(list,w)=>list.reduce((sum,n)=>sum+nodeSize(n,w).height+30,0);
      const h=Math.max(130,heightOf(task,420),heightOf(method,350))+35;
      panels.push({stage:stage.id,label:stage.label,x:40,y,width:1160,height:h});
      for(const [list,x,w] of [[task,290,420],[method,820,350]]){
        let ny=y+22;for(const n of list){const size=nodeSize(n,w);positions[n.id]={x,y:ny,...size};ny+=size.height+30;}
      }y+=h+20;
    }
  }else{
    // Keep stages in source order and compute longest-path levels inside each.
    const rank=new Map(),edges=orderedEdges(r);let offset=0;
    for(const stage of r.stages){
      const subset=r.nodes.filter(n=>n.stage===stage.id), ids=new Set(subset.map(n=>n.id));
      const inside=edges.filter(e=>ids.has(e.from)&&ids.has(e.to));
      const order=topological(subset,inside),local=new Map(subset.map(n=>[n.id,0]));
      for(const id of order){for(const e of inside.filter(e=>e.from===id))local.set(e.to,Math.max(local.get(e.to),local.get(id)+1));}
      for(const n of subset)rank.set(n.id,offset+local.get(n.id));
      offset+=subset.length?Math.max(...local.values())+1:0;
    }
    const grouped=new Map();for(const n of r.nodes){const key=rank.get(n.id);if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(n);}
    const maxCount=Math.max(1,...[...grouped.values()].map(list=>list.length));
    const feedbackSpace=r.edges.some(e=>e.type==='feedback')?180:0;
    width=primary==='validation'?1320+feedbackSpace:Math.max(1080,210+maxCount*320+Math.max(0,maxCount-1)*46+70+feedbackSpace);
    for(const [level,list] of [...grouped.entries()].sort((a,b)=>a[0]-b[0])){
      let height=78;
      if(primary==='validation'){
        for(const lane of ['development','validation']){
          const part=list.filter(n=>(n.lane??'development')===lane), w=Math.min(400,(550-Math.max(0,part.length-1)*28)/Math.max(1,part.length));
          const left=lane==='development'?60:710, total=part.length*w+Math.max(0,part.length-1)*28;
          part.forEach((n,i)=>{const size=nodeSize(n,w);positions[n.id]={x:left+(550-total)/2+i*(w+28),y,...size};height=Math.max(height,size.height);});
        }
      }else{
        const content=width-230-feedbackSpace, total=list.length*320+(list.length-1)*46;
        list.forEach((n,i)=>{const size=nodeSize(n,320);positions[n.id]={x:190+(content-total)/2+i*366,y,...size};height=Math.max(height,size.height);});
      }
      rows.push({level,y,height,stage:list[0].stage});y+=height+68;
    }
    if(primary!=='validation')for(const stage of r.stages){
      const cells=r.nodes.filter(n=>n.stage===stage.id).map(n=>positions[n.id]);if(!cells.length)continue;
      const top=Math.min(...cells.map(p=>p.y))-18,bottom=Math.max(...cells.map(p=>p.y+p.height))+18;
      panels.push({stage:stage.id,label:stage.label,x:26,y:top,width:width-52-feedbackSpace,height:bottom-top});
    }
  }
  const height=y+65;
  const warnings=[];
  if(height>2200||width>2000)warnings.push('路线图较大：按最终排版尺寸检查字号，必要时生成总览/详图；不要删关键节点');
  const all=Object.entries(positions);
  for(let i=0;i<all.length;i++)for(let j=i+1;j<all.length;j++){
    const [id,a]=all[i],[other,b]=all[j];
    if(a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y)throw new Error(`节点重叠 ${id}/${other}`);
  }
  for(const [id,p] of all)if(p.x<0||p.y<0||p.x+p.width>width||p.y+p.height>height)throw new Error(`节点越界 ${id}`);
  return {primary,width,height,title,titleHeight,start,positions,panels,rows,fontSize,warnings};
}
