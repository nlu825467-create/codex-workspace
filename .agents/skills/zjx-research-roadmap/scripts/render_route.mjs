import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {validateRoute,chooseLayout,planLayout,wrapText} from './route_core.mjs';
import {inspectCustomLayout} from './layout_quality.mjs';
import {routedPath} from './route_geometry.mjs';

function args(argv){const out={};for(let i=0;i<argv.length;i+=2){if(!argv[i]?.startsWith('--')||!argv[i+1])throw new Error('参数格式：--name value');out[argv[i].slice(2)]=argv[i+1];}return out;}
const opt=args(process.argv.slice(2));
for(const key of ['input','outdir','runtime-modules','presentation-skill','python'])if(!opt[key])throw new Error(`缺少 --${key}`);
const input=path.resolve(opt.input), outdir=path.resolve(opt.outdir), workspace=path.resolve(opt.workspace??path.dirname(input));
const relative=path.relative(workspace,outdir);
if(relative.startsWith('..')||path.isAbsolute(relative))throw new Error('outdir 必须位于 workspace 内；验证后再复制到其他位置');
const runtimeModules=path.resolve(opt['runtime-modules']), skillDir=path.resolve(opt['presentation-skill']);
process.env.RUNTIME_NODE_MODULES=runtimeModules;
const req=createRequire(path.join(runtimeModules,'__runtime__.cjs'));
const {Presentation,PresentationFile,FileBlob}=await import(pathToFileURL(req.resolve('@oai/artifact-tool')).href);
const {FontLibrary}=createRequire(req.resolve('@oai/artifact-tool'))('skia-canvas');
const {finalizePresentation}=await import(pathToFileURL(path.join(skillDir,'container_tools/artifact_tool_utils.mjs')).href);
const available=new Map(FontLibrary.families.map(f=>[f.toLowerCase(),f]));
const candidates=opt.font?[opt.font]:['Microsoft YaHei UI','Noto Sans SC','Noto Sans CJK SC','Source Han Sans SC'];
const font=candidates.map(f=>available.get(f.toLowerCase())).find(Boolean);
if(!font)throw new Error('未发现可用中文字体；传入已验证字体 --font，不能静默使用缺字字体');
const route=JSON.parse((await fs.readFile(input,'utf8')).replace(/^\uFEFF/,''));
if(opt.layout)route.selection={...(route.selection??{}),primary:opt.layout,reason:opt.reason??route.selection?.reason??'用户或模型显式指定该布局。'};
if(opt.style)route.appearance={...(route.appearance??{}),style:opt.style};
const contentCheck=validateRoute(route), selection=chooseLayout(route);
let plan=planLayout(route,selection);
if(route.constraints?.independent_validation&&selection.primary!=='validation'&&!opt['layout-spec'])throw new Error('独立验证作为局部结构时须提供 layout-spec，并用 zones[].lane="validation" 明确验证边界');
if(!opt['layout-spec']&&route.nodes.length>=12&&selection.motifs.length>=2)throw new Error('复杂组合路线须先编排 layout-spec.json；基础网格不能作为最终版面。按 references/visual-layout.md 构图后继续生成，不向用户索要布局代码。');
if(opt['layout-spec']){
  const spec=JSON.parse((await fs.readFile(path.resolve(opt['layout-spec']),'utf8')).replace(/^\uFEFF/,''));
  for(const k of ['width','height','fontSize'])if(!Number.isFinite(spec[k])||spec[k]<20)throw new Error(`自定义布局 ${k} 无效`);
  const positions={};
  for(const n of route.nodes){
    const p=spec.positions?.[n.id];
    if(!p||!['x','y','width','height'].every(k=>Number.isFinite(p[k]))||p.width<=28||p.height<40||p.x<0||p.y<0||p.x+p.width>spec.width||p.y+p.height>spec.height)throw new Error(`自定义节点几何无效 ${n.id}`);
    const size=spec.nodeStyles?.[n.id]?.size??spec.fontSize;
    positions[n.id]={...p,text:wrapText((n.certainty==='inferred'?'推断：':n.certainty==='proposed'?'建议：':'')+n.label,p.width,size)};
    if(positions[n.id].text.split('\n').length*(size*1.35)+24>p.height)throw new Error(`自定义节点文字高度不足 ${n.id}`);
  }
  const boxes=Object.entries(positions);
  for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){
    const [id,a]=boxes[i],[other,b]=boxes[j];
    if(a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y)throw new Error(`自定义节点重叠 ${id}/${other}`);
  }
  for(const [id,r] of Object.entries(spec.routing??{})){
    if(!route.edges.some(e=>e.id===id))throw new Error(`自定义路由引用未知边 ${id}`);
    for(const p of r.points??[])if(!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<1||p.x>=spec.width-1||p.y<1||p.y>=spec.height-1)throw new Error(`自定义路由点越界 ${id}`);
  }
  const visualGeometry=inspectCustomLayout(route,spec);
  if(route.constraints?.independent_validation&&selection.primary!=='validation'){
    const zones=(spec.zones??[]).filter(z=>z.lane==='validation');
    if(!zones.length)throw new Error('局部独立验证缺少 lane="validation" 的区域');
    const contains=(z,p)=>p.x>=z.x&&p.y>=z.y&&p.x+p.width<=z.x+z.width&&p.y+p.height<=z.y+z.height;
    const overlap=(z,p)=>p.x<z.x+z.width&&p.x+p.width>z.x&&p.y<z.y+z.height&&p.y+p.height>z.y;
    for(const n of route.nodes){
      if(n.lane==='validation'&&!zones.some(z=>contains(z,positions[n.id])))throw new Error(`外部验证节点未完整处于验证区域 ${n.id}`);
      if(n.lane!=='validation'&&zones.some(z=>overlap(z,positions[n.id])))throw new Error(`验证区域混入开发节点 ${n.id}`);
    }
  }
  plan={...plan,...spec,positions,title:wrapText(route.title,spec.width-84,spec.titleSize??34),titleHeight:spec.titleHeight??70,start:140,panels:spec.panels??[],warnings:visualGeometry.warnings};
}
const stem=opt.stem??'研究技术路线图';
if(path.basename(stem)!==stem||/[<>:"/\\|?*]/.test(stem))throw new Error('stem 必须是安全文件名');
const pptx=path.join(outdir,stem+'.pptx'), png=path.join(outdir,stem+'.png');
for(const file of [pptx,png])if(await fs.stat(file).catch(()=>null))throw new Error(`输出已存在，请使用新版本目录：${file}`);
const build=path.join(workspace,'.roadmap-build',`${Date.now()}-${process.pid}`);
await fs.mkdir(build,{recursive:true});await fs.mkdir(outdir,{recursive:true});
const targetWidth=route.appearance?.target_width_mm;
const outputScale=targetWidth?targetWidth/(plan.width*25.4/96):1;
const presentation=Presentation.create({slideSize:{width:plan.width*outputScale,height:plan.height*outputScale}}), slide=presentation.slides.add();
slide.background.fill='#FFFFFF';
const style=route.appearance?.style??'academic', mono=style==='mono';
const palette={input:'#E8F0FA',task:'#F5F7FA',method:'#FFF1DC',model:'#EEEAF8',validation:'#E4F2EB',output:'#DFEAF7',decision:'#FFF6DF'};
const neutral=style!=='color';
const ink=neutral?'#222222':'#183651', accent=neutral?'#333333':'#305D8C';
function shape(name,text,x,y,width,height,{fill='none',line='none',size=24,bold=false,color=ink,align='center',dash=false,geometry='rect',lineWidth=plan.frameWidth??1.3}={}){
  if(mono){if(fill!=='none')fill=name.startsWith('band-accent-')?'#202020':'#FFFFFF';if(line!=='none')line='#202020';color='#202020';}
  const s=slide.shapes.add({name,geometry,position:{left:x*outputScale,top:y*outputScale,width:width*outputScale,height:height*outputScale},fill,line:{fill:line,width:line==='none'?0:lineWidth*outputScale,style:dash?'dashed':'solid'}});
  if(text){s.text=text;s.text.style={typeface:font,fontSize:size*outputScale,bold,color,alignment:align,verticalAlignment:'middle',autoFit:'none',wrap:'none',insets:{top:10*outputScale,bottom:10*outputScale,left:12*outputScale,right:12*outputScale}};}
  return s;
}
shape('route-title',plan.title,42,plan.titleY??15,plan.width-84,plan.titleHeight,{size:plan.titleSize??34,bold:true,color:plan.accent??accent});
for(const band of plan.stageBands??[]){
  shape('band-'+band.id,'',280,band.y,plan.width-340,band.height,{fill:band.fill??'none'});
  const center=band.y+band.height/2;
  shape('band-number-'+band.id,band.number,40,center-75,190,58,{size:38,bold:true,color:band.color??accent});
  shape('band-label-'+band.id,band.label,40,center-17,190,100,{size:28,bold:true,color:band.color??accent});
  shape('band-accent-'+band.id,'',245,band.y+18,3,band.height-36,{fill:band.color??(neutral?'#999999':'#B7C7D6')});
}
for(const a of plan.annotations??[])shape('annotation-'+a.id,wrapText(a.text,a.width,a.size??22),a.x,a.y,a.width,a.height,{fill:a.fill??'none',size:a.size??22,color:a.color??(neutral?'#666666':'#667C8E'),bold:a.bold??false,align:a.align??'center'});
if(plan.primary==='swimlane'){
  const y=plan.start-52;shape('column-stage','研究阶段',40,y,210,42,{size:22,bold:true});shape('column-task','研究任务',290,y,420,42,{size:22,bold:true});shape('column-method','研究方法',820,y,350,42,{size:22,bold:true});
}
if(plan.zones){
  for(const z of plan.zones){
    shape('zone-'+z.id,'',z.x,z.y,z.width,z.height,{fill:z.fill??(neutral?'#F7F7F7':'#F8FAFC'),line:z.line??(neutral?'#999999':'#B7C7D6'),dash:true});
    if(z.label)shape('zone-heading-'+z.id,z.label,z.x,z.y-56,z.width,48,{size:26,bold:true,color:z.color??accent});
  }
}else if(plan.primary==='validation'){
  shape('development-zone','',40,plan.start-18,590,plan.height-plan.start-32,{fill:mono?'#FFFFFF':neutral?'#F7F7F7':'#F4F7FB',line:neutral?'#AAAAAA':'#BBCADA',dash:true});
  shape('validation-zone','',690,plan.start-18,590,plan.height-plan.start-32,{fill:mono?'#FFFFFF':neutral?'#F4F4F4':'#F0F7F3',line:neutral?'#999999':'#B9CFC2',dash:true});
  shape('development-heading','模型开发',60,plan.start-60,550,42,{size:23,bold:true,color:accent});
  shape('validation-heading','独立外部验证',710,plan.start-60,550,42,{size:23,bold:true,color:accent});
}
for(const panel of plan.panels){
  shape('stage-frame-'+panel.stage,'',panel.x,panel.y,panel.width,panel.height,{line:neutral?'#AAAAAA':'#C7D2DD',dash:true});
  const label=wrapText(panel.label,plan.primary==='swimlane'?180:148,22);
  shape('stage-label-'+panel.stage,label,panel.x+8,panel.y+8,plan.primary==='swimlane'?202:148,panel.height-16,{size:22,bold:true,color:accent});
}
const nodes=new Map();
for(const n of route.nodes){
  const p=plan.positions[n.id], fill=mono?'#FFFFFF':style==='color'?palette[n.role]:n.role==='output'?'#EFEFEF':'#FFFFFF';
  const nodeStyle={...(plan.defaultNodeStyle??{}),...(plan.nodeStyles?.[n.id]??{})};
  nodes.set(n.id,shape('node-'+n.id,p.text,p.x,p.y,p.width,p.height,{fill,line:accent,size:plan.fontSize,bold:['model','output'].includes(n.role),geometry:n.role==='decision'?'diamond':'rect',...nodeStyle,dash:n.certainty!=='explicit'}));
}
const edgeObjects=[];
function connector(from,to,fromSide,toSide,{arrow=true,dashed=false,color=ink,kind='elbow',width=1.8}={}){
  return slide.shapes.connect(from,to,{kind,fromSide,toSide,line:{fill:color,width:width*outputScale,style:dashed?'dashed':'solid'},tail:{type:arrow?'triangle':'none',width:plan.arrowSize??'sm',length:plan.arrowSize??'sm'}});
}
for(const e of route.edges){
  const a=plan.positions[e.from],b=plan.positions[e.to];
  const color=mono?ink:e.type==='feedback'?(plan.feedbackColor??(neutral?'#555555':'#A05A2C')):plan.edgeColor??ink;
  const dashed=e.type==='supports'||e.certainty!=='explicit';
  let labelX,labelY,labelW=160;
  const custom=plan.routing?.[e.id];
  if(custom){
    const names=[],refs=[nodes.get(e.from)];
    const routePoints=routedPath(a,b,custom).slice(1,-1).map(([x,y])=>({x,y}));
    for(const [i,p] of routePoints.entries()){
      const name='guide-'+e.id+'-'+(i+1);names.push(name);refs.push(shape(name,'',p.x-.05,p.y-.05,.1,.1));
    }
    refs.push(nodes.get(e.to));const objects=[];
    for(let i=0;i<refs.length-1;i++)objects.push(connector(refs[i],refs[i+1],i===0?custom.fromSide:'right',i===refs.length-2?custom.toSide:'left',{arrow:i===refs.length-2,dashed,color:mono?ink:custom.color??color,width:custom.width??plan.edgeWidth??1.8,kind:'straight'}).id);
    edgeObjects.push({id:e.id,objects,guides:names,from:nodes.get(e.from).id,to:nodes.get(e.to).id,type:e.type});
    labelX=custom.label?.x??(a.x+a.width/2);labelY=custom.label?.y??(a.y+a.height+12);labelW=custom.label?.width??160;
  }else if(e.type==='feedback'){
    // Native, attached endpoint segments with invisible routing guides keep the
    // scientific direction and route outside the main content. Only the final
    // segment has an arrowhead. Guides are editable graphical objects, not steps.
    const x=plan.width-92,ay=a.y+a.height/2,by=b.y+b.height/2;
    const ga=shape('guide-'+e.id+'-a','',x,ay,1,1),gb=shape('guide-'+e.id+'-b','',x,by,1,1);
    const c1=connector(nodes.get(e.from),ga,'right','left',{arrow:false,dashed,color,kind:'straight'});
    const c2=connector(ga,gb,'top','bottom',{arrow:false,dashed,color,kind:'straight'});
    const c3=connector(gb,nodes.get(e.to),'left','right',{dashed,color,kind:'straight'});
    edgeObjects.push({id:e.id,objects:[c1.id,c2.id,c3.id],from:nodes.get(e.from).id,to:nodes.get(e.to).id,type:e.type});
    labelW=142;labelX=x-160;labelY=(ay+by)/2-25;
  }else{
    const sameRow=Math.abs(a.y-b.y)<12;
    const forward=b.y>=a.y+a.height;
    let fromSide,toSide;
    if(sameRow){fromSide=a.x<b.x?'right':'left';toSide=a.x<b.x?'left':'right';}
    else if(Math.abs((a.x+a.width/2)-(b.x+b.width/2))>450){fromSide=a.x<b.x?'right':'left';toSide=a.x<b.x?'left':'right';}
    else{fromSide=forward?'bottom':'top';toSide=forward?'top':'bottom';}
    const c=connector(nodes.get(e.from),nodes.get(e.to),fromSide,toSide,{dashed,color});
    edgeObjects.push({id:e.id,objects:[c.id],from:nodes.get(e.from).id,to:nodes.get(e.to).id,type:e.type});
    if(sameRow){const left=a.x<b.x?a.x+a.width:b.x+b.width,right=a.x<b.x?b.x:a.x;labelW=Math.max(65,Math.min(160,right-left-8));labelX=(left+right)/2-labelW/2;labelY=a.y+a.height/2-38;}
    else{labelX=(a.x+a.width/2+b.x+b.width/2)/2+10;labelY=(a.y+a.height+b.y)/2-20;}
  }
  const label=(e.certainty==='inferred'?'推断：':e.certainty==='proposed'?'建议：':'')+(e.label??'');
  if(label){const size=custom?.label?.size??plan.edgeLabelSize??18;const t=wrapText(label,labelW,size);shape('edge-label-'+e.id,t,labelX,labelY,labelW,Math.max(38,t.split('\n').length*(size*1.35)+24),{fill:'#FFFFFF',size,color:custom?.color??color});}
}
const state={planned:'计划研究',completed:'已完成研究',unspecified:''}[route.study_status];
const uncertain=route.nodes.some(n=>n.certainty!=='explicit')||route.edges.some(e=>e.certainty!=='explicit');
const footer=[state,uncertain?'虚线及文字标记说明推断/建议步骤':''].filter(Boolean).join('；');
if(footer)shape('route-legend',wrapText(plan.footer??footer,plan.width-84,plan.footerSize??17),42,plan.footerY??(plan.height-48),plan.width-84,plan.footerHeight??38,{size:plan.footerSize??17,color:neutral?'#666666':'#526477',align:'left'});
slide.speakerNotes.textFrame.setText([
  `布局：${selection.primary}。${selection.reason}`,
  ...route.sources.map(s=>`来源 ${s.id}：${s.label}${s.path?'；'+s.path:''}${s.text?'\n'+s.text:''}`),
  ...route.nodes.map(n=>`节点 ${n.id}：${n.details}。依据：${n.evidence.map(x=>x.source+' '+x.locator).join('；')}${n.rationale?'。'+n.rationale:''}`),
  ...route.edges.map(e=>`关系 ${e.id}：${e.from} ${e.type} ${e.to}。${e.label??''} 依据：${e.evidence.map(x=>x.source+' '+x.locator).join('；')}${e.rationale?'。'+e.rationale:''}`)
].join('\n\n'));
const candidate=path.join(build,'candidate.pptx');
await(await PresentationFile.exportPptx(presentation)).save(candidate);
await finalizePresentation({workspaceDir:workspace,candidatePath:candidate,finalPath:pptx,pythonExecutable:path.resolve(opt.python),integrityValidatorPath:path.join(skillDir,'container_tools/inspect_presentation_package_integrity.py'),layoutValidatorPath:path.join(skillDir,'container_tools/inspect_presentation_layout_geometry.py'),explicitTotalSlideCount:1,fontPolicy:{basis:'design',families:[font]},layoutArgs:['--expected-slide-size-emu',`${Math.round(plan.width*outputScale*9525)},${Math.round(plan.height*outputScale*9525)}`,'--validate-heading-fit'],verifyArtifactToolImport:true,receiptPath:path.join(build,'finalization.json')});
// Render the actual delivered PPTX, not a second independently laid-out image.
const final=await PresentationFile.importPptx(await FileBlob.load(pptx));
const finalSlide=final.slides.items[0];
const dpi=route.appearance?.dpi??300, pngWidth=route.appearance?.png_width??Math.round((targetWidth??200)/25.4*dpi);
const preview=await final.export({slide:finalSlide,format:'png',scale:pngWidth/(plan.width*outputScale)});
let bytes=Buffer.from(await preview.arrayBuffer());
function crc32(data){let crc=0xffffffff;for(const v of data){crc^=v;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
function density(buffer,dpi){const data=Buffer.alloc(9);data.writeUInt32BE(Math.round(dpi/0.0254),0);data.writeUInt32BE(Math.round(dpi/0.0254),4);data[8]=1;const type=Buffer.from('pHYs'),chunk=Buffer.alloc(21);chunk.writeUInt32BE(9,0);type.copy(chunk,4);data.copy(chunk,8);chunk.writeUInt32BE(crc32(Buffer.concat([type,data])),17);const parts=[buffer.subarray(0,8)];let pos=8;while(pos<buffer.length){const length=buffer.readUInt32BE(pos),name=buffer.toString('ascii',pos+4,pos+8),part=buffer.subarray(pos,pos+length+12);if(name!=='pHYs')parts.push(part);if(name==='IHDR')parts.push(chunk);pos+=length+12;}return Buffer.concat(parts);}
bytes=density(bytes,dpi);await fs.writeFile(png,bytes);
await fs.writeFile(path.join(build,'route.json'),JSON.stringify(route,null,2));
await fs.writeFile(path.join(build,'layout-spec.json'),JSON.stringify(plan,null,2));
const map={nodes:route.nodes.map(n=>({id:n.id,shape:nodes.get(n.id).id,label:plan.positions[n.id].text})),edges:edgeObjects};
await fs.writeFile(path.join(build,'object-map.json'),JSON.stringify(map,null,2));
// fileURLToPath is needed for Windows drive letters and Chinese paths.
const {fileURLToPath}=await import('node:url');
const auditPath=path.join(path.dirname(fileURLToPath(import.meta.url)),'inspect_native.py');
const audit=spawnSync(path.resolve(opt.python),['-X','utf8',auditPath,'--pptx',pptx,'--route',path.join(build,'route.json'),'--map',path.join(build,'object-map.json'),'--png',png],{encoding:'utf8'});
if(audit.status!==0)throw new Error('原生对象校验失败：'+audit.stdout+audit.stderr);
const printAudit=spawnSync(path.resolve(opt.python),['-X','utf8',path.join(path.dirname(fileURLToPath(import.meta.url)),'inspect_print.py'),'--pptx',pptx,'--profile',route.appearance?.print_profile??'general',...(targetWidth?['--width-mm',String(targetWidth)]:[])],{encoding:'utf8'});
if(printAudit.status!==0)throw new Error('印刷尺寸检查失败：'+printAudit.stdout+printAudit.stderr);
const printCheck=JSON.parse(printAudit.stdout);
await fs.writeFile(path.join(build,'print-audit.json'),JSON.stringify(printCheck,null,2));
const report={print:printCheck,selection,canvas:{width:plan.width,height:plan.height},font,png_width:pngWidth,dpi,warnings:[...contentCheck.warnings,...plan.warnings,...printCheck.warnings],native:JSON.parse(audit.stdout),pptx,png,visual_review_required:true};
await fs.writeFile(path.join(build,'report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({pptx,png,report:path.join(build,'report.json'),selection,warnings:report.warnings},null,2));
