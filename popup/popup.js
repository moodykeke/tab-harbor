/**
 * Tab Harbor — Popup
 * 菜单形态:沿用原版「点击即执行 + 数量显示」的交互逻辑,并做增强。
 * 保存流水线在 background 中执行;此页面负责统计、选项与入口。
 */
'use strict';

(function () {
  const $ = (s) => document.querySelector(s);

  function send(msg) {
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

  let toastTimer = null;
  function toast(text, isError) {
    const el = $('#ppToast');
    el.textContent = text;
    el.hidden = false;
    el.classList.toggle('pp__toast--error', !!isError);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
  }

  /** 菜单条目上的实时数量:窗口标签数 / 窗口数 / 已存组数与标签数 */
  async function refreshCounts() {
    const data = await BGTStore.load();
    document.documentElement.dataset.theme = data.settings.theme;

    const winTabs = await chrome.tabs.query({ currentWindow: true });
    $('#countWindow').textContent = `(${winTabs.length})`;

    let windowCount = 1;
    try {
      const wins = await chrome.windows.getAll();
      windowCount = wins.length;
    } catch (e) { /* 预览模式 */ }
    $('#countWindows').textContent = windowCount > 1 ? tr('({n} 个窗口)', { n: windowCount }) : '';

    const groups = data.groups.filter((g) => !g.archived);
    const tabs = BGTStore.totalTabCount(data);
    $('#countSaved').textContent = groups.length
      ? tr('({g} 组 {t} 个)', { g: groups.length, t: tabs })
      : tr('(空)');

    return data;
  }

  /**
   * 原版逻辑:保存成功后立即收起弹窗(后台负责开管理页/关标签)。
   * 增强:若设置为不打开管理页,则给出短反馈再收起,避免"点了没反应"。
   */
  async function doSave(action) {
    const data = await BGTStore.load();
    const res = await send({ action });
    if (res && res.ok) {
      const msg = action === 'saveAllWindows'
        ? tr('已保存 {a} 个窗口共 {b} 个标签', { a: res.groups, b: res.saved })
        : tr('已保存 {n} 个标签', { n: res.saved });
      if (data.settings.openManagerAfterSave) {
        window.close(); // 管理页已经打开,直接收起(原版行为)
      } else {
        toast(msg);
        setTimeout(() => window.close(), 900);
      }
    } else if (res && res.reason === 'empty') {
      toast(tr('没有可保存的标签'), true);
    } else {
      toast(tr('保存失败:') + (res && res.reason ? res.reason : tr('后台服务不可用')), true);
    }
  }

  /** 泊位:置顶分组 1–9,点击或数字键立即恢复到当前窗口 */
  async function renderBerths(data) {
    const row = $('#berthRow');
    const berths = BGTStore.getBerths(data);
    row.hidden = !berths.length;
    row.textContent = '';
    for (const b of berths) {
      const chip = h2('button', { class: 'pp__berth', type: 'button', title: tr('泊位 {n}', { n: b.berth }) },
        h2('kbd', { text: String(b.berth) }),
        h2('span', { class: 'pp__berth-name', text: b.title }),
      );
      chip.addEventListener('click', () => restoreBerth(b));
      row.appendChild(chip);
    }
  }

  function h2(tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs) for (const k of Object.keys(attrs)) {
      const v = attrs[k];
      if (v == null) continue;
      if (k === 'text') el.textContent = v;
      else if (k === 'class') el.className = v;
      else el.setAttribute(k, v);
    }
    for (const c of children) el.appendChild(c);
    return el;
  }

  async function restoreBerth(berth) {
    const res = await send({ action: 'restoreGroup', groupId: berth.id, mode: 'current' });
    if (res && res.ok) {
      toast(tr('已恢复 {n} 个标签', { n: res.restored }));
      setTimeout(() => window.close(), 800);
    } else {
      toast(tr('恢复失败:后台服务不可用'), true);
    }
  }

  async function init() {
    const data = await refreshCounts();
    renderBerths(data);

    // 数字键 1–9 速泊
    document.addEventListener('keydown', (e) => {
      if (/^[1-9]$/.test(e.key) && !/^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) {
        const berths = BGTStore.getBerths(data);
        const berth = berths.find((b) => b.berth === Number(e.key));
        if (berth) { e.preventDefault(); restoreBerth(berth); }
      }
    });

    // 保存选项(与设置中的 excludePinned / excludeActive 同步持久化)
    $('#optPinned').checked = !!data.settings.excludePinned;
    $('#optActive').checked = !!data.settings.excludeActive;
    $('#optPinned').addEventListener('change', async (e) => {
      data.settings.excludePinned = e.target.checked;
      await BGTStore.persist(data);
    });
    $('#optActive').addEventListener('change', async (e) => {
      data.settings.excludeActive = e.target.checked;
      await BGTStore.persist(data);
    });

    // 菜单动作
    $('#btnSave').addEventListener('click', () => doSave('saveWindow'));
    $('#btnSaveAll').addEventListener('click', () => doSave('saveAllWindows'));

    // 收工:展开内联命名行,确认后整窗存为工作区并关闭标签
    const wsRow = $('#ppWsNameRow');
    $('#btnClockOut').addEventListener('click', () => {
      wsRow.hidden = !wsRow.hidden;
      if (!wsRow.hidden) $('#wsName').focus();
    });
    const clockOut = async () => {
      const res = await send({
        action: 'saveWorkspace',
        title: $('#wsName').value,
        closeTabs: true,
      });
      if (res && res.ok) {
        toast(tr('已收工:{n} 个标签入「{name}」', { n: res.saved, name: res.title }));
        setTimeout(() => window.close(), 900);
      } else if (res && res.reason === 'empty') {
        toast(tr('当前窗口没有可保存的标签'), true);
      } else {
        toast(tr('收工失败:') + (res && res.reason ? res.reason : tr('后台服务不可用')), true);
      }
    };
    $('#wsNameOk').addEventListener('click', clockOut);
    $('#wsName').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') clockOut();
    });

    $('#btnOpenManager').addEventListener('click', async () => {
      const res = await send({ action: 'openManager' });
      if (!res || !res.ok) {
        // 后台不可用时直接打开(预览模式兜底)
        try { chrome.tabs.create({ url: chrome.runtime.getURL(BGTStore.MANAGER_PAGE) }); } catch (e) { /* noop */ }
      }
      window.close();
    });

    const sideBtn = $('#btnSidePanel');
    if (typeof chrome.sidePanel !== 'undefined') sideBtn.hidden = false;
    sideBtn.addEventListener('click', async () => {
      // windowId 必须在**本页**取好再发出去:SW 侧在调用 sidePanel.open() 之前
      // 不能有任何 await,否则这次点击的用户手势就失效了(见 background.js 的注释)。
      let windowId;
      try { windowId = (await chrome.windows.getCurrent()).id; } catch (e) { /* 预览模式 */ }
      const res = await send({ action: 'openSidePanel', windowId });
      if (res && res.ok) { window.close(); return; }
      // 失败不要静默关掉弹窗:给出可见反馈,并退回管理页
      toast(tr('侧边栏打不开,已改为打开管理页'), true);
      await send({ action: 'openManager' });
      setTimeout(() => window.close(), 1500);
    });

    const openSettingsPage = () => {
      try {
        chrome.tabs.create({ url: chrome.runtime.getURL(BGTStore.MANAGER_PAGE) + '#settings' });
      } catch (e) { /* noop */ }
      window.close();
    };
    $('#btnOpenSettings').addEventListener('click', openSettingsPage);
    $('#btnOpenSettingsMenu').addEventListener('click', openSettingsPage);

    // 保存期间标签数可能变化,离开前刷新一次数量
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') refreshCounts();
    });
  }

  init();
})();
