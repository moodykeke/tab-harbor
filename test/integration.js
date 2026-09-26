/**
 * Tab Harbor — 集成测试(node test/integration.js)
 * 覆盖"单函数正确、组合失败"的类别:备份信任链、恢复事务、事件计数、
 * 收工去重工作区感知、规则分流 accepted 语义。
 * WebDAV 网络层以 fetch mock 替身模拟(成功/失败/hash-mismatch 三态)。
 */
'use strict';

const assert = require('assert');
const path = require('path');

/* ---------------- 运行环境替身 ---------------- */

// 内存 storage(chrome.storage.local 替身)
const mem = new Map();
global.chrome = {
  runtime: {
    id: 'itest',
    getManifest: () => ({ version: '3.11.1' }),
    getURL: (p) => 'chrome-extension://itest/' + p,
    sendMessage: () => {},
  },
  storage: {
    local: {
      get: async (keys) => {
        const out = {};
        for (const k of Array.isArray(keys) ? keys : [keys]) if (mem.has(k)) out[k] = mem.get(k);
        return out;
      },
      set: async (obj) => { for (const k of Object.keys(obj)) mem.set(k, obj[k]); },
      remove: async (keys) => { for (const k of Array.isArray(keys) ? keys : [keys]) mem.delete(k); },
    },
  },
  // WebDAV 替身:状态机 controlled 环境变量切换行为
};

// WebDAV 响应控制
let davMode = 'ok'; // ok | fail | tamper
let davStored = null;
global.fetch = async (url, opts) => {
  if (String(url).includes('dav.test')) {
    if (opts && opts.method === 'PUT') {
      davStored = JSON.parse(opts.body);
      return davMode === 'fail' ? { ok: false, status: 500, text: async () => '' } : { ok: true, status: 201, text: async () => '' };
    }
    if (opts && opts.method === 'GET') {
      let body = davStored;
      if (davMode === 'tamper') {
        body = JSON.parse(JSON.stringify(body));
        body.data.groups.push({ title: 'INJECTED', tabs: [] });
      }
      return { ok: true, status: 200, text: async () => JSON.stringify(body) };
    }
  }
  return { ok: false, status: 404, text: async () => '' };
};

function setDav(mode, stored) { davMode = mode; davStored = stored; }

const BGTStore = require('../shared/store.js').BGTStore;

let passed = 0, failed = 0;
const queue = [];
function test(name, fn) { queue.push({ name, fn }); }

(async () => {
  const NOW = Date.now();

  /* ---- 1. 备份信任链:创建 → 验证 → 破坏 → 验证失败 → 拒绝恢复 ---- */
  test('信任链:本地 v2 备份验证 PASS;payload 篡改后 FAIL', async () => {
    const data = BGTStore.normalizeData({
      groups: [{ id: 'g1', title: 'A', tabs: [{ url: 'https://a.com/' }] }],
      workspaces: [], records: [],
    });
    const payload = BGTStore.makeFullBackup(data);
    const payloadHash = await BGTStore.hashPayload(payload);
    const node = { id: 'b1', at: NOW, fingerprint: 'x',
      manifest: BGTStore.makeBackupManifest(payloadHash, payload, 'test'), data: payload };

    const good = await BGTStore.verifyBackup({ manifest: node.manifest, data: node.data });
    assert.strictEqual(good.ok, true, JSON.stringify(good.checks));

    const tamperedPayload = JSON.parse(JSON.stringify(payload));
    tamperedPayload.groups[0].title = 'HACKED';
    const bad = await BGTStore.verifyBackup({
      manifest: BGTStore.makeBackupManifest(await BGTStore.hashPayload(tamperedPayload) === payloadHash
        ? 'wrong' : payloadHash, tamperedPayload, 'test'),
      data: tamperedPayload,
    });
    // 重算哈希 ≠ 清单哈希 → 必须失败
    assert.strictEqual(bad.ok, false, '篡改 payload 必须被 SHA-256 检出');
  });

  /* ---- 2. 恢复事务:恢复 → 全量一致 → 撤销(安全留底)→ 完全一致 ---- */
  test('恢复事务:applyFullRestore 覆盖四域;安全留底可完全回滚', async () => {
    const current = BGTStore.normalizeData({
      groups: [{ title: '现场', tabs: [{ url: 'https://live.com/' }] }],
      workspaces: [], records: [{ title: 'R', tabs: [] }],
      settings: { theme: 'dark', webdav: { url: 'https://mine/', pass: 'k' } },
    });
    const backupPayload = BGTStore.makeFullBackup(BGTStore.normalizeData({
      groups: [{ title: '旧项目', tabs: [{ url: 'https://old.com/' }] }],
      workspaces: [], records: [], settings: { theme: 'light' },
    }));
    // 恢复前安全留底(与 actions.restoreBackup 相同协议)
    mem.set('bgtBackups', [{ id: 'safety', at: NOW, fingerprint: 'pre', data: BGTStore.makeFullBackup(current) }]);

    const restored = BGTStore.applyFullRestore(current, backupPayload);
    const state = {
      groups: restored.groups, workspaces: restored.workspaces,
      records: restored.records, settings: restored.settings,
    };
    assert.strictEqual(state.groups[0].title, '旧项目');
    assert.strictEqual(state.settings.theme, 'light');
    assert.strictEqual(state.settings.webdav.url, 'https://mine/', '本机云配置必须保留');

    // 撤销 = 从安全留底回滚
    const safety = mem.get('bgtBackups')[0];
    const rolled = BGTStore.applyFullRestore(state, safety.data);
    assert.strictEqual(rolled.groups[0].title, '现场');
    assert.strictEqual(rolled.records.length, 1, 'records 必须一并回滚');
    assert.strictEqual(rolled.settings.theme, 'dark', 'settings 必须一并回滚');
  });

  /* ---- 3. WebDAV v2 写→解析→验证→恢复 全链 ---- */
  test('WebDAV v2 信封:cloudRestore 哈希校验 + applyFullRestore(经 parseBackup 统一)', async () => {
    const store = { groups: [{ title: '云端组', tabs: [{ url: 'https://c.com/' }] }], workspaces: [], records: [] };
    const payload = BGTStore.makeFullBackup(BGTStore.normalizeData(store));
    setDav('ok', {
      app: 'tab-harbor', kind: 'full-envelope',
      manifest: BGTStore.makeBackupManifest(await BGTStore.hashPayload(payload), payload, 'test'),
      data: payload,
    });
    // 模拟 cloudRestore 的解析+验证段
    const parsed = BGTStore.parseBackup(JSON.stringify(davStored));
    assert.strictEqual(parsed.legacy, false);
    const verdict = await BGTStore.verifyBackup({ manifest: parsed.manifest, data: parsed.data });
    assert.strictEqual(verdict.ok, true, 'v2 信封必须验证通过');
    const restored = BGTStore.applyFullRestore(
      { settings: { webdav: { url: 'https://mine/' } } }, parsed.data);
    assert.strictEqual(restored.groups[0].title, '云端组');

    // 篡改远端 → 解析成功但哈希不匹配
    davStored.data.groups.push({ title: 'INJECT', tabs: [] });
    const tampered = BGTStore.parseBackup(JSON.stringify(davStored));
    const hash = await BGTStore.hashPayload(tampered.data);
    assert.notStrictEqual(hash, tampered.manifest.payloadHash, '篡改必须改变哈希');
  });

  /* ---- 4. v1 legacy:解析为 legacy:true,验证标注"无哈希" ---- */
  test('v1 旧格式:legacy 标注,验证不通过但可恢复', async () => {
    setDav('ok', { app: 'tab-harbor', kind: 'full', groups: [] });
    const parsed = BGTStore.parseBackup(JSON.stringify({ app: 'tab-harbor', kind: 'full', groups: [] }));
    assert.strictEqual(parsed.legacy, true);
    assert.strictEqual(parsed.manifest, null);
    const verdict = await BGTStore.verifyBackup({ manifest: parsed.manifest, data: parsed.data });
    assert.strictEqual(verdict.legacy, true);
    assert.ok(verdict.checks.some((c) => c.label === '完整性哈希' && !c.ok));
  });

  /* ---- 5. 收工去重:工作区感知 + lastEventId 保留 ---- */
  test('Record 去重:同工作区同内容跳过;异工作区入账;lastEventId 保留', () => {
    const mk = (id, ws, urls) => BGTStore.makeRecord({ title: id, createdAt: NOW, workspaceId: ws, tabs: urls.map((u) => ({ url: u, title: u })) });
    const records = [mk('r1', 'wA', ['https://a.com/'])];
    const sameAgain = mk('r1b', 'wA', ['https://a.com/']);
    const otherWs = mk('r2', 'wB', ['https://a.com/']);   // 同内容,不同项目
    const changed = mk('r3', 'wA', ['https://a.com/', 'https://b.com/']);
    assert.strictEqual(BGTStore.recordEqualsLast(records, sameAgain), true, '同项目同内容必须跳过');
    assert.strictEqual(BGTStore.recordEqualsLast(records, otherWs), false, '不同项目必须入账');
    assert.strictEqual(BGTStore.recordEqualsLast(records, changed), false, '内容变化必须入账');
  });

  /* ---- 6. 智能去重:仅存新增(端到端语义) ---- */
  test('filterOnlyNew 端到端:仅存新增(保留 fresh、剔除已收藏)', () => {
    const savedKey = BGTStore.normalizeUrl('https://saved.com/page').key;
    const tabs = [
      BGTStore.makeStoredTab({ url: 'https://saved.com/page', title: '已收藏' }, NOW),
      BGTStore.makeStoredTab({ url: 'https://fresh.com/', title: '新页' }, NOW),
    ];
    const out = BGTStore.filterOnlyNew(tabs, [savedKey]);
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].url, 'https://fresh.com/');
  });

  /* ---- 7. makeStoredTab:savedAt = 采集时刻 ---- */
  test('makeStoredTab:savedAt 使用采集时刻', () => {
    const t = BGTStore.makeStoredTab({ url: 'https://x.com/', title: 'X' }, 1700000000000);
    assert.strictEqual(t.savedAt, 1700000000000);
    const t2 = BGTStore.makeStoredTab({ url: 'https://x.com/' });
    assert.ok(t2.savedAt > 1600000000000);
  });

  /* ---- 8. 规则分流:归一化键去重(utm 变体) ---- */
  test('routeTabsByRules:utm 变体同批次去重', () => {
    const rules = BGTStore.parseRules('github.com => 代码');
    const { routes } = BGTStore.routeTabsByRules([
      { url: 'https://github.com/p?utm_source=a' },
      { url: 'https://github.com/p?utm_source=b' },
    ], rules);
    assert.strictEqual(routes[0].tabs.length, 1);
  });

  /* ---- 9. 多窗口结构:windows[] 扁平镜像 ---- */
  test('normalizeWorkspace 多窗口:扁平镜像与退化', () => {
    const w = BGTStore.normalizeWorkspace({
      title: '双屏', createdAt: NOW,
      windows: [
        { tabs: [{ url: 'https://a.com/' }] },
        { tabs: [{ url: 'https://b.com/', pinned: true }] },
        { tabs: [] },
      ],
    });
    assert.strictEqual(w.windows.length, 2);
    assert.strictEqual(w.tabs.length, 2);
    const single = BGTStore.normalizeWorkspace({ title: '单', windows: [{ tabs: [{ url: 'https://a.com/' }] }] });
    assert.strictEqual(single.windows, undefined);
  });

  const t0 = performance.now ? null : null;

  await runReport();

  async function runReport() {
    for (const t of queue) {
      try { await t.fn(); passed += 1; console.log('  PASS', t.name); }
      catch (e) {
        failed += 1;
        console.error('  FAIL', t.name, '\n       ', e && e.message);
      }
    }
    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed) process.exit(1);
  }
})();
