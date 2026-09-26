/**
 * Tab Harbor — 全量测试入口:node tools/test-all.js
 *
 * 依次跑六套 + 一道静态门禁,汇总为一份可贴进审核材料的报告,
 * 任一失败即以非零退出(可直接作为发布门禁)。
 *
 * 也作为模块被 tools/pack.js 复用:runAll() 返回 { ok, suites, report }。
 */
'use strict';

const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

/** 顺序即发布门禁顺序:先静态门禁,再数据层,最后接缝层 */
const SUITES = [
  { name: 'Lint(未声明标识符)', file: 'tools/check-globals.js' },
  { name: 'Unit(store 纯函数)', file: 'test/test-store.js' },
  { name: 'Performance(基准)', file: 'test/perf.js' },
  { name: 'i18n(穷尽式)', file: 'test/i18n.js' },
  { name: 'Integration(链路)', file: 'test/integration.js' },
  { name: 'SW 路由/接线', file: 'test/sw-routes.js' },
  { name: 'Seam(静态契约)', file: 'test/seams.js' },
];

function countsFrom(out) {
  const m = /(\d+)\s+passed,\s+(\d+)\s+failed/.exec(out);
  return m ? { passed: Number(m[1]), failed: Number(m[2]) } : null;
}

function runAll(opts) {
  opts = opts || {};
  const suites = [];
  let ok = true;
  for (const s of SUITES) {
    let out = '';
    let code = 0;
    try {
      out = execFileSync(process.execPath, [s.file], { cwd: ROOT, encoding: 'utf8' });
    } catch (e) {
      code = e.status == null ? 1 : e.status;
      out = String((e.stdout || '') + (e.stderr || ''));
    }
    const c = countsFrom(out);
    const suiteOk = code === 0;
    if (!suiteOk) ok = false;
    suites.push({ name: s.name, file: s.file, ok: suiteOk, code, counts: c, out });
    if (!opts.quiet) {
      process.stdout.write('### ' + s.name + ' (' + s.file + ')\n');
      process.stdout.write(out.replace(/^\s+|\s+$/g, '') + '\n\n');
    }
  }

  const lines = [];
  lines.push('Tab Harbor — 发布门禁报告');
  lines.push('生成时间: ' + new Date().toISOString());
  lines.push('Node: ' + process.version);
  lines.push('');
  let totalP = 0;
  let totalF = 0;
  for (const s of suites) {
    const c = s.counts;
    if (c) { totalP += c.passed; totalF += c.failed; }
    const detail = c ? '(' + c.passed + ' passed, ' + c.failed + ' failed)' : '(exit ' + s.code + ')';
    lines.push((s.ok ? 'PASS  ' : 'FAIL  ') + s.name + ': ' + detail);
  }
  lines.push('');
  lines.push('合计: ' + totalP + ' passed, ' + totalF + ' failed / ' + suites.length + ' 套');
  lines.push(ok ? '结论: 全部通过,可发布' : '结论: 存在失败项,禁止发布');
  lines.push('(逐套完整输出见各脚本 stdout;复现: node tools/test-all.js)');
  const report = lines.join('\n') + '\n';

  return { ok, suites, report };
}

if (require.main === module) {
  const r = runAll();
  process.stdout.write('\n' + r.report);
  process.exit(r.ok ? 0 : 1);
}

module.exports = { runAll, SUITES };
