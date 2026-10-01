/**
 * Tab Harbor — 无头 Chrome 截图工具(tools/chrome-shot.js,被 make-icons/make-promo 复用)
 *
 * 零依赖:把一段 HTML 在无头 Chrome 里渲染为指定像素尺寸的 PNG(透明背景)。
 * 用 Chrome 而不是自写光栅化器:SVG/文本排版由浏览器保证,产物与商店里看到的一致。
 * 产出尺寸用 PNG IHDR 字节逐一核验,防止设备缩放悄悄改变输出。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  path.join(os.homedir(), 'AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'),
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

function findChrome(explicit) {
  if (explicit) return explicit;
  for (const p of CHROME_CANDIDATES) if (fs.existsSync(p)) return p;
  throw new Error('未找到 Chrome,请用 --chrome <路径> 指定');
}

/** 读 PNG IHDR 的宽高(固定偏移,无需解码器) */
function pngSize(buf) {
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

/**
 * 把 html 渲染成 width×height 的 PNG,返回 Buffer。
 * opts.chromePath 可显式指定浏览器;输出尺寸不符即抛错(宁可失败不出坏图)。
 */
function shotHtml(html, width, height, opts = {}) {
  const chrome = findChrome(opts.chromePath);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bgt-shot-'));
  const htmlPath = path.join(tmp, 'page.html');
  const outPath = path.join(tmp, 'shot.png');
  let lastErr;
  try {
    fs.writeFileSync(htmlPath, html, 'utf8');
    const fileUrl = 'file:///' + encodeURI(htmlPath.split(path.sep).join('/'));
    const base = [
      '--disable-gpu',
      '--force-device-scale-factor=1',
      '--hide-scrollbars',
      '--default-background-color=00000000', // 透明背景,图标保持圆角外形
      '--virtual-time-budget=2000',
      '--window-size=' + width + ',' + height,
      '--screenshot=' + outPath,
      fileUrl,
    ];
    for (const headlessFlag of ['--headless=new', '--headless']) {
      try {
        execFileSync(chrome, [headlessFlag].concat(base), { stdio: 'ignore', timeout: 60000 });
        const buf = fs.readFileSync(outPath);
        const { w, h } = pngSize(buf);
        if (w !== width || h !== height) {
          throw new Error('PNG 尺寸 ' + w + '×' + h + ' ≠ 期望 ' + width + '×' + height);
        }
        return buf;
      } catch (e) {
        lastErr = e; // 换下一个 headless flag 重试
      }
    }
    throw lastErr || new Error('无头 Chrome 截图失败');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

module.exports = { shotHtml, findChrome, pngSize };
