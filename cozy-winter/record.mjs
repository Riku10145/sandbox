import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const { values: args } = parseArgs({
  options: {
    fps: { type: 'string', default: '30' },
    w: { type: 'string', default: '1920' },
    h: { type: 'string', default: '1080' },
    still: { type: 'string' },
    cam: { type: 'string' },
    fx: { type: 'string' },
    out: { type: 'string', default: 'out/cozy-winter.mp4' },
    audio: { type: 'string', default: 'out/ambience.wav' },
  },
});

const root = fileURLToPath(new URL('.', import.meta.url));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
  try {
    const body = await readFile(join(root, path === '/' ? 'index.html' : path));
    res.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/index.html?w=${args.w}&h=${args.h}${args.cam ? `&cam=${args.cam}` : ''}${args.fx ? `&fx=${args.fx}` : ''}`;

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: Number(args.w), height: Number(args.h) } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(base);
await page.waitForFunction(() => window.ready === true, null, { timeout: 180000 }).catch(() => {});
if (errors.length) console.error(errors.join('\n'));
const canvas = page.locator('canvas');
await mkdir(join(root, 'out'), { recursive: true });

async function frameAt(t) {
  await page.evaluate((tt) => window.renderAt(tt), t);
  return canvas.screenshot({ type: 'png' });
}

if (args.still !== undefined) {
  for (const t of args.still.split(',').map(Number)) {
    const file = join(root, 'out', `still-${t}${args.fx ? `-${args.fx.replaceAll(',', '+')}` : ''}.png`);
    const { writeFile } = await import('node:fs/promises');
    const t0 = Date.now();
    await writeFile(file, await frameAt(t));
    console.log(`${file} (${Date.now() - t0} ms)`);
  }
} else {
  const fps = Number(args.fps);
  const duration = await page.evaluate(() => window.DURATION);
  const frames = Math.round(duration * fps);
  const ff = spawn('ffmpeg', [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'image2pipe', '-framerate', String(fps), '-i', '-',
    '-i', join(root, args.audio),
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart',
    join(root, args.out),
  ], { stdio: ['pipe', 'inherit', 'inherit'] });
  const t0 = Date.now();
  for (let i = 0; i < frames; i++) {
    const png = await frameAt(i / fps);
    if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once('drain', r));
    if (i % 30 === 0) console.log(`frame ${i}/${frames} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  ff.stdin.end();
  const code = await new Promise((r) => ff.on('close', r));
  console.log(`ffmpeg exit ${code}, ${frames} frames in ${((Date.now() - t0) / 1000).toFixed(0)}s -> ${args.out}`);
}

await browser.close();
server.close();
