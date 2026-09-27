/**
 * Tab Harbor(原 Better Group Tabs)— Service Worker (MV3)
 * 职责:保存流水线、键盘快捷键、v1→v2 迁移、工具栏徽章、
 *       定时快照(崩溃恢复)、右键菜单存入分组、omnibox 搜索。
 */
'use strict';

importScripts('shared/i18n.js', 'shared/store.js', 'shared/garden.js'); // garden:WP-5.4 快照磁盘通道(SW 内可直接用 IndexedDB 取句柄)

const BADGE_COLOR = '#0891b2';
const BADGE_OK_COLOR = '#16a34a';   // 右键菜单动作成功时的徽章色
const SNAPSHOT_ALARM = 'bgt-snapshot';
const SNAPSHOT_KEEP = 3;
const BACKUP_ALARM = 'bgt-daily-backup';
const BACKUP_FILE = 'tab-harbor-backup.json';

/* ---------------- 保存流水线 ---------------- */

/** 过滤掉插件自身页面,避免把管理页/弹窗页存进分组 */
function ownPages(tabs) {
  const base = chrome.runtime.getURL('');
  return tabs.filter((t) => typeof t.url === 'string' && !t.url.startsWith(base));
}

function defaultGroupTitle() {
  return BGTStore.defaultGroupTitle();
}

/** 统计一组新标签里,有多少网址在此前已保存过(重复保存) */
function countRepeatedUrls(data, group) {
  const seen = new Set();
  for (const g of data.groups) {
    for (const t of g.tabs) seen.add(BGTStore.normalizeUrl(t.url).key);
  }
  return group.tabs.filter((t) => seen.has(BGTStore.normalizeUrl(t.url).key)).length;
}

/** 保存过滤:按设置剔除固定标签/当前页/特殊页/重复网址,并生成 v2 标签对象 —— 见 store.buildGroup */

/**
 * 保存时自动套用整理规则:命中规则的标签分流进对应分组(同名追加去重,无则新建)。
 * 返回分流后的"剩余"分组(可能为 null)与路由统计。
 */
function applyRulesOnGroup(data, group, settings) {
  const rules = BGTStore.parseRules(settings.tidyRules);
  if (!settings.autoApplyRules || !rules.length) return { group, routed: 0, routedTabs: [] };
  const { routes, rest } = BGTStore.routeTabsByRules(group.tabs, rules);
  if (!routes.length) return { group, routed: 0, routedTabs: [] };
  BGTStore.applyRoutedGroups(data, routes);
  const routedTabs = routes.reduce((acc, r) => acc.concat(r.tabs), []);
  if (!rest.length) return { group: null, routed: routedTabs.length, routedTabs };
  group.tabs = rest;
  return { group, routed: routedTabs.length, routedTabs };
}

async function saveWindow(windowIdOpt, opts) {
  opts = opts || {};
  const data = await BGTStore.load();
  const settings = data.settings;

  const query = windowIdOpt != null ? { windowId: windowIdOpt } : { currentWindow: true };
  const rawTabs = ownPages(await chrome.tabs.query(query));
  if (!rawTabs.length) return { ok: false, reason: 'empty' };

  const activeUrl = (rawTabs.find((t) => t.active) || {}).url || '';
  let group = BGTStore.buildGroup(rawTabs, settings, { activeUrl });
  if (!group) return { ok: false, reason: 'empty' };

  // 智能去重(仅存新增):manager 预检传入"要保存的新增身份键集合"
  const newOnly = BGTStore.filterOnlyNew(group.tabs, opts.onlyNewKeys);
  if (opts.onlyNewKeys && opts.onlyNewKeys.length && !newOnly.length) {
    return { ok: true, saved: 0, allKnown: true };
  }
  group.tabs = newOnly;

  const dupCount = countRepeatedUrls(data, group);
  group.title = opts.title || defaultGroupTitle();
  const ruled = applyRulesOnGroup(data, group, settings);
  group = ruled.group;
  if (group) data.groups.unshift(group);
  await BGTStore.persist(data);

  // 先开管理页(保住窗口不被关空),再按设置关闭已保存标签
  if (settings.openManagerAfterSave && !opts.fromManager) {
    await chrome.tabs.create({ url: chrome.runtime.getURL(BGTStore.MANAGER_PAGE) });
  }
  // accepted = 剩余分组标签 + 已被规则自动归组的标签(P1-2:它们同样"已保存",都应关闭)
  const acceptedTabs = (group ? group.tabs : []).concat(ruled.routedTabs || []);
  if (acceptedTabs.length) await closeSavedTabs(rawTabs, { tabs: acceptedTabs }, settings);
  return {
    ok: true,
    saved: acceptedTabs.length,
    dupCount,
    autoRouted: ruled.routed,
  };
}

async function saveAllWindows(opts) {
  opts = opts || {};
  const data = await BGTStore.load();
  const settings = data.settings;
  const windows = await chrome.windows.getAll({ populate: true });

  const results = [];
  for (let i = 0; i < windows.length; i += 1) {
    const rawTabs = ownPages(windows[i].tabs || []);
    if (!rawTabs.length) continue;
    const activeUrl = (rawTabs.find((t) => t.active) || {}).url || '';
    const built = BGTStore.buildGroup(rawTabs, settings, { activeUrl });
    if (!built) continue;
    built.title = tr('{name} · 窗口 {n}', { name: defaultGroupTitle(), n: i + 1 });
    const dupCount = countRepeatedUrls(data, built); // 必须在插入前统计
    const ruled = applyRulesOnGroup(data, built, settings);
    if (ruled.group) data.groups.unshift(ruled.group);
    results.push({ rawTabs, group: ruled.group, dupCount, routed: ruled.routed });
  }

  if (!results.length) return { ok: false, reason: 'empty' };
  await BGTStore.persist(data);

  // 管理页只开一次;先开页保住窗口,再逐个关闭已保存标签
  if (settings.openManagerAfterSave && !opts.fromManager) {
    await chrome.tabs.create({ url: chrome.runtime.getURL(BGTStore.MANAGER_PAGE) });
  }
  for (const r of results) if (r.group) await closeSavedTabs(r.rawTabs, r.group, settings);

  return {
    ok: true,
    saved: results.reduce((n, r) => n + (r.group ? r.group.tabs.length : 0), 0),
    groups: results.filter((r) => r.group).length,
    dupCount: results.reduce((n, r) => n + r.dupCount, 0),
    autoRouted: results.reduce((n, r) => n + r.routed, 0),
  };
}

/** 按设置关闭已保存的标签页 */
async function closeSavedTabs(rawTabs, group, settings) {
  if (!settings.closeSavedTabs || !group) return;
  const savedKeys = BGTStore.keySet(group.tabs); // 身份键:与"已保存过"的判定同一语义
  const ids = rawTabs.filter((t) => savedKeys.has(BGTStore.normalizeUrl(t.url).key)).map((t) => t.id);
  if (ids.length) {
    try {
      await chrome.tabs.remove(ids);
    } catch (e) {
      /* 标签可能已被用户关闭 */
    }
  }
}

/* ---------------- 定时快照(崩溃恢复) ---------------- */

async function snapshotAllWindows(force) {
  const data = await BGTStore.load();
  if (!force && !data.settings.autoSnapshot) return;

  const now = Date.now();
  const windows = await chrome.windows.getAll({ populate: true });
  const tabs = [];
  for (const w of windows) {
    for (const t of ownPages(w.tabs || [])) {
      if (!t.url || t.url === 'about:blank') continue;
      tabs.push(BGTStore.makeStoredTab(t, now));
    }
  }
  if (!tabs.length) return;

  const snap = BGTStore.makeSnapshot(tabs);
  const list = await BGTStore.loadSnapshots();
  if (list.length && list[list.length - 1].hash === snap.hash) return; // 无变化不重复存
  list.push(snap);
  await BGTStore.saveSnapshots(list);
}

/* ---------------- 工作区:收工 / 开工 ---------------- */

/**
 * 收工:把当前聚焦窗口(或全部窗口)的标签存为命名工作区。
 * 同名工作区覆盖更新(闭环"每天收工"的场景);随后关闭这些标签(可选),先开新标签页保住窗口。
 * allWindows 时存为多窗口结构 windows[](多显示器),tabs 保持扁平镜像。
 */
async function saveWorkspace(title, opts) {
  opts = opts || {};
  const data = await BGTStore.load();
  const base = chrome.runtime.getURL('');
  const all = await chrome.windows.getAll({ populate: true });
  const focused = all.find((w) => w.focused) || all[0];
  if (!focused) return { ok: false, reason: 'empty' };

  const winList = opts.allWindows ? all : [focused];
  const now = Date.now();
  const winGroups = [];
  const rawPerWindow = [];
  for (const w of winList) {
    const rawTabs = (w.tabs || []).filter((t) =>
      typeof t.url === 'string' && !t.url.startsWith(base) && t.url !== 'about:blank');
    if (!rawTabs.length) continue;
    rawPerWindow.push({ windowId: w.id, rawTabs });
    winGroups.push({
      tabs: rawTabs.map((t) => BGTStore.makeStoredTab(t, now)),
    });
  }
  if (!winGroups.length) return { ok: false, reason: 'empty' };

  const tabs = winGroups.reduce((acc, g) => acc.concat(g.tabs), []);
  title = (title || '').trim() || defaultGroupTitle();
  // 2.1a(决策 2026-09-27):同名从"身份"降级为"可见的绑定建议"——
  // 身份交给稳定 ID,名字是非唯一显示名(允许重名);默认仍是更新,但冲突必须先对用户
  // 可见(显示将被覆盖的是什么),选择经 autoUpdate 记住
  const mode = (opts && opts.updateMode) || ''; // ''(未指明,由 autoUpdate 决定) | 'update' | 'new'
  const updateId = (opts && opts.updateId) || '';
  const remember = !!(opts && opts.remember);
  const matches = data.workspaces.filter((w) => w.title === title);
  const payload = {
    title, createdAt: now, tabs,
    windows: winGroups.length > 1 ? winGroups : undefined,
  };
  const brief = (w) => ({ id: w.id, title: w.title, tabs: w.tabs.length, savedAt: w.createdAt, autoUpdate: !!w.autoUpdate });
  let existing = null;
  if (mode === 'update') {
    existing = (updateId && matches.find((w) => w.id === updateId)) || (matches.length === 1 ? matches[0] : null);
    if (!existing) return { ok: false, reason: 'name-ambiguous', candidates: matches.map(brief) };
  } else if (mode !== 'new' && matches.length) {
    const autos = matches.filter((w) => w.autoUpdate);
    if (autos.length === 1) {
      existing = autos[0]; // "每天重复收工":用户看过冲突并选了更新 → 零提示直接更新
    } else if (matches.length === 1) {
      return { ok: false, reason: 'name-conflict', conflict: brief(matches[0]) };
    } else {
      return { ok: false, reason: 'name-ambiguous', candidates: matches.map(brief) };
    }
  }
  let wsId;
  if (existing) {
    // 覆盖更新只刷新"本次收工应收割的字段",不得全量铺:
    // normalizeWorkspace 会把 payload 里没有的 lastEventId/lastRestoredAt 填成 undefined/0
    // 一并 assign 进去 —— v3.11.1 声称已修 lastEventId 保留,但只盖住了"新建了记录"的回填分支;
    // recordEqualsLast 命中(去重)的那次收工仍会丢 lastEventId(工作区引用退化成 :static,
    // 与记录事件不再去重,×N 虚高),lastRestoredAt 则每次覆盖都被重置(卡片"开工于…"消失)
    const keepEventId = existing.lastEventId;
    const keepRestoredAt = existing.lastRestoredAt;
    Object.assign(existing, BGTStore.normalizeWorkspace(payload), { id: existing.id });
    existing.createdAt = now; // 覆盖更新,视为最新一次收工
    existing.lastEventId = keepEventId;        // 若本次新建了记录,下方 wsRef 回填会覆盖为最新 rec.id
    existing.lastRestoredAt = keepRestoredAt;
    if (remember) existing.autoUpdate = true;  // 用户看过"将被覆盖的是什么"仍选更新 → 以后不再问
    wsId = existing.id;
  } else {
    const wsObj = BGTStore.normalizeWorkspace(payload);
    data.workspaces.unshift(wsObj);
    wsId = wsObj.id;
  }

  // 工作记录(不可变日志):每次收工入账;与上一条 hash 相同则跳过
  let recordCreated = false;
  const rec = BGTStore.makeRecord({
    title, createdAt: now, tabs: tabs.map((t) => ({ ...t })), workspaceId: wsId, source: 'clockout',
  });
  if (!BGTStore.recordEqualsLast(data.records, rec)) {
    data.records = (data.records || []).concat(rec).slice(-BGTStore.RECORDS_MAX);
    recordCreated = true;
    // 事件对齐:工作区引用指向本次 capture 事件(身份计数用)
    const wsRef = data.workspaces.find((w) => w.id === wsId);
    if (wsRef) wsRef.lastEventId = rec.id;
  }
  await BGTStore.persist(data);

  if (opts.closeTabs !== false) {
    try {
      await chrome.tabs.create({ windowId: focused.id }); // 新标签页保住聚焦窗口
      const ids = rawPerWindow.reduce((acc, r) => acc.concat(r.rawTabs.map((t) => t.id)), []);
      if (ids.length) await chrome.tabs.remove(ids); // 非聚焦窗口随最后一个标签自动关闭
    } catch (e) { /* 标签可能已被关闭 */ }
  }
  return { ok: true, saved: tabs.length, title, windows: winGroups.length, recordCreated };
}

/** 开工:把工作区恢复为新窗口 / 当前窗口 / 替换当前窗口,固定标签原样保留。
 *  多窗口工作区:new 模式逐窗口还原;'current'/'replace' 模式扁平合并进当前窗口。 */

/* ---------------- 2.1b:活窗口 ↔ 项目绑定 ----------------
 * 绑定住 chrome.storage.session:跨 SW 回收存活、浏览器关闭即消失 ——
 * "这个窗口正在做哪个项目"是会话事实,不是历史事实。
 * 摘录在采集瞬间把归属冻结进自身(excerpt.workspaceId),此后与会话无关;
 * 绑定是事实,名字只是显示 —— 不再从名字猜意图。 */
const WS_BINDING_KEY = 'bgtWindowBindings'; // { [windowId]: workspaceId }

async function bindWindowToWorkspace(windowId, workspaceId) {
  if (!windowId || !workspaceId || !chrome.storage || !chrome.storage.session) return;
  try {
    const res = await chrome.storage.session.get(WS_BINDING_KEY);
    const map = (res && res[WS_BINDING_KEY]) || {};
    map[String(windowId)] = workspaceId;
    await chrome.storage.session.set({ [WS_BINDING_KEY]: map });
  } catch (e) { /* 绑定失败不影响开工 */ }
}

async function lookupWindowBinding(windowId) {
  if (windowId == null || !chrome.storage || !chrome.storage.session) return null;
  try {
    const res = await chrome.storage.session.get(WS_BINDING_KEY);
    const map = (res && res[WS_BINDING_KEY]) || {};
    return map[String(windowId)] || null;
  } catch (e) { return null; }
}

if (chrome.windows && chrome.windows.onRemoved) {
  chrome.windows.onRemoved.addListener((windowId) => {
    // 窗口关闭即解除绑定(会话存储随浏览器消亡,这里只是即时卫生)
    chrome.storage.session.get(WS_BINDING_KEY).then((res) => {
      const map = (res && res[WS_BINDING_KEY]) || {};
      if (map[String(windowId)]) {
        delete map[String(windowId)];
        chrome.storage.session.set({ [WS_BINDING_KEY]: map });
      }
    }).catch(() => {});
  });
}

async function restoreWorkspace(workspaceId, mode) {
  const data = await BGTStore.load();
  const ws = data.workspaces.find((w) => w.id === workspaceId);
  if (!ws || !ws.tabs.length) return { ok: false, reason: 'empty' };
  const windows = (ws.windows && ws.windows.length) ? ws.windows : [{ tabs: ws.tabs }];

  let restored = 0;

  async function createTab(props) {
    try {
      await chrome.tabs.create(props);
      restored += 1;
    } catch (e) { /* 单个失败继续 */ }
  }
  if (mode === 'replace' || mode === 'current') {
    // 扁平合并进当前(或最后聚焦)窗口;replace 先恢复再清掉原有标签
    // populate: true 必需 —— 否则 cur.tabs 为 undefined,'replace' 模式永远清不掉原有标签
    const cur = await chrome.windows.getLastFocused({ populate: true });
    const oldIds = mode === 'replace' ? (cur.tabs || []).map((t) => t.id) : [];
    for (let i = 0; i < ws.tabs.length; i += 1) {
      await createTab({
        windowId: cur.id, url: ws.tabs[i].url, pinned: ws.tabs[i].pinned, active: i === 0,
      });
    }
    if (restored && oldIds.length) {
      try { await chrome.tabs.remove(oldIds); } catch (e) { /* 可能已关 */ }
    }
    await bindWindowToWorkspace(cur.id, workspaceId); // 2.1b:接收标签的窗口即属于该项目
  } else if (windows.length > 1) {
    // 多窗口:逐窗口还原
    for (let wi = 0; wi < windows.length; wi += 1) {
      const group = windows[wi];
      if (!group.tabs.length) continue;
      const first = group.tabs[0];
      const win = await chrome.windows.create({ url: first.url, focused: wi === 0 });
      if (first.pinned && win.tabs && win.tabs[0]) {
        await chrome.tabs.update(win.tabs[0].id, { pinned: true });
      }
      restored += 1;
      await bindWindowToWorkspace(win.id, workspaceId); // 2.1b:逐窗口绑定
      for (const t of group.tabs.slice(1)) {
        await createTab({ windowId: win.id, url: t.url, pinned: t.pinned, active: false });
      }
    }
  } else {
    const first = ws.tabs[0];
    const win = await chrome.windows.create({ url: first.url, focused: true });
    if (first.pinned && win.tabs && win.tabs[0]) {
      await chrome.tabs.update(win.tabs[0].id, { pinned: true });
    }
    restored = 1;
    await bindWindowToWorkspace(win.id, workspaceId); // 2.1b
    for (const t of ws.tabs.slice(1)) {
      await createTab({ windowId: win.id, url: t.url, pinned: t.pinned, active: false });
    }
  }
  ws.lastRestoredAt = Date.now();
  await BGTStore.persist(data);
  return { ok: true, restored, failed: ws.tabs.length - restored, windows: windows.length };
}

/* ---------------- 每日全量备份(本地滚动 + 云端 WebDAV) ---------------- */

async function makeLocalBackup(force) {
  const data = await BGTStore.load();
  const payload = BGTStore.makeFullBackup(data);
  // 全量指纹:覆盖 groups/workspaces/records/settings(此前漏 records/settings)
  const fingerprint = BGTStore.stateFingerprint(payload);
  const backups = await BGTStore.loadBackups();
  const last = backups[backups.length - 1];
  if (!force && last && last.fingerprint === fingerprint) return { ok: true, skipped: true };
  const payloadHash = await BGTStore.hashPayload(payload);
  const manifest = BGTStore.makeBackupManifest(payloadHash, payload,
    chrome.runtime.getManifest ? chrome.runtime.getManifest().version : '');
  backups.push({ id: BGTStore.genId('b'), at: Date.now(), fingerprint, manifest, data: payload });
  await BGTStore.saveBackups(backups);
  return { ok: true, skipped: false, count: backups.length };
}

/** WebDAV 基础请求(Basic 认证);返回 {ok, status, text} */
function webdavUrl(config, filename) {
  const base = (config.url || '').replace(/\/+$/, '');
  const dir = (config.dir || '').replace(/^\/+|\/+$/g, '');
  return [base, dir, filename].filter(Boolean).join('/');
}

function webdavAuth(config) {
  const bytes = new TextEncoder().encode(`${config.user || ''}:${config.pass || ''}`);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return 'Basic ' + btoa(bin);
}

function webdavConfigured(settings) {
  const w = settings.webdav;
  return !!(w && w.url && /^https?:\/\//i.test(w.url));
}

async function webdavRequest(method, config, filename, body) {
  const res = await fetch(webdavUrl(config, filename), {
    method,
    headers: Object.assign(
      { Authorization: webdavAuth(config) },
      body != null ? { 'Content-Type': 'application/json' } : {},
    ),
    body: body != null ? body : undefined,
  });
  const text = await res.text().catch(() => '');
  return { ok: res.ok, status: res.status, text };
}

async function cloudBackupNow(settings) {
  if (!webdavConfigured(settings)) return { ok: false, reason: 'no-config' };
  const data = await BGTStore.load();
  const payload = BGTStore.makeFullBackup(data, { stripSecrets: true });
  const payloadHash = await BGTStore.hashPayload(payload);
  const envelope = {
    app: 'tab-harbor',
    kind: 'full-envelope',
    manifest: BGTStore.makeBackupManifest(payloadHash, payload,
      chrome.runtime.getManifest ? chrome.runtime.getManifest().version : ''),
    data: payload,
  };
  const res = await webdavRequest('PUT', settings.webdav, BACKUP_FILE, JSON.stringify(envelope));
  if (!res.ok) {
    const meta = await BGTStore.loadCloudMeta();
    meta.lastCloudError = 'http-' + res.status;
    await BGTStore.saveCloudMeta(meta);
    return { ok: false, reason: 'http-' + res.status };
  }
  const meta = await BGTStore.loadCloudMeta();
  meta.lastCloudBackupAt = Date.now();
  meta.cloudSyncedFingerprint = BGTStore.stateFingerprint(payload);
  meta.lastCloudError = '';
  await BGTStore.saveCloudMeta(meta);
  return { ok: true, file: webdavUrl(settings.webdav, BACKUP_FILE), lastCloudBackupAt: meta.lastCloudBackupAt };
}

async function cloudRestore(settings) {
  if (!webdavConfigured(settings)) return { ok: false, reason: 'no-config' };
  const res = await webdavRequest('GET', settings.webdav, BACKUP_FILE);
  if (!res.ok) return { ok: false, reason: 'http-' + res.status };
  let parsed;
  try {
    parsed = BGTStore.parseBackup(res.text); // v2 信封或 v1 裸 payload
  } catch (e) {
    return { ok: false, reason: 'bad-file' };
  }
  // 信任链:远端哈希先行验证(旧格式诚实标注)
  if (parsed.manifest && parsed.manifest.payloadHash) {
    const remoteHash = await BGTStore.hashPayload(parsed.data);
    if (remoteHash !== parsed.manifest.payloadHash) return { ok: false, reason: 'hash-mismatch' };
  }
  // 恢复前先在本地留一份全量备份(可回退)
  await makeLocalBackup(true);
  const data = await BGTStore.load();
  const restored = BGTStore.applyFullRestore(data, parsed.data);
  data.groups = restored.groups;
  data.workspaces = restored.workspaces;
  data.records = restored.records;
  data.settings = restored.settings; // 本机 WebDAV 配置由 applyFullRestore 保留
  await BGTStore.persist(data);
  return { ok: true, groups: data.groups.length, exportedAt: parsed.manifest ? parsed.manifest.createdAt : '' };
}

/** WebDAV 连通性测试:上传并删除探测文件 */
async function cloudTest(settings) {
  if (!webdavConfigured(settings)) return { ok: false, reason: 'no-config' };
  const probe = { app: 'tab-harbor', kind: 'probe', at: Date.now() };
  const put = await webdavRequest('PUT', settings.webdav, 'tab-harbor-probe.json', JSON.stringify(probe));
  if (!put.ok) return { ok: false, reason: 'http-' + put.status };
  try {
    await fetch(webdavUrl(settings.webdav, 'tab-harbor-probe.json'), {
      method: 'DELETE', headers: { Authorization: webdavAuth(settings.webdav) },
    });
  } catch (e) { /* 清理失败不影响判定 */ }
  return { ok: true };
}

/* ---------------- 右键菜单:存入分组 ---------------- */

let lastMenuFp = '';

async function rebuildContextMenus() {
  if (!chrome.contextMenus) return;
  const data = await BGTStore.load();
  // 指纹守卫:菜单内容未变化时跳过重建,避免每次保存都 removeAll/create
  const fp = JSON.stringify([
    data.groups.filter((g) => !g.archived).slice(0, 8)
      .map((g) => [g.id, g.title || '', g.tabs.length]),
  ]);
  if (fp === lastMenuFp) return;
  lastMenuFp = fp;
  try {
    await chrome.contextMenus.removeAll();
  } catch (e) { /* noop */ }
  // create 不抛异常;连续重建时的竞态 lastError 通过回调吸收
  const create = (opts) => {
    try {
      chrome.contextMenus.create(opts, () => void chrome.runtime.lastError);
    } catch (e) { /* noop */ }
  };
  create({
    id: 'bgt-new',
    title: tr('把此页面存为新分组'),
    contexts: ['page', 'link'],
  });
  create({
    id: 'bgt-excerpt', // Wave 3.1:唯一"零新权限"的内容级信号(已声明的 contextMenus + selection 上下文)
    title: tr('把选中文字存为摘录'),
    contexts: ['selection'],
  });
  create({
    id: 'bgt-snapshot', // WP-5.4(T2):可选权限 pageCapture,首次使用时在手势内申请
    title: tr('把此页面存为完整快照(MHTML)'),
    contexts: ['page'],
  });
  const groups = data.groups.filter((g) => !g.archived).slice(0, 8);
  if (groups.length) {
    create({
      id: 'bgt-parent',
      title: tr('存入已有分组'),
      contexts: ['page'],
    });
    for (const g of groups) {
      create({
        id: 'g:' + g.id,
        parentId: 'bgt-parent',
        title: (g.title || tr('未命名分组')) + ` (${g.tabs.length})`,
        contexts: ['page'],
      });
    }
  }
}

/**
 * 右键菜单动作的用户反馈。
 * SKILL 强制规则 9:右键菜单执行了动作就必须给反馈,不能悄无声息。
 * 做法:徽章闪一个 ✓,2.2s 后恢复为分组数。不引入 notifications 权限(少一项审核面)。
 * 取舍:若 SW 恰好在这 2.2s 窗口内被回收,徽章可能停在 ✓ —— 它会在下一次 storage
 * 变化或 SW 重启时自愈(updateBadge 每次都会重算)。
 */
let badgeFlashTimer = null;
function flashBadge() {
  try {
    chrome.action.setBadgeText({ text: '✓' });
    chrome.action.setBadgeBackgroundColor({ color: BADGE_OK_COLOR });
  } catch (e) { return; }
  clearTimeout(badgeFlashTimer);
  badgeFlashTimer = setTimeout(async () => {
    badgeFlashTimer = null;
    try { updateBadge(await BGTStore.load()); } catch (e) { /* 忽略 */ }
  }, 2200);
}

/** 把标签加入分组;返回是否有实际改动(供右键菜单反馈使用) */
async function addTabToGroup(groupId, tab) {
  if (!tab || !tab.url) return false;
  const data = await BGTStore.load();
  const group = data.groups.find((g) => g.id === groupId);
  const key = BGTStore.normalizeUrl(tab.url).key;
  if (!group || group.tabs.some((t) => BGTStore.normalizeUrl(t.url).key === key)) return false;
  group.tabs.push(BGTStore.makeStoredTab(tab));
  group.collapsed = false;
  await BGTStore.persist(data);
  return true;
}

/** WP-5.4(T2):把页面存为完整快照(MHTML)。
 *  纪律:① pageCapture 是可选权限,首次使用在手势内申请(此函数第一个 await 就是它);
 *  ② MHTML 1–5MB/页,**绝不进 chrome.storage.local**(ADR-001 §边界)—— 落盘到
 *  garden 目录的 snapshots/ 子目录;③ store 只留清单 {url,title,hash,bytes,path,at},
 *  hash 用与备份层同一 SHA-256 口径(crypto.subtle),复现 ADR-001 附录 A 的五处纪律。 */
async function saveFullSnapshot(tab) {
  if (!tab || tab.id == null || !tab.url || !/^https?:/i.test(tab.url)) return false;
  try {
    const granted = await chrome.permissions.request({ permissions: ['pageCapture'] });
    if (!granted) return false;
    const blob = await new Promise((resolve, reject) => {
      try {
        chrome.pageCapture.saveAsMHTML({ tabId: tab.id }, (b) => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(b);
        });
      } catch (e) { reject(e); }
    });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hash = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
    const dir = await BGTGarden.loadGardenHandle();
    if (!dir || !(await BGTGarden.ensurePermission(dir))) return false;
    const sub = await dir.getDirectoryHandle('snapshots', { create: true });
    const name = BGTGarden.safeFileName(tab.title || tab.url) + '-' + Date.now() + '.mhtml';
    await BGTGarden.writeFile(sub, name, bytes, false);
    const data = await BGTStore.load();
    data.pageSnapshots.unshift(BGTStore.normalizePageSnap({
      url: tab.url, title: (tab && tab.title) || '', hash, bytes: bytes.length,
      path: 'snapshots/' + name, at: Date.now(),
    }));
    await BGTStore.persist(data, { pageSnapshots: true }); // 只写清单键 + meta
    return true;
  } catch (e) {
    return false;
  }
}

async function onContextMenuClicked(info, tab) {
  let acted = false;
  if (info.menuItemId === 'bgt-new') {
    if (!tab || !tab.url) return;
    const data = await BGTStore.load();
    data.groups.unshift(BGTStore.normalizeGroup({
      title: BGTStore.defaultGroupTitle(),
      createdAt: Date.now(),
      tabs: [{ url: tab.url, title: tab.title, favIconUrl: tab.favIconUrl, pinned: tab.pinned }],
    }));
    await BGTStore.persist(data);
    acted = true;
  } else if (String(info.menuItemId).startsWith('g:')) {
    acted = await addTabToGroup(String(info.menuItemId).slice(2), tab);
  } else if (info.menuItemId === 'bgt-snapshot') {
    // WP-5.4(T2):完整快照。手势纪律:pageCapture 的权限申请必须在本分支
    // 第一个 await 之前发起(saveFullSnapshot 的首语句就是 permissions.request)
    acted = await saveFullSnapshot(tab);
  } else if (info.menuItemId === 'bgt-excerpt') {
    // 摘录走 SW 串行队列,只写 bgtExcerpts+meta(分键收益与写隔离由测试看守);
    // 2.1b:采集瞬间冻结归属 —— 绑定中的窗口里的摘录,记下它属于哪个项目
    acted = await BGTStore.mutate(async () => {
      const text = String(info.selectionText || '').trim();
      if (!text || !info.pageUrl) return false;
      const projectId = await lookupWindowBinding(tab && tab.windowId);
      const data = await BGTStore.load();
      data.excerpts.unshift(BGTStore.normalizeExcerpt({
        url: info.pageUrl,
        text,
        tabTitle: (tab && tab.title) || '',
        savedAt: Date.now(),
        workspaceId: projectId || undefined,
      }));
      await BGTStore.persist(data, { excerpts: true });
      return true;
    });
  }
  if (acted) flashBadge();
}

/* ---------------- omnibox:地址栏 bgt 搜索 ---------------- */

function searchEverything(data, text) {
  const q = text.trim().toLowerCase();
  const out = [];
  for (const g of data.groups) {
    const titleHit = (g.title || '').toLowerCase().includes(q);
    for (const t of g.tabs) {
      if (!q
          || titleHit
          || (t.title || '').toLowerCase().includes(q)
          || (t.url || '').toLowerCase().includes(q)) {
        out.push({ group: g, tab: t });
      }
      if (out.length >= 8) return out;
    }
  }
  return out;
}

function initOmnibox() {
  if (!chrome.omnibox) return;
  chrome.omnibox.onInputChanged.addListener(async (text, suggest) => {
    // 默认建议:没有精确命中时下拉框也有一句人话可读
    // (omnibox.md §Default Suggestion;setDefaultSuggestion 必须在 onInputChanged 内调用)
    if (chrome.omnibox.setDefaultSuggestion) {
      chrome.omnibox.setDefaultSuggestion({
        description: escapeXml(tr('搜索已保存的标签,或输入 1–9 直达泊位'))
          + ' <match>' + escapeXml(text) + '</match>',
      });
    }
    try {
      const data = await BGTStore.load();
      // 泊位速恢复:`1`-`9` 或 `#2`
      const berthMatch = /^#?([1-9])$/.exec(text.trim());
      if (berthMatch) {
        const berth = BGTStore.getBerths(data).find((b) => b.berth === Number(berthMatch[1]));
        if (berth) {
          suggest([{
            content: 'berth:' + berth.berth,
            description: '<dim>[' + escapeXml(tr('泊位 {n}', { n: berth.berth })) + ']</dim> '
              + escapeXml(berth.title) + ' (' + berth.tabs + ')',
          }]);
          return;
        }
      }
      const hits = searchEverything(data, text);
      suggest(hits.slice(0, 8).map((h) => ({
        content: 't:' + encodeURIComponent(h.tab.url),
        description: '<dim>[' + escapeXml(h.group.title || tr('未命名分组')) + ']</dim> ' + escapeXml(h.tab.title || h.tab.url),
      })));
    } catch (e) { /* 忽略建议失败 */ }
  });
  chrome.omnibox.onInputEntered.addListener(async (text, disposition) => {
    try {
      // 必须尊重 disposition(omnibox.md §Handling Selection):
      // currentTab 复用当前标签,newBackgroundTab(Alt+Enter)不得抢焦点。
      // 此前三条路径都调 chrome.tabs.create,等于把 currentTab 与 Alt+Enter 都变成了前台新标签。
      const openOne = async (url) => {
        if (disposition === 'currentTab') { await chrome.tabs.update({ url }); return; }
        await chrome.tabs.create({ url, active: disposition !== 'newBackgroundTab' });
      };
      if (text.startsWith('berth:')) {
        const data = await BGTStore.load();
        const berth = BGTStore.getBerths(data).find((b) => b.berth === Number(text.slice(6)));
        const g = berth && (data.groups || []).find((x) => x.id === berth.id);
        if (g && g.tabs.length) {
          // 泊位恢复要重建整个现场(多标签),currentTab 语义不适用:
          // 统一在最后聚焦窗口里开,只有明确要求后台时才全部不激活。
          const cur = await chrome.windows.getLastFocused();
          const quiet = disposition === 'newBackgroundTab';
          for (let i = 0; i < g.tabs.length; i += 1) {
            const tb = g.tabs[i];
            await chrome.tabs.create({
              windowId: cur.id, url: tb.url, pinned: tb.pinned,
              active: !quiet && i === 0,
            });
          }
        }
        return;
      }
      if (text.startsWith('t:')) { await openOne(decodeURIComponent(text.slice(2))); return; }
      const data = await BGTStore.load();
      const hits = searchEverything(data, text);
      if (hits.length) await openOne(hits[0].tab.url);
    } catch (e) { /* 忽略 */ }
  });
}

function escapeXml(s) {
  return String(s || '').replace(/[<>&'"]/g, (c) => (
    { '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]
  ));
}

/* ---------------- 消息路由 ---------------- */

/**
 * 全部消息路由。纯分发:只吃 msg、只吐响应对象,不直接碰 sendResponse。
 * 抽成独立函数的好处:① 全篇 async/await,不再用 .then(sendResponse) 适配;
 * ② 路由逻辑集中在一处,便于与 test/sw-routes.js 的断言对照。
 */
async function handleMessage(msg) {
  try {
    switch (msg && msg.action) {
      case 'saveWindow':
        return await saveWindow(null, { fromManager: !!msg.fromManager, onlyNewKeys: msg.__onlyNewKeys });
      case 'saveAllWindows':
        return await saveAllWindows({ fromManager: !!msg.fromManager });
      case 'openManager':
        await chrome.tabs.create({ url: chrome.runtime.getURL(BGTStore.MANAGER_PAGE) });
        return { ok: true };
      case 'openSidePanel': {
        // sidePanel.open() 需要用户手势(Chrome 文档:"through an extension user gesture"),
        // 且手势跨 sendMessage 只在这一条消息的第一个同步轮次内有效 —— 调用前 await
        // 任何东西(哪怕只是取 windowId)都会让手势失效并抛 "must be called during
        // a user gesture",异常随后被本函数的 catch 吞掉,用户看到的是"点了没反应"。
        // 所以 windowId 由 popup 事先取好传进来,让 open() 成为这里的第一条语句;
        // 手势在调用那一刻即已生效,其后的 await 只是等结果。
        if (chrome.sidePanel && chrome.sidePanel.open && msg.windowId != null) {
          const opened = chrome.sidePanel.open({ windowId: msg.windowId });
          await opened;
          return { ok: true };
        }
        await chrome.tabs.create({ url: chrome.runtime.getURL(BGTStore.MANAGER_PAGE) });
        return { ok: true, fallback: true };
      }
      case 'saveWorkspace':
        // allWindows 必须透传:漏传会让"包含全部窗口"静默失效(仅存聚焦窗口)
        // 2.1a:updateMode/updateId/remember 同样必须透传 —— "路由漏传参数"在本项目有过先例
        return await saveWorkspace(msg.title, {
          closeTabs: msg.closeTabs !== false, allWindows: !!msg.allWindows,
          updateMode: msg.updateMode, updateId: msg.updateId, remember: !!msg.remember,
        });
      case 'restoreWorkspace':
        return await restoreWorkspace(msg.workspaceId, msg.mode || 'new');
      case 'renameGroup':
        // Single Writer:列表级 UI 态写操作收口到 SW 串行执行,
        // 消除管理页防抖写与 Alt+S 后台保存的双写竞争
        return await BGTStore.mutate(async () => {
          const data = await BGTStore.load();
          const group = data.groups.find((g) => g.id === msg.groupId);
          if (!group) return { ok: false, reason: 'not-found' };
          group.title = String(msg.title || '').trim();
          await BGTStore.persist(data, { groups: true }); // ADR-001:改名只写 bgtGroups+bgtMeta,不重写 records
          return { ok: true, title: group.title };
        });
      case 'renameWorkspace':
        return await BGTStore.mutate(async () => {
          const data = await BGTStore.load();
          const ws = data.workspaces.find((w) => w.id === msg.workspaceId);
          if (!ws) return { ok: false, reason: 'not-found' };
          ws.title = String(msg.title || '').trim();
          await BGTStore.persist(data, { workspaces: true });
          return { ok: true, title: ws.title };
        });
      case 'saveSettings':
        // Single Writer(手册决策 2):设置类写入收口为 SW 补丁 —— 永远 load 新鲜状态、
        // 只写 meta。调用方(popup/设置页)不再持快照整包覆盖,与并发保存相遇时
        // 不可能再丢更新;补丁键按 DEFAULT_SETTINGS 白名单过滤
        return await BGTStore.mutate(async () => {
          const data = await BGTStore.load();
          const patch = (msg && msg.patch) || {};
          const clean = {};
          for (const k of Object.keys(patch)) {
            if (k in BGTStore.DEFAULT_SETTINGS) clean[k] = patch[k];
          }
          data.settings = Object.assign(data.settings, clean);
          await BGTStore.persist(data, {});
          return { ok: true, settings: data.settings };
        });
      case 'cloudTest':
        return await cloudTest(await (await BGTStore.load()).settings);
      case 'cloudBackupNow': {
        const res = await cloudBackupNow((await BGTStore.load()).settings);
        if (res.ok) await makeLocalBackup(true);
        return res;
      }
      case 'cloudRestore':
        return await cloudRestore(await (await BGTStore.load()).settings);
      case 'restoreGroup': {
        const data = await BGTStore.load();
        const group = data.groups.find((g) => g.id === msg.groupId);
        if (!group || !group.tabs.length) return { ok: false, reason: 'empty' };
        if (msg.mode === 'new') {
          const win = await chrome.windows.create({ url: group.tabs[0].url, focused: true });
          for (const t of group.tabs.slice(1)) {
            await chrome.tabs.create({ windowId: win.id, url: t.url, pinned: t.pinned, active: false });
          }
        } else {
          const cur = await chrome.windows.getCurrent();
          for (const t of group.tabs) {
            await chrome.tabs.create({ windowId: cur.id, url: t.url, pinned: t.pinned, active: false });
          }
        }
        return { ok: true, saved: group.tabs.length };
      }
      default:
        return { ok: false, reason: 'unknown-action' };
    }
  } catch (e) {
    return { ok: false, reason: String(e && e.message || e) };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    sendResponse(await handleMessage(msg));
  })();
  return true; // 异步应答:保持通道打开
});

/* ---------------- 快捷键 ---------------- */

if (chrome.commands && chrome.commands.onCommand) {
  chrome.commands.onCommand.addListener((command) => {
    if (command === 'save-current-window') saveWindow(null, {});
    if (command === 'save-all-windows') saveAllWindows({});
    if (command === 'save-workspace') saveWorkspace(undefined, { closeTabs: true });
  });
}

/* ---------------- 生命周期 ---------------- */

// MV3 纪律:事件监听器必须在 SW 顶层同步注册。写在 onInstalled/onStartup 回调里
// 有两个问题:① SW 被回收后若在其它时机重启,omnibox 监听器就缺失(地址栏建议失效);
// ② 同一实例内 onInstalled 与 onStartup 都触发时会被注册两次 → 建议重复。
// (contextMenus 的 create 是持久化的,放在生命周期回调里仍正确;omnibox 的 addListener 不是。)
initOmnibox();

chrome.runtime.onInstalled.addListener(async () => {
  let data = await BGTStore.load(); // load() 内部完成 v1 → v2 迁移
  const before = JSON.stringify(data.settings);
  data = BGTStore.applyVersionDefaults(data);
  if (JSON.stringify(data.settings) !== before) await BGTStore.persist(data);
  updateBadge(data);
  rebuildContextMenus();
  ensureAlarms();
});

chrome.runtime.onStartup.addListener(async () => {
  let data = await BGTStore.load();
  const before = JSON.stringify(data.settings);
  data = BGTStore.applyVersionDefaults(data);
  if (JSON.stringify(data.settings) !== before) await BGTStore.persist(data);
  updateBadge(data);
  rebuildContextMenus();
  ensureAlarms();
  runDailyBackup(); // 启动即补当日备份(内容无变化时自动跳过)
});

function ensureAlarms() {
  if (!chrome.alarms) return;
  chrome.alarms.create(SNAPSHOT_ALARM, { delayInMinutes: 2, periodInMinutes: 30 });
  chrome.alarms.create(BACKUP_ALARM, { delayInMinutes: 10, periodInMinutes: 6 * 60 });
}

/** 每日本地全量备份 + 已配置云端时自动上传 */
async function runDailyBackup() {
  try {
    const local = await makeLocalBackup(false);
    if (local.skipped) return;
    const settings = (await BGTStore.load()).settings;
    if (settings.dailyBackup && settings.webdav && settings.webdav.auto && webdavConfigured(settings)) {
      await cloudBackupNow(settings); // 云同步判定走 meta.cloudSyncedFingerprint,与本地去重解耦,失败可重试
    }
  } catch (e) { /* 备份失败不影响主功能 */ }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  // 分键后(ADR-001):徽章与右键菜单只依赖 groups 集合,听 bgtGroups 即可;
  // records/settings-only 的写入不再触发无谓的徽章刷新与菜单重建
  if (changes[BGTStore.GROUPS_KEY]) {
    updateBadge({ groups: changes[BGTStore.GROUPS_KEY].newValue });
    scheduleMenuRebuild(); // 保持右键菜单里的分组列表最新(防抖,避免频繁重建)
  }
});

/**
 * 重建右键菜单:刻意**不使用 setTimeout 防抖**。
 * service-worker.md 规则 3:计时器随 SW 回收而消失 —— 若 SW 在防抖窗口内被回收,
 * 菜单就永远停在旧内容上(没有任何后续事件会来补)。改为"在飞则合并"的循环:
 * 没有计时器、也不会漏更新。rebuildContextMenus 内部有指纹守卫,内容未变时立即返回,
 * 所以循环会迅速收敛。
 */
let menuBusy = false;
let menuDirty = false;
async function scheduleMenuRebuild() {
  if (menuBusy) { menuDirty = true; return; }
  menuBusy = true;
  try {
    do {
      menuDirty = false;
      await rebuildContextMenus();
    } while (menuDirty);
  } catch (e) {
    /* 菜单重建失败不影响主功能 */
  } finally {
    menuBusy = false;
  }
}

if (chrome.alarms) {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === SNAPSHOT_ALARM) snapshotAllWindows(false);
    if (alarm.name === BACKUP_ALARM) runDailyBackup();
  });
}

if (chrome.contextMenus) {
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    onContextMenuClicked(info, tab).catch(() => {});
  });
}

function updateBadge(data) {
  try {
    const n = data && Array.isArray(data.groups) ? data.groups.length : 0;
    chrome.action.setBadgeText({ text: n ? String(n) : '' });
    chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
  } catch (e) {
    /* 徽章失败不影响功能 */
  }
}
