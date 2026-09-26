/**
 * Tab Harbor — i18n 穷尽式检查(node test/i18n.js,取代旧 4 项版)
 * 扫描范围:JS 内 tr('…') 键 + 三个页面 HTML 的文本节点/title/placeholder/aria-label。
 * 白名单:_i18n_whitelist.json(品牌名/专有名词/示例域名/不需翻译串)。
 * 断言:所有非白名单中文文案必须有 EN 映射。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const I18N = require('../shared/i18n.js').BGTI18N;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log('  PASS', name); }
  catch (e) { failed += 1; console.error('  FAIL', name, '\n       ', e && e.message); }
}

const ROOT = path.join(__dirname, '..');
const WL_PATH = path.join(__dirname, 'i18n-whitelist.json');
const whitelist = new Set(
  fs.existsSync(WL_PATH) ? JSON.parse(fs.readFileSync(WL_PATH, 'utf8')) : []
);

const CJK = /[\u4e00-\u9fff\u3000-\u303f\uff01-\uffee]/; // CJK + 中文标点

/* ---- 1. JS tr() 键 ---- */
const jsFiles = [];
for (const dir of ['manager', 'manager/modules', 'popup', 'sidepanel']) {
  for (const f of fs.readdirSync(path.join(ROOT, dir))) {
    if (f.endsWith('.js')) jsFiles.push(path.join(ROOT, dir, f));
  }
}
jsFiles.push(path.join(ROOT, 'background.js'));

const trKeys = new Set();
for (const f of jsFiles) {
  const src = fs.readFileSync(f, 'utf8');
  let i = 0;
  while (true) {
    i = src.indexOf("tr('", i);
    if (i < 0) break;
    let j = i + 4;
    while (j < src.length) {
      if (src[j] === '\\') { j += 2; continue; }
      if (src[j] === "'") break;
      j += 1;
    }
    const key = src.slice(i + 4, j);
    if (CJK.test(key)) trKeys.add(key);
    i = j + 2;
  }
}

/* ---- 2. HTML 静态文本节点 / title / placeholder / aria-label ---- */
function* walkHtmlText(node, out) {
  for (const child of node.childNodes || []) {
    if (child.nodeType === 3 && child.textContent.trim()) out.push(child.textContent.trim());
    if (child.childNodes) yield* walkHtmlText(child, out);
  }
}

const htmlStrings = new Set();
for (const page of ['manager/manager.html', 'popup/popup.html', 'sidepanel/sidepanel.html']) {
  const src = fs.readFileSync(path.join(ROOT, page), 'utf8');
  // 粗解析:提取 <body> 内所有 >text< 片段与 title/placeholder/aria-label 属性
  for (const m of src.matchAll(/>([^<>]*[\u4e00-\u9fff][^<>]*)</g)) {
    htmlStrings.add(m[1].trim());
  }
  for (const m of src.matchAll(/(?:title|placeholder|aria-label)="([^"]*[\u4e00-\u9fff][^"]*)"/g)) {
    htmlStrings.add(m[1].trim());
  }
}

test('EN 表覆盖全部 tr() 键(JS)', () => {
  const missing = [...trKeys].filter((k) => !Object.prototype.hasOwnProperty.call(I18N.EN, k));
  assert.strictEqual(missing.length, 0, `缺 ${missing.length}: ${missing.slice(0, 12).join(' | ')}`);
});

test('EN 表覆盖全部 HTML 静态中文文案', () => {
  const missing = [...htmlStrings].filter((k) => CJK.test(k) && !whitelist.has(k)
    && !Object.prototype.hasOwnProperty.call(I18N.EN, k)
    && !Object.prototype.hasOwnProperty.call(I18N.EN, k.replace(/\s+/g, ' ')));
  assert.strictEqual(missing.length, 0, `缺 ${missing.length}: ${missing.slice(0, 12).join(' | ')}`);
});

test('_locales 键与 manifest 占位符一致', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  const zh = JSON.parse(fs.readFileSync(path.join(ROOT, '_locales/zh_CN/messages.json'), 'utf8'));
  const en = JSON.parse(fs.readFileSync(path.join(ROOT, '_locales/en/messages.json'), 'utf8'));
  assert.strictEqual(manifest.default_locale, 'zh_CN');
  assert.strictEqual(manifest.name, '__MSG_extName__');
  assert.strictEqual(manifest.description, '__MSG_extDesc__');
  for (const [locale, table] of [['zh', zh], ['en', en]]) {
    for (const key of ['extName', 'extDesc', 'cmdSaveCurrent', 'cmdSaveAll', 'cmdSaveWorkspace']) {
      assert.ok(table[key] && table[key].message, locale + ' missing ' + key);
    }
  }
  assert.deepStrictEqual(Object.keys(zh).sort(), Object.keys(en).sort(), 'zh/en 表键不对齐');
});

test('占位符一致性:EN 值与中文键的 {x} 变量集合一致', () => {
  const bad = [];
  for (const [k, v] of Object.entries(I18N.EN)) {
    const kv = new Set((k.match(/\{(\w+)\}/g) || []).sort());
    const vv = new Set((v.match(/\{(\w+)\}/g) || []).sort());
    if (kv.size !== vv.size || [...kv].some((x) => !vv.has(x))) bad.push(k);
  }
  assert.strictEqual(bad.length, 0, '占位符不一致: ' + bad.slice(0, 8).join(' | '));
});

test('白名单文件存在且为合法 JSON 数组', () => {
  const wl = JSON.parse(fs.readFileSync(WL_PATH, 'utf8'));
  assert.ok(Array.isArray(wl));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
