/**
 * Tab Harbor — Syntax(全量 JS 编译):node test/syntax.js
 *
 * 为什么需要它
 * ------------
 * v3.24.0 的 actions.js 里,一个字符串字面量在中间断了行(join('<换行>')),
 * 整个管理页模块图从那一版起加载即失败 —— 而 8 套门禁全绿:
 *   1) 没有任何一套真正"编译"过 manager/popup/sidepanel 的 JS(集成测试只跑 SW 侧);
 *   2) `node --check` 在 Node 22.9 上对 ESM 文件不做真实解析(实测:同一个坏文件,
 *      CJS 目标 exit=1,ESM 目标 exit=0)—— 不能指望它。
 *
 * 做法:子进程开 --experimental-vm-modules,对仓库每个 JS 文件用 vm 真编译:
 *   先按经典脚本目标编译;失败且报 import/export 位置问题时,再按 ESM 目标
 *   (vm.SourceTextModule,只 parse 不 link 不执行)编译;两个目标都失败才算失败。
 * 每个文件一条断言,输出口径与其余套件一致("N passed, M failed")。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

/* 递归收集要检查的 JS(跳过 node_modules/.git/skills/store-assets/icons/docs) */
const SKIP_DIRS = new Set(['node_modules', '.git', 'skills', 'store-assets', 'icons', 'docs', '.github']);
const ROOT_JS = ['background.js', 'dev-server.js'];

function walk(dir, acc) {
  for (const name of fs.readdirSync(dir).sort()) {
    if (SKIP_DIRS.has(name)) continue;
    const abs = path.join(dir, name);
    const st = fs.statSync(abs);
    if (st.isDirectory()) walk(abs, acc);
    else if (name.endsWith('.js')) acc.push(abs);
  }
  return acc;
}

function collectFiles() {
  const acc = ROOT_JS.filter((f) => fs.existsSync(path.join(ROOT, f))).map((f) => path.join(ROOT, f));
  for (const d of ['shared', 'manager', 'popup', 'sidepanel', 'test', 'tools']) {
    walk(path.join(ROOT, d), acc);
  }
  return acc;
}

/** 子进程内执行:返回 { passed, failed, details }。文件清单经 BGT_FILES 环境变量传入
 *  (-e 模式下 process.argv 的偏移不可靠)。 */
const CHILD = `(function () {
  const fs = require('fs');
  const path = require('path');
  const vm = require('vm');
  const files = JSON.parse(process.env.BGT_FILES);
  let passed = 0, failed = 0; const details = [];
  for (const f of files) {
    const rel = path.relative(process.cwd(), f).split(path.sep).join('/');
    const src = fs.readFileSync(f, 'utf8');
    let err1 = null, err2 = null;
    try { new vm.Script(src, { filename: rel }); }
    catch (e) { err1 = e; }
    if (err1) {
      try { new vm.SourceTextModule(src, { identifier: rel }); err1 = null; }
      catch (e) { err2 = e; }
    }
    if (!err1 && !err2) { passed += 1; }
    else {
      failed += 1;
      const e = err2 || err1;
      const loc = (e.stack || '').split('\\n').filter(function (l) { return l.indexOf(rel) >= 0; })[0] || '';
      details.push('FAIL ' + rel + ' — ' + e.message + (loc ? ' (' + loc.trim().split(' ')[0] + ')' : ''));
    }
  }
  console.log('  ' + passed + ' passed, ' + failed + ' failed');
  for (const d of details) console.log('  ' + d);
  process.exit(failed ? 1 : 0);
})();`;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log('  PASS', name); }
  catch (e) { failed += 1; console.error('  FAIL', name, '\n       ', e && e.message); }
}

const files = collectFiles();

test('子进程 vm 编译全部 ' + files.length + ' 个 JS 文件(经典脚本或 ESM,两目标择一通过)', () => {
  let out = '';
  try {
    out = execFileSync(process.execPath, ['--experimental-vm-modules', '-e', CHILD], {
      cwd: ROOT,
      encoding: 'utf8',
      env: Object.assign({}, process.env, { BGT_FILES: JSON.stringify(files) }),
    });
  } catch (e) {
    // 子进程 exit 1 = 存在编译不过的文件;把逐文件明细透出
    out = String((e.stdout || '') + (e.stderr || ''));
    const detail = out.trim().split('\n').filter((l) => l.indexOf('FAIL') >= 0).join('\n       ');
    throw new Error(detail || out.trim() || (e.message || '子进程失败'));
  }
  process.stdout.write(out);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
