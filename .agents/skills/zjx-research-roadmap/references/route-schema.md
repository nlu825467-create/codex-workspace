# route.json 版本1

当前模型根据材料生成，用户无需手写。图内文本中文，字段英文。

- schema_version：1；title：图标题；study_status：planned/completed/unspecified。
- sources：[{id,label,text?,path?}]，id唯一、label说明材料。text可存短原文，path是实际路径，不伪造文献。
- stages：[{id,label}]，按研究顺序；节点 stage 必须引用存在的阶段。
- nodes：[{id,label,details,stage,role,lane?,certainty,evidence,rationale?}]。
- edges：[{id,from,to,type,label?,certainty,evidence,rationale?}]。
- selection：{primary:"auto"|布局代码,reason?,motifs?:[布局代码],intent?:"stage-task-method",composition?}。显式选型必须有 reason。复杂路线由模型显式判断主结构，composition 记录 {choice,reading_order,focus_nodes:[节点id],alternatives:[{id,reason}]}，简述候选构图和取舍，不修改科学节点或关系。
- constraints：{independent_validation?:true}。仅在材料证明独立验证时设置，同时要有 validation lane 的独立 input 和验证任务；具体独立来源写入节点 details 和 evidence。
- 独立验证不强制 primary=validation。当其他关系主导时，使用自定义布局，在 zones 中用 lane:"validation" 标识局部外部验证区域，完整容纳验证节点并排除开发节点。科学独立性和禁止数据回流的检查不因主结构变化而取消。
- 验证评价可以汇总到没有后续出边的最终 output 报告。报告汇总不是训练回流；最终报告不能再成为开发输入。
- appearance：{style?:academic|mono|color,png_width?:整数,dpi?:300|600,target_width_mm?:50—300,print_profile?:funding|journal|general}。默认按20cm图宽计算像素；改变DPI元数据不是新增细节。

node.role：input/task/method/model/validation/output/decision。lane：development/validation，仅是分区，不证明独立性。

certainty：explicit/inferred/proposed。全部节点与边需 evidence：[{source:"s1",locator:"第2段"}]。inferred/proposed 还需 rationale；分别在图上标“推断：”“建议：”，用虚线并保留图例。明确的计划步骤属于 explicit。

edge.type：sequence/data/supports/validates/feedback/decision。反馈和条件边必须有 label。非反馈边构成排版用无环主图；实际循环的返回边明确标 feedback。孤立节点由模型核对，不由程序任意连线。

示例：

```json
{
  "schema_version":1,"title":"研究技术路线","study_status":"planned",
  "sources":[{"id":"s1","label":"用户研究方案","text":"收集样本，检测目标指标，再开展统计分析。"}],
  "stages":[{"id":"p1","label":"样本与检测"},{"id":"p2","label":"分析"}],
  "nodes":[
    {"id":"n1","label":"收集样本","details":"收集研究样本","stage":"p1","role":"input","certainty":"explicit","evidence":[{"source":"s1","locator":"第1句"}]},
    {"id":"n2","label":"目标指标检测","details":"检测研究目标指标","stage":"p1","role":"task","certainty":"explicit","evidence":[{"source":"s1","locator":"第1句"}]},
    {"id":"n3","label":"统计分析","details":"分析检测指标","stage":"p2","role":"output","certainty":"explicit","evidence":[{"source":"s1","locator":"第1句"}]}
  ],
  "edges":[
    {"id":"e1","from":"n1","to":"n2","type":"data","certainty":"explicit","evidence":[{"source":"s1","locator":"第1句"}]},
    {"id":"e2","from":"n2","to":"n3","type":"data","certainty":"explicit","evidence":[{"source":"s1","locator":"第1句"}]}
  ],"selection":{"primary":"auto"},"appearance":{"style":"academic","dpi":300}
}
```

label 可用\n指定换行，程序仍按宽度折行。修改标签保留id，修改科学关系同步更新edges/evidence。程序自动判断依据节点/边结构，不依据文字关键词。
