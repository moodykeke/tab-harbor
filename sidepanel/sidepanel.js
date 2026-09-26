/**
 * Tab Harbor — Side Panel(常驻侧栏)
 * 紧凑视图:搜索、分组列表、点击展开标签、快捷恢复。
 */
'use strict';

(function () {
  const $ = (s) => document.querySelector(s);
  let data = null;
  let query = '';
  const expanded = new Set();

  function h(tag, attrs) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const k of Object.keys(attrs)) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'html') el.innerHTML = v;
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

  function hueOf(str) {
    let hash = 0;
    const s = String(str || '');
    for (let i = 0; i < s.length; i += 1) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
    return hash % 360;
  }

  function send(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (res) => resolve(chrome.runtime.lastError ? null : res));
      } catch (e) { resolve(null); }
    });
  }

  async function restore(g, mode) {
    if (!g.tabs.length) return;
    const res = await send({ action: 'restoreGroup', groupId: g.id, mode });
    if (res && res.ok) toast(tr('已恢复 {n} 个标签', { n: g.tabs.length }));
    else if (res && res.reason === 'empty') toast(tr('该分组没有标签'));
    else toast(tr('请在管理页中恢复(预览模式)'));
  }

  let toastTimer = null;
  function toast(text) {
    let el = $('#spToast');
    if (!el) {
      el = h('div', { id: 'spToast', style: 'padding:6px 12px;font-size:12px;text-align:center;color:var(--ok)' });
      document.body.appendChild(el);
    }
    el.textContent = text;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.textContent = ''; }, 2500);
  }

  function render() {
    document.documentElement.dataset.theme = data.settings.theme;
    const wrap = $('#spGroups');
    wrap.textContent = '';
    const q = query.trim().toLowerCase();

    const groups = data.groups
      .filter((g) => !g.archived)
      .filter((g) => !q
        || (g.title || '').toLowerCase().includes(q)
        || g.tabs.some((t) => (t.title || '').toLowerCase().includes(q)
          || (t.url || '').toLowerCase().includes(q)));

    $('#spEmpty').hidden = groups.length > 0;

    for (const g of groups) {
      const open = expanded.has(g.id);
      const card = h('div', { class: 'sp__group' + (open ? ' open' : ''), 'data-id': g.id });

      const head = h('button', { class: 'sp__group-head', type: 'button' },
        h('span', { class: 'sp__dot', style: `--h:${hueOf(g.id)}` }),
        h('span', { class: 'sp__title', text: g.title || tr('未命名分组') }),
        h('span', { class: 'sp__count', text: String(g.tabs.length) }),
      );
      const chev = h('span', {
        class: 'sp__chev', html:
          '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
      });
      head.appendChild(chev);
      head.addEventListener('click', () => {
        if (expanded.has(g.id)) expanded.delete(g.id);
        else expanded.add(g.id);
        render();
      });
      card.appendChild(head);

      if (open) {
        const tabsEl = h('div', { class: 'sp__tabs' });
        for (const t of g.tabs) {
          const row = h('a', {
            class: 'sp__tab', href: t.url, target: '_blank', rel: 'noopener',
            title: t.title,
          }, t.title || t.url);
          tabsEl.appendChild(row);
        }
        if (!g.tabs.length) tabsEl.appendChild(h('p', { class: 'sp__empty', text: tr('空分组'), style: 'padding:6px' }));
        card.appendChild(tabsEl);

        const actions = h('div', { class: 'sp__actions' });
        const btnCurrent = h('button', { class: 'btn', type: 'button', text: tr('恢复') });
        btnCurrent.addEventListener('click', () => restore(g, 'current'));
        const btnNew = h('button', { class: 'btn', type: 'button', text: tr('新窗口') });
        btnNew.addEventListener('click', () => restore(g, 'new'));
        actions.appendChild(btnCurrent);
        actions.appendChild(btnNew);
        card.appendChild(actions);
      }

      wrap.appendChild(card);
    }
  }

  async function init() {
    data = await BGTStore.load();
    render();

    $('#spSearch').addEventListener('input', (e) => { query = e.target.value; render(); });
    $('#spManager').addEventListener('click', async () => {
      try {
        chrome.tabs.create({ url: chrome.runtime.getURL(BGTStore.MANAGER_PAGE) });
      } catch (e) { /* 预览模式 */ }
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes[BGTStore.META_KEY]) return; // 分键后 meta 恒随每次写入(ADR-001)
      (async () => {
        try {
          data = await BGTStore.load();
          render();
        } catch (e) {
          /* 读取失败时保持当前视图 */
        }
      })();
    });
  }

  init();
})();
