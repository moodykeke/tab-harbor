/**
 * Tab Harbor — events:全部事件绑定(含命令面板与键盘导航)
 */
import { state, $, $$, h, send, persistAndRender, persistAndRenderSoon } from './core.js';
import { ICONS, SORT_LABELS, THEME_LABELS } from './icons.js';
import { toast, openMenu } from './ui.js';
import { render, renderGroups, renderWorkspaces, applySearchLight, structureToken, updateBatchBar, showKbdFocus } from './render.js';
import {
  restoreGroup, deleteGroup, removeTab, addCurrentTabToGroup, newGroup, doSave,
  openDupMenu, openDupDialog, openRestoreMenu, openGroupMenu, jumpToGroup,
  importNativeGroups, tidyByDomain, handleImport, doExport,
  batchMerge, batchDelete, batchExport,
  confirmRestoreDialog, wsRestore, openWsMenu, deleteWorkspace,
  openWsDialog, confirmClockOut, removeWsTab,
  openRecordDialogById, resumeRecordById, restoreRecordFullById, recordToGroupById,
} from './actions.js';
import { undo, redo } from './ops.js';
import { openSettings, saveSettings, cloudAction, clearAll } from './settings.js';
import { bindDnD, moveTab } from './dnd.js';

/* ---------------- 命令面板 (Ctrl+K) ---------------- */

function paletteItems(q) {
  const qq = q.trim().toLowerCase();
  const items = [];
  for (const w of state.data.workspaces) {
    const hit = !qq
      || (w.title || '').toLowerCase().includes(qq)
      || w.tabs.some((t) => (t.title || '').toLowerCase().includes(qq));
    if (hit) {
      items.push({
        icon: ICONS.briefcase,
        label: tr('工作区:{name} · {n} 个标签', { name: w.title || tr('未命名'), n: w.tabs.length }),
        hint: tr('开工'),
        run: () => wsRestore(w, 'new'),
      });
    }
  }
  for (const g of state.data.groups) {
    const hit = !qq
      || (g.title || '').toLowerCase().includes(qq)
      || g.tabs.some((t) => (t.title || '').toLowerCase().includes(qq)
        || (t.url || '').toLowerCase().includes(qq));
    if (hit) {
      items.push({
        icon: ICONS.play,
        label: (g.title || tr('未命名分组')) + tr(' · {n} 个标签', { n: g.tabs.length }),
        hint: tr('后台恢复'),
        run: () => restoreGroup(g, 'current'),
      });
    }
  }
  const cmds = [
    { icon: ICONS.plus, label: tr('新建分组'), hint: tr('命令'), run: newGroup },
    { icon: ICONS.briefcase, label: tr('收工 · 存为工作区'), hint: tr('命令'), run: openWsDialog },
    { icon: ICONS.download, label: tr('保存当前窗口标签'), hint: tr('命令'), run: () => doSave('window') },
    { icon: ICONS.upload, label: tr('保存全部窗口'), hint: tr('命令'), run: () => doSave('all') },
    { icon: ICONS.sort, label: tr('按域名整理…'), hint: tr('命令'), run: tidyByDomain },
    { icon: ICONS.list, label: tr('重复保存统计'), hint: tr('命令'), run: openDupDialog },
    { icon: ICONS.moon, label: tr('导出备份'), hint: tr('命令'), run: doExport },
    { icon: ICONS.gear, label: tr('打开设置'), hint: tr('命令'), run: openSettings },
  ];
  for (const c of cmds) {
    if (!qq || c.label.toLowerCase().includes(qq)) items.push(c);
  }
  return items.slice(0, 9);
}

function renderPaletteList(q) {
  const listEl = $('#paletteList');
  listEl.textContent = '';
  const items = paletteItems(q);
  state.paletteActive = Math.min(state.paletteActive, Math.max(0, items.length - 1));
  if (!items.length) {
    listEl.appendChild(h('p', { class: 'palette__empty', text: tr('没有匹配的结果') }));
    return;
  }
  items.forEach((it, i) => {
    const row = h('button', {
      class: 'palette__item' + (i === state.paletteActive ? ' palette__item--active' : ''),
      type: 'button',
    },
      h('span', { class: 'menu__icon', html: it.icon }),
      h('span', { class: 'menu__label', text: it.label }),
      h('small', { text: it.hint || '' }),
    );
    row.addEventListener('click', () => { $('#paletteDialog').close(); it.run(); });
    listEl.appendChild(row);
  });
}

function openPalette() {
  state.paletteActive = 0;
  const input = $('#paletteInput');
  input.value = '';
  renderPaletteList('');
  $('#paletteDialog').showModal();
  input.focus();
}

/* ---------------- 事件绑定 ---------------- */

export function bindEvents() {
  const list = $('#groupList');

  // 折叠:点击分组头部空白处
  list.addEventListener('click', (e) => {
    const head = e.target.closest('.group__head');
    if (!head || e.target.closest('[data-act], input, a, button')) return;
    const card = head.closest('.group');
    const group = state.data.groups.find((g) => g.id === card.dataset.id);
    if (!group) return;
    group.collapsed = !group.collapsed;
    persistAndRender();
  });

  // 重命名与多选
  list.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('.group__title')) e.target.blur();
  });
  list.addEventListener('change', (e) => {
    if (e.target.matches('.group__check')) {
      const card = e.target.closest('.group');
      if (!card) return;
      if (e.target.checked) state.selected.add(card.dataset.id);
      else state.selected.delete(card.dataset.id);
      updateBatchBar();
      return;
    }
    if (!e.target.matches('.group__title')) return;
    const card = e.target.closest('.group');
    const group = state.data.groups.find((g) => g.id === card.dataset.id);
    if (!group) return;
    group.title = e.target.value.trim();
    // Single Writer:走后台串行端点,避免与后台保存双写竞争
    send({ action: 'renameGroup', groupId: group.id, title: group.title });
  });

  // 动作按钮
  document.addEventListener('click', (e) => {
    const actEl = e.target.closest('[data-act]');
    if (!actEl) return;
    const act = actEl.dataset.act;
    const card = actEl.closest('.group');
    const group = card ? state.data.groups.find((g) => g.id === card.dataset.id) : null;
    switch (act) {
      case 'collapse':
        if (group) { group.collapsed = !group.collapsed; persistAndRender(); }
        break;
      case 'restore': if (group) restoreGroup(group, 'current'); break;
      case 'restore-menu': if (group) openRestoreMenu(actEl, group); break;
      case 'more': if (group) openGroupMenu(group, actEl); break;
      case 'addcurrent': if (group) addCurrentTabToGroup(group); break;
      case 'del-tab': {
        if (!group) break;
        const tabEl = actEl.closest('.tab');
        if (tabEl) removeTab(group, tabEl.dataset.id);
        break;
      }
      case 'dup': {
        const tabEl = actEl.closest('.tab');
        if (!tabEl || !group) break;
        const t = group.tabs.find((x) => x.id === tabEl.dataset.id);
        if (t) openDupMenu(group, t, actEl);
        break;
      }
      default: break;
    }
  });

  bindDnD();

  // 侧边栏
  $('#btnNewGroup').addEventListener('click', newGroup);
  $('#btnEmptySave').addEventListener('click', () => doSave('window'));
  $('#btnSaveWindow').addEventListener('click', () => doSave('window'));
  $('#btnSaveAllWindows').addEventListener('click', () => doSave('all'));
  $('#btnImportNative').addEventListener('click', importNativeGroups);
  $('#btnTidy').addEventListener('click', tidyByDomain);
  $('#btnDupStats').addEventListener('click', openDupDialog);
  $('#dupClose').addEventListener('click', () => $('#dupDialog').close());
  $('#btnExport').addEventListener('click', doExport);
  $('#btnImport').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', (e) => handleImport(e.target.files[0]));

  // 工具栏
  $('#btnArchived').addEventListener('click', () => {
    state.data.settings.showArchived = !state.data.settings.showArchived;
    persistAndRender();
  });
  $('#btnToggleAll').addEventListener('click', () => {
    const anyExpanded = state.data.groups.some((g) => !g.collapsed);
    state.data.groups.forEach((g) => { g.collapsed = anyExpanded; });
    persistAndRender();
  });

  // 批量操作条
  $('#batchAll').addEventListener('click', () => {
    const visibleIds = $$('#groupList .group').map((c) => c.dataset.id);
    const allSelected = visibleIds.length && visibleIds.every((id) => state.selected.has(id));
    if (allSelected) state.selected.clear();
    else visibleIds.forEach((id) => state.selected.add(id));
    render();
  });
  $('#batchMerge').addEventListener('click', batchMerge);
  $('#batchExport').addEventListener('click', batchExport);
  $('#batchDelete').addEventListener('click', batchDelete);
  $('#batchCancel').addEventListener('click', () => { state.selected.clear(); render(); });

  // 选择性恢复对话框
  $('#restoreCancel').addEventListener('click', () => $('#restoreDialog').close());
  $('#restoreOk').addEventListener('click', confirmRestoreDialog);
  $('#restoreCheckAll').addEventListener('click', () => {
    $$('#restoreTabs input').forEach((el) => { el.checked = true; });
  });
  $('#restoreInvert').addEventListener('click', () => {
    $$('#restoreTabs input').forEach((el) => { el.checked = !el.checked; });
  });

  // 命令面板
  const paletteInput = $('#paletteInput');
  paletteInput.addEventListener('input', () => { state.paletteActive = 0; renderPaletteList(paletteInput.value); });
  paletteInput.addEventListener('keydown', (e) => {
    const items = paletteItems(paletteInput.value);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      state.paletteActive = (state.paletteActive + 1) % Math.max(1, items.length);
      renderPaletteList(paletteInput.value);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      state.paletteActive = (state.paletteActive - 1 + items.length) % Math.max(1, items.length);
      renderPaletteList(paletteInput.value);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = items[state.paletteActive];
      if (item) { $('#paletteDialog').close(); item.run(); }
    }
  });
  $('#helpClose').addEventListener('click', () => $('#helpDialog').close());

  // 搜索(结构未变时走轻量路径,只切换可见性)
  const searchInput = $('#searchInput');
  searchInput.addEventListener('input', () => {
    state.query = searchInput.value;
    if (state.view === 'workspaces') { renderWorkspaces(); return; }
    if (structureToken() === state.renderToken) applySearchLight();
    else renderGroups();
  });

  // 视图切换:分组 / 工作区 / 时间轴
  $('#viewGroups').addEventListener('click', () => {
    if (state.view === 'groups') return;
    state.view = 'groups';
    render();
  });
  $('#viewWorkspaces').addEventListener('click', () => {
    if (state.view === 'workspaces') return;
    state.view = 'workspaces';
    render();
  });
  $('#viewTimeline').addEventListener('click', () => {
    if (state.view === 'timeline') return;
    state.view = 'timeline';
    render();
  });

  // 时间轴:分组定位 / 恢复;工作记录 → 当时现场
  $('#timelineList').addEventListener('click', (e) => {
    const actEl = e.target.closest('[data-tl-act]');
    if (actEl) {
      const row = actEl.closest('.tl-row');
      const group = state.data.groups.find((x) => x.id === row.dataset.id);
      if (!group) return;
      if (actEl.dataset.tlAct === 'restore') {
        restoreGroup(group, 'current');
      } else {
        state.view = 'groups';
        render();
        jumpToGroup(group.id);
      }
      return;
    }
    const recEl = e.target.closest('[data-rec]');
    if (recEl) openRecordDialogById(recEl.dataset.rec);
  });

  // 当时现场对话框按钮
  $('#recClose').addEventListener('click', () => $('#recordDialog').close());
  $('#recordDialog').addEventListener('click', (e) => {
    if (e.target !== $('#recordDialog')) return; // 点背板不误关?保持原生行为
  });
  $('#recResume').addEventListener('click', () => resumeRecordById($('#recordDialog').dataset.recId));
  $('#recRestoreFull').addEventListener('click', () => restoreRecordFullById($('#recordDialog').dataset.recId));
  $('#recToGroup').addEventListener('click', () => recordToGroupById($('#recordDialog').dataset.recId));

  // 首次引导卡
  $('#btnWelcomeSave').addEventListener('click', () => doSave('window'));
  $('#btnWelcomeDismiss').addEventListener('click', async () => {
    state.data.settings.welcomed = true;
    await persistAndRender();
  });

  // 收工:对话框 + 工作区列表事件
  $('#btnClockOut').addEventListener('click', openWsDialog);
  $('#btnClockOutTop').addEventListener('click', openWsDialog);
  $('#btnWsEmptyClock').addEventListener('click', openWsDialog);
  $('#wsOk').addEventListener('click', confirmClockOut);
  $('#wsCancel').addEventListener('click', () => $('#wsDialog').close());
  $('#wsName').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmClockOut();
  });
  $('#wsList').addEventListener('click', (e) => {
    const actEl = e.target.closest('[data-act]');
    const card = e.target.closest('.ws');
    if (!card) return;
    const ws = state.data.workspaces.find((x) => x.id === card.dataset.id);
    if (!ws) return;
    if (!actEl) {
      // 点击头部空白处:展开 / 收起
      if (e.target.closest('.ws__head')) {
        if (state.wsOpen.has(ws.id)) state.wsOpen.delete(ws.id);
        else state.wsOpen.add(ws.id);
        renderWorkspaces();
      }
      return;
    }
    switch (actEl.dataset.act) {
      case 'ws-toggle': {
        if (state.wsOpen.has(ws.id)) state.wsOpen.delete(ws.id);
        else state.wsOpen.add(ws.id);
        renderWorkspaces();
        break;
      }
      case 'ws-open': wsRestore(ws, 'new'); break;
      case 'ws-open-menu':
        openMenu(actEl, [
          { label: tr('在新窗口打开'), icon: ICONS.play, onPick: () => wsRestore(ws, 'new') },
          { label: tr('恢复到当前窗口'), icon: ICONS.tabs, onPick: () => wsRestore(ws, 'current') },
          { label: tr('替换当前窗口(先清后恢复)'), icon: ICONS.briefcase, onPick: () => wsRestore(ws, 'replace') },
        ]);
        break;
      case 'ws-more': openWsMenu(ws, actEl); break;
      case 'ws-del-tab': {
        const row = actEl.closest('.tab');
        removeWsTab(ws, row.dataset.id);
        persistAndRenderSoon();
        renderWorkspaces();
        break;
      }
      default: break;
    }
  });
  $('#wsList').addEventListener('change', (e) => {
    if (!e.target.matches('.ws__title')) return;
    const card = e.target.closest('.ws');
    const ws = state.data.workspaces.find((x) => x.id === card.dataset.id);
    if (!ws) return;
    ws.title = e.target.value.trim();
    send({ action: 'renameWorkspace', workspaceId: ws.id, title: ws.title });
  });
  $('#wsList').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('.ws__title')) e.target.blur();
  });

  // 排序 / 外观:自绘下拉菜单
  $('#sortBtn').addEventListener('click', () => {
    openMenu($('#sortBtn'), Object.keys(SORT_LABELS).map((key) => ({
      label: SORT_LABELS[key], icon: ICONS.sort,
      checked: state.data.settings.sortMode === key,
      onPick: () => { state.data.settings.sortMode = key; persistAndRender(); },
    })));
  });
  $('#themeBtn').addEventListener('click', () => {
    openMenu($('#themeBtn'), Object.keys(THEME_LABELS).map((key) => ({
      label: THEME_LABELS[key], icon: ICONS.moon,
      checked: state.data.settings.theme === key,
      onPick: () => { state.data.settings.theme = key; persistAndRender(); },
    })));
  });

  // 设置对话框
  $('#btnSettings').addEventListener('click', openSettings);
  $('#settingsClose').addEventListener('click', () => $('#settingsDialog').close());
  $('#settingsCancel').addEventListener('click', () => $('#settingsDialog').close());
  $('#settingsSave').addEventListener('click', saveSettings);
  $('#btnClearAll').addEventListener('click', clearAll);

  // 云端备份
  $('#cloudTest').addEventListener('click', () => cloudAction('test'));
  $('#cloudNow').addEventListener('click', () => cloudAction('now'));
  $('#cloudRestore').addEventListener('click', () => cloudAction('restore'));

  // 多步撤销 / 重做
  document.addEventListener('keydown', (e) => {
    if (!((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z')) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || '')) return;
    e.preventDefault();
    if (e.shiftKey) redo(); else undo();
  });

  // 键盘
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openPalette();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      searchInput.focus();
      searchInput.select();
      return;
    }
    if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey
        && !/^(input|textarea|select)$/i.test(document.activeElement.tagName)) {
      e.preventDefault();
      searchInput.focus();
      searchInput.select();
      return;
    }
    if (e.key === 'n' && !e.ctrlKey && !e.metaKey && !e.altKey
        && !/^(input|textarea|select)$/i.test(document.activeElement.tagName)) {
      e.preventDefault();
      newGroup();
      return;
    }
    if (e.key === '?' && !/^(input|textarea|select)$/i.test(document.activeElement.tagName)) {
      e.preventDefault();
      $('#helpDialog').showModal();
      return;
    }
    if (e.key === 'Escape' && document.activeElement === searchInput) {
      searchInput.value = '';
      state.query = '';
      renderGroups();
      searchInput.blur();
    }
  });

  // 键盘列表导航:↑↓ 移动焦点,Enter 执行主操作,Del 删除,Esc 取消
  document.addEventListener('keydown', (e) => {
    if (['ArrowDown', 'ArrowUp', 'Enter', 'Delete'].indexOf(e.key) < 0) return;
    const tag = document.activeElement ? document.activeElement.tagName : '';
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag)) return;
    if ($('dialog[open]') || state.menuState) return;
    const container = state.view === 'workspaces' ? $('#wsList') : $('#groupList');
    const cards = $$(container.id === 'wsList' ? '#wsList .ws' : '#groupList .group:not([hidden])');
    if (!cards.length) return;

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      state.kbdIndex = state.kbdIndex < 0
        ? (delta > 0 ? 0 : cards.length - 1)
        : Math.max(0, Math.min(cards.length - 1, state.kbdIndex + delta));
      showKbdFocus(cards);
    } else if (state.kbdIndex >= 0 && state.kbdIndex < cards.length) {
      const card = cards[state.kbdIndex];
      if (e.key === 'Enter') {
        e.preventDefault();
        if (state.view === 'workspaces') {
          const ws = state.data.workspaces.find((x) => x.id === card.dataset.id);
          if (ws) wsRestore(ws, 'new');
        } else {
          const g = state.data.groups.find((x) => x.id === card.dataset.id);
          if (g) restoreGroup(g, 'current');
        }
      } else if (e.key === 'Delete') {
        e.preventDefault();
        if (state.view === 'workspaces') {
          const ws = state.data.workspaces.find((x) => x.id === card.dataset.id);
          if (ws) deleteWorkspace(ws);
        } else {
          const g = state.data.groups.find((x) => x.id === card.dataset.id);
          if (g) deleteGroup(g);
        }
      }
    }
  });

  // 把标签拖到「新建分组」按钮上 → 直接创建一个只含该标签的新分组
  const newBtn = $('#btnNewGroup');
  newBtn.addEventListener('dragover', (e) => {
    if (!state.dragInfo || state.dragInfo.type !== 'tab') return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    newBtn.classList.add('dragover');
  });
  newBtn.addEventListener('dragleave', () => newBtn.classList.remove('dragover'));
  newBtn.addEventListener('drop', (e) => {
    newBtn.classList.remove('dragover');
    if (!state.dragInfo || state.dragInfo.type !== 'tab') return;
    e.preventDefault();
    e.stopPropagation();
    const g = BGTStore.normalizeGroup({ title: '', createdAt: Date.now(), tabs: [] });
    if (moveTab(state.dragInfo.groupId, state.dragInfo.tabId, g.id, 0)) {
      state.data.groups.unshift(g);
      state.dragInfo = null;
      persistAndRender();
      toast(tr('已移动到新分组'));
    }
  });

  // 外部数据变化(如 Alt+S 快捷键保存、popup/右键菜单保存);
  // 自己写入的变更通过令牌跳过,避免多余重渲染
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[BGTStore.STORE_KEY]) {
      const next = changes[BGTStore.STORE_KEY].newValue;
      if (BGTStore.isSelfWrite(next && next.updatedAt)) return;
      BGTStore.load().then((d) => { state.data = d; render(); });
    }
  });

}
