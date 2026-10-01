/**
 * Tab Harbor 商店促销图生成器:node tools/make-promo.js
 *
 * 产出(CWS 素材,均由无头 Chrome 真渲染,非手绘拼图):
 *   store-assets/promo-440.png   440×280  小促销图(RECOMMENDED,上架建议项)
 *   store-assets/promo-1400.png  1400×560 横幅(Marquee,选填)
 * 文案为常青款(无版本号/日期),长期复用;改文案/配色直接改本文件的 HTML 模板。
 * 用法:node tools/make-promo.js [--chrome <chrome.exe 路径>] [--out store-assets]
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { shotHtml } = require('./chrome-shot.js');
const { iconSvg, glyphSvg } = require('./brand.js');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'store-assets');

const FONT = "'Segoe UI','Microsoft YaHei','PingFang SC',sans-serif";

const CSS = [
  'html,body{margin:0;padding:0;overflow:hidden}',
  '*{box-sizing:border-box}',
  '.tile{position:relative;width:{W}px;height:{H}px;color:#fff;font-family:' + FONT + ';',
  '  background:linear-gradient(135deg,#062033 0%,#0a3a5e 58%,#0d5b8c 100%)}',
  '.glow{position:absolute;inset:0;background:radial-gradient(ellipse at 12% 0%,rgba(34,211,238,.22),transparent 55%)}',
  '.deco{position:absolute;right:-{DECX}px;bottom:-{DECY}px;line-height:0}',
  '.waves{position:absolute;left:0;right:0;bottom:0;line-height:0}',
  '.content{position:relative;height:100%;display:flex;flex-direction:column;justify-content:center;padding:{PAD}px}',
  '.brandrow{display:flex;align-items:center;gap:{GAP}px}',
  '.name{font-weight:700;letter-spacing:.3px;color:#fff;white-space:nowrap}',
  '.tagline{margin-top:{MT}px;color:rgba(255,255,255,.88);font-weight:400}',
  '.chips{display:flex;flex-wrap:wrap;gap:{CGAP}px;margin-top:{CMT}px}',
  '.chip{border:1px solid rgba(255,255,255,.30);background:rgba(255,255,255,.10);',
  '  border-radius:999px;color:rgba(255,255,255,.95);white-space:nowrap;padding:{CPAD}px {CPADX}px}',
  '.rule{width:{RULE}px;height:3px;border-radius:2px;background:linear-gradient(90deg,#22d3ee,#3b82f6);margin-top:{RMT}px}',
].join('\n');

/** 440×280:小促销图。少字、大图标,远看先认出「帆船」 */
function tile440() {
  const vars = {
    W: 440, H: 280, PAD: 34, GAP: 14, MT: 12, CMT: 16, CGAP: 8,
    CPAD: 4, CPADX: 10, RULE: 56, RMT: 16, DECX: 46, DECY: 40,
  };
  const css = Object.entries(vars).reduce(
    (s, [k, v]) => s.split('{' + k + '}').join(String(v)), CSS);
  return '<!doctype html>\n<html><head><meta charset="utf-8"><style>' + css + '</style></head><body>'
    + '<div class="tile">'
    + '<div class="glow"></div>'
    + '<div class="deco">' + glyphSvg(230, 0.10) + '</div>'
    + '<svg class="waves" width="440" height="56" viewBox="0 0 440 56" xmlns="http://www.w3.org/2000/svg">'
    + '<path d="M0,34 C60,22 120,46 220,36 C320,26 380,44 440,34 L440,56 L0,56 Z" fill="rgba(255,255,255,.07)"/>'
    + '</svg>'
    + '<div class="content">'
    + '<div class="brandrow">' + iconSvg(56)
    + '<div><div class="name" style="font-size:21px">Tab Harbor · 标签港湾</div>'
    + '<div class="tagline" style="font-size:13px">标签会关闭,工作脉络不该消失。</div></div></div>'
    + '<div class="rule"></div>'
    + '<div class="chips" style="max-width:330px">'
    + '<span class="chip" style="font-size:11px">本地优先</span>'
    + '<span class="chip" style="font-size:11px">零网络 · 零追踪</span>'
    + '<span class="chip" style="font-size:11px">定期 + 增量备份</span>'
    + '<span class="chip" style="font-size:11px">一键回到工作现场</span>'
    + '</div></div></div></body></html>';
}

/** 1400×560:横幅。同一品牌语言放大,右侧留白给帆船装饰 */
function tile1400() {
  const vars = {
    W: 1400, H: 560, PAD: 84, GAP: 26, MT: 14, CMT: 30, CGAP: 14,
    CPAD: 9, CPADX: 20, RULE: 120, RMT: 28, DECX: 60, DECY: 70,
  };
  const css = Object.entries(vars).reduce(
    (s, [k, v]) => s.split('{' + k + '}').join(String(v)), CSS);
  return '<!doctype html>\n<html><head><meta charset="utf-8"><style>' + css + '</style></head><body>'
    + '<div class="tile">'
    + '<div class="glow"></div>'
    + '<div class="deco">' + glyphSvg(560, 0.09) + '</div>'
    + '<svg class="waves" width="1400" height="120" viewBox="0 0 1400 120" xmlns="http://www.w3.org/2000/svg">'
    + '<path d="M0,70 C240,44 480,96 760,74 C1040,52 1240,92 1400,68 L1400,120 L0,120 Z" fill="rgba(255,255,255,.06)"/>'
    + '</svg>'
    + '<div class="content" style="max-width:900px">'
    + '<div class="brandrow">' + iconSvg(112)
    + '<div><div class="name" style="font-size:44px">Tab Harbor · 标签港湾</div>'
    + '<div class="tagline" style="font-size:22px">标签会关闭,工作脉络不该消失。</div></div></div>'
    + '<div class="rule"></div>'
    + '<div class="chips">'
    + '<span class="chip" style="font-size:17px">本地优先 · 数据不出你的机器</span>'
    + '<span class="chip" style="font-size:17px">零网络 · 零追踪</span>'
    + '<span class="chip" style="font-size:17px">定期 + 增量备份</span>'
    + '<span class="chip" style="font-size:17px">一键回到工作现场</span>'
    + '</div></div></div></body></html>';
}

function main() {
  const argv = process.argv.slice(2);
  const chromeIdx = argv.indexOf('--chrome');
  const opts = { chromePath: chromeIdx >= 0 ? argv[chromeIdx + 1] : undefined };
  const outIdx = argv.indexOf('--out');
  const outDir = outIdx >= 0 ? path.resolve(argv[outIdx + 1]) : OUT_DIR;
  fs.mkdirSync(outDir, { recursive: true });
  for (const [file, html, w, h] of [
    ['promo-440.png', tile440(), 440, 280],
    ['promo-1400.png', tile1400(), 1400, 560],
  ]) {
    const p = path.join(outDir, file);
    fs.writeFileSync(p, shotHtml(html, w, h, opts));
    console.log('written', p);
  }
}

main();
