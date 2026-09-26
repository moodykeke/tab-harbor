import io

p = 'test/test-store.js'
s = io.open(p, encoding='utf-8').read()

# 1) runner 升级为异步队列
old = """let passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); passed += 1; console.log('  PASS', name); }
  catch (e) {
    failed += 1;
    console.error('  FAIL', name, '\\n       ', e && e.message);
  }
}"""
new = """let passed = 0, failed = 0;
const queue = [];

function test(name, fn) { queue.push({ name, fn }); }

async function run() {
  for (const t of queue) {
    try { await t.fn(); passed += 1; console.log('  PASS', t.name); }
    catch (e) {
      failed += 1;
      console.error('  FAIL', t.name, '\\n       ', e && e.message);
    }
  }
}"""
assert old in s, 'runner'
s = s.replace(old, new, 1)

# 2) 尾部 runner 调用
old = "console.log(`\\n${passed} passed, ${failed} failed`);\nprocess.exit(failed ? 1 : 0);"
new = "run().then(() => {\n  console.log(`\\n${passed} passed, ${failed} failed`);\n  process.exit(failed ? 1 : 0);\n});"
assert old in s, 'tail'
s = s.replace(old, new, 1)

io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('runner ok')

# ============ 两个失效测试重写 + 新增回归 ============
p = 'test/test-store.js'
s = io.open(p, encoding='utf-8').read()

old = """test('buildUrlIdentity 按身份键聚合每次保存记录,时间升序', () => {
  const data = BGTStore.normalizeData({
    groups: [
      { id: 'g1', title: '早', createdAt: 100, tabs: [{ url: 'https://x.com/a', savedAt: 200 }, { url: 'https://y.com/', savedAt: 150 }] },
      { id: 'g2', title: '晚', createdAt: 300, tabs: [{ url: 'https://x.com/a', savedAt: 400 }] },
    ],
  });
  const index = BGTStore.buildUrlIdentity(data);
  const xa = BGTStore.lookupIndex(index, 'https://x.com/a#frag');
  assert.strictEqual(xa.length, 2);
  assert.deepStrictEqual(xa.map((o) => o.at), [200, 400]);
  assert.deepStrictEqual(xa.map((o) => o.refTitle), ['早', '晚']);
  assert.strictEqual(BGTStore.lookupIndex(index, 'https://y.com/').length, 1);
});"""
new = """test('buildUrlIdentity 按身份键聚合,seenCount=唯一事件', () => {
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
  const newKeys = [BGTStore.normalizeUrl('https://b.com/new').key];
  const out = BGTStore.filterOnlyNew(tabs, newKeys);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].url, 'https://b.com/new'); // 旧行为会错误保留 A
  assert.strictEqual(BGTStore.filterOnlyNew(tabs, []).length, 2); // 空集合 = 全量
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
  const current = { settings: BGTStore.normalizeSettings({ webdav: { url: 'https://mine/', pass: 'keep' } }) };
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
});"""
assert old in s, 'identity test rewrite'
s = s.replace(old, new, 1)

# verifyBackup 旧测试删除(已被新测试覆盖)
old = """test('verifyBackup:结构/指纹/规模检查', () => {
  const data = BGTStore.normalizeData({
    groups: [{ id: 'g1', title: 'A', tabs: [{ url: 'https://a.com/' }] }],
    workspaces: [],
    records: [{ id: 'r1', title: 'R', tabs: [{ url: 'https://b.com/' }] }],
  });
  const payload = BGTStore.makeFullBackup(data);
  // 伪造备份节点(makeLocalBackup 中 fingerprint 在外层)
  const node = { id: 'b1', at: Date.now(), data: payload };
  const result = BGTStore.verifyBackup(payload);
  assert.strictEqual(result.ok, true);
  assert.ok(result.checks.every((c) => c.ok), JSON.stringify(result.checks));
  const labels = result.checks.map((c) => c.label);
  assert.ok(labels.includes('可解析') && labels.includes('来源合法') && labels.includes('结构合法'));

  // 坏数据:来源不对
  const bad = BGTStore.verifyBackup({ app: 'other', kind: 'full', groups: [] });
  assert.strictEqual(bad.ok, false);
  const nullResult = BGTStore.verifyBackup(null);
  assert.strictEqual(nullResult.ok, false);
});

"""
assert old in s, 'old verifyBackup test'
s = s.replace(old, '', 1)

io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('tests rewritten')
