import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {validateRoute,chooseLayout,planLayout} from './route_core.mjs';

// Synthetic research descriptions for behavioral/geometry checks, not real studies.
const ref=[{source:'s1',locator:'布局测试研究描述'}];
function fixture(key,stages,ns,es,extra={}){
  const nodes=ns.map(([id,label,stage,role,lane])=>({id,label,details:label,stage,role,lane,certainty:'explicit',evidence:ref}));
  const edges=es.map(([from,to,type='data',label],i)=>({id:'e'+(i+1),from,to,type,label,certainty:'explicit',evidence:ref}));
  const text=nodes.map(n=>n.id+'：'+n.details).join('；')+'。关系：'+edges.map(e=>`${e.from} ${e.type} ${e.to}${e.label?'（'+e.label+'）':''}`).join('；')+'。';
  return {schema_version:1,title:'示例：'+key+'研究技术路线',study_status:'planned',sources:[{id:'s1',label:'虚构布局测试材料，非真实研究',text}],stages:stages.map(([id,label])=>({id,label})),nodes,edges,selection:{primary:'auto'},appearance:{style:'academic',dpi:300},...extra};
}
export const fixtures={
  vertical:fixture('纵向递进',[['p1','样本收集'],['p2','指标检测'],['p3','分析与产出']], [['a','研究样本','p1','input'],['b','目标指标检测','p2','task'],['c','统计分析','p3','task'],['d','形成研究结论','p3','output']], [['a','b'],['b','c'],['c','d']]),
  parallel:fixture('并行汇合',[['p1','数据准备'],['p2','多方法分析'],['p3','结果整合']], [['a','共同研究数据','p1','input'],['b','分析方法A','p2','task'],['c','分析方法B','p2','task'],['d','结果整合','p3','output']], [['a','b'],['a','c'],['b','d'],['c','d']], {appearance:{style:'color',dpi:300}}),
  swimlane:fixture('阶段任务方法',[['p1','调查准备'],['p2','实证分析'],['p3','结果解释']], [['a','明确研究问题','p1','task'],['b','文献梳理','p1','method'],['c','分析调查数据','p2','task'],['d','统计建模方法','p2','method'],['e','研究结论与建议','p3','output'],['f','比较与归纳','p3','method']], [['b','a','supports'],['a','c','sequence'],['d','c','supports'],['c','e'],['f','e','supports']], {selection:{primary:'auto',intent:'stage-task-method'},appearance:{style:'mono',dpi:300}}),
  fusion:fixture('多源融合',[['p1','多源数据'],['p2','分源处理'],['p3','联合分析']], [['a','研究数据源A','p1','input'],['b','研究数据源B','p1','input'],['c','数据A预处理','p2','task'],['d','数据B预处理','p2','task'],['e','多源联合分析','p3','task'],['f','综合分析结果','p3','output']], [['a','c'],['b','d'],['c','e'],['d','e'],['e','f']],{appearance:{style:'color',dpi:300}}),
  validation:fixture('开发与独立验证',[['p1','研究数据'],['p2','模型开发'],['p3','独立评价']], [['a','开发队列数据','p1','input','development'],['b','另一机构独立队列','p1','input','validation'],['c','特征筛选','p2','task','development'],['d','建立预测模型','p2','model','development'],['e','内部性能评价','p3','validation','development'],['f','独立外部验证','p3','validation','validation'],['g','外部验证结果','p3','output','validation']], [['a','c'],['c','d'],['d','e','validates'],['d','f','validates'],['b','f'],['f','g']], {constraints:{independent_validation:true}}),
  feedback:fixture('迭代反馈',[['p1','模型与预测'],['p2','实验评价'],['p3','结果反馈']], [['a','初始研究数据','p1','input'],['b','模型训练与预测','p1','model'],['c','候选实验验证','p2','validation'],['d','测量与结果评价','p2','task'],['e','形成实验结果','p3','output']], [['a','b'],['b','c'],['c','d'],['d','e'],['e','b','feedback','实验结果更新模型']]),
};
fixtures.hybrid=structuredClone(fixtures.validation);
fixtures.hybrid.title='示例：多源融合与独立验证';
fixtures.hybrid.nodes.push({id:'x',label:'开发用第二数据源',details:'仅用于开发的第二数据源',stage:'p1',role:'input',lane:'development',certainty:'explicit',evidence:ref});
fixtures.hybrid.edges.push({id:'ex',from:'x',to:'c',type:'data',certainty:'explicit',evidence:ref});
fixtures.hybrid.sources[0].text+='开发用第二数据源x与开发队列a都进入特征筛选c，独立验证队列b不参与训练。';

let checks=0;
for(const [key,r] of Object.entries(fixtures)){
  validateRoute(r);const s=chooseLayout(r);assert.equal(s.primary,key==='hybrid'?'validation':key);const p=planLayout(r,s);assert.equal(Object.keys(p.positions).length,r.nodes.length);checks++;
}
assert.ok(chooseLayout(fixtures.hybrid).motifs.includes('fusion'));checks++;
function bad(base,mutate,pattern){const r=structuredClone(base);mutate(r);assert.throws(()=>validateRoute(r),pattern);checks++;}
bad(fixtures.vertical,r=>r.edges[0].to='missing',/未知节点/);
bad(fixtures.vertical,r=>r.nodes[0].evidence=[],/材料依据/);
bad(fixtures.vertical,r=>r.nodes[1].id='a',/id重复/);
bad(fixtures.vertical,r=>r.edges.push({...r.edges[0],id:'back',from:'d',to:'a'}),/循环/);
bad(fixtures.feedback,r=>r.edges.at(-1).label='',/必须有标签/);
bad(fixtures.validation,r=>r.constraints={},/独立验证依据/);
bad(fixtures.validation,r=>r.edges.push({...r.edges[0],id:'leak',from:'b',to:'d'}),/验证数据流回/);
bad(fixtures.vertical,r=>r.nodes[0].certainty='inferred',/缺少解释/);
bad(fixtures.vertical,r=>r.selection={primary:'feedback',reason:'无反馈'},/缺少真实反馈/);
bad(fixtures.vertical,r=>r.nodes[0].label='',/短标签/);
bad(fixtures.vertical,r=>r.selection.motifs=['validation'],/独立验证依据/);
bad(fixtures.vertical,r=>r.selection.motifs=['feedback'],/缺少真实反馈/);
const localValidation=structuredClone(fixtures.validation);
localValidation.selection={primary:'vertical',reason:'连续模型开发为核心，外部验证为局部结构',motifs:['validation']};
validateRoute(localValidation);assert.equal(chooseLayout(localValidation).primary,'vertical');assert.ok(chooseLayout(localValidation).motifs.includes('validation'));checks++;
bad(localValidation,r=>r.edges.push({...r.edges[0],id:'local-leak',from:'b',to:'d'}),/验证数据流回/);
const optimizationValidation=structuredClone(fixtures.validation);
optimizationValidation.selection={primary:'feedback',reason:'开发区结果反馈是核心研究方法，独立验证保留在局部区域',motifs:['feedback','validation']};
optimizationValidation.edges.push({id:'iter',from:'e',to:'d',type:'feedback',label:'开发集评价更新模型',certainty:'explicit',evidence:ref});
validateRoute(optimizationValidation);assert.equal(chooseLayout(optimizationValidation).primary,'feedback');assert.ok(chooseLayout(optimizationValidation).motifs.includes('validation'));checks++;
const report=structuredClone(fixtures.validation);report.nodes.at(-1).lane='development';validateRoute(report);checks++;
bad(report,r=>r.edges.push({...r.edges[0],id:'report-leak',from:'g',to:'d'}),/验证数据流回|循环/);
const long=structuredClone(fixtures.vertical);long.nodes[1].label='开展研究材料中已经明确说明的目标指标检测及质量检查并保留所有必要的研究含义';validateRoute(long);assert.ok(planLayout(long).positions.b.height>78);checks++;
const unknown=structuredClone(fixtures.vertical);unknown.nodes[1].certainty='inferred';unknown.nodes[1].rationale='对材料中两个连续操作的概括';validateRoute(unknown);assert.ok(planLayout(unknown).positions.b.text.startsWith('推断：'));checks++;
const arg=process.argv.indexOf('--write-fixtures');
if(arg>=0){const folder=path.resolve(process.argv[arg+1]);await fs.mkdir(folder,{recursive:true});for(const [key,r] of Object.entries(fixtures))await fs.writeFile(path.join(folder,key+'.json'),JSON.stringify(r,null,2));}
console.log(JSON.stringify({passed:checks,layouts:Object.keys(fixtures)}));
