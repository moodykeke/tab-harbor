/**
 * Service Worker 路由与接线测试:node test/sw-routes.js
 *
 * 这一套补的是"接缝":在真实加载的 background.js 上驱动消息路由与事件监听器。
 * v3.11.2 出包的 5 个 P0 里有 3 个(data 层之外的全部)本可以被这里拦住:
 *   - 消息路由漏传 allWindows
 *   - omnibox 调用未注入的 t()
 *   - getLastFocused() 未带 populate 导致 replace 模式失效
 */
'use strict';

const assert = require('assert');
const path = require('path');
const { createEnv } = require('./helpers/sw-env');
const BGTStore = require('../shared/store.js').BGTStore;

let passed = 0;
let failed = 0;
const queue = [];
function test(name, fn) { queue.push({ name, fn }); }

const EMPTY = () => BGTStore.emptyData();
const W1 = (tabs) => ({ id: 1, focused: true, tabs });
const T = (id, url) => ({ id, url, title: url });

/* ---- 1. 路由表存在性 ---- */

test('SW 路由:UI 会发出的每个 action 都被处理(无 unknown-action)', async () => {
  const ACTIONS = ['saveWindow', 'saveAllWindows', 'openManager', 'openSidePanel',
    'saveWorkspace', 'restoreWorkspace', 'renameGroup', 'renameWorkspace',
    'cloudTest', 'cloudBackupNow', 'cloudRestore', 'restoreGroup'];
  for (const action of ACTIONS) {
    const env = createEnv({ windows: [W1([])], storage: { bgtData: EMPTY() } });
    const res = await env.send({ action });
    assert.notStrictEqual(res && res.reason, 'unknown-action', action + ' 未被 SW 路由处理');
  }
});

/* ---- 2. 收工:多窗口参数透传 ---- */

test('saveWorkspace:allWindows 透传,两个窗口各存一条 windows[]', async () => {
  const env = createEnv({
    windows: [W1([T(11, 'https://a.com/')]), { id: 2, focused: false, tabs: [T(21, 'https://b.com/')] }],
    storage: { bgtData: EMPTY() },
  });
  const res = await env.send({ action: 'saveWorkspace', title: '多窗口', closeTabs: false, allWindows: true });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.windows, 2);
  const d = env.data();
  assert.strictEqual(d.workspaces.length, 1);
  assert.strictEqual(d.workspaces[0].windows.length, 2, 'windows[] 应有两条');
  assert.strictEqual(d.workspaces[0].tabs.length, 2, '扁平镜像应有 2 个标签');
});

test('saveWorkspace:不传 allWindows 时只存聚焦窗口(对照组)', async () => {
  const env = createEnv({
    windows: [W1([T(11, 'https://a.com/')]), { id: 2, focused: false, tabs: [T(21, 'https://b.com/')] }],
    storage: { bgtData: EMPTY() },
  });
  const res = await env.send({ action: 'saveWorkspace', title: '单窗口', closeTabs: false });
  assert.strictEqual(res.windows, 1);
  assert.strictEqual(env.data().workspaces[0].windows, undefined, '单窗口不落 windows 结构');
  assert.strictEqual(env.data().workspaces[0].tabs.length, 1);
});

/* ---- 3. 开工:replace 模式必须清掉原有标签 ---- */

test('restoreWorkspace mode replace:原有标签被移除(回归:getLastFocused 缺 populate)', async () => {
  const data = EMPTY();
  data.workspaces = [BGTStore.normalizeWorkspace({
    id: 'w1', title: 'W', tabs: [{ url: 'https://n1.com/' }, { url: 'https://n2.com/' }],
  })];
  const env = createEnv({
    windows: [W1([T(11, 'https://old1.com/'), T(12, 'https://old2.com/')])],
    storage: { bgtData: data },
  });
  const res = await env.send({ action: 'restoreWorkspace', workspaceId: 'w1', mode: 'replace' });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(env.callCount('tabs.remove'), 1, 'replace 必须清掉原有标签');
  const removed = env.callsOf('tabs.remove')[0].args[0].slice().sort((a, b) => a - b);
  assert.deepStrictEqual(removed, [11, 12]);
  const win = env.world.windows.find((w) => w.id === 1);
  assert.deepStrictEqual(win.tabs.map((t) => t.url), ['https://n1.com/', 'https://n2.com/']);
});

test('restoreWorkspace mode current:不清空原有标签(对照组)', async () => {
  const data = EMPTY();
  data.workspaces = [BGTStore.normalizeWorkspace({ id: 'w1', title: 'W', tabs: [{ url: 'https://n1.com/' }] })];
  const env = createEnv({
    windows: [W1([T(11, 'https://old1.com/')])],
    storage: { bgtData: data },
  });
  await env.send({ action: 'restoreWorkspace', workspaceId: 'w1', mode: 'current' });
  assert.strictEqual(env.callCount('tabs.remove'), 0);
  assert.strictEqual(env.world.windows.find((w) => w.id === 1).tabs.length, 2);
});

/* ---- 4. omnibox:顶层注册 + 泊位建议不抛异常 ---- */

test('omnibox 监听器在 SW 顶层同步注册(MV3 纪律)', async () => {
  const env = createEnv({ windows: [W1([])], storage: { bgtData: EMPTY() } });
  assert.ok(env.listenerCount('omnibox.onInputChanged') >= 1,
    'onInputChanged 必须在顶层注册,否则 SW 被回收后地址栏建议失效');
  assert.ok(env.listenerCount('omnibox.onInputEntered') >= 1);
});

test('omnibox 生命周期回调不会重复注册监听器', async () => {
  const env = createEnv({ windows: [W1([])], storage: { bgtData: EMPTY() } });
  env.fire('runtime.onInstalled');
  env.fire('runtime.onStartup');
  await env.settle();
  assert.strictEqual(env.listenerCount('omnibox.onInputChanged'), 1, '重复注册会让建议出现两遍');
});

test('omnibox 输入泊位号给出 berth 建议(回归:调用未注入的 t())', async () => {
  const data = EMPTY();
  data.groups = [BGTStore.normalizeGroup({
    id: 'g1', title: '工作', pinned: true, tabs: [{ url: 'https://a.com/', title: 'A' }],
  })];
  const env = createEnv({ windows: [W1([])], storage: { bgtData: data } });
  const got = [];
  env.fire('omnibox.onInputChanged', '1', (list) => got.push(list));
  await env.settle();
  assert.strictEqual(got.length, 1, 'suggest 未被调用(异常被 catch 吞掉了?)');
  assert.ok(got[0][0].content.startsWith('berth:'), '应给出泊位建议,实际: ' + JSON.stringify(got[0]));
  assert.ok(got[0][0].description.indexOf('工作') >= 0);
});

/* ---- 5. 重命名走 SW 串行端点 ---- */

test('renameGroup / renameWorkspace 真正落盘', async () => {
  const data = EMPTY();
  data.groups = [BGTStore.normalizeGroup({ id: 'g1', title: '旧名', tabs: [{ url: 'https://a.com/' }] })];
  data.workspaces = [BGTStore.normalizeWorkspace({ id: 'w1', title: '旧区', tabs: [{ url: 'https://b.com/' }] })];
  const env = createEnv({ windows: [W1([])], storage: { bgtData: data } });

  const r1 = await env.send({ action: 'renameGroup', groupId: 'g1', title: '新名' });
  assert.strictEqual(r1.ok, true);
  assert.strictEqual(env.data().groups[0].title, '新名');

  const r2 = await env.send({ action: 'renameWorkspace', workspaceId: 'w1', title: '新区' });
  assert.strictEqual(r2.ok, true);
  assert.strictEqual(env.data().workspaces[0].title, '新区');
});

test('renameGroup 对不存在的 id 返回 not-found', async () => {
  const env = createEnv({ windows: [W1([])], storage: { bgtData: EMPTY() } });
  const res = await env.send({ action: 'renameGroup', groupId: 'nope', title: 'x' });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.reason, 'not-found');
});

/* ---- 6. 保存流水线端到端 ---- */

test('saveWindow + onlyNewKeys:只存新增(端到端,回归 v3.10 语义反转)', async () => {
  const data = EMPTY();
  data.groups = [BGTStore.normalizeGroup({ id: 'g1', title: '已有', tabs: [{ url: 'https://known.com/' }] })];
  const env = createEnv({
    windows: [W1([{ id: 11, url: 'https://known.com/', title: 'Known', active: true },
      T(12, 'https://fresh.com/')])],
    storage: { bgtData: data },
  });
  const onlyNew = [BGTStore.normalizeUrl('https://known.com/').key];
  const res = await env.send({ action: 'saveWindow', fromManager: true, __onlyNewKeys: onlyNew });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.saved, 1);
  const fresh = env.data().groups[0];
  assert.deepStrictEqual(fresh.tabs.map((t) => t.url), ['https://fresh.com/']);
});

test('saveWindow 全部已收藏时返回 allKnown,不新建分组', async () => {
  const data = EMPTY();
  data.groups = [BGTStore.normalizeGroup({ id: 'g1', title: '已有', tabs: [{ url: 'https://known.com/' }] })];
  const env = createEnv({
    windows: [W1([{ id: 11, url: 'https://known.com/', title: 'K', active: true }])],
    storage: { bgtData: data },
  });
  const res = await env.send({
    action: 'saveWindow', fromManager: true,
    __onlyNewKeys: [BGTStore.normalizeUrl('https://known.com/').key],
  });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.allKnown, true);
  assert.strictEqual(env.data().groups.length, 1, '不应新建分组');
});

test('saveAllWindows:每个窗口一个分组', async () => {
  const env = createEnv({
    windows: [W1([T(11, 'https://a.com/'), T(12, 'https://b.com/')]),
      { id: 2, focused: false, tabs: [T(21, 'https://c.com/')] }],
    storage: { bgtData: EMPTY() },
  });
  const res = await env.send({ action: 'saveAllWindows', fromManager: true });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.groups, 2);
  assert.strictEqual(res.saved, 3);
  assert.strictEqual(env.data().groups.length, 2);
});

test('saveWindow 自动套用整理规则:命中标签归入规则分组', async () => {
  const data = EMPTY();
  data.settings.autoApplyRules = true;
  data.settings.tidyRules = 'github.com => 代码';
  const env = createEnv({
    windows: [W1([T(11, 'https://github.com/x'), T(12, 'https://news.com/y')])],
    storage: { bgtData: data },
  });
  const res = await env.send({ action: 'saveWindow', fromManager: true });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.autoRouted, 1);
  const codeGroup = env.data().groups.find((g) => g.title === '代码');
  assert.ok(codeGroup, '应出现规则分组「代码」');
  assert.deepStrictEqual(codeGroup.tabs.map((t) => t.url), ['https://github.com/x']);
  assert.strictEqual(env.data().groups.length, 2, '未命中的标签留在新建的日期分组');
});

/* ---- 7. 三层备份 ---- */

test('cloudBackupNow:上传 v2 信封、清单含 64 位哈希、云端副本剥离密码', async () => {
  const data = EMPTY();
  data.settings.webdav = { url: 'https://dav.example.com/dav/', user: 'u', pass: 'secret', dir: 'th', auto: false };
  data.groups = [BGTStore.normalizeGroup({ title: 'G', tabs: [{ url: 'https://a.com/' }] })];
  let putBody = null;
  const env = createEnv({
    windows: [W1([])],
    storage: { bgtData: data },
    fetch: (u, init) => {
      if (init && init.method === 'PUT') putBody = init.body;
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('') });
    },
  });
  const res = await env.send({ action: 'cloudBackupNow' });
  assert.strictEqual(res.ok, true);
  const env2 = JSON.parse(putBody);
  assert.strictEqual(env2.kind, 'full-envelope');
  assert.strictEqual(env2.manifest.payloadHash.length, 64);
  assert.strictEqual(env2.data.settings.webdav.pass, '', '云端副本必须剥离密码');
});

test('cloudRestore:payload 被篡改 → hash-mismatch 阻断恢复', async () => {
  const data = EMPTY();
  data.settings.webdav = { url: 'https://dav.example.com/dav/', user: 'u', pass: 'p', dir: '', auto: false };
  data.groups = [BGTStore.normalizeGroup({ title: 'G', tabs: [{ url: 'https://a.com/' }] })];
  const payload = BGTStore.makeFullBackup(data, { stripSecrets: true });
  const hash = await BGTStore.hashPayload(payload);
  const envelope = {
    app: 'tab-harbor', kind: 'full-envelope',
    manifest: BGTStore.makeBackupManifest(hash, payload, '3.11.3'),
    data: payload,
  };
  const tampered = JSON.parse(JSON.stringify(envelope));
  tampered.data.groups[0].title = '被篡改';
  const env = createEnv({
    windows: [W1([])], storage: { bgtData: data },
    fetch: () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(tampered)) }),
  });
  const res = await env.send({ action: 'cloudRestore' });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.reason, 'hash-mismatch');
});

test('cloudRestore:未篡改 → 成功全量恢复', async () => {
  const data = EMPTY();
  data.settings.webdav = { url: 'https://dav.example.com/dav/', user: 'u', pass: 'p', dir: '', auto: false };
  const payload = BGTStore.makeFullBackup(data, { stripSecrets: true });
  payload.groups = [BGTStore.normalizeGroup({ title: '云端分组', tabs: [{ url: 'https://c.com/' }] })];
  const hash = await BGTStore.hashPayload(payload);
  const envelope = {
    app: 'tab-harbor', kind: 'full-envelope',
    manifest: BGTStore.makeBackupManifest(hash, payload, '3.11.3'),
    data: payload,
  };
  const env = createEnv({
    windows: [W1([])], storage: { bgtData: data },
    fetch: () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(envelope)) }),
  });
  const res = await env.send({ action: 'cloudRestore' });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(env.data().groups[0].title, '云端分组');
});

/* ---- 8. 定时快照 / 右键菜单 / 徽章 ---- */

test('alarm 触发崩溃快照,写入 bgtSnapshots', async () => {
  const env = createEnv({
    windows: [W1([T(11, 'https://a.com/'), T(12, 'https://b.com/')])],
    storage: { bgtData: EMPTY() },
  });
  env.fire('alarms.onAlarm', { name: 'bgt-snapshot' });
  await env.settle(80);
  const snaps = env.storage.get('bgtSnapshots');
  assert.ok(Array.isArray(snaps) && snaps.length === 1, '应写入 1 份快照');
  assert.strictEqual(snaps[0].tabs.length, 2);
});

test('安装时重建右键菜单:根项 + 分组子项', async () => {
  const data = EMPTY();
  data.groups = [BGTStore.normalizeGroup({ id: 'g1', title: '工作', tabs: [{ url: 'https://a.com/' }] })];
  const env = createEnv({ windows: [W1([])], storage: { bgtData: data } });
  env.fire('runtime.onInstalled');
  await env.settle(80);
  assert.ok(env.callCount('contextMenus.removeAll') >= 1);
  const ids = env.callsOf('contextMenus.create').map((c) => c.args[0].id);
  assert.ok(ids.indexOf('bgt-new') >= 0, '缺少"存为新分组"');
  assert.ok(ids.indexOf('bgt-parent') >= 0, '缺少"存入已有分组"');
  assert.ok(ids.indexOf('g:g1') >= 0, '缺少分组子项');
});

test('storage 变化时更新徽章为分组数', async () => {
  const env = createEnv({ windows: [W1([])], storage: { bgtData: EMPTY() } });
  const data = EMPTY();
  data.groups = [BGTStore.normalizeGroup({ title: 'A', tabs: [] }), BGTStore.normalizeGroup({ title: 'B', tabs: [] })];
  await env.chrome.storage.local.set({ bgtData: data });
  await env.settle(20);
  const last = env.callsOf('action.setBadgeText').pop();
  assert.strictEqual(last.args[0].text, '2');
});

run().then(() => {
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
});

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
