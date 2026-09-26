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
      return { id: gid + 't' + i, url: t[0], title: t[1], favIconUrl: '', pinned: !!t[2], savedAt: NOW - (t[3] || 0) * 3600e3 };
    });
  }

  /**
   * 预览演示数据。
   * 之前只有 2 个分组、没有工作区与记录 —— 于是预览里"时间轴""工作区""周报""洞察"
   * 四个视图全是空的,既没法验收也没法截图。这里补齐一整套:分组 / 多窗口工作区 /
   * 连续几天的收工记录(周报与差分才有东西可算)。
   */
  const seedGroups = [
    {
      id: 'g1',
      title: '前端资料',
      createdAt: NOW - 3 * DAY,
      collapsed: false,
      tabs: mkTabs([
        ['https://github.com/trending', 'Trending repositories on GitHub Today', 0, 3],
        ['https://developer.mozilla.org/zh-CN/docs/Web', 'Web 技术文档 | MDN', 0, 3],
        ['https://web.dev/learn/css', 'Learn CSS - web.dev', 0, 4],
      ], 'g1'),
    },
    {
      id: 'g2',
      title: '每日阅读',
      createdAt: NOW - 26 * 3600 * 1000,
      collapsed: false,
      tabs: mkTabs([
        ['https://news.ycombinator.com/', 'Hacker News', 0, 2],
        ['https://www.bilibili.com/', '哔哩哔哩 (゜-゜)つロ 干杯~-bilibili', 0, 5],
      ], 'g2'),
    },
    {
      id: 'g3',
      title: '项目 A · 设计稿',
      createdAt: NOW - 6 * DAY,
      collapsed: false,
      pinned: true,
      tabs: mkTabs([
        ['https://www.figma.com/file/abc/Design', '设计稿 – Figma', 1, 8],
        ['https://linear.app/team/issues', 'Issues – Linear', 0, 8],
      ], 'g3'),
    },
    {
      id: 'g4',
      title: '调研 · 性能优化',
      createdAt: NOW - 9 * DAY,
      collapsed: true,
      tabs: mkTabs([
        ['https://web.dev/articles/inp', 'Optimize Interaction to Next Paint', 0, 12],
        ['https://developer.chrome.com/docs/lighthouse/overview', 'Lighthouse overview', 0, 12],
        ['https://github.com/GoogleChrome/lighthouse', 'GoogleChrome/lighthouse', 0, 13],
      ], 'g4'),
    },
    {
      id: 'g5',
      title: '待读长文',
      createdAt: NOW - 40 * DAY,
      collapsed: true,
      archived: true,
      tabs: mkTabs([
        ['https://example.com/long-read-1', '一篇很久没读的长文', 0, 40],
      ], 'g5'),
    },
  ];

  /** 连续几天的收工记录:喂给时间轴差分、港湾周报、重复保存统计与相似分组洞察 */
  function mkRecords() {
    const plan = [
      [0, '项目 A · 设计稿', [
        ['https://www.figma.com/file/abc/Design', '设计稿 – Figma'],
        ['https://linear.app/team/issues', 'Issues – Linear'],
        ['https://github.com/trending', 'Trending repositories on GitHub Today'],
        ['https://developer.mozilla.org/zh-CN/docs/Web', 'Web 技术文档 | MDN'],
      ]],
      [1, '项目 A · 前端联调', [
        ['https://www.figma.com/file/abc/Design', '设计稿 – Figma'],
        ['https://linear.app/team/issues', 'Issues – Linear'],
        ['https://web.dev/articles/inp', 'Optimize Interaction to Next Paint'],
        ['https://developer.chrome.com/docs/lighthouse/overview', 'Lighthouse overview'],
      ]],
      [2, '每日阅读', [
        ['https://news.ycombinator.com/', 'Hacker News'],
        ['https://www.bilibili.com/', '哔哩哔哩 (゜-゜)つロ 干杯~-bilibili'],
      ]],
      [4, '调研 · 性能优化', [
        ['https://web.dev/articles/inp', 'Optimize Interaction to Next Paint'],
        ['https://web.dev/learn/css', 'Learn CSS - web.dev'],
        ['https://github.com/GoogleChrome/lighthouse', 'GoogleChrome/lighthouse'],
      ]],
      [6, '项目 A · 周会', [
        ['https://linear.app/team/issues', 'Issues – Linear'],
        ['https://www.figma.com/file/abc/Design', '设计稿 – Figma'],
      ]],
    ];
    return plan.map(function (p, i) {
      const at = NOW - p[0] * DAY - 2 * 3600e3;
      return {
        id: 'r' + i,
        createdAt: at,
        title: p[1],
        source: 'clockout',
        tabs: p[2].map(function (t, k) {
          return { id: 'r' + i + 't' + k, url: t[0], title: t[1], favIconUrl: '', pinned: false, savedAt: at };
        }),
      };
    });
  }

  const seed = {
    version: 2,
    settings: { theme: 'auto' },
    groups: seedGroups,
    records: mkRecords(),
    workspaces: [
      {
        id: 'ws1',
        title: '项目 A · 设计评审',
        createdAt: NOW - 1 * DAY,
        lastRestoredAt: NOW - 20 * 3600e3,
        tabs: mkTabs([], 'ws1').concat([
          { id: 'ws1a', url: 'https://www.figma.com/file/abc/Design', title: '设计稿 – Figma', favIconUrl: '', pinned: false, savedAt: NOW - DAY },
          { id: 'ws1b', url: 'https://linear.app/team/issues', title: 'Issues – Linear', favIconUrl: '', pinned: false, savedAt: NOW - DAY },
          { id: 'ws1c', url: 'https://developer.mozilla.org/zh-CN/docs/Web', title: 'Web 技术文档 | MDN', favIconUrl: '', pinned: false, savedAt: NOW - DAY },
        ]),
      },
      {
        id: 'ws2',
        title: '双屏 · 写作 + 查资料',
        createdAt: NOW - 3 * DAY,
        tabs: [
          { id: 'ws2a', url: 'https://developer.chrome.com/docs/extensions/', title: 'Chrome Extensions documentation', favIconUrl: '', pinned: false, savedAt: NOW - 3 * DAY },
          { id: 'ws2b', url: 'https://news.ycombinator.com/', title: 'Hacker News', favIconUrl: '', pinned: false, savedAt: NOW - 3 * DAY },
          { id: 'ws2c', url: 'https://example.com/second-screen', title: 'Second screen', favIconUrl: '', pinned: false, savedAt: NOW - 3 * DAY },
        ],
        windows: [
          { tabs: [
            { id: 'ws2a', url: 'https://developer.chrome.com/docs/extensions/', title: 'Chrome Extensions documentation', favIconUrl: '', pinned: false, savedAt: NOW - 3 * DAY },
            { id: 'ws2b', url: 'https://news.ycombinator.com/', title: 'Hacker News', favIconUrl: '', pinned: false, savedAt: NOW - 3 * DAY },
          ] },
          { tabs: [
            { id: 'ws2c', url: 'https://example.com/second-screen', title: 'Second screen', favIconUrl: '', pinned: false, savedAt: NOW - 3 * DAY },
          ] },
        ],
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
              data.groups.forEach(function (g) { BGTStore.keySet(g.tabs).forEach(function (k) { seen.add(k); }); });
              const dupCount = group.tabs.filter(function (t) { return seen.has(BGTStore.normalizeUrl(t.url).key); }).length;
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
      // 注意签名:Chrome 允许 getLastFocused(getInfo?, callback?)。调用方传了
      // {populate:true}(replace 模式需要 cur.tabs),模拟层必须一并接收该参数,
      // 否则会把 info 对象当成回调 → preview 下开工替换模式直接崩。
      getLastFocused: function (info, cb) {
        const v = { id: 1, tabs: mockWindowTabs }; // 恒带 tabs(真实 API 需 populate:true)
        return typeof cb === 'function' ? (setTimeout(function () { cb(v); }, 0), undefined) : resolve(v);
      },
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
