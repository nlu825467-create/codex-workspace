"""Verify native semantic objects, attached connector endpoints and PNG metadata."""
import argparse,json,zipfile,xml.etree.ElementTree as ET
from collections import Counter
from PIL import Image

def inspect(pptx,route,mapping,png):
    ns={'p':'http://schemas.openxmlformats.org/presentationml/2006/main','a':'http://schemas.openxmlformats.org/drawingml/2006/main'}
    with zipfile.ZipFile(pptx) as z:
        slides=[n for n in z.namelist() if n.startswith('ppt/slides/slide') and n.endswith('.xml') and '/_rels/' not in n]
        assert len(slides)==1,'单图渲染器应有一页'
        root=ET.fromstring(z.read(slides[0]))
    shapes={};shape_ids={}
    for s in root.findall('.//p:sp',ns):
        p=s.find('p:nvSpPr/p:cNvPr',ns)
        if p is not None:
            shapes[p.attrib['name']]=s
            shape_ids[p.attrib['name']]=p.attrib['id']
    for n in route['nodes']:
        name='node-'+n['id'];assert name in shapes,f'缺少原生节点 {name}'
        text=''.join(t.text or '' for t in shapes[name].findall('.//a:t',ns))
        expected=next(x['label'] for x in mapping['nodes'] if x['id']==n['id'])
        assert ''.join(text.split())==''.join(expected.split()),f'节点文本丢失 {n["id"]}'
    connectors=root.findall('.//p:cxnSp',ns)
    ids={x.attrib['id'] for x in root.findall('.//p:cNvPr',ns)}
    actual=Counter()
    for c in connectors:
        endpoints=[]
        for tag in ['a:stCxn','a:endCxn']:
            end=c.find('.//'+tag,ns)
            assert end is not None and end.attrib.get('id') in ids,'连接端点缺失或悬空'
            endpoints.append(end.attrib['id'])
        tail=c.find('.//a:tailEnd',ns)
        head=c.find('.//a:headEnd',ns)
        assert head is None or head.attrib.get('type','none')=='none','箭头误指源节点'
        arrow=tail.attrib.get('type','none') if tail is not None else 'none'
        actual[(*endpoints,arrow)]+=1
    paths={e['id']:e.get('guides') for e in mapping.get('edges',[]) if 'guides' in e}
    expected_count=sum(len(paths[e['id']])+1 if e['id'] in paths else 3 if e['type']=='feedback' else 1 for e in route['edges'])
    assert len(connectors)==expected_count,f'连线数量错误 {len(connectors)}/{expected_count}'
    expected=Counter()
    for e in route['edges']:
        source=shape_ids['node-'+e['from']];target=shape_ids['node-'+e['to']]
        if e['id'] in paths:
            names=paths[e['id']]
            assert all(x.startswith('guide-'+e['id']+'-') for x in names),'路由点命名与关系不一致'
            chain=[source,*[shape_ids[x] for x in names],target]
            for i in range(len(chain)-1):expected[(chain[i],chain[i+1],'triangle' if i==len(chain)-2 else 'none')]+=1
        elif e['type']=='feedback':
            a=shape_ids['guide-'+e['id']+'-a'];b=shape_ids['guide-'+e['id']+'-b']
            expected[(source,a,'none')]+=1;expected[(a,b,'none')]+=1
            expected[(b,target,'triangle')]+=1
        else:expected[(source,target,'triangle')]+=1
    assert actual==expected,'连接端点或目标箭头与研究关系不一致'
    assert not root.findall('.//p:pic',ns),'核心路线渲染器不应含图片替代对象'
    with Image.open(png) as im:
        im.load();width,height=im.size;dpi=im.info.get('dpi')
        assert width>=800 and height>0,'PNG尺寸异常'
        assert dpi and abs(dpi[0]-(route.get('appearance',{}).get('dpi') or 300))<1,'PNG缺少正确DPI'
    return {'native_nodes':len(route['nodes']),'native_connectors':len(connectors),'native_shapes':len(shapes),'endpoint_pairs_verified':True,'target_arrows_verified':True,'embedded_pictures':0,'png_pixels':[width,height],'png_dpi':list(dpi),'desktop_application_tested':False}

if __name__=='__main__':
    p=argparse.ArgumentParser()
    for key in ['pptx','route','map','png']:p.add_argument('--'+key,required=True)
    a=p.parse_args()
    print(json.dumps(inspect(a.pptx,json.load(open(a.route,encoding='utf-8-sig')),json.load(open(a.map,encoding='utf-8-sig')),a.png),ensure_ascii=False))
