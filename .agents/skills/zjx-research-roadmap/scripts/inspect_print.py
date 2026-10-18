"""Measure the delivered PPTX at its intended placement size, without changing it."""
import argparse, json, zipfile, xml.etree.ElementTree as ET

NS = {'p': 'http://schemas.openxmlformats.org/presentationml/2006/main',
      'a': 'http://schemas.openxmlformats.org/drawingml/2006/main'}

def inspect(pptx, width_mm=None, profile='general'):
    with zipfile.ZipFile(pptx) as z:
        size = ET.fromstring(z.read('ppt/presentation.xml')).find('p:sldSz', NS)
        native_w = int(size.attrib['cx']) / 36000
        native_h = int(size.attrib['cy']) / 36000
        width_mm = width_mm or native_w
        scale = width_mm / native_w
        texts, lines, arrows = [], [], []
        for filename in z.namelist():
            if not filename.startswith('ppt/slides/slide') or not filename.endswith('.xml'):
                continue
            root = ET.fromstring(z.read(filename))
            for shape in root.findall('.//p:sp', NS):
                name = shape.find('p:nvSpPr/p:cNvPr', NS).attrib.get('name', '')
                text = ''.join(x.text or '' for x in shape.findall('.//a:t', NS))
                if text:
                    sizes = [int(x.attrib['sz']) / 100 * scale
                             for x in shape.findall('.//a:rPr', NS) if 'sz' in x.attrib]
                    texts.append({'name': name, 'text': text, 'pt': sizes})
                ln = shape.find('p:spPr/a:ln', NS)
                if ln is not None and not ln.findall('a:noFill', NS) and int(ln.attrib.get('w', 0)):
                    lines.append({'name': name, 'pt': int(ln.attrib['w']) / 12700 * scale})
            for shape in root.findall('.//p:cxnSp', NS):
                ln = shape.find('p:spPr/a:ln', NS)
                if ln is None:
                    continue
                lines.append({'name': 'connector', 'pt': int(ln.attrib.get('w', 0)) / 12700 * scale})
                for arrow in ln.findall('a:tailEnd', NS) + ln.findall('a:headEnd', NS):
                    if arrow.attrib.get('type', 'none') != 'none':
                        arrows.append(dict(arrow.attrib))
    warnings = []
    if profile == 'funding':
        for t in texts:
            floor = 9 if t['name'].startswith('node-') else 8
            if not t['pt']:
                warnings.append(t['name'] + ' 字号未显式记录，需人工核对')
            elif min(t['pt']) < floor - .02:
                warnings.append(f"{t['name']} {min(t['pt']):.2f} pt，小于本技能基金可读性建议 {floor} pt")
        for ln in lines:
            floor = .5
            if ln['pt'] < floor - .01:
                warnings.append(f"{ln['name']} {ln['pt']:.3f} pt，小于本技能基金线宽建议 {floor} pt")
        if any(a.get('w') == 'sm' or a.get('len') == 'sm' for a in arrows):
            warnings.append('使用小箭头头部，需在最终页面尺寸下人工复核')
    all_sizes = [p for t in texts for p in t['pt']]
    node_sizes = [p for t in texts if t['name'].startswith('node-') for p in t['pt']]
    return {'profile': profile, 'basis': 'skill readability recommendations, not sponsor compliance',
            'native_size_mm': [native_w, native_h],
            'placement_size_mm': [width_mm, native_h * scale],
            'min_text_pt': min(all_sizes) if all_sizes else None,
            'min_node_pt': min(node_sizes) if node_sizes else None,
            'line_pt': sorted(set(round(x['pt'], 3) for x in lines)),
            'arrow_presets': [dict(x) for x in {tuple(sorted(a.items())) for a in arrows}],
            'warnings': warnings, 'texts': texts,
            'requires_page_visual_review': True}

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--pptx', required=True)
    parser.add_argument('--width-mm', type=float)
    parser.add_argument('--profile', choices=['general', 'funding', 'journal'], default='general')
    args = parser.parse_args()
    print(json.dumps(inspect(args.pptx, args.width_mm, args.profile), ensure_ascii=False))
