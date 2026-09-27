'use strict';
/**
 * test/helpers/sw-env.js — Service Worker 运行时 harness
 *
 * 为什么需要它
 * ------------
 * v3.11.2 出包的 5 个 P0 全部位于"接线层":消息路由漏传参数、调用了未注入的全局
 * 函数、chrome API 用法错误。四套既有测试只覆盖 shared/store.js 的纯函数,
 * 所以 57/57 全绿的同时这些功能是真死的。
 *
 * 这个 harness 在一个受控的 vm 上下文里**真实加载** background.js 与 shared/*.js
 * (真实的 importScripts 语义),让"消息路由"这种接线可以被断言。
 *
 * 用法:
 *   const { createEnv } = require('./helpers/sw-env');
 *   const env = createEnv({ windows: [...] });   // 构造即完成 background.js 顶层执行
 *   const res = await env.send({ action: 'saveWorkspace', allWindows: true });
 *   env.fire('omnibox.onInputChanged', '2', suggest);   // 触发事件监听器
 *   await env.settle();                                 // 等异步副作用落地
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { webcrypto } = require('node:crypto');

const ROOT = path.join(__dirname, '..', '..');

function clone(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}

/**
 * 造一个可断言的扩展世界。
 * @param {object} opts
 *   opts.windows  [{ id, focused, tabs: [{ id, url, title, pinned, active }] }]
 *   opts.storage  预置的 chrome.storage.local 内容
 *   opts.lang     navigator.language(默认 zh-CN,让 tr() 直返中文便于断言)
 *   opts.fetch    (url, init) => ({ ok, status, text() })
 */
function createEnv(opts) {
  opts = opts || {};
  const listeners = new Map();
  const calls = [];
  const storage = new Map(Object.entries(clone(opts.storage) || {}));
  const sessionStore = new Map(); // chrome.storage.session(2.1b 绑定用,与 local 分离)

  const record = (api, args) => { calls.push({ api, args: clone(args) }); };
  const on = (key, fn) => {
    if (!listeners.has(key)) listeners.set(key, []);
    listeners.get(key).push(fn);
  };
  const fire = (key, ...args) => {
    const fns = listeners.get(key) || [];
    for (const fn of fns) fn(...args);
    return fns.length;
  };
  const listenerCount = (key) => (listeners.get(key) || []).length;

  /* ---------------- 窗口 / 标签世界 ---------------- */
  let nextTabId = 9000;
  let nextWinId = 1;
  const world = {
    windows: (opts.windows || []).map((w, i) => ({
      id: w.id != null ? w.id : (nextWinId += 1),
      focused: !!w.focused,
      tabs: (w.tabs || []).map((t) => Object.assign({ pinned: false, active: false, title: t.url }, t, {
        id: t.id != null ? t.id : (nextTabId += 1),
      })),
    })),
  };
  if (world.windows.length && !world.windows.some((w) => w.focused)) world.windows[0].focused = true;

  const findWindow = (id) => world.windows.find((w) => w.id === id);
  const focusedWindow = () => world.windows.find((w) => w.focused) || world.windows[0];
  const allTabs = () => world.windows.reduce((acc, w) => acc.concat(w.tabs), []);
  const createdTabs = () => calls.filter((c) => c.api === 'tabs.create').map((c) => c.args[0]);

  /* ---------------- storage ---------------- */
  const localGet = (keys, cb) => {
    record('storage.local.get', [keys]);
    const out = {};
    const list = keys == null ? Array.from(storage.keys())
      : Array.isArray(keys) ? keys : [keys];
    for (const k of list) if (storage.has(k)) out[k] = clone(storage.get(k));
    if (typeof cb === 'function') { cb(out); return undefined; }
    return Promise.resolve(out);
  };
  const localSet = (obj, cb) => {
    record('storage.local.set', [Object.keys(obj || {})]);
    const changes = {};
    for (const k of Object.keys(obj || {})) {
      changes[k] = { oldValue: clone(storage.get(k)), newValue: clone(obj[k]) };
      storage.set(k, clone(obj[k]));
    }
    fire('storage.onChanged', changes, 'local');
    if (typeof cb === 'function') { cb(); return undefined; }
    return Promise.resolve();
  };
  const localRemove = (keys, cb) => {
    record('storage.local.remove', [keys]);
    for (const k of (Array.isArray(keys) ? keys : [keys])) storage.delete(k);
    if (typeof cb === 'function') { cb(); return undefined; }
    return Promise.resolve();
  };

  // WP-5.4:opts.gardenHandle 时构造假目录与最小 indexedDB 垫片(暂存,sandbox 建好后挂上)
  let gardenShim = null;
  if (opts.gardenHandle) {
    const sink = { files: new Map() };
    const fakeDir = {
      name: 'test-garden',
      queryPermission: async () => 'granted',
      requestPermission: async () => 'granted',
      getDirectoryHandle: async () => fakeDir,
      getFileHandle: async (name) => ({
        getFile: async () => ({ text: async () => sink.files.get(name) || '' }),
        createWritable: async () => ({ write: async (c) => sink.files.set(name, c), close: async () => {} }),
      }),
    };
    gardenShim = {
      sink,
      indexedDB: {
        open: () => {
          const req = {};
          setTimeout(() => {
            const db = {
              transaction: () => {
                const tx = { objectStore: () => ({ get: () => ({ result: fakeDir }), put: () => ({}) }) };
                setTimeout(() => { if (tx.oncomplete) tx.oncomplete(); }, 0); // garden 在同步段后才挂 oncomplete
                return tx;
              },
              close: () => {},
            };
            req.result = db; // IDB 语义:回调触发时 req.result 已就绪
            if (req.onsuccess) req.onsuccess({ target: { result: db } });
          }, 0);
          return req;
        },
      },
    };
  }

  // tabs.get 桩的世界查找
  const vmWorldFindTab = (tabId) => {
    for (const w of world.windows) {
      const t = (w.tabs || []).find((x) => x.id === tabId);
      if (t) return clone(Object.assign({ windowId: w.id }, t));
    }
    return undefined;
  };

  /* ---------------- chrome.* ---------------- */
  const chrome = {
    runtime: {
      id: 'test-extension-id',
      getURL: (p) => 'chrome-extension://test-extension-id/' + (p || ''),
      getManifest: () => ({ version: '3.11.3' }),
      lastError: undefined,
      onMessage: { addListener: (fn) => on('runtime.onMessage', fn) },
      onInstalled: { addListener: (fn) => on('runtime.onInstalled', fn) },
      onStartup: { addListener: (fn) => on('runtime.onStartup', fn) },
    },
    storage: {
      session: {
        // 2.1b:会话级存储(活窗口↔项目绑定)。与生产同语义:跨 SW 回收存活,测试内即内存
        get: (keys, cb) => {
          record('storage.session.get', [keys]);
          const out = {};
          for (const k of (keys == null ? Array.from(sessionStore.keys()) : Array.isArray(keys) ? keys : [keys])) {
            if (sessionStore.has(k)) out[k] = clone(sessionStore.get(k));
          }
          return cb ? (cb(out), undefined) : Promise.resolve(out);
        },
        set: (obj, cb) => {
          record('storage.session.set', [Object.keys(obj || {})]);
          for (const [k, v] of Object.entries(obj || {})) sessionStore.set(k, clone(v));
          return cb ? (cb(), undefined) : Promise.resolve();
        },
        remove: (keys, cb) => {
          record('storage.session.remove', [keys]);
          for (const k of (Array.isArray(keys) ? keys : [keys])) sessionStore.delete(k);
          return cb ? (cb(), undefined) : Promise.resolve();
        },
      },
      local: {
        get: localGet,
        set: localSet,
        remove: localRemove,
        getBytesInUse: () => Promise.resolve(JSON.stringify(Array.from(storage.entries())).length * 2),
      },
      onChanged: { addListener: (fn) => on('storage.onChanged', fn) },
    },
    scripting: {
      executeScript: ({ target, func }) => {
        record('scripting.executeScript', [target, String(func).slice(0, 40)]);
        // 确定性伪页内计算:hash = f(tabId 对应 url, salt);测试用 __fpSalt 换盐即"内容变了"
        const tab = vmWorldFindTab(target && target.tabId);
        const url = (tab && tab.url) || 'about:blank';
        const salt = (globalThis.__fpSalt = globalThis.__fpSalt || 'v1');
        let h1 = 0x811c9dc5, h2 = 0x9e3779b9;
        const src = url + '|' + salt;
        for (let i = 0; i < src.length; i += 1) {
          const c = src.charCodeAt(i);
          h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
          h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0;
        }
        const hex = (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')).repeat(4);
        return Promise.resolve([{ result: { len: 2048 + (url.length % 97), head: '<html>…' + url.slice(0, 40), hash: hex } }]);
      },
    },
    pageCapture: {
      saveAsMHTML: ({ tabId }, cb) => {
        record('pageCapture.saveAsMHTML', [{ tabId }]);
        const fake = new (require('buffer').Blob)(['FAKE-MHTML-BODY-0123456789']);
        if (cb) cb(fake);
        return Promise.resolve(fake);
      },
    },
    tabs: {
      onActivated: { addListener: (fn) => on('tabs.onActivated', fn) },
      get: (tabId, cb) => {
        record('tabs.get', [tabId]);
        const out = vmWorldFindTab(tabId);
        return cb ? (cb(out), undefined) : Promise.resolve(out);
      },
      query: (q) => {
        record('tabs.query', [q]);
        q = q || {};
        let tabs;
        if (q.windowId != null) {
          const w = findWindow(q.windowId);
          tabs = w ? w.tabs.slice() : [];
        } else if (q.currentWindow) {
          const w = focusedWindow();
          tabs = w ? w.tabs.slice() : [];
        } else {
          tabs = allTabs();
        }
        if (q.active) tabs = tabs.filter((t) => t.active);
        return Promise.resolve(clone(tabs));
      },
      create: (props) => {
        record('tabs.create', [props]);
        const win = findWindow(props.windowId) || focusedWindow() || world.windows[0];
        const tab = {
          id: (nextTabId += 1), url: props.url || 'about:blank', title: props.url || 'about:blank',
          pinned: !!props.pinned, active: !!props.active,
        };
        if (win) {
          if (props.active) win.tabs.forEach((t) => { t.active = false; });
          win.tabs.push(tab);
        }
        return Promise.resolve(clone(tab));
      },
      remove: (ids) => {
        record('tabs.remove', [ids]);
        const set = new Set(Array.isArray(ids) ? ids : [ids]);
        for (const w of world.windows) w.tabs = w.tabs.filter((t) => !set.has(t.id));
        return Promise.resolve();
      },
      update: (id, props) => {
        record('tabs.update', [id, props]);
        for (const t of allTabs()) if (t.id === id) Object.assign(t, props);
        return Promise.resolve({ id });
      },
      group: (o) => { record('tabs.group', [o]); return Promise.resolve(77); },
    },
    tabGroups: {
      query: () => { record('tabGroups.query', []); return Promise.resolve([]); },
      update: () => Promise.resolve(),
    },
    windows: {
      WINDOW_ID_NONE: -1,
      onRemoved: { addListener: (fn) => on('windows.onRemoved', fn) },
      onFocusChanged: { addListener: (fn) => on('windows.onFocusChanged', fn) },
      getAll: (q) => {
        record('windows.getAll', [q]);
        return Promise.resolve(clone(world.windows.map((w) => (q && q.populate ? w : { id: w.id, focused: w.focused }))));
      },
      getLastFocused: (info) => {
        record('windows.getLastFocused', [info]);
        const w = focusedWindow();
        const out = { id: w ? w.id : 1, focused: true };
        // 忠于真实 API:tabs 仅在 populate:true 时出现
        if (info && info.populate) out.tabs = clone(w ? w.tabs : []);
        return Promise.resolve(out);
      },
      getCurrent: (info) => {
        record('windows.getCurrent', [info]);
        const w = focusedWindow();
        const out = { id: w ? w.id : 1 };
        if (info && info.populate) out.tabs = clone(w ? w.tabs : []);
        return Promise.resolve(out);
      },
      create: (props) => {
        record('windows.create', [props]);
        const w = { id: (nextWinId += 1), focused: !!props.focused, tabs: [] };
        w.tabs.push({ id: (nextTabId += 1), url: props.url || 'about:blank', title: props.url || '', pinned: false, active: true });
        world.windows.push(w);
        return Promise.resolve({ id: w.id, tabs: clone(w.tabs) });
      },
    },
    contextMenus: {
      removeAll: () => { record('contextMenus.removeAll', []); return Promise.resolve(); },
      create: (o, cb) => { record('contextMenus.create', [o]); if (cb) cb(); },
      onClicked: { addListener: (fn) => on('contextMenus.onClicked', fn) },
    },
    omnibox: {
      onInputChanged: { addListener: (fn) => on('omnibox.onInputChanged', fn) },
      onInputEntered: { addListener: (fn) => on('omnibox.onInputEntered', fn) },
      setDefaultSuggestion: (o) => record('omnibox.setDefaultSuggestion', [o]),
    },
    alarms: {
      create: (n, i) => { record('alarms.create', [n, i]); },
      onAlarm: { addListener: (fn) => on('alarms.onAlarm', fn) },
    },
    commands: { onCommand: { addListener: (fn) => on('commands.onCommand', fn) } },
    action: {
      setBadgeText: (o) => record('action.setBadgeText', [o]),
      setBadgeBackgroundColor: (o) => record('action.setBadgeBackgroundColor', [o]),
    },
    permissions: {
      request: (perms) => { record('permissions.request', [perms]); return Promise.resolve(true); },
      contains: () => Promise.resolve(true),
      remove: () => Promise.resolve(),
    },
    sidePanel: { open: (o) => { record('sidePanel.open', [o]); return Promise.resolve(); } },
  };

  /* ---------------- vm 上下文 + importScripts ---------------- */
  const sandbox = {
    chrome,
    crypto: webcrypto,
    TextEncoder,
    TextDecoder,
    URL,
    URLSearchParams,
    btoa,
    atob,
    fetch: (url, init) => {
      record('fetch', [url, init && init.method]);
      if (opts.fetch) return opts.fetch(url, init);
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('') });
    },
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    navigator: { language: opts.lang || 'zh-CN' },
    localStorage: {
      length: 0, key: () => null, getItem: () => null, setItem: () => {}, removeItem: () => {},
    },
  };
  sandbox.self = sandbox;
  if (gardenShim) sandbox.indexedDB = gardenShim.indexedDB; // garden.js 的 withStore 在 vm 里能命中
  vm.createContext(sandbox);
  sandbox.importScripts = (...names) => {
    for (const n of names) {
      const p = path.join(ROOT, n);
      vm.runInContext(fs.readFileSync(p, 'utf8'), sandbox, { filename: n });
    }
  };
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8'), sandbox, { filename: 'background.js' });

  /* ---------------- 对外接口 ---------------- */
  function send(msg, timeoutMs) {
    return new Promise((resolve, reject) => {
      const fns = listeners.get('runtime.onMessage') || [];
      if (!fns.length) { reject(new Error('background.js 未注册 onMessage 监听器')); return; }
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error('消息 ' + JSON.stringify(msg && msg.action) + ' 超时未应答'));
      }, timeoutMs || 3000);
      const sendResponse = (r) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(clone(r));
      };
      // 真实语义:返回 true 表示异步应答
      const ret = fns[0](clone(msg), { id: 'test' }, sendResponse);
      if (ret !== true && !settled) {
        settled = true;
        clearTimeout(timer);
        resolve(undefined);
      }
    });
  }

  return {
    sandbox,
    chrome,
    world,
    calls,
    storage,
    gardenSink: gardenShim ? gardenShim.sink : null,
  send,
    fire,
    listenerCount,
    createdTabs,
    allTabs,
    focusedWindow,
    /** 合并视图(ADR-001 分键后与 store.load 同口径):meta 存在时从四键组装,否则回落旧单键 */
    data: () => {
      const meta = storage.get('bgtMeta');
      if (meta && typeof meta === 'object') {
        return clone({
          version: 2,
          groups: storage.get('bgtGroups') || [],
          workspaces: storage.get('bgtWorkspaces') || [],
          records: storage.get('bgtRecords') || [],
          excerpts: storage.get('bgtExcerpts') || [],
          pageSnapshots: storage.get('bgtPageSnapshots') || [],
          contentFingerprints: storage.get('bgtContentFingerprints') || [],
          settings: meta.settings || {},
          updatedAt: meta.updatedAt,
        });
      }
      return clone(storage.get('bgtData'));
    },
    /** 注入完整状态:直接写 v3 分键布局 —— 在任何 persist 之后依然可被 data() 读回。
     *  (旧实现只写 bgtData 单键,首次 persist 产生 bgtMeta 后即被读路径静默忽略)
     *  要测"v2 旧键 → 迁移"路径,请用 createEnv 的 storage 预置,不要用本方法 */
    setData: (d) => {
      storage.delete('bgtData');
      storage.set('bgtMeta', { schemaVersion: 3, settings: (d && d.settings) || {}, updatedAt: (d && d.updatedAt) || 1 });
      storage.set('bgtGroups', clone((d && d.groups) || []));
      storage.set('bgtWorkspaces', clone((d && d.workspaces) || []));
      storage.set('bgtRecords', clone((d && d.records) || []));
      storage.set('bgtExcerpts', clone((d && d.excerpts) || []));
    },
    callCount: (api) => calls.filter((c) => c.api === api).length,
    callsOf: (api) => calls.filter((c) => c.api === api),
    /** 等异步副作用落地(事件监听器不返回 Promise,只能让出事件循环) */
    settle: (ms) => new Promise((r) => setTimeout(r, ms || 40)),
  };
}

module.exports = { createEnv, ROOT };
