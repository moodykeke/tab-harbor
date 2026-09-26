/**
 * Tab Harbor 品牌图标生成器:node tools/make-icons.js
 * 程序化绘制「帆船入港」图标并输出透明 PNG(4x 超采样抗锯齿),无第三方依赖。
 * 产出:icons/icon16/32/48/64/128.png
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/* ---------------- PNG 编码 ---------------- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length);
  return out;
}

function encodePNG(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------------- 品牌绘制:帆船入港 ---------------- */

// 海洋渐变:青 → 天蓝 → 蓝
const STOPS = [[34, 211, 238], [14, 165, 233], [37, 99, 235]];

function gradient(t) {
  const seg = t < 0.5 ? [STOPS[0], STOPS[1], t * 2] : [STOPS[1], STOPS[2], (t - 0.5) * 2];
  const lerp = (a, b) => a + (b - a) * seg[2];
  return [lerp(seg[0][0], seg[1][0]), lerp(seg[0][1], seg[1][1]), lerp(seg[0][2], seg[1][2])];
}

function inRoundedRect(u, v, r) {
  if (u < 0 || v < 0 || u > 1 || v > 1) return false;
  const cx = Math.max(r, Math.min(1 - r, u));
  const cy = Math.max(r, Math.min(1 - r, v));
  return (u - cx) * (u - cx) + (v - cy) * (v - cy) <= r * r;
}

function inTriangle(px, py, a, b, c) {
  const d1 = (b[0] - a[0]) * (py - a[1]) - (b[1] - a[1]) * (px - a[0]);
  const d2 = (c[0] - b[0]) * (py - b[1]) - (c[1] - b[1]) * (px - b[0]);
  const d3 = (a[0] - c[0]) * (py - c[1]) - (a[1] - c[1]) * (px - c[0]);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

function inConvex(px, py, poly) {
  let hasPos = false;
  let hasNeg = false;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const cross = (b[0] - a[0]) * (py - a[1]) - (b[1] - a[1]) * (px - a[0]);
    if (cross > 0) hasPos = true;
    if (cross < 0) hasNeg = true;
  }
  return !(hasPos && hasNeg);
}

const SAIL = [[0.44, 0.10], [0.44, 0.54], [0.14, 0.54]];
const SAIL2 = [[0.53, 0.24], [0.53, 0.54], [0.80, 0.54]];
const HULL = [[0.10, 0.60], [0.90, 0.60], [0.75, 0.78], [0.25, 0.78]];

function waveY(u, i) {
  const base = i === 0 ? 0.855 : 0.935;
  const phase = i === 0 ? 0 : Math.PI;
  return base + 0.022 * Math.sin(u * Math.PI * 4.2 + phase);
}

function glyph(u, v) {
  if (inTriangle(u, v, SAIL[0], SAIL[1], SAIL[2])) return true;
  if (inTriangle(u, v, SAIL2[0], SAIL2[1], SAIL2[2])) return true;
  if (inConvex(u, v, HULL)) return true;
  for (let i = 0; i < 2; i += 1) {
    if (Math.abs(v - waveY(u, i)) <= 0.020 && u >= 0.08 && u <= 0.92) return true;
  }
  return false;
}

function renderIcon(size) {
  const S = 4; // 超采样倍数
  const N = size * S;
  const buf = Buffer.alloc(N * N * 4);
  const r = 0.225; // 圆角比例

  for (let y = 0; y < N; y += 1) {
    for (let x = 0; x < N; x += 1) {
      const u = (x + 0.5) / N;
      const v = (y + 0.5) / N;
      const o = (y * N + x) * 4;
      if (!inRoundedRect(u, v, r)) continue; // RGBA 默认全 0 = 透明
      const [cr, cg, cb] = gradient((u + v) / 2);
      const white = glyph(u, v);
      buf[o] = white ? 255 : cr;
      buf[o + 1] = white ? 255 : cg;
      buf[o + 2] = white ? 255 : cb;
      buf[o + 3] = 255;
    }
  }

  // 盒式降采样(预乘 alpha 平均,避免边缘黑晕)
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let sr = 0, sg = 0, sb = 0, sa = 0;
      for (let dy = 0; dy < S; dy += 1) {
        for (let dx = 0; dx < S; dx += 1) {
          const o = ((y * S + dy) * N + (x * S + dx)) * 4;
          const a = buf[o + 3];
          sr += buf[o] * a; sg += buf[o + 1] * a; sb += buf[o + 2] * a; sa += a;
        }
      }
      const o = (y * size + x) * 4;
      if (sa > 0) {
        out[o] = Math.round(sr / sa);
        out[o + 1] = Math.round(sg / sa);
        out[o + 2] = Math.round(sb / sa);
      }
      out[o + 3] = Math.round(sa / (S * S));
    }
  }
  return encodePNG(size, size, out);
}

const dir = path.join(__dirname, '..', 'icons');
for (const size of [16, 32, 48, 64, 128]) {
  const file = path.join(dir, `icon${size}.png`);
  fs.writeFileSync(file, renderIcon(size));
  console.log('written', file);
}
