/**
 * Tab Harbor — 品牌 SVG 片段(tools/brand.js,被 make-icons.js / make-promo.js 复用)
 *
 * 唯一的图形事实来源:帆船 = Phosphor Icons「sailboat」(MIT,原件在
 * store-assets/brand/,溯源见 CREDITS.md);底 = 海洋渐变圆角方。
 * 改品牌 = 改这里 + 重跑两个生成脚本,不允许在别处抄一份参数。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const BRAND_SVG = path.join(__dirname, '..', 'store-assets', 'brand', 'sailboat-fill.svg');

const VB = 256;                            // 画布 viewBox
const RADIUS = Math.round(VB * 0.225);     // 圆角比例(沿用 v3.x 图标)
const STOPS = ['rgb(34,211,238)', 'rgb(14,165,233)', 'rgb(37,99,235)']; // 青 → 天蓝 → 蓝

/* 帆船摆放:图形实际包围盒约 (10,3)-(247,224),缩放平移到圆角底的视觉重心 */
const GLYPH_SCALE = 0.78;
const GLYPH_TX = 27.8;
const GLYPH_TY = 45.5;

function glyphPath() {
  const svg = fs.readFileSync(BRAND_SVG, 'utf8');
  const m = svg.match(/<path[^>]*\bd="([^"]+)"/);
  if (!m) throw new Error(BRAND_SVG + ' 中未找到 <path d="…">');
  return m[1];
}

/** 完整图标(渐变圆角底 + 白帆船),size 为输出像素 */
function iconSvg(size) {
  const d = glyphPath();
  return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + VB + ' ' + VB
    + '" xmlns="http://www.w3.org/2000/svg">'
    + '<defs>'
    + '<linearGradient id="g" x1="0" y1="0" x2="1" y2="1">'
    + '<stop offset="0" stop-color="' + STOPS[0] + '"/>'
    + '<stop offset="0.5" stop-color="' + STOPS[1] + '"/>'
    + '<stop offset="1" stop-color="' + STOPS[2] + '"/>'
    + '</linearGradient>'
    + '<clipPath id="r"><rect width="' + VB + '" height="' + VB + '" rx="' + RADIUS + '"/></clipPath>'
    + '</defs>'
    + '<g clip-path="url(#r)">'
    + '<rect width="' + VB + '" height="' + VB + '" fill="url(#g)"/>'
    + '<g transform="translate(' + GLYPH_TX + ',' + GLYPH_TY + ') scale(' + GLYPH_SCALE + ')" fill="#fff">'
    + '<path d="' + d + '"/>'
    + '</g></g></svg>';
}

/** 纯白帆船(无底),用于深色背景上的大号装饰,size 为输出像素 */
function glyphSvg(size, opacity) {
  const d = glyphPath();
  return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + VB + ' ' + VB
    + '" xmlns="http://www.w3.org/2000/svg">'
    + '<g transform="translate(' + GLYPH_TX + ',' + GLYPH_TY + ') scale(' + GLYPH_SCALE + ')"'
    + ' fill="#fff"' + (opacity != null ? ' opacity="' + opacity + '"' : '') + '>'
    + '<path d="' + d + '"/></g></svg>';
}

module.exports = { iconSvg, glyphSvg, STOPS, VB, RADIUS };
