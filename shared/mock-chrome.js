/**
 * 预览用 chrome API 模拟 —— 在真实扩展环境中自动跳过。
 * 用途:直接用浏览器打开 manager/manager.html 或 popup/popup.html 即可
 *       完整体验界面与交互(数据保存在 localStorage,不影响真实扩展)。
 */
(function () {
  'use strict';
  const isReal = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id && chrome.storage;
  if (isReal) return;

  const LS_KEY = 'bgtMockData';
  const NOW = Date.now();
  const DAY = 86400000;

  function mkTabs(list, gid) {
    return list.map(function (t, i) {
      return { id: gid + 't' + i, url: t[0], title: t[1], favIconUrl: '', pinned: !!t[2] };
    });
  }

  const seed = {
    version: 2,
    settings: { theme: 'auto' },
    groups: [
      {
        id: 'g1',
        title: '前端资料',
        createdAt: NOW - 3 * DAY,
        collapsed: false,
        tabs: mkTabs([
          ['https://github.com/trending', 'Trending repositories on GitHub Today'],
          ['https://developer.mozilla.org/zh-CN/docs/Web', 'Web 技术文档 | MDN'],
          ['https://web.dev/learn/css', 'Learn CSS - web.dev'],
        ], 'g1'),
      },
      {
        id: 'g2',
        title: '每日阅读',
        createdAt: NOW - 26 * 3600 * 1000,
        collapsed: false,
        tabs: mkTabs([
          ['https://news.ycombinator.com/', 'Hacker News'],
          ['https://www.bilibili.com/', '哔哩哔哩 (゜-゜)つロ 干杯~-bilibili'],
        ], 'g2'),
      },
    ],
  };

  const mockWindow2Tabs = [
    { id: 'w2-1', url: 'https://example.com/second-screen', title: 'Second screen', active: true, pinned: false, favIconUrl: '' },
  ];

  const mockWindowTabs = [
    { id: 'w1', url: 'https://github.com/explore', title: 'Explore - GitHub', active: true, pinned: false, favIconUrl: '' },
    { id: 'w2', url: 'https://developer.mozilla.org/zh-CN/', title: 'MDN Web Docs', active: false, pinned: false, favIconUrl: '' },
    { id: 'w3', url: 'chrome://extensions/', title: '扩展程序', active: false, pinned: true, favIconUrl: '' },
    { id: 'w4', url: 'https://translate.google.com/', title: 'Google 翻译', active: false, pinned: false, favIconUrl: '' },
  ];

  function readData() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) return JSON.parse(raw);
      // 首次预览且无 v1 数据时,给出演示分组
      if (!localStorage.getItem('tabGroups')) return JSON.parse(JSON.stringify(seed));
      return undefined;
    } catch (e) {
      return JSON.parse(JSON.stringify(seed));
    }
  }
  function writeData(d) {
    localStorage.setItem(LS_KEY, JSON.stringify(d));
  }

  function resolve(v) {
    return new Promise(function (res) { setTimeout(function () { res(v); }, 0); });
  }

  window.chrome = {
    runtime: {
      id: 'mock-extension-id',
      getURL: function (p) { return 'mock://' + p; },
      sendMessage: function (msg, cb) {
        setTimeout(function () {
          let result = { ok: false, reason: 'mock' };
          if (msg && msg.action === 'saveWindow' && typeof BGTStore !== 'undefined') {
            const data = readData();
            const group = BGTStore.buildGroup(mockWindowTabs, data.settings, { activeUrl: mockWindowTabs[0].url });
            if (group && Array.isArray(msg.__onlyNewKeys) && msg.__onlyNewKeys.length) {
              group.tabs = BGTStore.filterOnlyNew(group.tabs, msg.__onlyNewKeys);
            }
            if (group && !group.tabs.length) {
              result = { ok: true, saved: 0, allKnown: true };
            } else if (group) {
              const seen = new Set();
              data.groups.forEach(function (g) { g.tabs.forEach(function (t) { seen.add(t.url); }); });
              const dupCount = group.tabs.filter(function (t) { return seen.has(t.url); }).length;
              group.title = BGTStore.defaultGroupTitle();
              data.groups.unshift(group);
              writeData(data);
              result = { ok: true, saved: group.tabs.length, dupCount: dupCount };
            } else {
              result = { ok: false, reason: 'empty' };
            }
          } else if (msg && msg.action === 'saveWorkspace' && typeof BGTStore !== 'undefined') {
            const data = readData();
            if (!Array.isArray(data.workspaces)) data.workspaces = [];
            const now = Date.now();
            const source = msg.allWindows ? [mockWindowTabs, mockWindow2Tabs] : [mockWindowTabs];
            const winGroups = source.map(function (list) {
              return { tabs: list.filter(function (t) { return t.url !== 'about:blank'; }).map(function (t) {
                return { id: 'w' + Math.random().toString(36).slice(2, 8), url: t.url, title: t.title, favIconUrl: '', pinned: !!t.pinned, savedAt: now };
              }) };
            }).filter(function (g) { return g.tabs.length; });
            const tabs = winGroups.reduce(function (acc, g) { return acc.concat(g.tabs); }, []);
            const title = (msg.title || '').trim() || BGTStore.defaultGroupTitle();
            const existing = data.workspaces.find(function (w) { return w.title === title; });
            const payload = { title: title, createdAt: now, tabs: tabs, windows: winGroups.length > 1 ? winGroups : undefined };
            if (existing) { Object.assign(existing, BGTStore.normalizeWorkspace(payload), { id: existing.id }); existing.createdAt = now; }
            else { data.workspaces.unshift(BGTStore.normalizeWorkspace(payload)); }
            let recordCreated = false;
            if (!Array.isArray(data.records)) data.records = [];
            const rec = BGTStore.makeRecord({ title: title, createdAt: now, tabs: tabs.map(function (t) { return Object.assign({}, t); }), workspaceId: (existing && existing.id) || (data.workspaces[0] && data.workspaces[0].id), source: 'clockout' });
            if (!BGTStore.recordEqualsLast(data.records, rec)) {
              data.records = data.records.concat(rec).slice(-BGTStore.RECORDS_MAX);
              recordCreated = true;
            }
            writeData(data);
            result = { ok: true, saved: tabs.length, title: title, windows: winGroups.length, recordCreated: recordCreated };
          } else if (msg && msg.action === 'restoreGroup') {
            const d3 = readData();
            const g = (d3.groups || []).find(function (x) { return x.id === msg.groupId; });
            result = g && g.tabs.length ? { ok: true, restored: g.tabs.length } : { ok: false, reason: 'empty' };
          } else if (msg && msg.action === 'renameGroup' || msg && msg.action === 'renameWorkspace') {
            const data = readData();
            const list = msg.action === 'renameGroup' ? data.groups : data.workspaces;
            const idKey = msg.action === 'renameGroup' ? 'id' : 'id';
            const obj = list.find(function (x) { return x.id === msg[msg.action === 'renameGroup' ? 'groupId' : 'workspaceId']; });
            if (obj) obj.title = String(msg.title || '').trim();
            writeData(data);
            result = { ok: true, title: obj ? obj.title : null };
          } else if (msg && msg.action === 'restoreWorkspace') {
            const d2 = readData();
            const ws = (d2.workspaces || []).find(function (w) { return w.id === msg.workspaceId; });
            result = ws && ws.tabs.length ? { ok: true, restored: ws.tabs.length, windows: (ws.windows && ws.windows.length) || 1 } : { ok: false, reason: 'empty' };
          } else if (msg && msg.action === 'saveAllWindows') {
            result = { ok: false, reason: 'empty' };
          } else if (msg && msg.action === 'openManager') {
            result = { ok: true };
          }
          if (cb) cb(result);
        }, 60);
      },
      onMessage: { addListener: function () {} },
      onInstalled: { addListener: function () {} },
      onStartup: { addListener: function () {} },
    },
    storage: {
      local: {
        get: function (keys, cb) {
          const out = {};
          const list = keys == null ? [] : Array.isArray(keys) ? keys : [keys];
          const data = readData();
          list.forEach(function (k) {
            if (k === 'bgtData') { if (data !== undefined) out[k] = data; }
            else {
              const raw = localStorage.getItem(k);
              if (raw != null) { try { out[k] = JSON.parse(raw); } catch (e) { out[k] = raw; } }
            }
          });
          return cb ? (setTimeout(function () { cb(out); }, 0), undefined) : resolve(out);
        },
        set: function (obj, cb) {
          if (obj && obj.bgtData) writeData(obj.bgtData);
          if (cb) setTimeout(cb, 0);
          return resolve(undefined);
        },
        remove: function (keys, cb) {
          (Array.isArray(keys) ? keys : [keys]).forEach(function (k) { localStorage.removeItem(k); });
          if (cb) setTimeout(cb, 0);
          return resolve(undefined);
        },
        getBytesInUse: function (keys, cb) {
          let n = 0;
          for (let i = 0; i < localStorage.length; i += 1) {
            const k = localStorage.key(i);
            n += k.length + (localStorage.getItem(k) || '').length;
          }
          n *= 2; // UTF-16 近似
          return cb ? (setTimeout(function () { cb(n); }, 0), undefined) : resolve(n);
        },
        onChanged: { addListener: function () {} },
      },
      sync: {
        get: function (k, cb) { const o = {}; if (cb) setTimeout(function () { cb(o); }, 0); return resolve(o); },
        set: function (o, cb) { if (cb) setTimeout(cb, 0); return resolve(undefined); },
      },
      onChanged: { addListener: function () {} },
    },
    tabs: {
      query: function (q, cb) { const v = mockWindowTabs.slice(); return cb ? (setTimeout(function () { cb(v); }, 0), undefined) : resolve(v); },
      create: function (props, cb) { const v = { id: 'new' }; if (cb) setTimeout(function () { cb(v); }, 0); return resolve(v); },
      remove: function (ids, cb) { if (cb) setTimeout(cb, 0); return resolve(undefined); },
      update: function (id, props, cb) { const v = {}; if (cb) setTimeout(function () { cb(v); }, 0); return resolve(v); },
    },
    windows: {
      getLastFocused: function (cb) { const v = { id: 1, tabs: mockWindowTabs }; return cb ? (setTimeout(function () { cb(v); }, 0), undefined) : resolve(v); },
      getCurrent: function (cb) { const v = { id: 1, tabs: mockWindowTabs }; return cb ? (setTimeout(function () { cb(v); }, 0), undefined) : resolve(v); },
      create: function (props, cb) { const v = { id: 'new' + Math.floor(Math.random() * 1e4), tabs: [{ id: 'nt' + Math.floor(Math.random() * 1e4) }] }; if (cb) setTimeout(function () { cb(v); }, 0); return resolve(v); },
      getAll: function (q, cb) {
        const v = [
          { id: 1, focused: true, tabs: mockWindowTabs },
          { id: 2, focused: false, tabs: mockWindow2Tabs },
        ];
        return cb ? (setTimeout(function () { cb(v); }, 0), undefined) : resolve(v);
      },
    },
    action: {
      setBadgeText: function () {},
      setBadgeBackgroundColor: function () {},
    },
    permissions: {
      request: function () { return resolve(false); },
      contains: function () { return resolve(true); },
      remove: function () { return resolve(undefined); },
    },
    commands: { onCommand: { addListener: function () {} } },
  };
})();
