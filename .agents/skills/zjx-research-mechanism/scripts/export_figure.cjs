#!/usr/bin/env node
'use strict';
// Render one self-contained SVG consistently to PNG, high-resolution TIFF and PDF.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

function argumentsFrom(argv) {
  const valueKeys = new Set(['svg', 'out', 'modules', 'browser', 'width-mm', 'dpi', 'preview-width']);
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--overwrite') { result.overwrite = true; continue; }
    const key = argv[i].replace(/^--/, '');
    if (!argv[i].startsWith('--') || !valueKeys.has(key) || !argv[i + 1] || argv[i + 1].startsWith('--')) {
      throw new Error('Unknown or incomplete argument: ' + argv[i]);
    }
    result[key] = argv[++i];
  }
  if (!result.svg || !result.out) throw new Error('Required: --svg FILE --out DIRECTORY [--modules NODE_MODULES]');
  result.widthMm = Number(result['width-mm'] || 180);
  result.dpi = Number(result.dpi || 600);
  result.previewWidth = Number(result['preview-width'] || 1536);
  if (!Number.isFinite(result.widthMm) || result.widthMm < 10 || result.widthMm > 1000) throw new Error('Invalid width in mm');
  if (!Number.isFinite(result.dpi) || result.dpi < 72 || result.dpi > 2400) throw new Error('Invalid DPI');
  if (!Number.isInteger(result.previewWidth) || result.previewWidth < 256 || result.previewWidth > 8192) throw new Error('Invalid preview width');
  return result;
}

function dependency(name, modules) {
  return modules ? require(path.join(path.resolve(modules), name)) : require(name);
}

function browserPath(explicit) {
  if (explicit || process.env.FIGURE_BROWSER) {
    const selected = path.resolve(explicit || process.env.FIGURE_BROWSER);
    if (!fs.existsSync(selected)) throw new Error('Browser executable is missing: ' + selected);
    return selected;
  }
  const options = process.platform === 'win32'
    ? [
        path.join(process.env.PROGRAMFILES || 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'),
        path.join(process.env['PROGRAMFILES(X86)'] || 'C:/Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe'),
        path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
      ]
    : ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
  return options.find(candidate => fs.existsSync(candidate));
}

function sha(data) { return crypto.createHash('sha256').update(data).digest('hex'); }

async function main() {
  const args = argumentsFrom(process.argv.slice(2));
  const { chromium } = dependency('playwright', args.modules);
  const sharp = dependency('sharp', args.modules);
  const input = path.resolve(args.svg);
  const out = path.resolve(args.out);
  const svgData = await fsp.readFile(input);
  const svg = svgData.toString('utf8').replace(/^\uFEFF/, '');
  if (/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(svg)) throw new Error('DTD/entities/external stylesheet instructions are forbidden');
  await fsp.mkdir(out, { recursive: true });
  const names = ['figure-preview.png', 'figure.tiff', 'figure.pdf', 'export-manifest.json'];
  const svgDestination = path.join(out, 'figure.svg');
  if (input !== svgDestination) names.push('figure.svg');
  for (const name of names) {
    if (fs.existsSync(path.join(out, name)) && !args.overwrite) throw new Error('Refusing to overwrite generated file without --overwrite: ' + name);
  }
  const temporary = [];
  const temp = name => {
    const target = path.join(out, '.' + name + '.' + crypto.randomUUID() + '.tmp');
    temporary.push(target);
    return target;
  };
  const pngTemp = temp('preview');
  const tiffTemp = temp('tiff');
  const pdfTemp = temp('pdf');
  const manifestTemp = temp('manifest');
  const svgTemp = input !== svgDestination ? temp('svg') : null;
  const executablePath = browserPath(args.browser);
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    const context = await browser.newContext({ viewport: { width: args.previewWidth, height: 1024 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const requests = [];
    await page.route('**/*', route => { requests.push(route.request().url()); return route.abort(); });
    await page.setContent('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>');
    const source = await page.evaluate(raw => {
      const doc = new DOMParser().parseFromString(raw, 'image/svg+xml');
      if (doc.querySelector('parsererror')) throw new Error('Invalid SVG XML');
      const root = doc.documentElement;
      if (root.localName !== 'svg' || root.namespaceURI !== 'http://www.w3.org/2000/svg') throw new Error('Invalid SVG root');
      if (doc.querySelector('image,feImage,script,foreignObject,canvas,iframe,object,embed')) throw new Error('SVG must contain only native self-contained graphics');
      const ids = new Set();
      const refs = [];
      for (const element of doc.querySelectorAll('*')) {
        if (element.namespaceURI !== root.namespaceURI) throw new Error('Non-SVG namespace');
        if (element.id) {
          if (ids.has(element.id)) throw new Error('Duplicate id: ' + element.id);
          ids.add(element.id);
        }
        for (const attribute of element.attributes) {
          if (attribute.localName.toLowerCase().startsWith('on')) throw new Error('Event handlers are forbidden');
          if (attribute.localName === 'href') {
            if (!attribute.value.startsWith('#')) throw new Error('External/embedded href is forbidden');
            refs.push(attribute.value.slice(1));
          }
          for (const match of attribute.value.matchAll(/url\s*\(\s*['"]?([^)'"\s]+)/gi)) {
            if (!match[1].startsWith('#')) throw new Error('External CSS URL is forbidden');
            refs.push(match[1].slice(1));
          }
        }
        if (element.localName === 'style') {
          if (/@import|@font-face/i.test(element.textContent)) throw new Error('External styles/fonts are forbidden');
          for (const match of element.textContent.matchAll(/url\s*\(\s*['"]?([^)'"\s]+)/gi)) {
            if (!match[1].startsWith('#')) throw new Error('External stylesheet URL is forbidden');
            refs.push(match[1].slice(1));
          }
        }
      }
      if (refs.some(ref => !ids.has(ref))) throw new Error('Unresolved internal SVG reference');
      const values = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
      if (values.length !== 4 || values.some(v => !Number.isFinite(v)) || values[2] <= 0 || values[3] <= 0) throw new Error('Valid viewBox is required');
      const textCount = root.querySelectorAll('text').length;
      if (!textCount) throw new Error('Scientific labels must be editable SVG text');
      const copy = document.importNode(root, true);
      document.body.appendChild(copy);
      document.documentElement.style.margin = '0';
      document.documentElement.style.padding = '0';
      document.body.style.cssText = 'margin:0;padding:0;background:white;overflow:hidden;';
      copy.setAttribute('width', '100%');
      copy.setAttribute('height', '100%');
      copy.style.display = 'block';
      copy.style.width = '100%';
      copy.style.height = '100%';
      copy.style.background = 'white';
      return { viewBox: values, textCount, filterCount: root.querySelectorAll('filter').length };
    }, svg);
    const ratio = source.viewBox[3] / source.viewBox[2];
    const heightMm = args.widthMm * ratio;
    const previewHeight = Math.round(args.previewWidth * ratio);
    const pixelWidth = Math.round(args.widthMm / 25.4 * args.dpi);
    const pixelHeight = Math.round(pixelWidth * ratio);
    if (ratio < .05 || ratio > 20 || pixelWidth > 20000 || pixelHeight > 20000 || pixelWidth * pixelHeight > 100000000) throw new Error('Requested figure exceeds safe rendering dimensions');
    async function size(width, height) {
      await page.setViewportSize({ width, height });
      await page.evaluate(({ width, height }) => {
        document.body.style.width = width + 'px';
        document.body.style.height = height + 'px';
      }, { width, height });
      await page.evaluate(() => document.fonts.ready);
    }
    await size(args.previewWidth, previewHeight);
    await page.screenshot({ path: pngTemp, type: 'png', animations: 'disabled', omitBackground: false });
    await size(pixelWidth, pixelHeight);
    const highResolutionPng = await page.screenshot({ type: 'png', animations: 'disabled', omitBackground: false });
    await sharp(highResolutionPng)
      .flatten({ background: '#ffffff' })
      .removeAlpha()
      .toColourspace('srgb')
      .withIccProfile('srgb')
      .withMetadata({ density: args.dpi })
      .tiff({ compression: 'lzw', predictor: 'horizontal', xres: args.dpi / 25.4, yres: args.dpi / 25.4, resolutionUnit: 'inch' })
      .toFile(tiffTemp);
    await page.evaluate(({ widthMm, heightMm }) => {
      const style = document.createElement('style');
      style.textContent = '@page{size:' + widthMm + 'mm ' + heightMm + 'mm;margin:0;}@media print{html,body{margin:0!important;padding:0!important;width:' + widthMm + 'mm!important;height:' + heightMm + 'mm!important;}svg{width:100%!important;height:100%!important;}*{-webkit-print-color-adjust:exact;print-color-adjust:exact;}}';
      document.head.appendChild(style);
    }, { widthMm: args.widthMm, heightMm });
    await page.pdf({ path: pdfTemp, width: args.widthMm + 'mm', height: heightMm + 'mm', preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
    if (requests.length) throw new Error('SVG attempted external requests: ' + requests.join(', '));
    if (svgTemp) await fsp.writeFile(svgTemp, svgData);
    const manifest = {
      source: input,
      source_sha256: sha(svgData),
      width_mm: args.widthMm,
      height_mm: heightMm,
      dpi: args.dpi,
      preview_pixels: [args.previewWidth, previewHeight],
      tiff_pixels: [pixelWidth, pixelHeight],
      tiff_color: 'RGB/sRGB',
      tiff_compression: 'LZW',
      svg_text_count: source.textCount,
      svg_filter_count: source.filterCount,
      pdf_mode: 'Direct SVG print; native text and paths retained where supported; filters may rasterize locally',
      outputs: {},
    };
    for (const [name, target] of [['figure-preview.png', pngTemp], ['figure.tiff', tiffTemp], ['figure.pdf', pdfTemp]]) {
      const bytes = await fsp.readFile(target);
      manifest.outputs[name] = { bytes: bytes.length, sha256: sha(bytes) };
    }
    manifest.outputs['figure.svg'] = { bytes: svgData.length, sha256: sha(svgData) };
    await fsp.writeFile(manifestTemp, JSON.stringify(manifest, null, 2) + '\n');
    const commits = [[pngTemp, 'figure-preview.png'], [tiffTemp, 'figure.tiff'], [pdfTemp, 'figure.pdf'], [manifestTemp, 'export-manifest.json']];
    if (svgTemp) commits.push([svgTemp, 'figure.svg']);
    for (const [from, name] of commits) {
      const to = path.join(out, name);
      if (args.overwrite && fs.existsSync(to)) await fsp.unlink(to);
      await fsp.rename(from, to);
    }
    process.stdout.write(JSON.stringify({ ok: true, output_dir: out, files: ['figure-preview.png', 'figure.svg', 'figure.tiff', 'figure.pdf'], tiff_pixels: manifest.tiff_pixels, dpi: args.dpi }, null, 2) + '\n');
  } finally {
    if (browser) await browser.close();
    for (const target of temporary) {
      if (path.dirname(target) === out && fs.existsSync(target)) await fsp.unlink(target);
    }
  }
}

main().catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
