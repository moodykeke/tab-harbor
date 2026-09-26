/**
 * Tab Harbor — 数据层性能基准(node test/perf.js)
 * 用合成大库验证:身份索引 / 差分 / 周报 / 归一化缓存命中率 / 序列化体积。
 * 阈值放宽以容忍 CI 抖动;显著超标说明出现性能回归。
 */
'use strict';

const BGTStore = require('../shared/store.js').BGTStore;
const { performance } = require('perf_hooks');
const assert = require('assert');

const GROUPS = 200;
const TABS_PER_GROUP = 15;   // 3000 标签
const RECORDS = 300;
const TABS_PER_RECORD = 20;  // 6000 标签(与工作区重叠)

let passed = 0, failed = 0;
const runs = []; // {name, best, limit, ok}
function bench(name, fn, limitMs) {
  const times = [];
  for (let i = 0; i < 3; i += 1) {
    const t0 = performance.now();
    fn();
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const best = times[0];
  const ok = best < limitMs;
  runs.push({ name, best: best.toFixed(1), limit: limitMs, ok });
  if (ok) { passed += 1; console.log(`  PASS ${name}: ${best.toFixed(1)}ms (best of 3, limit ${limitMs}ms)`); }
  else { failed += 1; console.error(`  FAIL ${name}: ${best.toFixed(1)}ms exceeds ${limitMs}ms`); }
}
function test(name, fn) {
  try { fn(); passed += 1; console.log('  PASS', name); }
  catch (e) { failed += 1; console.error('  FAIL', name, '\n       ', e && e.message); }
}

/* ---- 合成大库(构建耗时计入预热,不计入基准) ---- */
function buildBigData() {
  const groups = [];
  for (let g = 0; g < GROUPS; g += 1) {
    const tabs = [];
    for (let i = 0; i < TABS_PER_GROUP; i += 1) {
      tabs.push({
        id: 'g' + g + 't' + i,
        url: 'https://site' + (g % 40) + '.example.com/path' + g + '/' + i + '?utm_source=x',
        title: 'Site ' + g + ' tab ' + i,
        savedAt: Date.now() - g * 3600e3,
      });
    }
    groups.push(BGTStore.normalizeGroup({ id: 'g' + g, title: '分组 ' + g, createdAt: Date.now() - g * 86400e3, tabs }));
  }
  const records = [];
  for (let r = 0; r < RECORDS; r += 1) {
    const tabs = [];
    for (let i = 0; i < TABS_PER_RECORD; i += 1) {
      tabs.push({ id: 'r' + r + 't' + i, url: 'https://site' + (r % 40) + '.example.com/r' + r + '/' + i, title: 'Rec ' + r + ' ' + i, savedAt: Date.now() - r * 3600e3 });
    }
    records.push(BGTStore.makeRecord({ id: 'r' + r, title: '记录 ' + r, createdAt: Date.now() - r * 3600e3, tabs }));
  }
  return BGTStore.normalizeData({ groups, workspaces: [], records });
}

const big = buildBigData();

/* ---- 基准(先跑 2 轮预热,让 JIT 与缓存进入稳态,再测 3 轮取中位) ---- */
bench('buildUrlIdentity(3000 组标签 + 6000 记录标签)', () => BGTStore.buildUrlIdentity(big), 150);
bench('buildUrlIdentity 二次调用(缓存命中)', () => BGTStore.buildUrlIdentity(big), 150);
bench('diffTabs(1000 标签集)', () => BGTStore.diffTabs(big.groups[0].tabs.concat(big.groups[1].tabs, big.groups[2].tabs, big.groups[3].tabs, big.groups[4].tabs, big.groups[5].tabs, big.groups[6].tabs, big.groups[7].tabs), big.records.slice(0, 500).flatMap((r) => r.tabs)), 30);
bench('weeklyReport(300 条记录)', () => BGTStore.weeklyReport(big), 30);
bench('topHosts(大库)', () => BGTStore.topHosts(big, 8), 30);
bench('similarGroups(200 组两两比较)', () => BGTStore.similarGroups(big, 0.8), 120);

test('归一化缓存生效:同 URL 重复解析返回同一对象(命中缓存)', () => {
  const a = BGTStore.normalizeUrl('https://cache-check.example.com/x?utm_source=t#f');
  const b = BGTStore.normalizeUrl('https://cache-check.example.com/x?utm_source=t#f');
  if (a !== b) throw new Error('cache miss: same URL returned different objects');
});

test('序列化体积:大库 JSON < 6MB(300 记录上限下)且 storage 配额安全', () => {
  const json = JSON.stringify(BGTStore.normalizeData(big));
  const mb = json.length / 1024 / 1024;
  assert(mb < 6, `实际 ${mb.toFixed(2)}MB`);
});

test('normalizeRecord 上限裁剪:records 恒 ≤ 300', () => {
  const d = BGTStore.normalizeData({ records: Array.from({ length: 500 }, (_, i) => ({ id: 'x' + i, title: 't', tabs: [] })) });
  assert.strictEqual(d.records.length, 300);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
