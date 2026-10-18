# 原生 PPT 和 PNG 生成

模型先准备 route.json。程序不会读论文、运行独立语言模型或提取科研方法：理解任务由当前 Codex 模型完成。

## 运行准备

1. 用 Codex 的 load_workspace_dependencies 获取当前 bundled Node、Python 和 Node modules 路径。用已安装 Presentations 技能的位置作为 presentation-skill，不把个人用户名或插件版本写死。
2. 读取 Presentations 的 implementation.md、API_QUICK_START.md、finalization.md；当前任务第一次创建/编辑 PPT 前，依其要求独立运行 mark_artifact_operation_started.mjs 恰好一次。operation-kind=create，expected-output-count 是本次实际 PPTX 数量，output-format=pptx；工作目录是该技能目录。只运行验证数据或读文件时不标记。
3. 使用 bundled Node 执行 scripts/render_route.mjs，传入以下参数。参数使用实际绝对路径；PowerShell 含空格/中文路径用单引号，不拼接未经转义的材料内容。

| 参数 | 含义 |
|---|---|
| --input | 模型生成的 route.json |
| --outdir | 新建最终交付目录，不能覆盖已有版本 |
| --workspace | 本任务工作目录，outdir及内部生成文件在此范围；input可来自其他可读目录 |
| --runtime-modules | bundled Node modules 目录 |
| --presentation-skill | 已安装 Presentations 技能目录 |
| --python | bundled Python 可执行文件 |
| --font | 可选，实际安装字体；默认检测可用中文字体 |
| --stem | 可选，安全输出文件名，默认研究技术路线图 |
| --layout / --reason | 可选，模型/用户覆盖结构建议及解释 |
| --style | 可选 academic（黑灰浅灰）/mono（白底黑字黑线）/color（用户要求的彩色） |
| --layout-spec | 可选，模型编排的自定义几何和避障路由文件，见下文 |

脚本采用已发现 runtime 包的绝对导入，不需要安装包或创建全局环境变量。字体先检测，再导出。可用中文字体缺失会明确报错，不能静默退到缺字字体。

## 输出与保证范围

outdir 只放 PNG/PPTX。route.json、对象映射、布局报告和官方 finalization 回执位于 workspace/.roadmap-build 的单次构建目录。CLI返回交付路径、报告路径、选型理由及警告。

PPTX先通过 Presentations 的文件结构/字体/几何检查，再重新载入该最终文件并渲染PNG。随附 inspect_native.py 核对每个科学节点是否为原生文字形状、文本是否完整、每条连接的实际端点是否对应研究关系、目标箭头方向及PNG像素/DPI。图片素材不能冒充核心节点。

普通边使用原生绑定连接线。反馈边使用三个原生线段及两个不可见路由点，保留主节点的端点绑定与外侧回路；只末段有箭头。用户移动节点后，首末连接段随端点更新，中间路由点可单独调整。不要承诺所有反馈路径会在任意移动后自动避障。

指定 appearance.target_width_mm 时，PPT页面与默认PNG均按该实际宽度输出；具体用途及尺度见 [最终页面尺寸](print-size.md)。未指定时，默认PNG按20cm宽、300dpi输出；600dpi在未指定png_width时相应增加像素。指定png_width后按该像素输出，DPI表示对应物理尺寸，不能宣称仅调整DPI增加清晰度。画布过大时报告提示模型在最终使用尺寸下复核。

生成成功后必须查看PNG，核对语义及每条关键连接。连线标签和复杂跨分支路径需要视觉检查；程序不保证任意图都没有交叉。过密时由模型有依据地概括/分图或调整布局，不能删除关键节点自动“修复”。程序面向单主图；复杂定制需要模型在保持数据规范和原生输出的前提下扩展绘制代码。

如果依赖不可用，保留已完成的结构提取并报告具体缺失。不要输出图片塞入PPT的伪可编辑替代品，也不要声称PNG已通过未完成的检查。

## 复杂图的自定义布局

默认排版不能保证长连线避障。复杂组合先按 visual-layout.md 构图，由模型生成 layout-spec.json 并传入 --layout-spec，不改变原科学路线。字段：width/height/fontSize；positions 是以节点id为键的 {x,y,width,height}；zones 为 {id,label,x,y,width,height,fill?,line?,color?} 数组；routing 以边id为键，值为 {fromSide,toSide,points?:[{x,y}],label?:{x,y,width,size?},kind?:"elbow"|"straight",color?,width?}。自定义布局须提供全部边的路由；带文字的边须给标签位置。

可选 titleSize/titleHeight/titleY/accent 配置标题；stageBands 是 {id,number,label,y,height,fill?,color?} 数组，在左侧显示阶段，并用低对比底色建立阶段节奏。该模式内容从x=280开始编排，常用竖向主轴。defaultNodeStyle 和 nodeStyles[id] 可设 {fill,line,color,size,bold,geometry}，不改变科学角色。annotations 为 {id,text,x,y,width,height,size?,color?,bold?,align?,fill?}，仅写来源支持的说明；footer 简述状态或关键边界。mono 强制原生文字、节点和连线转为黑白。

stageBands 完全可选，不能对所有复杂研究统一开启。横向或局部闭环构图可设置 stageBands:[]、panels:[]，使用少量功能分组标题，direction:"horizontal" 表示主要横向阅读。primary 不是 validation 但存在独立验证时，必须提供 --layout-spec，并为验证区域指定 zones[].lane="validation"；程序检查该区域完整包含外部验证节点且不混入开发节点。

自定义文件不能新增或删去科学节点/边。程序检查节点覆盖、尺寸、文字行高、节点重叠、路由点范围、轴向线穿过节点和标签压字，再用不可见原生路由点与绑定线段绘制折线路径，只有末段带目标箭头。原生检查逐段核对完整关系链。明显逆向流程、混合端点自动折线和斜线会提示视觉复核。模型仍须判断整体构图、不同边是否混淆及实际渲染效果，必要时重排。

## 开发验证

bundled Node运行 scripts/test_route.mjs 检查六类选型、混合结构、长中文、悬空边、缺依据、循环、无标签反馈、独立性和验证泄漏。加 --write-fixtures 指向私有目录可输出七份虚构布局材料用于实际PPT/PNG试跑。这些测试仅覆盖结构验证和可复现绘图；不宣称验证了对任意真实研究材料的提取能力。

最终尺寸可配置 appearance.print_profile；funding使用本技能基金可读性建议进行提示，journal仅测量。自定义布局增加frameWidth、arrowSize、footerSize/footerHeight/footerY，以免边框、箭头和图例保持不合适的固定尺度。内部print-audit.json来自交付PPTX的真实字号和线宽，仍须人工页面复核。

自定义路由的折线在验证和绘制中共用同一几何实现；混合方向的elbow必须提供显式points。重复或同方向共线点会被去除，保留实际转角。内部布局报告新增保存layout-spec.json，方便从交付图追溯并修复。反馈端点仍原生绑定，路由引导点为微小不可见原生形状。改动节点后必须复核路径，不承诺任意移动后自动避障。开发连线检查可运行scripts/test_route_geometry.mjs；它覆盖已知遮线与短末段失败，不替代最终渲染审查。
