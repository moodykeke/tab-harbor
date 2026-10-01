/**
 * Tab Harbor 品牌图标生成器 v2:node tools/make-icons.js
 *
 * 图形来源:Phosphor Icons「sailboat」(MIT)—— 开源、可长期商用,原件存于
 * store-assets/brand/(来源与许可见同目录 CREDITS.md);与品牌「帆船入港」一致。
 * 渲染:无头 Chrome 把「品牌渐变圆角底 + 白色帆船」的 SVG 栅格化为
 * icons/icon16/32/48/64/128.png —— 每个尺寸独立渲染真像素,不是同一张图缩放。
 * 用法:node tools/make-icons.js [--chrome <chrome.exe 路径>]
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { shotHtml } = require('./chrome-shot.js');
const { iconSvg } = require('./brand.js');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'icons');
const SIZES = [16, 32, 48, 64, 128];

function htmlFor(size) {
  return '<!doctype html>\n<html><head><meta charset="utf-8"><style>'
    + 'html,body{margin:0;padding:0;background:transparent;overflow:hidden}'
    + 'svg{display:block}'
    + '</style></head><body>'
    + iconSvg(size)
    + '</body></html>';
}

function main() {
  const argv = process.argv.slice(2);
  const chromeIdx = argv.indexOf('--chrome');
  const opts = { chromePath: chromeIdx >= 0 ? argv[chromeIdx + 1] : undefined };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const size of SIZES) {
    const file = path.join(OUT_DIR, 'icon' + size + '.png');
    fs.writeFileSync(file, shotHtml(htmlFor(size), size, size, opts));
    console.log('written', file);
  }
}

main();
