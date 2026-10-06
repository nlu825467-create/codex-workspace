#!/usr/bin/env python3
"""Validate self-contained editable scientific SVG using only the standard library."""
import argparse
import collections
import hashlib
import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

SVG_NS = 'http://www.w3.org/2000/svg'
FORBIDDEN = {'image', 'feImage', 'canvas', 'foreignObject', 'script', 'iframe', 'object', 'embed'}


def normalized(text):
    return ' '.join(text.split())


def inspect(path, mechanism=None):
    data = Path(path).read_bytes()
    raw = data.decode('utf-8-sig')
    if re.search(r'<!DOCTYPE|<!ENTITY|<\?xml-stylesheet', raw, re.I):
        raise ValueError('SVG must not contain a DTD, entity declaration or external stylesheet instruction')
    root = ET.fromstring(raw)
    if root.tag != '{' + SVG_NS + '}svg':
        raise ValueError('Root must be an SVG-namespace svg element')
    errors, warnings = [], []
    counts = collections.Counter()
    ids, references, text_nodes = {}, [], []
    for element in root.iter():
        tag = element.tag.rsplit('}', 1)[-1]
        counts[tag] += 1
        if tag in FORBIDDEN:
            errors.append('Forbidden element: ' + tag)
        if not element.tag.startswith('{' + SVG_NS + '}'):
            errors.append('Non-SVG element: ' + tag)
        ident = element.get('id')
        if ident:
            if ident in ids:
                errors.append('Duplicate id: ' + ident)
            ids[ident] = element
        for key, value in element.attrib.items():
            local_key = key.rsplit('}', 1)[-1]
            if local_key.lower().startswith('on'):
                errors.append('Event handler is forbidden: ' + local_key)
            if local_key == 'href':
                if not value.startswith('#'):
                    errors.append('External or embedded reference: ' + value[:90])
                else:
                    references.append(value[1:])
            for match in re.finditer(r'url\s*\(\s*[\'"]?([^\)\'\"]+)', value, re.I):
                target = match.group(1).strip()
                if not target.startswith('#'):
                    errors.append('External CSS resource: ' + target[:90])
                else:
                    references.append(target[1:])
        if tag == 'style':
            css = ''.join(element.itertext())
            if re.search(r'@import|@font-face', css, re.I):
                errors.append('External styles/font dependencies are forbidden')
            for match in re.finditer(r'url\s*\(\s*[\'"]?([^\)\'\"]+)', css, re.I):
                target = match.group(1).strip()
                if target.startswith('#'):
                    references.append(target[1:])
                else:
                    errors.append('External stylesheet URL')
        if tag == 'text':
            text_nodes.append(normalized(' '.join(element.itertext())))
    if 'base64' in raw.lower() or re.search(r'(?:href|src)\s*=\s*[\'"]\s*data:', raw, re.I):
        errors.append('Embedded data URI/base64 is forbidden')
    for reference in sorted(set(references)):
        if reference not in ids:
            errors.append('Unresolved internal reference: #' + reference)
    try:
        view_box = [float(v) for v in re.split(r'[\s,]+', root.get('viewBox', '').strip())]
        if len(view_box) != 4 or view_box[2] <= 0 or view_box[3] <= 0:
            raise ValueError()
    except ValueError:
        errors.append('A valid positive viewBox is required')
        view_box = None
    if not text_nodes:
        errors.append('Scientific SVG must contain editable text')
    if counts['filter']:
        warnings.append('SVG filters may render differently in design apps and may rasterize locally in PDF')
    label_checks = []
    if mechanism:
        manifest = json.loads(Path(mechanism).read_text(encoding='utf-8-sig'))
        for label in manifest.get('label_manifest', []):
            expected = normalized(label['text'])
            ident = label.get('id')
            if ident:
                node = ids.get(ident)
                editable = [e for e in node.iter() if e.tag == '{' + SVG_NS + '}text'] if node is not None else []
                actual = normalized(' '.join(' '.join(e.itertext()) for e in editable))
                ok = bool(editable) and ''.join(expected.split()) in ''.join(actual.split())
            else:
                ok = any(''.join(expected.split()) in ''.join(content.split()) for content in text_nodes)
            label_checks.append({'id': ident, 'text': expected, 'present': ok})
            if not ok:
                errors.append('Missing editable canonical label: ' + expected)
    return {
        'valid': not errors,
        'source': str(Path(path).resolve()),
        'sha256': hashlib.sha256(data).hexdigest(),
        'viewBox': view_box,
        'element_counts': dict(counts),
        'editable_text': text_nodes,
        'label_checks': label_checks,
        'errors': errors,
        'warnings': warnings,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('svg')
    parser.add_argument('--mechanism')
    parser.add_argument('--out')
    args = parser.parse_args()
    try:
        result = inspect(args.svg, args.mechanism)
    except (ValueError, OSError, ET.ParseError, json.JSONDecodeError) as exc:
        result = {'valid': False, 'errors': [str(exc)]}
    payload = json.dumps(result, ensure_ascii=False, indent=2)
    if args.out:
        Path(args.out).write_text(payload + '\n', encoding='utf-8')
    print(payload)
    return 0 if result['valid'] else 1


if __name__ == '__main__':
    sys.exit(main())
