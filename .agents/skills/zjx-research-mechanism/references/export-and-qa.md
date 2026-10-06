# 导出与质量检查

## 运行环境

用 `mcp__codex_app__load_workspace_dependencies` 找到当前任务的 Node、Python、node_modules 等实际路径。导出脚本使用 Playwright 和 sharp，不要求系统 Python/Node 已加入 PATH。`inspect_svg.py` 只使用 Python 标准库；`verify_exports.py` 需要 Pillow 和 PyMuPDF（优先）或 pypdf（PDF 基础检查）。缺失时先检查已提供的运行时，不盲目安装或改变用户环境。

浏览器选择顺序：显式 `--browser`、环境变量 `FIGURE_BROWSER`、现有 Windows Chrome/Edge、Linux/macOS 常见 Chromium、Playwright 已安装 Chromium。导出会启动独立的无界面浏览器，不操作用户正在使用的浏览器或账户。脚本拦截页面外部请求，SVG 在内存中加载。

## 调用

以下可执行文件及目录是占位符，调用时换成工具返回的真实绝对路径。脚本路径相对于本 skill 根目录。

```text
PYTHON scripts/inspect_svg.py OUTPUT/figure.svg --mechanism OUTPUT/mechanism.json --out OUTPUT/svg-inspection.json
NODE scripts/export_figure.cjs --svg OUTPUT/figure.svg --out OUTPUT --modules NODE_MODULES --width-mm 180 --dpi 600 --preview-width 1536
PYTHON scripts/verify_exports.py --dir OUTPUT --mechanism OUTPUT/mechanism.json --out OUTPUT/export-verification.json
```

三个阶段依赖前一阶段成功，顺序执行。Windows 调用 Python 时可带 `-X utf8`，避免系统默认编码影响中文技能文件与控制台输出。`--browser` 可指定实际浏览器可执行文件。输出目录必须独立于上传原始资料；脚本拒绝覆盖已有导出文件，除非明确加 `--overwrite`，且本次任务授权更新的正是这些生成文件。

SVG 是唯一最终绘图源。PNG、TIFF、PDF 都从同一份 SVG 导出；不能 SVG 一版、预览另一版。脚本为图像统一白底，按 viewBox 保持宽高比。默认 TIFF RGB/sRGB、600 dpi、LZW，无损压缩；实际像素宽度为 `round(width_mm / 25.4 * dpi)`。不要修改 DPI 标签冒充增加真实分辨率。用户指定期刊宽度、分辨率、颜色空间或压缩方式时遵从；CMYK 要有正确色彩转换和配置，不能仅改扩展名或 ICC 描述。

PDF 是一页机制图，物理尺寸与 TIFF 一致，页面无多余页脚、网页边距或空白页。浏览器直接打印 SVG 可保留文本和原生矢量路径，SVG filter 可能造成局部图像。不能用整页 PNG 包装成 PDF 冒充矢量 PDF。若用户明确要求百分之百纯矢量 PDF，需要把滤镜效果改成实际路径/渐变并另行检查 PDF 图像对象。

## 必须通过的检查

1. SVG 的 XML 有效、根元素正确、viewBox 比例合理，id 无重复，内部引用可解析。
2. SVG 没有 image/canvas/foreignObject、脚本、外部资源和文字转曲；label_manifest 中的规范标签存在。
3. 预览是最终 SVG 的渲染，文字和箭头没有被裁切，图形无明显错位。
4. TIFF 确实为 TIFF，像素数与尺寸和 DPI 计算一致，分辨率标签正确、颜色模式正确。
5. PDF 可解析、恰好一页，尺寸正确，主要科学标签仍能提取为文本；整页单一图像替代内容不合格。
6. 导出文件实际存在。导出清单 export-manifest.json 与验证记录用于内部排查，不替代检查实际图像。

`verify_exports.py` 同时输出 PDF 图像数量和图像覆盖面积，提醒混合图形的实际情况。图像覆盖是技术检查，不是科学或视觉相似度证明。PDF 页内容中的路径/文本可保留，而滤镜对象局部栅格化应记录；所有标签缺失或者单一图像覆盖整页应修复。

## 交付

最终回复内嵌绝对路径的 `figure-preview.png`，提供 `figure.svg`、`figure.tiff`、`figure.pdf` 下载链接。用户未要求时不附内部脚本、调试日志、机制底稿、源资料复制件和 QA 文件。参考图可在用户要求或对比有帮助时另外呈现，但不能替代最终预览。
