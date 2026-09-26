/**
 * Tab Harbor — 静态检查:未声明标识符(no-undef 轻量版)
 *
 * 动机:manager/ 模块是 ESM,靠 import 注入符号;一旦漏 import,
 * 浏览器只在**该回调真正触发时**抛 ReferenceError —— 静态测试与数据层单测
 * 全部发现不了。v3.11.2 的 `events.js` 漏 import `persistAndRenderSoon`
 * 就是这类缺陷(工作区删标签功能整体失效)。
 *
 * 做法:文件级作用域近似 —— 汇总 声明 / import / 已知全局 / 解构参数,
 * 再扫描所有 `name(...)` 形式的调用。只报"全局都找不到"的名字,零误报优先。
 *
 * 用法:node tools/check-globals.js   (退出码 1 = 发现问题)
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/** 运行时注入 / 平台提供 / 语言内建 */
const KNOWN_GLOBALS = new Set([
  // 平台
  'chrome', 'BGTStore', 'BGTI18N', 'tr', 'window', 'document', 'navigator', 'localStorage',
  'console', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'fetch',
  'URL', 'URLSearchParams', 'Blob', 'FileReader', 'TextEncoder', 'TextDecoder', 'crypto',
  'Intl', 'JSON', 'Math', 'Date', 'Promise', 'Map', 'Set', 'WeakMap', 'Object', 'Array',
  'String', 'Number', 'Boolean', 'Symbol', 'Error', 'TypeError', 'RegExp', 'Function',
  'requestAnimationFrame', 'cancelAnimationFrame', 'queueMicrotask', 'structuredClone',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent', 'decodeURIComponent',
  'define', 'require', 'module', 'exports', 'process', 'globalThis', 'self', 'importScripts',
  'alert', 'confirm', 'prompt', 'getComputedStyle', 'matchMedia', 'DOMException',
  'AbortController', 'Headers', 'Request', 'Response', 'atob', 'btoa', 'CustomEvent', 'Event',
  'Image', 'FormData', 'File', 'Notification', 'performance', 'caches', 'indexedDB',
  'Uint8Array', 'Int8Array', 'Uint16Array', 'Uint32Array', 'Float64Array', 'ArrayBuffer',
  'ArrayBuffer', 'TextDecoderStream', 'ResizeObserver', 'IntersectionObserver', 'MutationObserver',
]);

/** 这些是语法关键字,不是标识符调用 */
const NOT_IDENTIFIERS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'new', 'delete', 'void',
  'in', 'of', 'do', 'else', 'try', 'finally', 'function', 'class', 'await', 'yield',
  'async', 'import', 'super', 'this',
]);

/** `/` 是正则字面量还是除号:看前一个有意义字符 */
function regexAllowedAt(out) {
  const t = out.replace(/\s+$/, '');
  if (!t) return true;
  const last = t[t.length - 1];
  if ('(,=:[!&|?{};+-*%~^<>'.indexOf(last) >= 0) return true;
  return /(?:^|[^\w$])(return|typeof|case|in|of|new|delete|void|do|else|yield|await|instanceof)$/.test(t);
}

function stripCommentsAndStrings(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  // 吞掉 [from, i) 区间,但原样补回其中的换行 —— 保证报出的行号与源文件一致
  const swallowNewlines = (from) => {
    let k = 0;
    for (let j = from; j < i; j += 1) if (src[j] === '\n') k += 1;
    if (k) out += '\n'.repeat(k);
  };
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (c === '/' && c2 === '/') { while (i < n && src[i] !== '\n') i += 1; continue; }
    if (c === '/' && c2 === '*') {
      const from = i;
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i += 1;
      i += 2;
      swallowNewlines(from);
      continue;
    }
    if (c === '/' && regexAllowedAt(out)) {
      const from = i;
      // 正则字面量:跳过到未转义的收尾 /,并吃掉 flags
      i += 1;
      let inClass = false;
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '[') inClass = true;
        else if (src[i] === ']') inClass = false;
        else if (src[i] === '/' && !inClass) { i += 1; break; }
        else if (src[i] === '\n') break;
        i += 1;
      }
      while (i < n && /[a-z]/i.test(src[i])) i += 1;
      swallowNewlines(from);
      out += '/re/';
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const from = i;
      const q = c; i += 1;
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === q) { i += 1; break; }
        i += 1;
      }
      swallowNewlines(from);
      out += '""';
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

function collectDeclared(src) {
  const names = new Set();
  const add = (re, group) => {
    let m;
    while ((m = re.exec(src))) names.add(m[group || 1]);
  };
  add(/\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)/g);
  add(/\bclass\s+([A-Za-z_$][\w$]*)/g);
  add(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g);
  add(/^\s*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/gm); // 对象方法简写 acceptNode(node) {
  // import { a, b as c } / import d from / import * as e
  const impRe = /\bimport\s+([\s\S]*?)\bfrom\b/g;
  let m;
  while ((m = impRe.exec(src))) {
    const clause = m[1];
    const braced = clause.match(/\{([\s\S]*?)\}/);
    if (braced) {
      for (const part of braced[1].split(',')) {
        const t = part.trim();
        if (!t) continue;
        const asM = t.match(/\bas\s+([A-Za-z_$][\w$]*)$/);
        names.add(asM ? asM[1] : t.split(/\s+/)[0]);
      }
    }
    const star = clause.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/);
    if (star) names.add(star[1]);
    const def = clause.replace(/\{[\s\S]*?\}/, '').replace(/\*[\s\S]*$/, '').trim().replace(/,$/, '');
    if (def && /^[A-Za-z_$][\w$]*$/.test(def)) names.add(def);
  }
  // 解构参数 / 解构赋值:({ a, b }) 与 const { a, b } =
  const destrRe = /[{,]\s*([A-Za-z_$][\w$]*)\s*(?:[,}]|=[^=])/g;
  while ((m = destrRe.exec(src))) names.add(m[1]);
  // catch (e) / 箭头与函数参数:宽松收集所有 `(a, b) =>` 与 `function (a, b)` 的参数名
  const paramRe = /\(([^()]*)\)\s*(?:=>|\{)/g;
  while ((m = paramRe.exec(src))) {
    for (const p of m[1].split(',')) {
      const t = p.trim().replace(/^\.\.\./, '').split(/[=:]/)[0].trim();
      if (/^[A-Za-z_$][\w$]*$/.test(t)) names.add(t);
    }
  }
  return names;
}

function findCalls(src, declared) {
  const bad = [];
  const re = /(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g;
  let m;
  while ((m = re.exec(src))) {
    const name = m[1];
    if (declared.has(name) || KNOWN_GLOBALS.has(name) || NOT_IDENTIFIERS.has(name)) continue;
    const line = src.slice(0, m.index).split('\n').length;
    bad.push({ name, line, kind: '未声明' });
  }
  return bad;
}

function walk(dir, acc) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.js$/.test(e.name)) acc.push(p);
  }
  return acc;
}

const files = walk(path.join(ROOT, 'manager'), [])
  .concat([path.join(ROOT, 'background.js'),
    path.join(ROOT, 'popup', 'popup.js'),
    path.join(ROOT, 'sidepanel', 'sidepanel.js'),
    path.join(ROOT, 'shared', 'store.js'),
    path.join(ROOT, 'shared', 'i18n.js')]);

let problems = 0;
for (const f of files) {
  if (!fs.existsSync(f)) continue;
  const raw = fs.readFileSync(f, 'utf8');
  const src = stripCommentsAndStrings(raw);
  const declared = collectDeclared(src);
  const bad = findCalls(src, declared);
  const uniq = new Map();
  for (const b of bad) if (!uniq.has(b.name)) uniq.set(b.name, b);
  if (uniq.size) {
    problems += uniq.size;
    console.log('\n✗ ' + path.relative(ROOT, f));
    for (const [name, b] of uniq) console.log('   L' + b.line + '  未声明却作为函数调用: ' + name + '()');
  }
}

console.log(problems
  ? '\n发现 ' + problems + ' 处未声明调用'
  : '\n✓ 未发现未声明标识符调用');
process.exit(problems ? 1 : 0);
