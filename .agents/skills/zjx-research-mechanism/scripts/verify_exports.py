#!/usr/bin/env python3
"""Verify physical sizes, metadata, text retention and whole-page raster substitution."""
import argparse
import hashlib
import json
import math
import sys
from pathlib import Path
from PIL import Image


def normalized(text):
    return ' '.join(text.split())


def verify(directory, mechanism=None):
    directory = Path(directory)
    errors, warnings = [], []
    manifest = json.loads((directory / 'export-manifest.json').read_text(encoding='utf-8'))
    for name, info in manifest['outputs'].items():
        target = directory / name
        if not target.is_file():
            errors.append('Missing file: ' + name)
        elif hashlib.sha256(target.read_bytes()).hexdigest() != info['sha256']:
            errors.append('Output changed since export: ' + name)
    with Image.open(directory / 'figure-preview.png') as preview:
        preview_info = {'format': preview.format, 'pixels': list(preview.size)}
        if preview.format != 'PNG' or list(preview.size) != manifest['preview_pixels']:
            errors.append('Preview PNG format or size mismatch')
    with Image.open(directory / 'figure.tiff') as tiff:
        dpi = tiff.info.get('dpi', (0, 0))
        tiff_info = {
            'format': tiff.format,
            'pixels': list(tiff.size),
            'mode': tiff.mode,
            'dpi': [float(value) for value in dpi],
            'compression': tiff.info.get('compression'),
            'icc_profile_present': bool(tiff.info.get('icc_profile')),
        }
        if tiff.format != 'TIFF' or list(tiff.size) != manifest['tiff_pixels']:
            errors.append('TIFF format or pixel dimensions mismatch')
        if tiff.mode != 'RGB':
            errors.append('TIFF must be opaque RGB unless another mode was explicitly requested')
        if len(dpi) != 2 or any(not math.isclose(float(v), manifest['dpi'], abs_tol=.1) for v in dpi):
            errors.append('TIFF DPI metadata mismatch')
        if tiff.info.get('compression') != 'tiff_lzw':
            errors.append('TIFF must use lossless LZW compression')
    expected_size = [manifest['width_mm'] * 72 / 25.4, manifest['height_mm'] * 72 / 25.4]
    pdf_info = {}
    text = ''
    try:
        import pymupdf as fitz
    except ImportError:
        fitz = None
    if fitz is not None:
        with fitz.open(directory / 'figure.pdf') as document:
            pdf_info['page_count'] = len(document)
            if len(document) != 1:
                errors.append('PDF must have exactly one page')
            page = document[0]
            pdf_info['size_points'] = [page.rect.width, page.rect.height]
            text = page.get_text()
            pdf_info['text_characters'] = len(text.strip())
            pdf_info['vector_drawing_count'] = len(page.get_drawings())
            image_infos = page.get_image_info()
            page_area = page.rect.width * page.rect.height
            coverages = []
            for info in image_infos:
                area = (fitz.Rect(info['bbox']) & page.rect).get_area()
                coverages.append(area / page_area)
            pdf_info['image_occurrences'] = len(image_infos)
            pdf_info['largest_image_coverage'] = max(coverages, default=0)
            if not text.strip():
                errors.append('PDF lost all editable/extractable scientific text')
            if pdf_info['largest_image_coverage'] > .95 and not pdf_info['vector_drawing_count']:
                errors.append('PDF appears to substitute a full-page raster image for the figure')
            if image_infos:
                warnings.append('PDF contains local raster objects; do not claim it is entirely vector')
            page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False).save(directory / 'pdf-verification-preview.png')
    else:
        from pypdf import PdfReader
        document = PdfReader(directory / 'figure.pdf')
        pdf_info['page_count'] = len(document.pages)
        if len(document.pages) != 1:
            errors.append('PDF must have exactly one page')
        page = document.pages[0]
        pdf_info['size_points'] = [float(page.mediabox.width), float(page.mediabox.height)]
        text = page.extract_text() or ''
        pdf_info['text_characters'] = len(text.strip())
        if not text.strip():
            errors.append('PDF lost all extractable scientific text')
        warnings.append('PyMuPDF unavailable; PDF image coverage and rendered preview remain unchecked')
        errors.append('Full PDF visual/vector verification requires PyMuPDF')
    if any(abs(actual - expected) > 1.0 for actual, expected in zip(pdf_info['size_points'], expected_size)):
        errors.append('PDF physical page size mismatch')
    if mechanism:
        source = json.loads(Path(mechanism).read_text(encoding='utf-8-sig'))
        pdf_text = normalized(text)
        missing = [label['text'] for label in source.get('label_manifest', []) if normalized(label['text']) not in pdf_text]
        pdf_info['missing_canonical_labels'] = missing
        if missing:
            errors.append('Canonical labels missing from PDF text: ' + ', '.join(missing))
    return {'valid': not errors, 'png': preview_info, 'tiff': tiff_info, 'pdf': pdf_info, 'errors': errors, 'warnings': warnings}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dir', required=True)
    parser.add_argument('--mechanism')
    parser.add_argument('--out')
    args = parser.parse_args()
    try:
        result = verify(args.dir, args.mechanism)
    except Exception as exc:
        result = {'valid': False, 'errors': [str(exc)]}
    payload = json.dumps(result, ensure_ascii=False, indent=2)
    if args.out:
        Path(args.out).write_text(payload + '\n', encoding='utf-8')
    print(payload)
    return 0 if result['valid'] else 1


if __name__ == '__main__':
    sys.exit(main())
