/**
 * store.js 纯函数单元测试:node test/test-store.js
 */
'use strict';

const assert = require('assert');
const BGTStore = require('../shared/store.js').BGTStore;

let passed = 0;
let failed = 0;
const queue = [];

function test(name, fn) { queue.push({ name, fn }); }

async function run() {
  for (const t of queue) {
    try {
      await t.fn();
      passed += 1;
      console.log('  PASS', t.name);
    } catch (e) {
      failed += 1;
      console.error('  FAIL', t.name, '\n       ', e && e.message);
    }
  }
}

const SETTINGS_BASE = BGTStore.DEFAULT_SETTINGS;

/* ---- buildGroup:保存过滤 ---- */

test('buildGroup 去重/固定/特殊页/活动页过滤', () => {
  const tabs = [
    { url: 'https://a.com/', title: 'A', pinned: false },
    { url: 'https://a.com/', title: 'A 重复' },
    { url: 'https://b.com/', title: 'B', pinned: true },
    { url: 'chrome://extensions/', title: '扩展' },
    { url: 'about:blank', title: '空白' },
  ];
  const out = BGTStore.buildGroup(tabs, { ...SETTINGS_BASE, dedupe: true, excludePinned: true, skipSpecialPages: true })
    || { tabs: [] };
  assert.deepStrictEqual(out.tabs.map((t) => t.url), ['https://a.com/']);

  const keepPinned = BGTStore.buildGroup(tabs, { ...SETTINGS_BASE, dedupe: false, excludePinned: false, skipSpecialPages: false });
  assert.strictEqual(keepPinned.tabs.length, 4); // a, a重复, b(pinned), chrome://
});

test('buildGroup 排除当前活动页', () => {
  const tabs = [
    { url: 'https://a.com/', title: 'A', active: false },
    { url: 'https://b.com/', title: 'B' },
  ];
  const out = BGTStore.buildGroup(tabs, { ...SETTINGS_BASE, excludeActive: true }, { activeUrl: 'https://a.com/' });
  assert.deepStrictEqual(out.tabs.map((t) => t.url), ['https://b.com/']);
});

test('buildGroup 全部被过滤时返回 null', () => {
  const out = BGTStore.buildGroup([{ url: 'chrome://x/' }], { ...SETTINGS_BASE, skipSpecialPages: true });
  assert.strictEqual(out, null);
});

/* ---- migrateV1:v1 → v2 ---- */

test('migrateV1 迁移标题/时间/标签并继承 deleteTabOnOpen', () => {
  const v1 = [{
    id: 1700000000000,
    date: 1700000000000,
    title: '工作',
    tabs: [{ url: 'https://mail.google.com/', title: 'Gmail', favIconUrl: '', pinned: true }],
  }];
  const data = BGTStore.migrateV1(v1, { deleteTabOnOpen: 'yes' });
  assert.strictEqual(data.groups.length, 1);
  const g = data.groups[0];
  assert.strictEqual(g.title, '工作');
  assert.strictEqual(g.createdAt, 1700000000000);
  assert.strictEqual(g.tabs[0].pinned, true);
  assert.strictEqual(g.tabs[0].id.startsWith('t'), true);
  assert.strictEqual(data.settings.deleteGroupOnRestore, true);
});

/* ---- normalizeGroup:pinned/archived/容错 ---- */

test('normalizeGroup 保留 pinned/archived 并补齐缺失字段', () => {
  const g = BGTStore.normalizeGroup({
    title: 'X', pinned: true, archived: true,
    tabs: [{ url: 'https://a.com/', title: 'A', pinned: true }],
  });
  assert.strictEqual(g.pinned, true);
  assert.strictEqual(g.archived, true);
  assert.ok(g.id.length > 1);
  assert.strictEqual(g.tabs[0].id.startsWith('t'), true);

  const empty = BGTStore.normalizeGroup(null);
  assert.deepStrictEqual(empty.tabs, []);
  assert.strictEqual(empty.title, '');
});

/* ---- parseRules / ruleTarget:整理规则 ---- */

test('parseRules 解析与容错', () => {
  const rules = BGTStore.parseRules('github.com => 代码\n\n*.example.com => 测试\n坏行\n => 空\na.com=>\n');
  assert.deepStrictEqual(rules, [
    { domain: 'github.com', name: '代码' },
    { domain: 'example.com', name: '测试' },
  ]);
});

test('ruleTarget 精确/子域/兜底', () => {
  const rules = BGTStore.parseRules('github.com => 代码');
  assert.strictEqual(BGTStore.ruleTarget(rules, 'github.com'), '代码');
  assert.strictEqual(BGTStore.ruleTarget(rules, 'gist.github.com'), '代码');
  assert.strictEqual(BGTStore.ruleTarget(rules, 'github.com.evil.io'), 'github.com.evil.io');
  assert.strictEqual(BGTStore.ruleTarget(rules, 'unknown.com'), 'unknown.com');
});

/* ---- 快照与令牌 ---- */

test('makeSnapshot 生成内容指纹', () => {
  const s1 = BGTStore.makeSnapshot([{ url: 'https://a.com/' }, { url: 'https://b.com/' }]);
  const s2 = BGTStore.makeSnapshot([{ url: 'https://a.com/' }]);
  assert.strictEqual(s1.hash, 'https://a.com/\nhttps://b.com/');
  assert.notStrictEqual(s1.hash, s2.hash);
  assert.ok(s1.id.startsWith('s'));
});

test('isSelfWrite 只匹配最后一次写入令牌', () => {
  // persist 依赖 chrome.storage,node 下不可用;直接验证令牌比较逻辑
  assert.strictEqual(BGTStore.isSelfWrite(undefined), false);
  assert.strictEqual(BGTStore.isSelfWrite(0), false);
});

/* ---- normalizeData:updatedAt 透传 ---- */

test('normalizeData 透传 updatedAt 且补全结构', () => {
  const d = BGTStore.normalizeData({ groups: [], settings: {}, updatedAt: 123 });
  assert.strictEqual(d.updatedAt, 123);
  assert.strictEqual(d.version, BGTStore.DATA_VERSION);
  const d2 = BGTStore.normalizeData({});
  assert.strictEqual(d2.updatedAt, undefined);
});

/* ---- 重复保存:savedAt 记录与网址索引 ---- */

test('buildGroup 为每个标签记录保存时刻 savedAt', () => {
  const out = BGTStore.buildGroup(
    [{ url: 'https://a.com/' }, { url: 'https://b.com/' }],
    { ...SETTINGS_BASE });
  assert.ok(out.tabs.every((t) => t.savedAt > 1600000000000));
  assert.strictEqual(out.tabs[0].savedAt, out.tabs[1].savedAt); // 同批次同一时刻
});

test('normalizeGroup 老数据无 savedAt 时回退为分组创建时间', () => {
  const g = BGTStore.normalizeGroup({ createdAt: 1700000000000, tabs: [{ url: 'https://a.com/' }] });
  assert.strictEqual(g.tabs[0].savedAt, 1700000000000);
  const g2 = BGTStore.normalizeGroup({ createdAt: 1700000000000, tabs: [{ url: 'https://a.com/', savedAt: 1690000000000 }] });
  assert.strictEqual(g2.tabs[0].savedAt, 1690000000000); // 有值则保留
});

test('buildUrlIdentity 按身份键聚合,seenCount=唯一事件', () => {
  const data = BGTStore.normalizeData({
    groups: [
      { id: 'g1', title: '早', createdAt: 100, tabs: [{ url: 'https://x.com/a', savedAt: 200 }, { url: 'https://y.com/', savedAt: 150 }] },
      { id: 'g2', title: '晚', createdAt: 300, tabs: [{ url: 'https://x.com/a', savedAt: 400 }] },
    ],
  });
  const index = BGTStore.buildUrlIdentity(data);
  const xa = BGTStore.lookupIndex(index, 'https://x.com/a#frag');
  assert.strictEqual(xa.seenCount, 2);            // 两个不同分组事件
  assert.strictEqual(xa.referenceCount, 2);
  assert.deepStrictEqual(xa.occurrences.map((o) => o.at), [200, 400]);
  assert.deepStrictEqual(xa.occurrences.map((o) => o.refTitle), ['早', '晚']);
  assert.strictEqual(BGTStore.lookupIndex(index, 'https://y.com/').seenCount, 1);
});

test('事件去重:同一次收工的工作区与记录只计 1 次(引用数仍为 2)', () => {
  const data = BGTStore.normalizeData({
    workspaces: [{ id: 'w1', title: '工位', createdAt: 100, lastEventId: 'r1',
      tabs: [{ url: 'https://x.com/a', savedAt: 300 }] }],
    records: [{ id: 'r1', title: '记录', createdAt: 300, tabs: [{ url: 'https://x.com/a', savedAt: 300 }] }],
  });
  const entry = BGTStore.lookupIndex(BGTStore.buildUrlIdentity(data), 'https://x.com/a');
  assert.strictEqual(entry.seenCount, 1);        // 同一 capture 事件
  assert.strictEqual(entry.referenceCount, 2);   // 两份文档引用
});

test('filterOnlyNew:仅存新增(回归 v3.10 语义反转)', () => {
  const tabs = [
    { url: 'https://a.com/saved', title: 'A(已收藏)' },
    { url: 'https://b.com/new', title: 'B(新增)' },
  ];
  const savedKeys = [BGTStore.normalizeUrl('https://a.com/saved').key]; // 已收藏键
  const out = BGTStore.filterOnlyNew(tabs, savedKeys);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].url, 'https://b.com/new'); // 旧行为会错误保留 A
  assert.strictEqual(BGTStore.filterOnlyNew(tabs, []).length, 2); // 空集合 = 全量
});

test('mergeGroups 合并式撤销:恢复被删的,保留撤销期间的新编辑', () => {
  const before = [
    BGTStore.normalizeGroup({ id: 'a', title: 'A', createdAt: 1 }),
    BGTStore.normalizeGroup({ id: 'b', title: 'B', createdAt: 2 }),
    BGTStore.normalizeGroup({ id: 'c', title: 'C', createdAt: 3 }),
  ];
  // 撤销时刻:b 被重命名为 B2,c 被删除,新增了 d
  const current = [
    BGTStore.normalizeGroup({ id: 'b', title: 'B2', createdAt: 2 }),
    BGTStore.normalizeGroup({ id: 'd', title: 'D', createdAt: 4 }),
  ];
  const merged = BGTStore.mergeGroups(before, current);
  assert.deepStrictEqual(merged.map((g) => `${g.id}:${g.title}`), [
    'a:A',   // 被删的 a 从快照恢复
    'b:B2',  // 活着的 b 保留撤销期间的改名
    'c:C',   // 被删的 c 恢复
    'd:D',   // 撤销期间新建的 d 保留
  ]);
});

test('normalizeWorkspace 工作区结构与容错', () => {
  const w = BGTStore.normalizeWorkspace({
    title: '项目A', createdAt: 100,
    tabs: [{ url: 'https://a.com/', title: 'A', pinned: true }],
  });
  assert.strictEqual(w.title, '项目A');
  assert.ok(w.id.startsWith('w'));
  assert.strictEqual(w.lastRestoredAt, 0);
  assert.strictEqual(w.tabs[0].pinned, true);
  assert.strictEqual(w.tabs[0].savedAt, 100);
  const d = BGTStore.normalizeData({});
  assert.deepStrictEqual(d.workspaces, []); // 旧数据自动补全空数组
});

test('makeFullBackup 云端剥离密码,本地保留', () => {
  const data = BGTStore.normalizeData({ groups: [{ title: 'A', tabs: [{ url: 'https://a.com/' }] }] });
  data.settings.webdav = { url: 'https://dav.x/', user: 'u', pass: 'secret', dir: '', auto: true };
  const cloud = BGTStore.makeFullBackup(data, { stripSecrets: true });
  assert.strictEqual(cloud.settings.webdav.pass, '');
  assert.strictEqual(cloud.app, 'tab-harbor');
  assert.strictEqual(cloud.kind, 'full');
  const local = BGTStore.makeFullBackup(data);
  assert.strictEqual(local.settings.webdav.pass, 'secret');
  const parsed = BGTStore.parseBackup(JSON.stringify(cloud));
  assert.strictEqual(parsed.legacy, true);            // v1 裸 payload → legacy 标记
  assert.strictEqual(parsed.data.groups.length, 1);
  assert.strictEqual(parsed.manifest, null);
  assert.throws(() => BGTStore.parseBackup('{"app":"other"}'));
});

test('similarGroups 高重叠分组被检出,低重叠被忽略', () => {
  const mk = (id, title, urls) => BGTStore.normalizeGroup({ id, title, tabs: urls.map((u) => ({ url: u })) });
  const data = BGTStore.normalizeData({ groups: [
    mk('a', '早间', ['https://x.com/1', 'https://x.com/2', 'https://x.com/3', 'https://y.com/9']),
    mk('b', '早间备份', ['https://x.com/1', 'https://x.com/2', 'https://x.com/3', 'https://y.com/9']),
    mk('c', '无关', ['https://z.com/1', 'https://z.com/2', 'https://z.com/3']),
  ]});
  const sims = BGTStore.similarGroups(data, 0.8);
  assert.strictEqual(sims.length, 1);
  assert.strictEqual(sims[0].aId, 'a');
  assert.strictEqual(sims[0].bId, 'b');
  assert.ok(sims[0].score > 0.99);
});

test('routeTabsByRules 分流去重,applyRoutedGroups 同名追加/新建', () => {
  const rules = BGTStore.parseRules('github.com => 代码');
  const tabs = [
    { url: 'https://github.com/a' }, { url: 'https://github.com/a' }, // 重复
    { url: 'https://gist.github.com/b' }, // 子域命中
    { url: 'https://news.com/c' },
  ];
  const { routes, rest } = BGTStore.routeTabsByRules(tabs, rules);
  assert.strictEqual(routes.length, 1);
  assert.strictEqual(routes[0].name, '代码');
  assert.strictEqual(routes[0].tabs.length, 2); // 去重后
  assert.strictEqual(rest.length, 1);

  const data = BGTStore.normalizeData({});
  data.groups.unshift(BGTStore.normalizeGroup({ title: '代码', tabs: [{ url: 'https://github.com/old' }] }));
  const created = BGTStore.applyRoutedGroups(data, routes);
  assert.strictEqual(created, 0); // 已有同名,追加
  assert.strictEqual(data.groups[0].tabs.length, 3);
  const created2 = BGTStore.applyRoutedGroups(data, [{ name: '新组', tabs: [{ url: 'https://n.com/' }] }]);
  assert.strictEqual(created2, 1);
});

test('applyVersionDefaults 老数据一次性关确认,尊重后续选择', () => {
  // v3.1 持久化时 settings 全量保存,老数据里 confirmDelete=true
  const d1 = BGTStore.normalizeData({ groups: [], settings: { confirmDelete: true } });
  assert.strictEqual(d1.settings.confirmDelete, true);
  BGTStore.applyVersionDefaults(d1);
  assert.strictEqual(d1.settings.confirmDelete, false);
  assert.strictEqual(d1.settings._v32DefaultsApplied, true);
  // 用户此后改回 true,不再被迁移覆盖
  d1.settings.confirmDelete = true;
  BGTStore.applyVersionDefaults(d1);
  assert.strictEqual(d1.settings.confirmDelete, true);
});

test('bucketByDay 按今天/昨天/近7天/更早分桶并跳过空桶', () => {
  const now = new Date(2026, 8, 25, 12, 0, 0).getTime(); // 2026-09-25 12:00
  const mk = (id, at) => ({ id, createdAt: at, tabs: [] });
  const groups = [
    mk('a', now - 3600e3),                 // 今天
    mk('b', now - 26 * 3600e3),            // 昨天
    mk('c', now - 3 * 86400e3),            // 近 7 天
    mk('d', now - 30 * 86400e3),           // 更早
  ];
  const buckets = BGTStore.bucketByDay(groups, now);
  assert.deepStrictEqual(buckets.map((b) => `${b.label}:${b.groups.length}`), [
    '今天:1', '昨天:1', '近 7 天:1', '更早:1',
  ]);
  // 空桶被过滤:只有今天的分组时只返回一个桶
  const one = BGTStore.bucketByDay([mk('x', now - 1000)], now);
  assert.strictEqual(one.length, 1);
  assert.strictEqual(one[0].label, '今天');
});

test('i18n t() zh 直返,en 查表 + 占位符', () => {
  const I18N = require('../shared/i18n.js').BGTI18N;
  assert.strictEqual(I18N.lang === 'zh' || I18N.lang === 'en', true);
  assert.strictEqual(I18N.tr('已保存 {n} 个标签', { n: 5 }), I18N.lang === 'en' ? 'Saved 5 tabs' : '已保存 5 个标签');
  assert.strictEqual(I18N.tr('不存在的键'), '不存在的键');
  assert.ok(Object.keys(I18N.EN).length > 250);
});

test('normalizeWorkspace 多窗口结构:扁平镜像 + 单窗口退化为 tabs', () => {
  const w = BGTStore.normalizeWorkspace({
    title: '双屏', createdAt: 100,
    windows: [
      { tabs: [{ url: 'https://a.com/', title: 'A' }] },
      { tabs: [{ url: 'https://b.com/', title: 'B', pinned: true }] },
      { tabs: [] },
    ],
  });
  assert.strictEqual(w.windows.length, 2);          // 空窗口被剔除
  assert.strictEqual(w.tabs.length, 2);             // 扁平镜像
  assert.strictEqual(w.tabs[1].pinned, true);
  assert.ok(w.tabs[0].id !== w.tabs[1].id);

  const single = BGTStore.normalizeWorkspace({ title: '单窗', tabs: [{ url: 'https://c.com/' }] });
  assert.strictEqual(single.windows, undefined);    // 单窗口不落 windows
  const degraded = BGTStore.normalizeWorkspace({ title: '退化', windows: [{ tabs: [{ url: 'https://d.com/' }] }] });
  assert.strictEqual(degraded.windows, undefined);  // 只剩一个窗口时退化为 tabs
});

test('normalizeUrl:fragment/尾斜杠/追踪参数归一,query 不合并', () => {
  const a = BGTStore.normalizeUrl('https://GitHub.com/test/#readme');
  const b = BGTStore.normalizeUrl('https://github.com/test/');
  const c = BGTStore.normalizeUrl('https://github.com/test');
  assert.strictEqual(a.key, c.key);
  assert.strictEqual(b.key, c.key);
  assert.strictEqual(a.hadFragment, true);

  const d = BGTStore.normalizeUrl('https://x.com/p?utm_source=rss&id=1');
  const e = BGTStore.normalizeUrl('https://x.com/p?id=1');
  assert.strictEqual(d.key, e.key);          // 追踪参数剥离
  const f = BGTStore.normalizeUrl('https://x.com/p?id=2');
  assert.notStrictEqual(e.key, f.key);       // 业务 query 不合并
});

test('diffTabs:时间差分按归一化键', () => {
  const prev = [{ url: 'https://a.com/x#top' }, { url: 'https://b.com/' }];
  const next = [{ url: 'https://a.com/x/' }, { url: 'https://c.com/' }];
  const d = BGTStore.diffTabs(prev, next);
  assert.strictEqual(d.added.length, 1);
  assert.strictEqual(d.added[0].url, 'https://c.com/');
  assert.strictEqual(d.removed.length, 1);
  assert.strictEqual(d.removed[0].url, 'https://b.com/');
  assert.strictEqual(d.kept, 1);
});

test('buildUrlIdentity:跨来源计数与首末时间', () => {
  const data = BGTStore.normalizeData({
    groups: [{ id: 'g1', title: 'G', createdAt: 100, tabs: [{ url: 'https://x.com/a?utm_source=r', savedAt: 200 }] }],
    records: [{ id: 'r1', title: 'R', createdAt: 300, tabs: [{ url: 'https://x.com/a', savedAt: 300 }] }],
  });
  const index = BGTStore.buildUrlIdentity(data);
  const entry = index.get(BGTStore.normalizeUrl('https://x.com/a').key);
  assert.strictEqual(entry.seenCount, 2);
  assert.strictEqual(entry.firstSeenAt, 200);
  assert.strictEqual(entry.lastSeenAt, 300);
  assert.deepStrictEqual(entry.occurrences.map((o) => o.source), ['group', 'record']);
});

test('makeRecord/recordEqualsLast:hash 相同不入账', () => {
  const mk = (id) => BGTStore.makeRecord({ title: 'W', createdAt: 1, tabs: [{ url: 'https://a.com/x', savedAt: 1 }], workspaceId: id });
  const r1 = mk('w1');
  const r2 = mk('w1');
  assert.strictEqual(r1.hash, r2.hash);
  const records = [r1];
  assert.strictEqual(BGTStore.recordEqualsLast(records, r2), true);
  const r3 = BGTStore.makeRecord({ title: 'W', createdAt: 2, tabs: [{ url: 'https://a.com/x' }, { url: 'https://new.com/' }], workspaceId: 'w1' });
  assert.strictEqual(BGTStore.recordEqualsLast(records, r3), false);
});

test('Operation 形状冻结:makeOperation', () => {
  const op = BGTStore.makeOperation(BGTStore.OP_TYPES.DELETE_GROUP, { groupId: 'g1' }, { type: 'RESTORE_GROUP', payload: {} });
  assert.ok(op.id.startsWith('op'));
  assert.strictEqual(op.type, 'DELETE_GROUP');
  assert.strictEqual(op.inverse.type, 'RESTORE_GROUP');
  assert.ok(op.createdAt > 0);
});

test('getBerths:置顶分组按序占用 1–9,归档/未置顶不占位', () => {
  const mk = (id, pinned, archived, n) => BGTStore.normalizeGroup({ id, title: 'G' + id, pinned, archived, tabs: Array.from({ length: n === undefined ? 1 : n }, (_, i) => ({ url: 'https://' + id + '/' + i })) });
  const data = BGTStore.normalizeData({ groups: [
    mk('a', true, false), mk('b', false, false), mk('c', true, false),
    mk('d', true, true),   // 归档不占位
    mk('e', true, false, 0), // 空分组不占位
  ]});
  const berths = BGTStore.getBerths(data);
  assert.deepStrictEqual(berths.map((b) => [b.berth, b.id]), [[1, 'a'], [2, 'c']]);
  assert.strictEqual(BGTStore.berthOf(data, 'c'), 2);
  assert.strictEqual(BGTStore.berthOf(data, 'b'), 0);
  // 超过 9 个只取前 9
  const many = BGTStore.normalizeData({ groups: Array.from({ length: 12 }, (_, i) => mk('p' + i, true, false)) });
  assert.strictEqual(BGTStore.getBerths(many).length, 9);
});

test('verifyBackup v2:清单校验/篡改检出/旧格式诚实降级', async () => {
  const data = BGTStore.normalizeData({
    groups: [{ title: 'A', tabs: [{ url: 'https://a.com/' }] }],
    records: [{ title: 'R', tabs: [] }],
  });
  const payload = BGTStore.makeFullBackup(data);
  const hash = await BGTStore.hashPayload(payload);
  const node = { manifest: BGTStore.makeBackupManifest(hash, payload, '3.11.0'), data: payload };
  const v = await BGTStore.verifyBackup(node);
  assert.strictEqual(v.ok, true);
  assert.strictEqual(v.legacy, false);
  assert.ok(v.checks.some((c) => c.label === 'SHA-256 一致' && c.ok));

  const tampered = JSON.parse(JSON.stringify(node));
  tampered.data.groups.push({ title: 'X' });
  assert.strictEqual((await BGTStore.verifyBackup(tampered)).ok, false, '篡改必须被检出');

  const legacy = await BGTStore.verifyBackup({ app: 'tab-harbor', kind: 'full', groups: [] });
  assert.strictEqual(legacy.legacy, true);
  assert.ok(legacy.checks.some((c) => c.label === '完整性哈希' && !c.ok));
});

test('applyFullRestore:settings 全量还原但保留本机 WebDAV', () => {
  const current = { settings: { webdav: { url: 'https://mine/', pass: 'keep' } } };
  const restored = BGTStore.applyFullRestore(current, {
    groups: [{ title: 'X', tabs: [] }], workspaces: [], records: [],
    settings: { theme: 'dark', webdav: { url: 'https://evil/' } },
  });
  assert.strictEqual(restored.settings.theme, 'dark');
  assert.strictEqual(restored.settings.webdav.url, 'https://mine/');
  assert.strictEqual(restored.settings.webdav.pass, 'keep');
  assert.strictEqual(restored.groups[0].title, 'X');
});

test('routeTabsByRules:同批次 utm 变体按身份键去重', () => {
  const rules = BGTStore.parseRules('news.com => 资讯');
  const { routes } = BGTStore.routeTabsByRules([
    { url: 'https://news.com/a?utm_source=rss' },
    { url: 'https://news.com/a#x' },
  ], rules);
  assert.strictEqual(routes[0].tabs.length, 1); // 归一化后同一页面
});

test('weeklyReport:滚动周节奏/最常停泊/日并集去重', () => {
  const now = new Date(2026, 8, 25, 12, 0, 0).getTime();
  const DAY = 86400000;
  const mk = (id, at, urls) => ({ id, createdAt: at, title: 'W', tabs: urls.map((u) => ({ url: u, title: u })) });
  const data = BGTStore.normalizeData({ records: [
    mk('r1', now - 1 * DAY, ['https://github.com/a', 'https://github.com/b']),
    mk('r2', now - 2 * DAY, ['https://github.com/a#top', 'https://news.com/']),   // github/a 归一后去重
    mk('r3', now - 20 * DAY, ['https://old.com/']),                               // 三周前,不计
  ]});
  const rep = BGTStore.weeklyReport(data, now);
  assert.strictEqual(rep.thisWeek, 2);
  assert.strictEqual(rep.lastWeek, 0);
  assert.strictEqual(rep.deltaPct, null);
  assert.strictEqual(rep.topHost.host, 'github.com');
  assert.strictEqual(rep.topHost.count, 3); // r1 两条 + r2 归一后 1 条
  assert.strictEqual(rep.days.length, 2);
  const yesterday = rep.days.find((d) => d.at < now - 1.5 * DAY);
  assert.strictEqual(yesterday.tabs.length, 2); // 并集去重:github/a 只算一次
});

/* ---- 身份层去重:全链路同口径 ---- */

test('keySet/dedupeTabs/appendNewTabs:utm、fragment、尾斜杠归一为同一身份', () => {
  const tabs = [
    { url: 'https://x.com/a' },
    { url: 'https://x.com/a?utm_source=fb' },
    { url: 'https://x.com/a#top' },
    { url: 'https://x.com/a/' },
    { url: 'https://x.com/b' },
  ];
  assert.strictEqual(BGTStore.keySet(tabs).size, 2);
  assert.strictEqual(BGTStore.dedupeTabs(tabs).length, 2);
  const target = [{ url: 'https://x.com/a' }];
  assert.strictEqual(BGTStore.appendNewTabs(target, tabs), 1); // 只有 b 是新的
  assert.strictEqual(target.length, 2);
});

test('buildGroup:dedupe 开启时 utm/尾斜杠变体合并为一', () => {
  // 回归:此前用原始 URL 字符串比较,这三个变体会被全部存下
  const out = BGTStore.buildGroup([
    { url: 'https://a.com/x' },
    { url: 'https://a.com/x?utm_source=rss' },
    { url: 'https://a.com/x/' },
  ], { ...SETTINGS_BASE, dedupe: true });
  assert.strictEqual(out.tabs.length, 1);
  assert.strictEqual(out.tabs[0].url, 'https://a.com/x');
});

test('相似分组闭环:合并去重与相似度判定同口径,合并后不再重复建议', () => {
  const data = BGTStore.normalizeData({ groups: [
    { id: 'A', title: 'A', tabs: [
      { url: 'https://s.com/1' }, { url: 'https://s.com/2' }, { url: 'https://s.com/3' }] },
    { id: 'B', title: 'B', tabs: [
      { url: 'https://s.com/1?utm_source=fb' }, { url: 'https://s.com/2#f' }, { url: 'https://s.com/3/' }] },
  ]});
  const sims = BGTStore.similarGroups(data, 0.8);
  assert.strictEqual(sims.length, 1);
  assert.strictEqual(sims[0].score, 1);

  // 修复前合并用原始串去重 → A 会变成 6 条,洞察下次仍报同一条"80% 重叠"
  const a = data.groups.find((g) => g.id === 'A');
  const b = data.groups.find((g) => g.id === 'B');
  BGTStore.appendNewTabs(a.tabs, b.tabs);
  assert.strictEqual(a.tabs.length, 3);
  assert.strictEqual(BGTStore.keySet(a.tabs).size, 3);

  data.groups = data.groups.filter((g) => g.id !== 'B');
  assert.strictEqual(BGTStore.similarGroups(data, 0.8).length, 0);
});

/* ---- v3 分键存储(ADR-001,docs/ADR-001-write-model.md §9 验收断言) ---- */

/** chrome.storage.local 内存替身:记录每次 set 写了哪些键(分键观测点) */
function stubStorage(initial) {
  const mem = new Map(Object.entries(JSON.parse(JSON.stringify(initial || {}))));
  const setCalls = [];
  global.chrome = {
    storage: {
      local: {
        get: async (keys) => {
          const out = {};
          for (const k of (keys == null ? Array.from(mem.keys()) : Array.isArray(keys) ? keys : [keys])) {
            if (mem.has(k)) out[k] = mem.get(k);
          }
          return out;
        },
        set: async (obj) => { setCalls.push(Object.keys(obj).sort()); for (const [k, v] of Object.entries(obj)) mem.set(k, v); },
        remove: async (keys) => { for (const k of (Array.isArray(keys) ? keys : [keys])) mem.delete(k); },
      },
    },
  };
  return { mem, setCalls };
}

const K = { meta: 'bgtMeta', groups: 'bgtGroups', ws: 'bgtWorkspaces', rec: 'bgtRecords', exc: 'bgtExcerpts' };
const ALL_KEYS = [K.groups, K.meta, K.rec, K.ws, K.exc].sort(); // 全量写 = 全部集合键 + meta,单次 set

function legacyBlob() {
  return {
    version: 2,
    groups: [BGTStore.normalizeGroup({ id: 'g1', title: '旧分组', tabs: [{ url: 'https://a.com/' }] })],
    workspaces: [BGTStore.normalizeWorkspace({ id: 'w1', title: '旧工作区' })],
    records: [BGTStore.makeRecord({ title: '旧记录', tabs: [BGTStore.makeStoredTab({ url: 'https://b.com/' })] })],
    settings: { ...BGTStore.DEFAULT_SETTINGS, theme: 'dark' },
    updatedAt: 123,
  };
}

test('ADR-001 §9.1: v2 单键加载即迁移 —— 四键出现、旧键移除、留底保留', async () => {
  const env = stubStorage({ bgtData: legacyBlob() });
  const data = await BGTStore.load();
  assert.ok(env.mem.has(K.meta), 'bgtMeta 应存在');
  assert.ok(env.mem.has(K.groups), 'bgtGroups 应存在');
  assert.ok(env.mem.has(K.ws), 'bgtWorkspaces 应存在');
  assert.ok(env.mem.has(K.rec), 'bgtRecords 应存在');
  assert.strictEqual(env.mem.get(K.meta).schemaVersion, BGTStore.STORAGE_SCHEMA, 'meta 应标记分键布局版本');
  assert.ok(!env.mem.has('bgtData'), '旧单键应被移除');
  assert.ok(env.mem.has(BGTStore.LEGACY_BACKUP_KEY), '应保留 v2 留底');
  assert.strictEqual(data.groups[0].id, 'g1');
  assert.strictEqual(data.settings.theme, 'dark');
  assert.strictEqual(data.records.length, 1);
});

test('ADR-001 §9.3: 迁移写是单次原子 set(全部键同调用)', async () => {
  const env = stubStorage({ bgtData: legacyBlob() });
  await BGTStore.load();
  const migrationWrites = env.setCalls.filter((ks) => ks.includes(K.meta));
  assert.strictEqual(migrationWrites.length, 1, '迁移只应有一次含 meta 的写');
  assert.deepStrictEqual(migrationWrites[0], ALL_KEYS, '所有键必须在同一次 set 里');
});

test('ADR-001 §9.2: 仅触 groups 的写不碰 records 键(分键收益可证伪)', async () => {
  const env = stubStorage({ bgtData: legacyBlob() });
  const data = await BGTStore.load();
  env.setCalls.length = 0;
  const recordsBefore = JSON.stringify(env.mem.get(K.rec));
  data.groups[0].title = '改名后';
  await BGTStore.persist(data, { groups: true });
  assert.deepStrictEqual(env.setCalls, [[K.groups, K.meta].sort()], '只应写 bgtGroups + bgtMeta');
  assert.strictEqual(JSON.stringify(env.mem.get(K.rec)), recordsBefore, 'bgtRecords 不得被重写');
  assert.strictEqual(env.mem.get(K.groups)[0].title, '改名后');
});

test('缺省 persist 为全量单次原子写(迁移/恢复/导入路径)', async () => {
  const env = stubStorage({ bgtData: legacyBlob() });
  const data = await BGTStore.load();
  env.setCalls.length = 0;
  await BGTStore.persist(data);
  assert.strictEqual(env.setCalls.length, 1, '全量写应是单次 set');
  assert.deepStrictEqual(env.setCalls[0], ALL_KEYS);
});

test('settings-only 写只落 meta(popup 选项路径不重写任何集合)', async () => {
  const env = stubStorage({ bgtData: legacyBlob() });
  const data = await BGTStore.load();
  env.setCalls.length = 0;
  data.settings.excludePinned = true;
  await BGTStore.persist(data, { settings: true });
  assert.deepStrictEqual(env.setCalls, [[K.meta].sort()]);
  assert.strictEqual(env.mem.get(K.meta).settings.excludePinned, true);
});

test('回声令牌随 bgtMeta.updatedAt 走(onChanged 过滤协议不变)', async () => {
  stubStorage({ bgtData: legacyBlob() });
  const data = await BGTStore.load();
  await BGTStore.persist(data, { groups: true });
  const res = await global.chrome.storage.local.get('bgtMeta');
  assert.strictEqual(BGTStore.isSelfWrite(res.bgtMeta.updatedAt), true, '自己刚写的 updatedAt 应被识别');
  assert.strictEqual(BGTStore.isSelfWrite(res.bgtMeta.updatedAt - 1), false, '别的时间戳不应被识别');
});

test('分键往返:persist → load 内容一致(合并视图形状未变)', async () => {
  stubStorage({});
  const data = BGTStore.emptyData();
  data.groups = [BGTStore.normalizeGroup({ id: 'g9', title: '往返', tabs: [{ url: 'https://x.com/' }] })];
  data.workspaces = [BGTStore.normalizeWorkspace({ id: 'w9', title: 'ws' })];
  data.records = [BGTStore.makeRecord({ title: 'r', tabs: [BGTStore.makeStoredTab({ url: 'https://y.com/' })] })];
  await BGTStore.persist(data);
  const back = await BGTStore.load();
  assert.deepStrictEqual(back, BGTStore.normalizeData(data));
});

/* ---- WP-1.3:派生索引指纹记忆化 ---- */

test('WP-1.3: 内容未变 → 命中同一份只读索引(不重建)', () => {
  const data = BGTStore.emptyData();
  data.groups = [BGTStore.normalizeGroup({ id: 'g1', title: '组', tabs: [{ url: 'https://a.com/x', title: 'A', savedAt: 100 }] })];
  data.records = [BGTStore.makeRecord({ id: 'r1', title: '记', createdAt: 200, tabs: [{ url: 'https://a.com/x', title: 'A', savedAt: 100 }] })];
  const a = BGTStore.buildUrlIdentity(data);
  const b = BGTStore.buildUrlIdentity(data);
  assert.strictEqual(b, a, '内容未变应命中缓存并返回同一实例');
  const e = BGTStore.lookupIndex(b, 'https://a.com/x');
  assert.strictEqual(e.seenCount, 2, '分组引用 + 记录事件');
});

test('WP-1.3: 任何输入改动都使缓存失效 —— 无过期窗口(防抖窗口内的编辑也逃不掉)', () => {
  const data = BGTStore.emptyData();
  data.groups = [BGTStore.normalizeGroup({ id: 'g1', title: '组', tabs: [{ url: 'https://a.com/x', title: '旧标题', savedAt: 100 }] })];
  data.workspaces = [BGTStore.normalizeWorkspace({ id: 'w1', title: '区' })];
  const a = BGTStore.buildUrlIdentity(data);
  const key = 'https://a.com/x';

  data.groups[0].tabs[0].title = '新标题'; // 未落盘的纯内存改动(persist 之前)
  const b = BGTStore.buildUrlIdentity(data);
  assert.notStrictEqual(b, a, '标签标题改动必须未命中');
  assert.strictEqual(BGTStore.lookupIndex(b, key).title, '新标题', '且新标题要在索引里生效');

  data.groups[0].tabs[0].savedAt = 999;
  assert.notStrictEqual(BGTStore.buildUrlIdentity(data), b, 'savedAt 改动必须未命中');

  data.workspaces[0].lastEventId = 'ev9';
  assert.notStrictEqual(BGTStore.buildUrlIdentity(data), b, 'workspace.lastEventId 改动必须未命中');

  data.groups[0].title = '改组名';
  assert.notStrictEqual(BGTStore.buildUrlIdentity(data), b, '分组标题(occurrences.refTitle)改动必须未命中');
});

/* ---- Wave 3.1:摘录集合(证据层,零新权限的内容级信号) ---- */

test('摘录归一化:trim、截断 500 字、滚动窗口 300 条', () => {
  const x = BGTStore.normalizeExcerpt({ url: ' https://a.com/doc ', text: '结论'.repeat(400), tabTitle: 'T', savedAt: 123 });
  assert.strictEqual(x.url, 'https://a.com/doc');
  assert.strictEqual(x.text.length, BGTStore.EXCERPT_TEXT_MAX, '文本截断到上限');
  assert.ok(x.id.startsWith('e'), '摘录 id 前缀');
  const many = [];
  for (let i = 0; i < BGTStore.EXCERPTS_MAX + 5; i += 1) many.push({ text: 'x' + i });
  const d = BGTStore.normalizeData({ excerpts: many });
  assert.strictEqual(d.excerpts.length, BGTStore.EXCERPTS_MAX, '滚动窗口生效');
  assert.strictEqual(d.excerpts[d.excerpts.length - 1].text, 'x' + (BGTStore.EXCERPTS_MAX + 4), '保留最新');
});

test('摘录计入身份索引:第四种观测来源(独立事件空间 + 80 字快照)', () => {
  const data = BGTStore.emptyData();
  data.records = [BGTStore.makeRecord({ id: 'r1', title: '记', createdAt: 100, tabs: [{ url: 'https://a.com/x', title: 'A', savedAt: 100 }] })];
  data.excerpts = [BGTStore.normalizeExcerpt({ id: 'e1', url: 'https://a.com/x', text: '关键结论'.repeat(30), tabTitle: '文档', savedAt: 200 })];
  const e = BGTStore.lookupIndex(BGTStore.buildUrlIdentity(data), 'https://a.com/x');
  assert.strictEqual(e.occurrences.length, 2, '记录 + 摘录各一条');
  assert.strictEqual(e.seenCount, 2, '摘录占独立事件空间(ev:x:)');
  const ex = e.occurrences.find((o) => o.source === 'excerpt');
  assert.ok(ex, '摘录 occurrence 存在');
  assert.strictEqual(ex.tabTitle.length, 80, 'occurrence 只带 80 字快照,完整文本在集合本身');
});

test('摘录改动使指纹缓存失效(WP-1.3 的指纹覆盖摘录)', () => {
  const data = BGTStore.emptyData();
  data.excerpts = [BGTStore.normalizeExcerpt({ id: 'e1', url: 'https://a.com/x', text: '旧摘录', savedAt: 100 })];
  const a = BGTStore.buildUrlIdentity(data);
  data.excerpts[0].text = '新摘录';
  assert.notStrictEqual(BGTStore.buildUrlIdentity(data), a, '摘录文本改动必须未命中');
});

/* ---- 决策 4:URL 归一化缓存为真 LRU(命中刷新近度,淘汰最久未用) ---- */

test('决策 4: urlCache 是真 LRU —— 命中刷新近度,热条目在溢出时存活', () => {
  const N = BGTStore.URL_CACHE_MAX;
  const url = (i) => 'https://site' + i + '.example.com/p' + i;
  for (let i = 0; i < N; i += 1) BGTStore.normalizeUrl(url(i)); // 灌满
  assert.ok(BGTStore.urlCacheHas(url(0)), '灌满后首条应在缓存中');

  BGTStore.normalizeUrl(url(0)); // 命中刷新近度:url(0) 成为"最近使用"
  BGTStore.normalizeUrl('https://one-more.example.com/'); // 溢出 1 条 → 只能淘汰"最久未用"(url(1))

  assert.ok(BGTStore.urlCacheHas(url(0)), '刚被访问过的热条目必须存活(这是 LRU 与 FIFO 的分界)');
  assert.ok(!BGTStore.urlCacheHas(url(1)), '最久未用的条目应被淘汰');
  assert.ok(BGTStore.urlCacheHas(url(N - 1)), '其余条目不受影响');
});

/* ---- Wave 3.2:稳定性分类器(判别核心,先于 WP-3.3) ---- */

/** 通过真实身份索引构造"同一 URL、逐次观测标题不同"的条目(occurrences 按 at 升序) */
function entryWithTitles(titles) {
  const data = BGTStore.emptyData();
  data.records = titles.map((t, i) => BGTStore.makeRecord({
    id: 'r' + i, title: '记' + i, createdAt: 100 + i,
    tabs: [{ url: 'https://a.com/x', title: t, savedAt: 100 + i }],
  }));
  return BGTStore.lookupIndex(BGTStore.buildUrlIdentity(data), 'https://a.com/x');
}

test('3.2 分类器:仅观测一次 → single,措辞守 §7.1 纪律', () => {
  const c = BGTStore.classifyStability(entryWithTitles(['唯一标题']));
  assert.strictEqual(c.verdict, 'single');
  assert.ok(c.reasons.join().includes('仅观测一次'), '不得说"内容稳定"');
});

test('3.2 分类器:标题一致与计数/日期噪声 → stable(首页类地址不产生假版本)', () => {
  assert.strictEqual(BGTStore.classifyStability(entryWithTitles(['收件箱', '收件箱'])).verdict, 'stable');
  const noisy = BGTStore.classifyStability(entryWithTitles(['收件箱 (3)', '收件箱 (12)', '收件箱 (128)']));
  assert.strictEqual(noisy.verdict, 'stable', '(N) 计数差异是噪声,不是版本');
  assert.ok(noisy.reasons.join().includes('噪声'), '判据要说明是噪声折叠');
  const dated = BGTStore.classifyStability(entryWithTitles(['日报 2026-09-25', '日报 2026-09-26']));
  assert.strictEqual(dated.verdict, 'stable', '日期后缀差异是噪声');
});

test('3.2 分类器:版本记号单调递进 → versioned;记号乱序不算', () => {
  const v = BGTStore.classifyStability(entryWithTitles(['设计稿 v1', '设计稿 v2', '设计稿 v3']));
  assert.strictEqual(v.verdict, 'versioned');
  assert.ok(v.reasons.join().includes('单调递进'));
  const chaos = BGTStore.classifyStability(entryWithTitles(['设计稿 v3', '设计稿 v2']));
  assert.notStrictEqual(chaos.verdict, 'versioned', '记号不单调不得判为版本谱系');
});

test('3.2 分类器:标题乱跳 → dynamic(变化率按噪声折叠后口径);收藏引用单独披露', () => {
  const d = BGTStore.classifyStability(entryWithTitles(['HN 头条甲', 'HN 头条乙完全不同', '又一个标题']));
  assert.strictEqual(d.verdict, 'dynamic');
  assert.strictEqual(d.titleChurn, 1, '折叠后 3 种标题 / 3 次观测');
  const data = BGTStore.emptyData();
  data.records = [BGTStore.makeRecord({ id: 'r1', title: '记', createdAt: 1, tabs: [{ url: 'https://a.com/x', title: 'T', savedAt: 1 }] })];
  data.groups = [BGTStore.normalizeGroup({ id: 'g1', title: '收藏', tabs: [{ url: 'https://a.com/x', title: 'T', savedAt: 2 }] })];
  const c = BGTStore.classifyStability(BGTStore.lookupIndex(BGTStore.buildUrlIdentity(data), 'https://a.com/x'));
  assert.strictEqual(c.savedByUser, true, '收藏引用应被披露为"被主动保存过"');
  assert.strictEqual(c.verdict, 'stable');
});

/* ---- WP-3.3:版本谱系(sourceVersions,零新增采集) ---- */

test('3.3 sourceVersions:按噪声折叠分组、按首次观测排序、每版聚合正确', () => {
  const data = BGTStore.emptyData();
  data.records = [
    BGTStore.makeRecord({ id: 'r1', title: '记1', createdAt: 100, tabs: [{ url: 'https://a.com/x', title: '设计稿 v1 (2)', savedAt: 100 }] }),
    BGTStore.makeRecord({ id: 'r2', title: '记2', createdAt: 200, tabs: [{ url: 'https://a.com/x', title: '设计稿 v1 (5)', savedAt: 200 }] }),
    BGTStore.makeRecord({ id: 'r3', title: '记3', createdAt: 300, tabs: [{ url: 'https://a.com/x', title: '设计稿 v2', savedAt: 300 }] }),
  ];
  data.excerpts = [
    BGTStore.normalizeExcerpt({ id: 'e1', url: 'https://a.com/x', text: 'v1 时期的摘录', savedAt: 150 }),
    BGTStore.normalizeExcerpt({ id: 'e2', url: 'https://a.com/x', text: 'v2 时期的摘录', savedAt: 350 }),
  ];
  const entry = BGTStore.lookupIndex(BGTStore.buildUrlIdentity(data), 'https://a.com/x');
  const vs = BGTStore.sourceVersions(entry);
  assert.strictEqual(vs.length, 2, 'v1 组(含计数噪声)与 v2 组共两版;摘录不另立版本');
  assert.strictEqual(vs[0].title.includes('v1'), true, '第一版标题保留原始形态');
  assert.strictEqual(vs[0].count, 3, '两条标题观测((N) 折叠)+ 时刻落在 v1 的摘录,共 3');
  assert.strictEqual(vs[0].firstAt, 100);
  assert.strictEqual(vs[1].firstAt, 300, '按首次观测升序,v2 在后');
  assert.strictEqual(vs[1].count, 2, 'v2 的一条记录 + 时刻落在 v2 的摘录');
  assert.ok(vs[1].sources.indexOf('excerpt') >= 0, '来源聚合包含摘录');
  // occurrence 归属口径:与分类器同一折叠
  assert.strictEqual(BGTStore.noiseFoldTitle('设计稿 v1 (改)') === BGTStore.noiseFoldTitle('设计稿 v1'), false,
    '(改) 与 v1 的关系按折叠键判断(此断言锚定导出口径存在,不预设折叠结果)');
});

test('3.3 sourceVersions:单版本(纯噪声差异)不产生假谱系', () => {
  const data = BGTStore.emptyData();
  data.records = [1, 2, 3].map((i) => BGTStore.makeRecord({
    id: 'r' + i, title: '记' + i, createdAt: 100 * i,
    tabs: [{ url: 'https://a.com/inbox', title: '收件箱 (' + (i * 4) + ')', savedAt: 100 * i }],
  }));
  const entry = BGTStore.lookupIndex(BGTStore.buildUrlIdentity(data), 'https://a.com/inbox');
  assert.strictEqual(BGTStore.sourceVersions(entry).length, 1, '(N) 计数差异折叠为一版');
});

run().then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
});
