/**
 * Tab Harbor(原 Better Group Tabs)— Service Worker (MV3)
 * 职责:保存流水线、键盘快捷键、v1→v2 迁移、工具栏徽章、
 *       定时快照(崩溃恢复)、右键菜单存入分组、omnibox 搜索。
 */
'use strict';

importScripts('shared/i18n.js', 'shared/store.js');

const BADGE_COLOR = '#0891b2';
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
  const savedUrls = new Set(group.tabs.map((t) => t.url));
  const ids = rawTabs.filter((t) => savedUrls.has(t.url)).map((t) => t.id);
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
  const existing = data.workspaces.find((w) => w.title === title);
  const payload = {
    title, createdAt: now, tabs,
    windows: winGroups.length > 1 ? winGroups : undefined,
  };
  let wsId;
  if (existing) {
    Object.assign(existing, BGTStore.normalizeWorkspace(payload), { id: existing.id });
    existing.createdAt = now; // 覆盖更新,视为最新一次收工
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
    const cur = await chrome.windows.getLastFocused();
    const oldIds = mode === 'replace' ? (cur.tabs || []).map((t) => t.id) : [];
    for (let i = 0; i < ws.tabs.length; i += 1) {
      await createTab({
        windowId: cur.id, url: ws.tabs[i].url, pinned: ws.tabs[i].pinned, active: i === 0,
      });
    }
    if (restored && oldIds.length) {
      try { await chrome.tabs.remove(oldIds); } catch (e) { /* 可能已关 */ }
    }
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

async function addTabToGroup(groupId, tab) {
  if (!tab || !tab.url) return;
  const data = await BGTStore.load();
  const group = data.groups.find((g) => g.id === groupId);
  const key = BGTStore.normalizeUrl(tab.url).key;
  if (!group || group.tabs.some((t) => BGTStore.normalizeUrl(t.url).key === key)) return;
  group.tabs.push(BGTStore.makeStoredTab(tab));
  group.collapsed = false;
  await BGTStore.persist(data);
}

async function onContextMenuClicked(info, tab) {
  if (info.menuItemId === 'bgt-new') {
    if (!tab || !tab.url) return;
    const data = await BGTStore.load();
    data.groups.unshift(BGTStore.normalizeGroup({
      title: BGTStore.defaultGroupTitle(),
      createdAt: Date.now(),
      tabs: [{ url: tab.url, title: tab.title, favIconUrl: tab.favIconUrl, pinned: tab.pinned }],
    }));
    await BGTStore.persist(data);
    return;
  }
  if (String(info.menuItemId).startsWith('g:')) {
    await addTabToGroup(String(info.menuItemId).slice(2), tab);
  }
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
    try {
      const data = await BGTStore.load();
      // 泊位速恢复:`1`-`9` 或 `#2`
      const berthMatch = /^#?([1-9])$/.exec(text.trim());
      if (berthMatch) {
        const berth = BGTStore.getBerths(data).find((b) => b.berth === Number(berthMatch[1]));
        if (berth) {
          suggest([{
            content: 'berth:' + berth.berth,
            description: '<dim>[' + escapeXml(t('泊位 {n}', { n: berth.berth })) + ']</dim> '
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
  chrome.omnibox.onInputEntered.addListener(async (text) => {
    try {
      if (text.startsWith('berth:')) {
        const data = await BGTStore.load();
        const berth = BGTStore.getBerths(data).find((b) => b.berth === Number(text.slice(6)));
        const g = berth && (data.groups || []).find((x) => x.id === berth.id);
        if (g) {
          const cur = await chrome.windows.getLastFocused();
          for (const tb of g.tabs) {
            await chrome.tabs.create({ windowId: cur.id, url: tb.url, pinned: tb.pinned, active: false });
          }
        }
        return;
      }
      if (text.startsWith('t:')) {
        await chrome.tabs.create({ url: decodeURIComponent(text.slice(2)) });
        return;
      }
      const data = await BGTStore.load();
      const hits = searchEverything(data, text);
      if (hits.length) await chrome.tabs.create({ url: hits[0].tab.url });
    } catch (e) { /* 忽略 */ }
  });
}

function escapeXml(s) {
  return String(s || '').replace(/[<>&'"]/g, (c) => (
    { '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]
  ));
}

/* ---------------- 消息路由 ---------------- */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      switch (msg && msg.action) {
        case 'saveWindow':
          return await saveWindow(null, { fromManager: !!msg.fromManager, onlyNewKeys: msg.__onlyNewKeys });
        case 'saveAllWindows':
          return await saveAllWindows({ fromManager: !!msg.fromManager });
        case 'openManager':
          await chrome.tabs.create({ url: chrome.runtime.getURL(BGTStore.MANAGER_PAGE) });
          return { ok: true };
        case 'openSidePanel':
          // 由 popup 的用户手势触发;不支持时回退打开管理页
          if (chrome.sidePanel && chrome.sidePanel.open) {
            const win = await chrome.windows.getCurrent();
            await chrome.sidePanel.open({ windowId: win.id });
            return { ok: true };
          }
          await chrome.tabs.create({ url: chrome.runtime.getURL(BGTStore.MANAGER_PAGE) });
          return { ok: true, fallback: true };
        case 'saveWorkspace':
          return await saveWorkspace(msg.title, { closeTabs: msg.closeTabs !== false });
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
            await BGTStore.persist(data);
            return { ok: true, title: group.title };
          });
        case 'renameWorkspace':
          return await BGTStore.mutate(async () => {
            const data = await BGTStore.load();
            const ws = data.workspaces.find((w) => w.id === msg.workspaceId);
            if (!ws) return { ok: false, reason: 'not-found' };
            ws.title = String(msg.title || '').trim();
            await BGTStore.persist(data);
            return { ok: true, title: ws.title };
          });
        case 'cloudTest':
          return await cloudTest(await (await BGTStore.load()).settings);
        case 'cloudBackupNow': {
          const res = await cloudBackupNow((await BGTStore.load()).settings);
          if (res.ok) await makeLocalBackup(true);
          return res;
        }
        case 'cloudRestore':
          return await cloudRestore((await BGTStore.load()).settings);
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
  })().then(sendResponse);
  return true; // 异步应答
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

chrome.runtime.onInstalled.addListener(async () => {
  let data = await BGTStore.load(); // load() 内部完成 v1 → v2 迁移
  const before = JSON.stringify(data.settings);
  data = BGTStore.applyVersionDefaults(data);
  if (JSON.stringify(data.settings) !== before) await BGTStore.persist(data);
  updateBadge(data);
  rebuildContextMenus();
  initOmnibox();
  ensureAlarms();
});

chrome.runtime.onStartup.addListener(async () => {
  let data = await BGTStore.load();
  const before = JSON.stringify(data.settings);
  data = BGTStore.applyVersionDefaults(data);
  if (JSON.stringify(data.settings) !== before) await BGTStore.persist(data);
  updateBadge(data);
  rebuildContextMenus();
  initOmnibox();
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
  if (changes[BGTStore.STORE_KEY]) {
    updateBadge(changes[BGTStore.STORE_KEY].newValue);
    scheduleMenuRebuild(); // 保持右键菜单里的分组列表最新(防抖,避免频繁重建)
  }
});

let menuTimer = null;
function scheduleMenuRebuild() {
  clearTimeout(menuTimer);
  menuTimer = setTimeout(() => { rebuildContextMenus().catch(() => {}); }, 800);
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
