/**
 * Tab Harbor — 数据层性能基准(node test/perf.js)
 *
 * 两处刻意的设计,都是被真实假失败教出来的
 * ------------------------------------------------
 * ① 判定用**相对基线**而不是绝对毫秒。
 *    v3.11.3 的发布门禁曾被 `topHosts: 30.4ms exceeds 30ms` 挡下 —— 典型值 24ms 配 30ms 上限,
 *    余量只有 25%。绝对墙钟阈值在负载波动的机器上必然假失败,而假失败的门禁会被绕过,
 *    比没有门禁更糟。
 *    现在:best <= baseline × 3.0(硬上限 ×10),基线记录在 test/perf-baseline.json。
 *    3x 容差让机器差异(通常 <2x)不误报,但数量级回归(缓存失效、复杂度写错)必被抓。
 *
 * ② 基准间**轮转测量**,每个基准取多轮最小值。
 *    原先的顺序测量里,前一个基准产生的垃圾会在后一个基准的每一轮里触发 GC,
 *    实测同一台机器上 `buildUrlIdentity 二次调用` 在两次运行间从 ×0.39 摆到 ×2.67。
 *    轮转把 GC 影响摊平,再取各轮最小值,才能得到可比的数字。
 *
 * 换机器或有意优化后:node test/perf.js --update-baseline
 */
'use strict';

const fs = require('fs');
const path = require('path');
const BGTStore = require('../shared/store.js').BGTStore;
const { performance } = require('perf_hooks');
const assert = require('assert');

const BASELINE_PATH = path.join(__dirname, 'perf-baseline.json');
const TOLERANCE = 3.0;  // 相对基线:放宽倍率(容忍机器差异)
const HARD = 10.0;      // 相对基线:硬上限(捕捉病态回归)
const ROUNDS = 4;       // 轮转轮数,每轮每个基准各跑一次

const GROUPS = 200;
const TABS_PER_GROUP = 15;   // 3000 标签
const RECORDS = 300;
const TABS_PER_RECORD = 20;  // 6000 标签(与工作区重叠)

let passed = 0, failed = 0;

/* ---- 合成大库 ---- */
function makeData(tag) {
  const groups = [];
  for (let g = 0; g < GROUPS; g += 1) {
    const tabs = [];
    for (let i = 0; i < TABS_PER_GROUP; i += 1) {
      tabs.push({
        id: tag + 'g' + g + 't' + i,
        url: 'https://site' + (g % 40) + '.example.com/' + tag + '/path' + g + '/' + i + '?utm_source=x',
        title: 'Site ' + g + ' tab ' + i,
        savedAt: Date.now() - g * 3600e3,
      });
    }
    groups.push(BGTStore.normalizeGroup({ id: tag + 'g' + g, title: '分组 ' + g, createdAt: Date.now() - g * 86400e3, tabs }));
  }
  const records = [];
  for (let r = 0; r < RECORDS; r += 1) {
    const tabs = [];
    for (let i = 0; i < TABS_PER_RECORD; i += 1) {
      tabs.push({ id: tag + 'r' + r + 't' + i, url: 'https://site' + (r % 40) + '.example.com/' + tag + '/r' + r + '/' + i, title: 'Rec ' + r + ' ' + i, savedAt: Date.now() - r * 3600e3 });
    }
    records.push(BGTStore.makeRecord({ id: tag + 'r' + r, title: '记录 ' + r, createdAt: Date.now() - r * 3600e3, tabs }));
  }
  return BGTStore.normalizeData({ groups, workspaces: [], records });
}

const big = makeData('main');   // 9000 个不同 URL,可完整放进 1 万条归一化缓存

// 预热:先把大库灌进归一化缓存,让"热缓存"基准名副其实
BGTStore.buildUrlIdentity(big);

/* ---- 基准定义 ----
   注意:这里**不再**单独跑"冷缓存"基准。原因是实测发现:额外灌入几千个全新 URL
   会把 1 万条上限的缓存挤爆,导致随后的"热缓存"基准其实每次都全量重解析
   (实测 27ms → 674ms),测出来的不是热路径而是 GC 抖动。
   冷路径的固有成本由"缓存容量边界"那一项确定性测试来守,不用计时阈值。 */
const BENCHES = [
  ['buildUrlIdentity(热缓存:同一大库重复解析)',
    () => BGTStore.buildUrlIdentity(big),
    () => BGTStore.buildUrlIdentity(big)],   // 计时前重新预热,确保缓存里是大库这一份
  ['diffTabs(1000 标签集)',
    () => BGTStore.diffTabs(big.groups.slice(0, 8).flatMap((g) => g.tabs), big.records.slice(0, 500).flatMap((r) => r.tabs))],
  ['weeklyReport(300 条记录)', () => BGTStore.weeklyReport(big)],
  ['topHosts(大库)', () => BGTStore.topHosts(big, 8)],
  ['similarGroups(200 组两两比较)', () => BGTStore.similarGroups(big, 0.8)],
];

/* ---- 轮转测量:每轮每个基准各跑一次,各基准取多轮最小值 ---- */
const best = {};
for (const [name] of BENCHES) best[name] = Infinity;
for (let round = 0; round < ROUNDS; round += 1) {
  for (const [name, fn, warmup] of BENCHES) {
    if (warmup) warmup();
    const t0 = performance.now();
    fn();
    const dt = performance.now() - t0;
    if (dt < best[name]) best[name] = dt;
  }
}
const measured = {};
for (const [name] of BENCHES) measured[name] = Number(best[name].toFixed(3));

const updateMode = process.argv.indexOf('--update-baseline') >= 0;

if (updateMode) {
  const out = {
    note: '参考机器上的基线。判定 = best <= baseline × ' + TOLERANCE + '(硬上限 ×' + HARD + ')。'
      + '换机器或有意优化后执行 node test/perf.js --update-baseline 重记。',
    recordedAt: new Date().toISOString(),
    node: process.version,
    tolerance: TOLERANCE,
    hard: HARD,
    rounds: ROUNDS,
    metrics: measured,
  };
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(out, null, 2) + '\n');
  console.log('已记录基线到 test/perf-baseline.json:');
  for (const [k, v] of Object.entries(measured)) console.log('  ' + v.toFixed(1) + 'ms  ' + k);
  process.exit(0);
}

let baseline = { metrics: {} };
try { baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8')); } catch (e) { /* 下面逐项报缺失 */ }

for (const [name] of BENCHES) {
  const val = measured[name];
  const base = baseline.metrics && baseline.metrics[name];
  if (!base) {
    failed += 1;
    console.error('  FAIL ' + name + ': 基线缺失 —— 先执行 node test/perf.js --update-baseline');
    continue;
  }
  const ratio = val / base;
  const limit = base * TOLERANCE;
  if (val <= limit) {
    passed += 1;
    console.log('  PASS ' + name + ': ' + val.toFixed(1) + 'ms (基线 ' + base.toFixed(1)
      + 'ms ×' + ratio.toFixed(2) + ', 上限 ' + limit.toFixed(0) + 'ms)');
  } else {
    failed += 1;
    console.error('  FAIL ' + name + ': ' + val.toFixed(1) + 'ms 超过基线 ' + base.toFixed(1)
      + 'ms 的 ' + TOLERANCE + 'x(' + limit.toFixed(0) + 'ms),倍率 ×' + ratio.toFixed(2));
  }
}

function test(name, fn) {
  try { fn(); passed += 1; console.log('  PASS', name); }
  catch (e) { failed += 1; console.error('  FAIL', name, '\n       ', e && e.message); }
}

test('归一化缓存生效:同 URL 重复解析返回同一对象(命中缓存)', () => {
  const a = BGTStore.normalizeUrl('https://cache-check.example.com/x?utm_source=t#f');
  const b = BGTStore.normalizeUrl('https://cache-check.example.com/x?utm_source=t#f');
  if (a !== b) throw new Error('cache miss: same URL returned different objects');
});

/* 缓存容量是真问题,所以用确定性断言守、不用计时阈值:
   上限 1 万条且按插入序逐出,意味着库的**不同 URL 总数**一旦超过 1 万,
   热条目会被批量操作/大库首屏挤掉,"热路径 15ms"就不再成立(实测 27ms → 674ms)。
   这里断言的是"有界性"(不会无界增长),同时把该边界钉成可回归的事实。 */
test('归一化缓存有界:灌入超过上限的不同 URL 后旧条目被淘汰', () => {
  const probe = 'https://cap-probe.example.com/keep';
  const before = BGTStore.normalizeUrl(probe);
  for (let i = 0; i < 11000; i += 1) BGTStore.normalizeUrl('https://cap.example.com/x' + i);
  const after = BGTStore.normalizeUrl(probe);
  assert.notStrictEqual(before, after, '超出容量后应淘汰旧条目(否则缓存无界增长)');
});

test('序列化体积:大库 JSON < 6MB(300 记录上限下)且 storage 配额安全', () => {
  const json = JSON.stringify(BGTStore.normalizeData(big));
  const mb = json.length / 1024 / 1024;
  assert(mb < 6, '实际 ' + mb.toFixed(2) + 'MB');
});

test('normalizeRecord 上限裁剪:records 恒 ≤ 300', () => {
  const d = BGTStore.normalizeData({ records: Array.from({ length: 500 }, (_, i) => ({ id: 'x' + i, title: 't', tabs: [] })) });
  assert.strictEqual(d.records.length, 300);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
