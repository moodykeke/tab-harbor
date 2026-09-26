/**
 * Garden(知识库通道)纯函数门禁:node test/garden.js
 * 覆盖:文件名安全 / Markdown 形状 / 托管区段纪律(WP-3.4 的核心)
 */
'use strict';

const assert = require('assert');
const { BGTGarden } = require('../shared/garden.js');

let passed = 0;
let failed = 0;
const queue = [];
function test(name, fn) { queue.push({ name, fn }); }
async function run() {
  for (const t of queue) {
    try { await t.fn(); passed += 1; console.log('  PASS', t.name); }
    catch (e) { failed += 1; console.error('  FAIL', t.name, '\n       ', e && e.message); }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

const { SECTION_BEGIN, SECTION_END } = BGTGarden;

test('safeFileName:路径符/控制符清洗、限长、兜底', () => {
  assert.strictEqual(BGTGarden.safeFileName('a/b\\c:d*e?f"g<h>i|j'), 'a b c d e f g h i j');
  assert.strictEqual(BGTGarden.safeFileName('  ..名字.  '), '名字', '首尾的点与空白都清(避免隐藏文件/Windows 保留形态)');
  assert.strictEqual(BGTGarden.safeFileName('x'.repeat(100)).length, 60);
  assert.strictEqual(BGTGarden.safeFileName(''), 'untitled');
  assert.strictEqual(BGTGarden.safeFileName(null), 'untitled');
});

test('groupMarkdown:链接清单 + 方括号转义 + 空分组兜底', () => {
  const md = BGTGarden.groupMarkdown({ title: 'T', tabs: [{ title: 'a[b]', url: 'https://a.com/x', savedAt: 0 }] });
  assert.ok(md.includes('# T'));
  assert.ok(md.includes('[a\\[b\\]](https://a.com/x)'), '方括号必须转义,否则链接断裂');
  const empty = BGTGarden.groupMarkdown({ title: 'E', tabs: [] });
  assert.ok(empty.includes('空分组'));
});

test('buildDailyEvidence:当天记录/摘录入选、归属项目、谱系标注、跨天不混入', () => {
  const today = new Date();
  const p = (n) => (n < 10 ? '0' + n : String(n));
  const key = today.getFullYear() + '-' + p(today.getMonth() + 1) + '-' + p(today.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const data = {
    workspaces: [{ id: 'w1', title: '项目A' }],
    records: [
      { createdAt: today.getTime(), title: 'R1', tabs: [{ title: 'T1', url: 'https://a.com/1', savedAt: today.getTime() }] },
      { createdAt: yesterday.getTime(), title: 'R旧', tabs: [{ title: '旧', url: 'https://a.com/old' }] },
    ],
    excerpts: [{ savedAt: today.getTime(), url: 'https://a.com/2', text: '关键结论', tabTitle: '文档', workspaceId: 'w1' }],
  };
  const r = BGTGarden.buildDailyEvidence(data, key, (url) => (url === 'https://a.com/1' ? 'v3' : ''));
  assert.ok(r.body.includes('R1'), '当天记录入选');
  assert.ok(!r.body.includes('R旧'), '跨天记录不得混入');
  assert.ok(r.body.includes('(v3 谱系)'), '多版本来源带谱系标注');
  assert.ok(r.body.includes('> 关键结论'), '摘录引用块');
  assert.ok(r.body.includes('项目:项目A'), '摘录显示归属项目');
});

test('托管区段:无标记时追加,标记成对出现', () => {
  const r = BGTGarden.applyManagedSection('# 我的日记\n\n今天写了点东西。\n', '证据正文\n');
  assert.strictEqual(r.replaced, false);
  assert.ok(r.content.startsWith('# 我的日记\n\n今天写了点东西。\n\n'));
  assert.ok(r.content.includes(SECTION_BEGIN + '\n证据正文\n' + SECTION_END));
});

test('托管区段(WP-3.4 核心):只替换两标记之间,标记外内容与标记本身逐字节保留', () => {
  const before = '# 日记\n\n头部内容,绝不能动。\n\n';
  const after = '\n尾部内容,也绝不能动。\n';
  const src = before + SECTION_BEGIN + '\n旧证据\n' + SECTION_END + after;
  const r = BGTGarden.applyManagedSection(src, '新证据\n');
  assert.strictEqual(r.replaced, true);
  assert.strictEqual(r.previousBody, '旧证据');
  assert.ok(r.content.startsWith(before), '标记之前必须逐字节保留');
  assert.ok(r.content.endsWith(after), '结束标记之后必须逐字节保留');
  const bi = r.content.indexOf(SECTION_BEGIN);
  const ei = r.content.lastIndexOf(SECTION_END);
  assert.ok(bi >= 0 && ei > bi, '标记必须原样存在');
  assert.strictEqual(r.content.slice(bi + SECTION_BEGIN.length + 1, ei).trim(), '新证据', '标记之间是新正文');
});

test('托管区段:正文不变时输出幂等(重导出无 diff)', () => {
  const src = '头\n\n' + SECTION_BEGIN + '\n同样正文\n' + SECTION_END + '\n尾';
  const r = BGTGarden.applyManagedSection(src, '同样正文\n');
  assert.strictEqual(r.content, '头\n\n' + SECTION_BEGIN + '\n同样正文\n' + SECTION_END + '\n尾');
});

test('dayKeyOf:本地时区 YYYY-MM-DD', () => {
  assert.strictEqual(BGTGarden.dayKeyOf(new Date(2026, 8, 27, 23, 59).getTime()), '2026-09-27');
  assert.strictEqual(BGTGarden.dayKeyOf(new Date(2026, 0, 5, 0, 0).getTime()), '2026-01-05');
});

run();
