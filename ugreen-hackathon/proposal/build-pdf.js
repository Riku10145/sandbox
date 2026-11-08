// Usage: node build-pdf.js <proposal.md> <out.html> <out.pdf>
const fs = require('fs');
const { chromium } = require('playwright');

const [src, outHtml, outPdf] = process.argv.slice(2);
const md = fs.readFileSync(src, 'utf8');

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = (s) => esc(s)
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

let html = '';
let inList = false;
let para = [];
const flushPara = () => { if (para.length) { html += `<p>${inline(para.join(' '))}</p>\n`; para = []; } };
const closeList = () => { if (inList) { html += '</ul>\n'; inList = false; } };

for (const line of md.split('\n')) {
  if (/^# /.test(line)) { flushPara(); closeList(); html += `<h1>${inline(line.slice(2))}</h1>\n`; }
  else if (/^## /.test(line)) { flushPara(); closeList(); html += `<h2>${inline(line.slice(3))}</h2>\n`; }
  else if (/^- /.test(line)) { flushPara(); if (!inList) { html += '<ul>\n'; inList = true; } html += `<li>${inline(line.slice(2))}</li>\n`; }
  else if (line.trim() === '') { flushPara(); closeList(); }
  else { closeList(); para.push(line.trim()); }
}
flushPara(); closeList();

const page = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>shoot-archive-audit proposal</title>
<style>
  @page { size: A4; margin: 12mm 16mm; }
  body { font-family: "DejaVu Sans", "Liberation Sans", Arial, sans-serif; font-size: 9.3pt; line-height: 1.36; color: #1a1a1a; }
  h1 { font-size: 17pt; margin: 0 0 2px; letter-spacing: -0.2px; }
  h1 + p { margin-top: 0; color: #444; }
  h2 { font-size: 10.6pt; margin: 8px 0 3px; padding-bottom: 2px; border-bottom: 1px solid #d0d0d0; color: #0b3d5c; }
  p { margin: 3px 0; }
  ul { margin: 3px 0; padding-left: 17px; }
  li { margin: 1px 0; }
  code { font-family: "DejaVu Sans Mono", monospace; font-size: 8.6pt; background: #f1f3f5; padding: 0 3px; border-radius: 3px; }
</style></head><body>
${html}</body></html>`;

fs.writeFileSync(outHtml, page);

(async () => {
  const browser = await chromium.launch();
  const p = await browser.newPage();
  await p.setContent(page, { waitUntil: 'load' });
  await p.pdf({ path: outPdf, format: 'A4', printBackground: true, preferCSSPageSize: true });
  await browser.close();
})();
