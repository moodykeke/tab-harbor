/**
 * 静态接缝检查:node test/seams.js
 *
 * 与 test/sw-routes.js 的分工:那一套在运行时驱动真实 background.js;
 * 这一套在源码层面守住三条"契约",防止接线再次悄悄错位:
 *
 *   A. UI → SW 路由契约:界面发出去的每个 action,SW 都必须有 case 分支;
 *      反过来 SW 新增的每个 case 都必须在契约清单里(否则等于没测试覆盖)。
 *   B. mock ↔ 生产一致性:mock-chrome 必须镜像 SW 的路由集合,
 *      差异只能来自显式豁免表(并写明理由)。v3.11.2 的 allWindows 缺陷
 *      正是被"mock 比生产更正确"掩盖的。
 *   C. DOM id 契约:JS 里 $('#id') 引用的 id 必须存在于对应 HTML
 *      (或在同一份 JS 里被动态创建)。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log('  PASS', name);
  } catch (e) {
    failed += 1;
    failures.push(name);
    console.error('  FAIL', name, '\n       ', e && e.message);
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

/* ---------------- 源码扫描工具 ---------------- */

/** 取出 `callee(` 的括号内原文(跳过字符串里的括号,保证配平) */
function callArgs(src, callee) {
  const out = [];
  let idx = 0;
  while ((idx = src.indexOf(callee + '(', idx)) >= 0) {
    const prev = src[idx - 1];
    if (prev && /[\w$.]/.test(prev)) { idx += callee.length; continue; }
    let i = idx + callee.length;
    const start = i;
    let depth = 0;
    for (; i < src.length; i += 1) {
      const c = src[i];
      if (c === "'" || c === '"' || c === '`') {
        const q = c; i += 1;
        while (i < src.length && src[i] !== q) { if (src[i] === '\\') i += 1; i += 1; }
        continue;
      }
      if (c === '(') depth += 1;
      else if (c === ')') { depth -= 1; if (depth === 0) break; }
    }
    out.push(src.slice(start, i));
    idx = i;
  }
  return out;
}

function literals(s) {
  const out = [];
  let m;
  const re = /'([A-Za-z][A-Za-z0-9_]*)'/g;
  while ((m = re.exec(s))) out.push(m[1]);
  return out;
}

/**
 * 从 action 表达式里取出真正的 action 名字。
 * 形如 `kind === 'all' ? 'saveAllWindows' : 'saveWindow'`,
 * 以及嵌套的 `kind === 'test' ? 'cloudTest' : kind === 'now' ? …`,
 * 里面的 'all' / 'test' / 'now' 是比较条件而不是 action,必须先剥掉。
 */
function actionLiterals(expr) {
  const cleaned = expr.replace(/[=!]==?\s*'[^']*'|'[^']*'\s*[=!]==?/g, ' ');
  return literals(cleaned);
}

const UI_FILES = [
  'manager/modules/actions.js', 'manager/modules/settings.js', 'manager/modules/events.js',
  'manager/modules/render.js', 'manager/modules/ui.js', 'manager/modules/dnd.js',
  'manager/modules/ops.js', 'manager/modules/core.js', 'manager/manager.js',
  'popup/popup.js', 'sidepanel/sidepanel.js',
];

/** UI 侧实际发出的 action 名 */
function uiActions() {
  const set = new Set();
  for (const f of UI_FILES) {
    if (!fs.existsSync(path.join(ROOT, f))) continue;
    const src = read(f);
    // 1) send({ action: <expr> }) —— 只看 action: 后面的表达式(可含三元),
    //    不能把实参里的其它字面量(如 mode: 'current'、kind === 'all')当成 action
    for (const args of callArgs(src, 'send')) {
      const m = /(?:^|[{,\s])action\s*:\s*([^,}]*)/.exec(args);
      if (m) for (const l of actionLiterals(m[1])) set.add(l);
    }
    // 2) const action = ... ? 'x' : 'y'  —— 先赋值再透传 send({ action })
    const assignRe = /(?:const|let|var)\s+action\s*=[^;]*/g;
    let m;
    while ((m = assignRe.exec(src))) for (const l of actionLiterals(m[0])) set.add(l);
  }
  return set;
}

/** SW 的 case 分支集合 */
function swActions() {
  const src = read('background.js');
  const set = new Set();
  let m;
  const re = /case\s+'([A-Za-z][A-Za-z0-9_]*)'\s*:/g;
  while ((m = re.exec(src))) set.add(m[1]);
  return set;
}

/** mock-chrome 处理的 action 集合 */
function mockActions() {
  const src = read('shared/mock-chrome.js');
  const set = new Set();
  let m;
  const re = /msg\.action\s*===\s*'([A-Za-z][A-Za-z0-9_]*)'/g;
  while ((m = re.exec(src))) set.add(m[1]);
  return set;
}

/**
 * 契约清单:SW 路由的权威集合。
 * 新增 SW 路由必须同时登记在这里,否则下面的断言会失败 —— 这是刻意的:
 * 没有登记的 route 就等于没有测试覆盖(v3.11.2 的教训)。
 */
const SW_CONTRACT = [
  'saveWindow', 'saveAllWindows', 'openManager', 'openSidePanel',
  'saveWorkspace', 'restoreWorkspace', 'renameGroup', 'renameWorkspace',
  'cloudTest', 'cloudBackupNow', 'cloudRestore', 'restoreGroup',
];

/**
 * 预览模式有意不模拟的 action。
 * 每条都要写明理由:mock 与生产不一致本身不是缺陷,未声明的差异才是。
 */
const PREVIEW_UNSUPPORTED = {
  openSidePanel: '侧边栏属浏览器 UI,预览页无法模拟;popup 已回退打开管理页',
  cloudTest: '预览环境无网络,无法探测 WebDAV 连通性;UI 会呈现失败',
  cloudBackupNow: '预览环境无网络,无法真正上传;云端信封形状由 sw-routes 覆盖',
  cloudRestore: '预览环境无网络,无法下载远端备份;信任链由 sw-routes 覆盖',
};

/* ---------------- A. UI → SW 路由契约 ---------------- */

test('A1. UI 发出的每个 action 在 SW 里都有 case 分支', () => {
  const sw = swActions();
  const missing = Array.from(uiActions()).filter((a) => !sw.has(a));
  assert(missing.length === 0, 'UI 会发送但 SW 不处理: ' + missing.join(', '));
});

test('A2. SW 的 case 集合与契约清单一致(新增路由必须登记)', () => {
  const sw = swActions();
  const extra = Array.from(sw).filter((a) => SW_CONTRACT.indexOf(a) < 0);
  const gone = SW_CONTRACT.filter((a) => !sw.has(a));
  assert(extra.length === 0, 'SW 有未登记进契约清单的路由: ' + extra.join(', '));
  assert(gone.length === 0, '契约清单里有 SW 已移除的路由: ' + gone.join(', '));
});

/* ---------------- B. mock ↔ 生产一致性 ---------------- */

test('B1. mock 覆盖 SW 路由减去显式豁免表', () => {
  const sw = swActions();
  const mock = mockActions();
  const missing = Array.from(sw).filter((a) => !mock.has(a) && !PREVIEW_UNSUPPORTED[a]);
  assert(missing.length === 0,
    'mock 未模拟且未在豁免表声明: ' + missing.join(', ') + '(mock 与生产分歧会让预览给出假信心)');
});

test('B2. mock 不处理 SW 不存在或已豁免的路由', () => {
  const sw = swActions();
  const mock = mockActions();
  const bogus = Array.from(mock).filter((a) => !sw.has(a));
  assert(bogus.length === 0, 'mock 处理了 SW 没有的路由: ' + bogus.join(', '));
  const pointless = Array.from(mock).filter((a) => PREVIEW_UNSUPPORTED[a]);
  assert(pointless.length === 0, '已在豁免表声明却被 mock 实现了: ' + pointless.join(', '));
});

test('B3. 豁免表每条都写明理由', () => {
  for (const [action, reason] of Object.entries(PREVIEW_UNSUPPORTED)) {
    assert(typeof reason === 'string' && reason.length >= 8, action + ' 的豁免理由过短');
  }
});

/* ---------------- C. DOM id 契约 ---------------- */

const PAGES = [
  { name: 'manager', html: 'manager/manager.html', dir: 'manager/modules', extra: ['manager/manager.js'] },
  { name: 'popup', html: 'popup/popup.html', dir: null, extra: ['popup/popup.js'] },
  { name: 'sidepanel', html: 'sidepanel/sidepanel.html', dir: null, extra: ['sidepanel/sidepanel.js'] },
];

function pageJs(page) {
  const files = page.extra.slice();
  if (page.dir) {
    for (const f of fs.readdirSync(path.join(ROOT, page.dir))) {
      if (f.endsWith('.js')) files.push(page.dir + '/' + f);
    }
  }
  return files.filter((f) => fs.existsSync(path.join(ROOT, f)));
}

for (const page of PAGES) {
  test('C. ' + page.name + ':JS 引用的 DOM id 都存在于 ' + path.basename(page.html), () => {
    const html = read(page.html);
    const htmlIds = new Set();
    let m;
    const idRe = /\bid\s*=\s*"([^"]+)"/g;
    while ((m = idRe.exec(html))) htmlIds.add(m[1]);

    const jsIds = new Set();      // 被 $('#id') 引用
    const createdIds = new Set(); // 被 JS 动态创建
    for (const f of pageJs(page)) {
      const src = read(f);
      const selRe = /\$\$?\(\s*'#([A-Za-z0-9_-]+)/g;
      while ((m = selRe.exec(src))) jsIds.add(m[1]);
      const mkRe = /\bid\s*:\s*'([A-Za-z0-9_-]+)'/g;
      while ((m = mkRe.exec(src))) createdIds.add(m[1]);
      // 动态拼接写法 $('#' + id):把疑似 id 的字面量也纳入检查
      if (src.indexOf("$('#' +") >= 0) {
        const litRe = /'(set[A-Z][A-Za-z0-9_]*)'/g;
        while ((m = litRe.exec(src))) jsIds.add(m[1]);
      }
    }

    const missing = Array.from(jsIds).filter((id) => !htmlIds.has(id) && !createdIds.has(id));
    assert(missing.length === 0,
      '选择器找不到对应 id(会在绑定时抛错): ' + missing.join(', '));
  });
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
