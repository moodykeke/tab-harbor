/**
 * Tab Harbor — core:共享状态与基础工具
 * 所有模块经此共享可变状态(state);渲染入口由 render.js 注册,
 * 避免核心与渲染层相互依赖。
 */

export const state = {
  data: null,         // { version, groups, workspaces, records, excerpts, settings }
  query: '',          // 搜索词
  view: 'today',      // today(默认:继续昨天的工作,WP-2.2)| groups | workspaces | timeline
  dragInfo: null,     // { type: 'tab'|'group', groupId, tabId? }
  menuState: null,    // 当前打开的自绘菜单 { el, anchor, cleanup }
  selected: new Set(),    // 批量操作:选中的分组 id
  renderToken: '',        // 结构令牌:结构未变时搜索走轻量路径
  restoreTarget: null,    // 选择性恢复的目标分组
  expandTimer: null,      // 拖拽悬停自动展开
  expandTarget: null,     // 悬停中的折叠卡片
  scrollTimer: null,      // 拖拽边缘自动滚动
  kbdIndex: -1,           // 键盘导航:当前焦点卡片序号
  wsOpen: new Set(),      // 展开中的工作区 id
  paletteActive: 0,       // 命令面板当前高亮项
  undoStack: [],          // 操作日志:多步撤销(会话级,不入盘)
  redoStack: [],          // 重做栈
};

export const $ = (s, r) => (r || document).querySelector(s);
export const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

export function h(tag, attrs) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const k of Object.keys(attrs)) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'html') el.innerHTML = v;
      else if (typeof v === 'function' && k.startsWith('on')) el.addEventListener(k.slice(2), v); // 闭包事件,不能走 setAttribute
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  for (let i = 2; i < arguments.length; i += 1) {
    const c = arguments[i];
    if (c == null || c === false) continue;
    el.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
  }
  return el;
}

const rtf = new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' });
export function relTime(ts) {
  const diff = Date.now() - ts;
  if (diff < 60e3) return tr('刚刚');
  if (diff < 36e5) return rtf.format(-Math.floor(diff / 60e3), 'minute');
  if (diff < 864e5) return rtf.format(-Math.floor(diff / 36e5), 'hour');
  if (diff < 30 * 864e5) return rtf.format(-Math.floor(diff / 864e5), 'day');
  return new Date(ts).toLocaleDateString();
}

export function hueOf(str) {
  let hash = 0;
  const s = String(str || '');
  for (let i = 0; i < s.length; i += 1) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  return hash % 360;
}

export function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return url; }
}

export function firstChar(s) {
  const c = (String(s || '').trim()[0]);
  return c ? c.toUpperCase() : '?';
}

export function fmtDate(ts) {
  const d = new Date(ts);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(
    sameYear ? { month: 'long', day: 'numeric' } : { year: 'numeric', month: 'long', day: 'numeric' });
}

export function snapshotGroups() {
  return JSON.parse(JSON.stringify(state.data.groups));
}

export function snapshotWorkspaces() {
  return JSON.parse(JSON.stringify(state.data.workspaces || []));
}

export function send(msg) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(msg, (res) => {
        resolve(chrome.runtime.lastError ? null : res);
      });
    } catch (e) {
      resolve(null);
    }
  });
}

/* ---------------- 渲染入口注册(打破 core ↔ render 循环) ---------------- */

let rerender = null;

export function setRenderer(fn) { rerender = fn; }

export async function persist() {
  await BGTStore.persist(state.data);
}

export async function persistAndRender() {
  await persist();
  if (rerender) await rerender();
}

/* ---------------- 防抖写:低价值状态变更延后落盘 ---------------- */

let pendingWrite = null;

/** 立即渲染,存储写入延后 300ms 合并(折叠/重命名/排序等 UI 态专用) */
export async function persistAndRenderSoon() {
  if (rerender) rerender();
  if (pendingWrite) clearTimeout(pendingWrite);
  pendingWrite = setTimeout(async () => {
    pendingWrite = null;
    try { await persist(); } catch (e) { /* 页面关闭中 */ }
  }, 300);
}

/** 页面隐藏/关闭前,把未落盘的防抖写立即刷出 */
export function flushPendingPersist() {
  if (!pendingWrite) return Promise.resolve();
  clearTimeout(pendingWrite);
  pendingWrite = null;
  return persist().catch(() => {});
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushPendingPersist();
  });
  window.addEventListener('pagehide', () => flushPendingPersist());
}
