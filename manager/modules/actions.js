/**
 * Tab Harbor — actions:分组与工作区的业务动作
 */
import { state, $, $$, h, relTime, hueOf, hostOf, firstChar, fmtDate, snapshotGroups, send, persist, persistAndRender } from './core.js';
import { ICONS, NATIVE_COLOR_NAMES } from './icons.js';
import { toast, offerUndo, confirmDialog, openMenu, iconBtn } from './ui.js';
import { render, renderGroups, renderWorkspaces, updateBatchBar } from './render.js';

/* ---------------- 恢复分组 ---------------- */

/**
 * 恢复方式:
 * current=当前窗口后台(默认)、current-fg=当前窗口前台、new=新窗口、
 * native=当前窗口并组装为 Chrome 原生标签组。
 * onlyTabIds 传入时只恢复选中的标签。
 */
export async function restoreGroup(group, mode, onlyTabIds) {
  let tabs = group.tabs;
  if (onlyTabIds && onlyTabIds.length) {
    const wanted = new Set(onlyTabIds);
    tabs = group.tabs.filter((t) => wanted.has(t.id));
  }
  if (!tabs.length) { toast(tr('没有选中要恢复的标签')); return; }
  let failed = 0;
  try {
    if (mode === 'new') {
      const first = tabs[0];
      const win = await chrome.windows.create({ url: first.url, focused: true });
      const firstTabId = win.tabs && win.tabs[0] && win.tabs[0].id;
      if (first.pinned && firstTabId != null) {
        await chrome.tabs.update(firstTabId, { pinned: true });
      }
      for (const t of tabs.slice(1)) {
        try {
          await chrome.tabs.create({ windowId: win.id, url: t.url, pinned: t.pinned, active: false });
        } catch (e) { failed += 1; }
      }
    } else if (mode === 'native') {
      if (!chrome.tabs.group) {
        toast(tr('当前环境不支持原生标签组,已按普通方式恢复'));
        await openTabsInCurrent(tabs, false);
        return;
      }
      const cur = await chrome.windows.getCurrent();
      const created = [];
      for (const t of tabs) {
        try {
          const nt = await chrome.tabs.create({ windowId: cur.id, url: t.url, active: false });
          created.push(nt.id);
        } catch (e) { failed += 1; }
      }
      if (created.length) {
        const nativeId = await chrome.tabs.group({ tabIds: created });
        if (group.title && chrome.tabGroups && chrome.tabGroups.update) {
          try { await chrome.tabGroups.update(nativeId, { title: group.title }); } catch (e) { /* 标题可省 */ }
        }
      }
    } else {
      failed = await openTabsInCurrent(tabs, mode === 'current-fg');
    }
  } catch (e) {
    toast(tr('恢复失败:') + (e && e.message ? e.message : e));
    return;
  }
  const where = mode === 'new' ? tr('已在新窗口恢复') : mode === 'native' ? tr('已恢复为原生标签组') : mode === 'current-fg' ? tr('已恢复到当前窗口') : tr('已恢复');
  toast(failed
    ? tr('{where} {ok} 个,{bad} 个无法打开', { where, ok: tabs.length - failed, bad: failed })
    : tr('{where} {n} 个标签', { where, n: tabs.length }));
  if (state.data.settings.deleteGroupOnRestore && tabs.length === group.tabs.length) {
    const before = snapshotGroups();
    state.data.groups = state.data.groups.filter((x) => x.id !== group.id);
    await persistAndRender();
    offerUndo(tr('已删除分组「{name}」', { name: group.title || tr('未命名分组') }), before);
  }
}

/** 在当前窗口打开;返回失败数 */
async function openTabsInCurrent(tabs, foreground) {
  const cur = await chrome.windows.getCurrent();
  let failed = 0;
  for (let i = 0; i < tabs.length; i += 1) {
    try {
      await chrome.tabs.create({
        windowId: cur.id, url: tabs[i].url, pinned: tabs[i].pinned,
        active: foreground && i === 0,
      });
    } catch (e) { failed += 1; }
  }
  return failed;
}

export async function deleteGroup(group) {
  if (state.data.settings.confirmDelete) {
    const ok = await confirmDialog({
      title: tr('删除分组'),
      text: tr('确定删除分组「{name}」及其 {n} 个标签吗?', { name: group.title || tr('未命名分组'), n: group.tabs.length }),
    });
    if (!ok) return;
  }
  const before = snapshotGroups();
  state.data.groups = state.data.groups.filter((x) => x.id !== group.id);
  await persistAndRender();
  offerUndo(tr('已删除分组「{name}」', { name: group.title || tr('未命名分组') }), before);
}

export async function removeTab(group, tabId) {
  const idx = group.tabs.findIndex((t) => t.id === tabId);
  if (idx < 0) return;
  const removed = group.tabs.splice(idx, 1)[0];
  await persistAndRender();
  const label = removed.title.length > 18 ? removed.title.slice(0, 18) + '…' : removed.title;
  toast(tr('已移除「{name}」', { name: label }), {
    duration: 6000,
    actionLabel: tr('撤销'),
    onAction: () => {
      const g = state.data.groups.find((x) => x.id === group.id);
      if (!g) { toast(tr('分组已不存在,无法撤销')); return; }
      g.tabs.splice(Math.min(idx, g.tabs.length), 0, removed);
      persistAndRender();
    },
  });
}

export async function addCurrentTabToGroup(group) {
  let active = null;
  try {
    [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch (e) { /* 预览模式 */ }
  if (!active || !active.url) { toast(tr('没有可添加的标签页')); return; }
  const key = BGTStore.normalizeUrl(active.url).key;
  if (group.tabs.some((t) => BGTStore.normalizeUrl(t.url).key === key)) {
    toast(tr('该页面已在此分组中'));
    return;
  }
  group.tabs.push(BGTStore.makeStoredTab(active));
  group.collapsed = false;
  await persistAndRender();
  toast(tr('已添加当前标签页'));
}

export async function newGroup() {
  const g = BGTStore.normalizeGroup({ title: '', createdAt: Date.now(), tabs: [] });
  state.data.groups.unshift(g);
  await persistAndRender();
  const input = $(`.group[data-id="${g.id}"] .group__title`);
  if (input) input.focus();
}

export async function copyGroupLinks(group) {
  if (!group || !group.tabs.length) { toast(tr('该分组没有标签')); return; }
  const text = group.tabs.map((t) => t.url).join('\n');
  try {
    await navigator.clipboard.writeText(text);
    toast(tr('已复制 {n} 个链接', { n: group.tabs.length }));
  } catch (e) {
    toast(tr('复制失败,浏览器未授权剪贴板'));
  }
}

export async function doSave(kind) {
  if (kind === 'window') {
    const pre = await precheckDedup();
    if (pre === 'cancel') return;
    if (pre) { await sendSaveWindow(pre); return; } // 仅存新增(携带身份键集合)
  }
  const res = await send({ action: kind === 'all' ? 'saveAllWindows' : 'saveWindow', fromManager: true });
  if (res && res.ok) {
    const dup = res.dupCount ? tr(',其中 {n} 个网址此前已保存过', { n: res.dupCount }) : '';
    const routed = res.autoRouted ? tr(',{n} 个已按规则自动归组', { n: res.autoRouted }) : '';
    toast(kind === 'all'
      ? tr('已保存 {a} 个窗口共 {b} 个标签{dup}{routed}', { a: res.groups, b: res.saved, dup, routed })
      : tr('已保存 {n} 个标签{dup}{routed}', { n: res.saved, dup, routed }));
    state.data = await BGTStore.load();
    render();
  } else if (res && res.reason === 'empty') {
    toast(tr('没有可保存的标签'));
  } else {
    toast(tr('保存失败:') + failureDetail(res));
  }
}

function sendSaveWindow(onlyNewKeys) {
  return (async () => {
    const res = await send({ action: 'saveWindow', fromManager: true, __onlyNewKeys: onlyNewKeys });
    if (res && res.ok) {
      if (res.allKnown || res.saved === 0) { toast(tr('没有需要新增的标签')); return; }
      toast(tr('已保存 {n} 个新增标签', { n: res.saved }));
      state.data = await BGTStore.load();
      render();
    } else if (res && res.reason === 'empty') {
      toast(tr('没有可保存的标签'));
    } else {
      toast(tr('保存失败:') + failureDetail(res));
    }
  })();
}

/** 保存失败的细节透出(后台 reason / 无响应),便于真机定位 */
function failureDetail(res) {
  if (res && res.reason) return String(res.reason);
  return tr('后台服务不可用');
}

/** 智能去重预检:统计当前窗口标签中"已收藏过"(分组/历史记录)的数量。
 *  返回:null=直接全量保存;'cancel'=取消;数组=仅存新增的键集合。 */
async function precheckDedup() {
  let tabs = [];
  try { tabs = await chrome.tabs.query({ currentWindow: true }); } catch (e) { /* 预览模式 */ }
  const base = chrome.runtime ? chrome.runtime.getURL('') : '';
  tabs = tabs.filter((t) => typeof t.url === 'string' && t.url.startsWith('http') && !t.url.startsWith(base));
  if (!tabs.length) return null;

  const index = BGTStore.buildUrlIdentity(state.data);
  // 规格:"X 个已在某分组保存过" —— 仅对比收藏分组;历史记录不算收藏,
  // 否则每次收工后所有标签都被视为已保存,弹窗会无意义地频繁出现。
  const savedSources = new Set(['group']);
  const knownKeys = new Set();
  let savedCount = 0;
  const newKeys = [];
  for (const t of tabs) {
    const key = BGTStore.normalizeUrl(t.url).key;
    const entry = index.get(key);
    const isSaved = entry && entry.occurrences.some((o) => savedSources.has(o.source));
    if (isSaved) { savedCount += 1; knownKeys.add(key); }
    else newKeys.push(key);
  }
  if (savedCount === 0) return null; // 无重复,直接全量保存
  if (!newKeys.length) { toast(tr('这些标签都已收藏过')); return 'cancel'; }

  return new Promise((resolve) => {
    const dlg = $('#dedupDialog');
    $('#dedupText').textContent = tr('当前窗口 {total} 个标签中,{saved} 个已收藏过。是否只保存新增的 {n} 个?', { total: tabs.length, saved: savedCount, n: newKeys.length });
    const close = (val) => { dlg.close(); resolve(val); };
    $('#dedupNewOnly').textContent = tr('仅存新增的 {n} 个', { n: newKeys.length });
    $('#dedupNewOnly').onclick = () => close(newKeys);
    $('#dedupAll').onclick = () => close(null);
    $('#dedupCancel').onclick = () => close('cancel');
    dlg.oncancel = () => resolve('cancel');
    dlg.showModal();
  });
}

/* ---------------- 跳转与重复洞察 ---------------- */

/** 跳到某分组:切回分组视图、必要时开启"显示归档"、展开、滚动定位并闪烁高亮 */
export async function jumpToGroup(groupId) {
  const g = state.data.groups.find((x) => x.id === groupId);
  if (!g) { toast(tr('该分组已不存在')); return; }
  let needRender = false;
  if (state.view !== 'groups') { state.view = 'groups'; needRender = true; }
  if (g.archived && !state.data.settings.showArchived) {
    state.data.settings.showArchived = true;
    needRender = true;
  }
  if (g.collapsed) { g.collapsed = false; needRender = true; }
  if (needRender) await persistAndRender();
  const card = $(`.group[data-id="${groupId}"]`);
  if (!card) return;
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  card.classList.add('group--flash');
  setTimeout(() => card.classList.remove('group--flash'), 1500);
}

/** 点击 ×N 徽章:列出该网址每一次保存的日期与所在分组,可跳转 */
export function openDupMenu(contextGroup, tab, anchor) {
  const identity = BGTStore.lookupIndex(BGTStore.buildUrlIdentity(state.data), tab.url);
  const occurrences = identity.occurrences;
  if (identity.seenCount <= 1) { toast(tr('该网址只保存过 1 次')); return; }
  openMenu(anchor, occurrences.map((o) => ({
    label: tr('{date} · {group}', { date: fmtDate(o.at), group: o.refTitle || tr('未命名分组') }),
    icon: (contextGroup && o.source === 'group' && o.refId === contextGroup.id) ? ICONS.check
      : o.source === 'group' ? ICONS.tabs
      : o.source === 'record' ? ICONS.list : ICONS.briefcase,
    onPick: () => {
      if (o.source === 'group') jumpToGroup(o.refId);
      else if (o.source === 'record') openRecordDialogById(o.refId);
      else if (o.source === 'workspace') locateWorkspace(o.refId);
    },
  })));
}

/** 从来源链跳到工作区卡片 */
function locateWorkspace(wsId) {
  state.view = 'workspaces';
  render();
  state.wsOpen.add(wsId);
  renderWorkspaces();
  const card = $(`#wsList .ws[data-id="${wsId}"]`);
  if (card) {
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.classList.add('group--flash');
    setTimeout(() => card.classList.remove('group--flash'), 1500);
  }
}

/** 重复统计面板:按次数排序,展开每次保存的日期与分组 */
export function openDupDialog() {
  const index = BGTStore.buildUrlIdentity(state.data);
  const dups = Array.from(index.values())
    .filter((entry) => entry.seenCount > 1)
    .sort((a, b) => b.seenCount - a.seenCount || b.lastSeenAt - a.lastSeenAt);

  const listEl = $('#dupList');
  listEl.textContent = '';
  const totalOcc = dups.reduce((n, e) => n + e.seenCount, 0);
  $('#dupSummary').textContent = dups.length
    ? tr('{n} 个网址被保存过多次,共 {m} 条记录', { n: dups.length, m: totalOcc })
    : tr('目前没有网址被重复保存。同一个网址每次保存都会记录日期和所在分组。');

  for (const entry of dups) {
    const occ = entry.occurrences;
    const latest = occ[occ.length - 1];
    const row = h('div', { class: 'dup-row' });
    const top = h('div', { class: 'dup-row__top' },
      h('span', { class: 'tab__avatar', text: firstChar(latest.tabTitle), style: `--h:${hueOf(entry.key)}` }),
      h('span', { class: 'dup-row__title', text: latest.tabTitle, title: entry.key }),
      h('span', { class: 'dup-row__count', text: '×' + occ.length }),
    );
    row.appendChild(top);
    const chips = h('div', { class: 'dup-row__chips' });
    for (const o of occ.slice(-12)) {
      const label = o.source === 'group' ? tr('{date} · {group}', { date: fmtDate(o.at), group: o.refTitle || tr('未命名分组') })
        : o.source === 'record' ? tr('{date} · 记录', { date: fmtDate(o.at) })
        : tr('{date} · 工作区', { date: fmtDate(o.at) });
      const chip = h('button', {
        class: 'dup-chip', type: 'button',
        title: o.source === 'group' ? tr('点击跳转到该分组') : o.source === 'record' ? tr('点击查看当时现场') : tr('点击定位到该工作区'),
      }, label);
      chip.addEventListener('click', () => {
        $('#dupDialog').close();
        if (o.source === 'group') jumpToGroup(o.refId);
        else if (o.source === 'record') openRecordDialogById(o.refId);
        else locateWorkspace(o.refId);
      });
      chips.appendChild(chip);
    }
    row.appendChild(chips);
    listEl.appendChild(row);
  }

  // 高频域名(洞察 → 规则闭环)
  const hostWrap = $('#hostList');
  hostWrap.textContent = '';
  const rules = BGTStore.parseRules(state.data.settings.tidyRules);
  const hasRuleFor = (host) => rules.some((r) => host === r.domain || host.endsWith('.' + r.domain));
  const hosts = BGTStore.topHosts(state.data, 8);
  if (!hosts.length) {
    hostWrap.appendChild(h('p', { class: 'snapshot-empty', text: tr('暂无域名数据。保存后这里会汇总你最常停留的站点。') }));
  }
  for (const hst of hosts) {
    const ruled = hasRuleFor(hst.host);
    hostWrap.appendChild(h('div', { class: 'sim-row' },
      h('span', { class: 'sim-names', text: hst.host, title: hst.host }),
      h('span', { class: 'sim-score', title: tr('{u} 个网址 · {m} 次保存', { u: hst.urls, m: hst.seenTotal }),
        text: tr('{u} 网址', { u: hst.urls }) }),
      ruled ? h('span', { class: 'sim-score', text: tr('已有规则') })
            : h('button', {
                class: 'btn', type: 'button', text: tr('转规则'),
                title: tr('把该域名写入整理规则,保存时自动归组'),
                onclick: () => addRuleForHost(hst.host),
              }),
    ));
  }

  // 相似分组建议
  const simWrap = $('#similarList');
  simWrap.textContent = '';
  const sims = BGTStore.similarGroups(state.data, 0.8);
  if (!sims.length) {
    simWrap.appendChild(h('p', {
      class: 'snapshot-empty',
      text: tr('没有高度重叠的分组。当两个分组的网址有 80% 以上相同时,这里会建议合并。'),
    }));
  }
  for (const sim of sims) {
    simWrap.appendChild(h('div', { class: 'sim-row' },
      h('span', { class: 'sim-names', text: tr('「{a}」+「{b}」· {n} 个共同网址', { a: sim.aTitle, b: sim.bTitle, n: sim.shared }) }),
      h('span', { class: 'sim-score', text: Math.round(sim.score * 100) + '%' }),
      h('button', {
        class: 'btn', type: 'button', text: tr('合并'),
        title: tr('把后者并入前者(自动去重),可撤销'),
        onclick: () => mergeSimilarPair(sim),
      }),
    ));
  }
  $('#dupDialog').showModal();
}

/** 把某一天的记录标签并集找回为一个分组(可撤销) */
export async function findBackDay(dayAt) {
  const dayStart = new Date(dayAt); dayStart.setHours(0, 0, 0, 0);
  const dayEnd = dayStart.getTime() + 86400000;
  const dayRecords = (state.data.records || []).filter((r) => r.createdAt >= dayStart.getTime() && r.createdAt < dayEnd);
  if (!dayRecords.length) { toast(tr('那一天没有记录')); return; }
  const seen = new Set();
  const tabs = [];
  for (const r of dayRecords) {
    for (const t of r.tabs) {
      const k = BGTStore.normalizeUrl(t.url).key;
      if (!seen.has(k)) { seen.add(k); tabs.push(t); }
    }
  }
  if (!tabs.length) { toast(tr('那一天没有记录')); return; }
  const before = state.data.groups.slice();
  const d = new Date(dayAt);
  const dateLabel = tr('{m}月{d}日', { m: d.getMonth() + 1, d: d.getDate() });
  const created = BGTStore.normalizeGroup({
    title: tr('回港 {date}', { date: dateLabel }),
    createdAt: Date.now(),
    tabs: tabs.map((t) => ({ url: t.url, title: t.title, favIconUrl: t.favIconUrl, pinned: t.pinned })),
  });
  state.data.groups.unshift(created);
  await persistAndRender();
  // 创建型操作:撤销 = 移除刚创建的分组(合并语义会把它当作"期间的编辑"保留)
  rollbackToast(tr('已找回 {n} 个标签(来自 {m} 条记录)', { n: tabs.length, m: dayRecords.length }),
    created.id, before);
}

/** 创建型操作的撤销:Toast 内一键移除刚创建的对象 */
function rollbackToast(label, createdGroupId, groupsBefore) {
  toast(label, {
    duration: 6000,
    actionLabel: tr('撤销'),
    onAction: async () => {
      state.data.groups = groupsBefore.filter((g) => g.id !== createdGroupId);
      await persistAndRender();
    },
  });
}

/** 把域名写入整理规则,并跳到设置页让用户补全分组名 */
async function addRuleForHost(host) {
  if ((state.data.settings.tidyRules || '')
      .split('\n').some((line) => line.trim().toLowerCase().startsWith(host.toLowerCase() + ' =>'))) {
    toast(tr('已有该域名的规则'));
    return;
  }
  state.data.settings.tidyRules = (state.data.settings.tidyRules || '')
    .replace(/\n+$/, '') + '\n' + host + ' => ';
  await persist();
  $('#dupDialog').close();
  const settings = await import('./settings.js');
  settings.openSettings();
  const box = $('#setTidyRules');
  if (box) { box.focus(); box.setSelectionRange(box.value.length, box.value.length); }
  toast(tr('规则已预填,补全分组名后保存'), { duration: 6000 });
}

/** 合并一对相似分组:b 并入 a,可撤销 */
export async function mergeSimilarPair(sim) {
  const a = state.data.groups.find((g) => g.id === sim.aId);
  const b = state.data.groups.find((g) => g.id === sim.bId);
  if (!a || !b) { toast(tr('分组已不存在')); return; }
  const before = snapshotGroups();
  BGTStore.appendNewTabs(a.tabs, b.tabs); // 身份键去重:与 similarGroups 的相似度口径一致
  state.data.groups = state.data.groups.filter((g) => g.id !== b.id);
  await persistAndRender();
  $('#dupDialog').close();
  offerUndo(tr('已合并「{b}」到「{a}」', { b: b.title || tr('未命名分组'), a: a.title || tr('未命名分组') }), before, 0, 'groups', 'MERGE_GROUPS');
}

/* ---------------- 菜单(分组卡) ---------------- */

/** 恢复方式菜单(拆分按钮的箭头部分) */
export function openRestoreMenu(anchor, group) {
  openMenu(anchor, [
    { label: tr('后台打开(当前窗口)'), icon: ICONS.play, onPick: () => restoreGroup(group, 'current') },
    { label: tr('前台打开(当前窗口)'), icon: ICONS.play, onPick: () => restoreGroup(group, 'current-fg') },
    { label: tr('在新窗口打开'), icon: ICONS.ext, onPick: () => restoreGroup(group, 'new') },
    { label: tr('恢复为原生标签组'), icon: ICONS.tabs, onPick: () => restoreGroup(group, 'native') },
    '-',
    { label: tr('选择标签恢复…'), icon: ICONS.list, onPick: () => openRestoreDialog(group) },
  ]);
}

/** 分组「⋯」菜单 */
export function openGroupMenu(group, anchor) {
  openMenu(anchor, [
    { label: tr('重命名'), icon: ICONS.pencil, onPick: () => {
        const input = $(`.group[data-id="${group.id}"] .group__title`);
        if (input) { input.focus(); input.select(); }
      } },
    { label: group.pinned ? tr('取消置顶') : tr('置顶'), icon: ICONS.pin, onPick: () => {
        group.pinned = !group.pinned; persistAndRender();
      } },
    { label: group.archived ? tr('取消归档') : tr('归档'), icon: ICONS.archive, onPick: () => {
        group.archived = !group.archived; persistAndRender();
      } },
    '-',
    { label: tr('复制链接列表'), icon: ICONS.copy, onPick: () => copyGroupLinks(group) },
    { label: tr('导出此分组'), icon: ICONS.download, onPick: () => exportGroup(group) },
    { label: tr('添加当前标签页'), icon: ICONS.plus, onPick: () => addCurrentTabToGroup(group) },
    '-',
    { label: tr('删除分组'), icon: ICONS.trash, danger: true, onPick: () => deleteGroup(group) },
  ]);
}

/* ---------------- 原生标签组导入 / 按域名整理 ---------------- */

/** 把当前窗口的 Chrome 原生标签组导入为持久分组 */
export async function importNativeGroups() {
  if (!chrome.tabGroups || !chrome.tabGroups.query) {
    toast(tr('当前环境不支持原生标签组(预览模式)'));
    return;
  }
  try {
    const cur = await chrome.windows.getCurrent();
    const tabs = await chrome.tabs.query({ windowId: cur.id });
    const tgs = await chrome.tabGroups.query({ windowId: cur.id });
    const byId = new Map();
    for (const t of tabs) {
      if (t.groupId && t.groupId !== -1) {
        if (!byId.has(t.groupId)) byId.set(t.groupId, []);
        byId.get(t.groupId).push(t);
      }
    }
    let imported = 0;
    for (const tg of tgs) {
      const raw = byId.get(tg.id);
      if (!raw || !raw.length) continue;
      state.data.groups.unshift(BGTStore.normalizeGroup({
        title: tg.title || (tr('原生 · ') + (NATIVE_COLOR_NAMES[tg.color] || tr('标签组'))),
        createdAt: Date.now(),
        tabs: raw.map((t) => ({ url: t.url, title: t.title, favIconUrl: t.favIconUrl, pinned: t.pinned })),
      }));
      imported += 1;
    }
    if (!imported) { toast(tr('当前窗口没有原生标签组')); return; }
    await persistAndRender();
    toast(tr('已导入 {n} 个原生分组', { n: imported }));
  } catch (e) {
    toast(tr('导入失败:') + (e && e.message ? e.message : e));
  }
}

/** 把所有(未归档)分组的标签按域名及规则重新归组 */
export async function tidyByDomain() {
  const source = state.data.groups.filter((g) => !g.archived && g.tabs.length);
  if (!source.length) { toast(tr('没有可整理的分组')); return; }
  const totalTabs = source.reduce((n, g) => n + g.tabs.length, 0);
  const ok = await confirmDialog({
    title: tr('按域名整理'),
    text: tr('将把 {groups} 个分组中共 {tabs} 个标签按域名(及整理规则)重新归组:网址相同的标签只保留一个,整理后变空的分组会被移除。可在操作后撤销。', { groups: source.length, tabs: totalTabs }),
    okText: tr('开始整理'),
  });
  if (!ok) return;

  const before = snapshotGroups();
  const rules = BGTStore.parseRules(state.data.settings.tidyRules);
  const buckets = new Map(); // 分组名 -> { reused?: group, tabs: [] }
  for (const g of source) {
    for (const t of g.tabs) {
      let name = tr('其他');
      try {
        name = BGTStore.ruleTarget(rules, new URL(t.url).hostname.replace(/^www\./, ''));
      } catch (e) { /* 非法网址归入其他 */ }
      if (!buckets.has(name)) {
        buckets.set(name, {
          reused: state.data.groups.find((x) => !x.archived && (x.title || '') === name),
          tabs: [],
          keys: new Set(), // 身份键:与全局去重口径一致
        });
      }
      const bucket = buckets.get(name);
      const key = BGTStore.normalizeUrl(t.url).key;
      if (!bucket.keys.has(key)) { bucket.keys.add(key); bucket.tabs.push(t); }
    }
  }

  const tidied = [];
  for (const [name, bucket] of buckets) {
    if (bucket.reused) {
      bucket.reused.tabs = bucket.tabs;
      tidied.push(bucket.reused);
    } else {
      tidied.push(BGTStore.normalizeGroup({ title: name, createdAt: Date.now(), tabs: bucket.tabs }));
    }
  }
  const untouched = state.data.groups.filter((g) => !source.includes(g));
  state.data.groups = tidied.concat(untouched);
  await persistAndRender();
  offerUndo(tr('整理完成:{n} 个分组', { n: buckets.size }), before, 0, 'groups', 'TIDY_DOMAIN');
}

/* ---------------- 导出 / 导入 ---------------- */

export function downloadGroups(groups, name) {
  const payload = {
    app: 'tab-harbor',
    version: BGTStore.DATA_VERSION,
    exportedAt: new Date().toISOString(),
    groups,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const safe = String(name || 'backup').replace(/[\\/:*?"<>|]/g, '_').slice(0, 40);
  a.href = URL.createObjectURL(blob);
  a.download = `tab-harbor-${safe}-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}

export function doExport() {
  if (!state.data.groups.length) { toast(tr('当前没有分组可导出')); return; }
  downloadGroups(state.data.groups, 'backup');
  toast(tr('已导出 {n} 个分组', { n: state.data.groups.length }));
}

export function exportGroup(group) {
  if (!group || !group.tabs.length) { toast(tr('该分组没有标签')); return; }
  downloadGroups([group], group.title || tr('未命名分组'));
  toast(tr('已导出分组「{name}」', { name: group.title || tr('未命名分组') }));
}

export async function handleImport(file) {
  if (!file) return;
  try {
    const obj = JSON.parse(await file.text());
    let rawGroups = [];
    if (Array.isArray(obj)) rawGroups = obj;
    else if (Array.isArray(obj.groups)) rawGroups = obj.groups;
    else if (Array.isArray(obj.tabGroups)) {
      // 支持 v1 老版本备份格式
      rawGroups = obj.tabGroups.map((g) => ({
        title: (g && g.title) || tr('导入分组'),
        createdAt: g && g.date,
        tabs: g && g.tabs,
      }));
    }
    if (!rawGroups.length) throw new Error('no groups');

    const groups = rawGroups.map((g) => BGTStore.normalizeGroup({
      title: g.title,
      createdAt: g.createdAt || g.date,
      pinned: g.pinned,
      archived: g.archived,
      tabs: (g.tabs || []).map((t) => ({
        url: t.url, title: t.title, favIconUrl: t.favIconUrl, pinned: t.pinned,
      })),
    }));
    state.data.groups = groups.concat(state.data.groups);
    await persistAndRender();
    toast(tr('已导入 {n} 个分组', { n: groups.length }));
  } catch (e) {
    toast(tr('导入失败:文件格式不正确'));
  } finally {
    $('#importFile').value = '';
  }
}

/* ---------------- 批量操作 ---------------- */

function selectedGroups() {
  return state.data.groups.filter((g) => state.selected.has(g.id));
}

export async function batchMerge() {
  const groups = selectedGroups();
  if (groups.length < 2) { toast(tr('请至少选择两个分组')); return; }
  const before = snapshotGroups();
  const target = groups[0];
  for (const g of groups.slice(1)) BGTStore.appendNewTabs(target.tabs, g.tabs);
  const removed = groups.slice(1).map((g) => g.id);
  state.data.groups = state.data.groups.filter((g) => !removed.includes(g.id));
  state.selected.clear();
  await persistAndRender();
  offerUndo(tr('已合并 {n} 个分组到「{name}」', { n: groups.length, name: target.title || tr('未命名分组') }), before, 0, 'groups', 'BATCH_DELETE_BATCH_MERGE');
}

export async function batchDelete() {
  const groups = selectedGroups();
  if (!groups.length) return;
  const ok = await confirmDialog({
    title: tr('删除所选分组'),
    text: tr('确定删除所选的 {n} 个分组(共 {m} 个标签)吗?', { n: groups.length, m: groups.reduce((n, g) => n + g.tabs.length, 0) }),
  });
  if (!ok) return;
  const before = snapshotGroups();
  const ids = new Set(groups.map((g) => g.id));
  state.data.groups = state.data.groups.filter((g) => !ids.has(g.id));
  state.selected.clear();
  await persistAndRender();
  offerUndo(tr('已删除 {n} 个分组', { n: groups.length }), before, 0, 'groups', 'BATCH_DELETE');
}

export function batchExport() {
  const groups = selectedGroups();
  if (!groups.length) return;
  downloadGroups(groups, 'selection');
  toast(tr('已导出 {n} 个分组', { n: groups.length }));
}

/* ---------------- 选择性恢复 ---------------- */

export function openRestoreDialog(group) {
  state.restoreTarget = group;
  $('#restoreTitle').textContent = tr('恢复分组「{name}」', { name: group.title || tr('未命名分组') });
  const wrap = $('#restoreTabs');
  wrap.textContent = '';
  for (const t of group.tabs) {
    const row = h('label', { class: 'restore__item' },
      h('input', { type: 'checkbox', checked: 'true', 'data-id': t.id }),
      h('span', { text: t.title || t.url, title: t.title }),
      h('span', { class: 'restore__host', text: hostOf(t.url) }),
    );
    wrap.appendChild(row);
  }
  $('#restoreDialog').showModal();
}

export async function confirmRestoreDialog() {
  if (!state.restoreTarget) return;
  const ids = $$('#restoreTabs input:checked').map((el) => el.dataset.id);
  const mode = $('#restoreMode').value;
  const group = state.restoreTarget;
  $('#restoreDialog').close();
  await restoreGroup(group, mode, ids);
}

/* ---------------- 工作区:收工 / 开工 ---------------- */

export async function wsRestore(ws, mode) {
  const res = await send({ action: 'restoreWorkspace', workspaceId: ws.id, mode });
  if (res && res.ok) toast(tr('已开工:恢复 {n} 个标签', { n: res.restored }));
  else if (res && res.reason === 'empty') toast(tr('该工作区没有标签'), true);
  else toast(tr('开工失败:后台服务不可用'), true);
}

export function openWsMenu(ws, anchor) {
  openMenu(anchor, [
    { label: tr('重命名'), icon: ICONS.pencil, onPick: () => {
        const input = $(`#wsList .ws[data-id="${ws.id}"] .ws__title`);
        if (input) { input.focus(); input.select(); }
      } },
    { label: tr('导出为分组备份'), icon: ICONS.download, onPick: () =>
        downloadGroups([BGTStore.normalizeGroup({ title: ws.title, tabs: ws.tabs })], ws.title) },
    '-',
    { label: tr('删除工作区'), icon: ICONS.trash, danger: true, onPick: () => deleteWorkspace(ws) },
  ]);
}

export async function deleteWorkspace(ws) {
  const ok = await confirmDialog({
    title: tr('删除工作区'),
    text: tr('确定删除工作区「{name}」及其 {n} 个标签吗?', { name: ws.title || tr('未命名'), n: ws.tabs.length }),
  });
  if (!ok) return;
  const before = state.data.workspaces.slice();
  state.data.workspaces = state.data.workspaces.filter((x) => x.id !== ws.id);
  await persistAndRender();
  offerUndo(tr('已删除工作区「{name}」', { name: ws.title || tr('未命名') }), before, 6000, 'workspaces', 'DELETE_WORKSPACE');
}

/** 收工对话框:命名 + 是否关闭标签 */
export function openWsDialog() {
  $('#wsName').value = '';
  $('#wsCloseTabs').checked = true;
  $('#wsDialog').showModal();
  setTimeout(() => $('#wsName').focus(), 60);
}

export async function confirmClockOut() {
  const title = $('#wsName').value;
  const closeTabs = $('#wsCloseTabs').checked;
  const allWindows = $('#wsAllWindows') ? $('#wsAllWindows').checked : false;
  const res = await send({ action: 'saveWorkspace', title, closeTabs, allWindows });
  if (res && res.ok) {
    $('#wsDialog').close();
    state.view = 'workspaces';
    state.query = '';
    $('#searchInput').value = '';
    state.data = await BGTStore.load();
    render();
    const multi = res.windows > 1 ? tr('({n} 个窗口)', { n: res.windows }) : '';
    toast(tr('已收工:{n} 个标签存入「{name}」', { n: res.saved, name: res.title }) + multi);
  } else if (res && res.reason === 'empty') {
    toast(tr('当前窗口没有可保存的标签'), true);
  } else {
    toast(tr('收工失败:后台服务不可用'), true);
  }
}

/** 从工作区移除单个标签:tabs 扁平镜像与 windows[] 双结构同步 */
export function removeWsTab(ws, tabId) {
  const idx = ws.tabs.findIndex((t) => t.id === tabId);
  if (idx < 0) return;
  ws.tabs.splice(idx, 1);
  if (ws.windows) {
    for (const win of ws.windows) {
      const wi = win.tabs.findIndex((t) => t.id === tabId);
      if (wi >= 0) { win.tabs.splice(wi, 1); break; }
    }
    ws.windows = ws.windows.filter((win) => win.tabs.length);
    if (ws.windows.length <= 1) ws.windows = undefined; // 退化为单窗口结构
  }
}

/* ---------------- 当时现场:工作记录详情(回到那一刻) ---------------- */

function findRecord(id) {
  return (state.data.records || []).find((r) => r.id === id);
}

function recLineEl(t, hueVal, identityIndex) {
  const identity = BGTStore.lookupIndex(identityIndex, t.url);
  const occ = identity.occurrences;
  const badge = identity.seenCount > 1
    ? h('button', {
        class: 'rec-badge', type: 'button', text: '×' + identity.seenCount,
        title: tr('已保存 {n} 次:', { n: identity.seenCount }) +
          occ.map((o) => tr('{date}({group})', { date: fmtDate(o.at), group: o.refTitle || tr('未命名分组') })).join('、'),
        onclick: (e) => { e.stopPropagation(); openDupMenu(null, t, e.currentTarget); },
      })
    : null;
  return h('div', { class: 'rec-line', style: `--h:${hueVal}` },
    h('span', { class: 'sp__dot' }),
    h('a', {
      class: 'tab__link', href: t.url, target: '_blank', rel: 'noopener',
      text: t.title || t.url, title: t.title,
    }),
    t.pinned ? h('span', { class: 'tab__pin', text: '📌' }) : null,
    h('span', { class: 'rec-host', text: hostOf(t.url) }),
    badge,
  );
}

/** 打开工作记录详情:差分摘要 + 新增/移除清单 + 三种恢复方式 */
export function openRecordDialog(record) {
  const rec = typeof record === 'string' ? findRecord(record) : record;
  if (!rec) { toast(tr('该记录已不存在')); return; }
  const records = (state.data.records || []).slice().sort((a, b) => a.createdAt - b.createdAt);
  const idx = records.findIndex((r) => r.id === rec.id);
  const prev = idx > 0 ? records[idx - 1] : null;
  const diff = prev ? BGTStore.diffTabs(prev.tabs, rec.tabs) : null;

  $('#recTitle').textContent = tr('当时现场 · {title}', { title: rec.title || tr('未命名分组') });
  const summary = $('#recDiffSummary');
  summary.textContent = '';
  summary.appendChild(h('span', { text: tr('{time}', { time: new Date(rec.createdAt).toLocaleString() }) }));
  summary.appendChild(h('span', { text: tr('{n} 个标签', { n: rec.tabs.length }) }));
  if (diff) {
    summary.appendChild(h('span', {
      html: '<span class="add">+' + diff.added.length + '</span> <span class="rem">−' + diff.removed.length + '</span> '
        + tr('相比上一记录'),
    }));
  }

  // 差分清单:新增 / 移除(相比上一记录)
  const identityIndex = BGTStore.buildUrlIdentity(state.data);
  const hueVal = hueOf(rec.id);
  const addedWrap = $('#recAddedList');
  const removedWrap = $('#recRemovedList');
  addedWrap.textContent = '';
  removedWrap.textContent = '';
  $('#recAddedLabel').hidden = !(diff && diff.added.length);
  $('#recRemovedLabel').hidden = !(diff && diff.removed.length);
  if (diff) {
    $('#recAddedLabel').textContent = tr('本次新增(+{n})', { n: diff.added.length });
    $('#recRemovedLabel').textContent = tr('本次移除(−{n})', { n: diff.removed.length });
    for (const t of diff.added) addedWrap.appendChild(recLineEl(t, hueVal, identityIndex));
    for (const t of diff.removed) removedWrap.appendChild(recLineEl(t, hueVal, identityIndex));
  }

  // 全部标签
  $('#recTabsLabel').textContent = diff ? tr('当时的全部标签({n})', { n: rec.tabs.length }) : tr('当时的标签({n})', { n: rec.tabs.length });
  const tabsWrap = $('#recTabsList');
  tabsWrap.textContent = '';
  for (const t of rec.tabs) tabsWrap.appendChild(recLineEl(t, hueVal, identityIndex));

  const dlg = $('#recordDialog');
  dlg.dataset.recId = rec.id;
  dlg.showModal();
}

export function openRecordDialogById(id) {
  const rec = findRecord(id);
  if (rec) openRecordDialog(rec);
}

export function resumeRecordById(id) {
  const rec = findRecord(id);
  if (rec) resumeFromRecord(rec);
}

export function restoreRecordFullById(id) {
  const rec = findRecord(id);
  if (rec) restoreRecordFull(rec);
}

export function recordToGroupById(id) {
  const rec = findRecord(id);
  if (rec) recordToGroup(rec);
}

/** 续航恢复:只打开"当时有、现在没有"的标签(当前窗口后台) */
export async function resumeFromRecord(rec) {
  let openTabs = [];
  try { openTabs = await chrome.tabs.query({}); } catch (e) { /* 预览模式 */ }
  const openKeys = new Set(openTabs.map((t) => BGTStore.normalizeUrl(t.url).key));
  const missing = rec.tabs.filter((t) => !openKeys.has(BGTStore.normalizeUrl(t.url).key));
  if (!missing.length) { toast(tr('这些标签现在都开着')); return; }
  const failed = await openTabsInCurrent(missing, false);
  toast(failed
    ? tr('{where} {ok} 个,{bad} 个无法打开', { where: tr('已恢复'), ok: missing.length - failed, bad: failed })
    : tr('已续航恢复 {n} 个标签', { n: missing.length }));
  $('#recordDialog').close();
}

/** 完整恢复:新窗口重建当时现场 */
export async function restoreRecordFull(rec) {
  await openTabsInNewWindow(rec.tabs);
  $('#recordDialog').close();
  toast(tr('已在新窗口恢复 {n} 个标签', { n: rec.tabs.length }));
}

/** 转为分组:把记录内容存为收藏 */
export async function recordToGroup(rec) {
  state.data.groups.unshift(BGTStore.normalizeGroup({
    title: rec.title || tr('未命名分组'),
    createdAt: Date.now(),
    tabs: rec.tabs.map((t) => ({ url: t.url, title: t.title, favIconUrl: t.favIconUrl, pinned: t.pinned })),
  }));
  await persistAndRender();
  $('#recordDialog').close();
  toast(tr('已转为分组「{name}」', { name: rec.title || tr('未命名分组') }));
}

async function openTabsInNewWindow(tabs) {
  if (!tabs.length) return;
  const win = await chrome.windows.create({ url: tabs[0].url, focused: true });
  if (tabs[0].pinned && win.tabs && win.tabs[0]) {
    await chrome.tabs.update(win.tabs[0].id, { pinned: true });
  }
  for (const t of tabs.slice(1)) {
    try { await chrome.tabs.create({ windowId: win.id, url: t.url, pinned: t.pinned, active: false }); } catch (e) { /* 继续 */ }
  }
}

/* ---------------- 快照与每日备份 ---------------- */

export async function renderSnapshots() {
  const wrap = $('#snapshotList');
  wrap.textContent = tr('加载中…');
  let list = [];
  try { list = await BGTStore.loadSnapshots(); } catch (e) { /* 预览模式 */ }
  wrap.textContent = '';
  if (!list.length) {
    wrap.appendChild(h('p', {
      class: 'snapshot-empty',
      text: tr('暂无快照。开启上面的开关后,每 30 分钟自动记录一次打开中的标签(保留最近 3 份)。'),
    }));
    return;
  }
  for (const s of list.slice().reverse()) {
    const when = new Date(s.at).toLocaleString({
      month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
    wrap.appendChild(h('div', { class: 'snapshot-row' },
      h('b', { text: when }),
      h('span', { text: tr('{n} 个标签', { n: s.tabs.length }) }),
      h('button', {
        class: 'btn', type: 'button', text: tr('恢复为分组'),
        onclick: () => restoreSnapshot(s),
      }),
    ));
  }
}

export async function restoreSnapshot(snap) {
  const before = snapshotGroups();
  const when = new Date(snap.at).toLocaleString({
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  const created = BGTStore.normalizeGroup({
    title: tr('快照 ') + when,
    createdAt: Date.now(),
    tabs: snap.tabs.map((t) => ({ url: t.url, title: t.title, favIconUrl: t.favIconUrl, pinned: t.pinned })),
  });
  state.data.groups.unshift(created);
  await persistAndRender();
  $('#settingsDialog').close();
  rollbackToast(tr('已从快照恢复 {n} 个标签', { n: snap.tabs.length }), created.id, before);
}

export async function renderBackups() {
  const wrap = $('#backupList');
  wrap.textContent = tr('加载中…');
  let list = [];
  try { list = await BGTStore.loadBackups(); } catch (e) { /* 预览模式 */ }
  wrap.textContent = '';
  if (!list.length) {
    wrap.appendChild(h('p', {
      class: 'snapshot-empty',
      text: tr('暂无备份。开启浏览器后每 6 小时自动留存一份完整数据(分组 + 工作区,保留最近 7 份);也可在下方「立即备份」手动触发后查看。'),
    }));
    return;
  }
  for (const b of list.slice().reverse()) {
    const when = new Date(b.at).toLocaleString({
      month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
    const g = b.data && Array.isArray(b.data.groups) ? b.data.groups.length : 0;
    const w = b.data && Array.isArray(b.data.workspaces) ? b.data.workspaces.length : 0;
    wrap.appendChild(h('div', { class: 'snapshot-row' },
      h('b', { text: when }),
      h('span', { text: tr('{g} 组 · {w} 工作区', { g, w }) }),
      h('button', {
        class: 'btn', type: 'button', text: tr('恢复'),
        title: tr('用这份备份覆盖当前分组与工作区(恢复前会自动再存一份本地备份)'),
        onclick: () => restoreBackup(b),
      }),
    ));
  }
}

export async function restoreBackup(backup) {
  // 恢复事务 1/5:验证信封(哈希不匹配或结构非法 → 阻断恢复)
  const verdict = await BGTStore.verifyBackup({ manifest: backup.manifest || null, data: backup.data || {} });
  if (!verdict.ok) {
    const failed = verdict.checks.filter((c) => !c.ok).map((c) => c.label).join('、');
    toast(tr('恢复已阻止:验证失败({failed})', { failed }), { duration: 6000 });
    return;
  }
  const ok = await confirmDialog({
    title: tr('从备份恢复'),
    text: tr('将用 {time} 的备份覆盖当前的分组与工作区。当前数据会先自动备份一份,可在恢复后撤销。', { time: new Date(backup.at).toLocaleString() }),
    okText: tr('覆盖恢复'),
  });
  if (!ok) return;
  // 恢复事务 2/5:恢复前安全留底(完整 state,含 groups/workspaces/records/settings)
  const safetyBackup = {
    id: BGTStore.genId('b'),
    at: Date.now(),
    fingerprint: BGTStore.stateFingerprint(state.data),
    manifest: BGTStore.makeBackupManifest(await BGTStore.hashPayload(BGTStore.makeFullBackup(state.data)), BGTStore.makeFullBackup(state.data), ''),
    data: BGTStore.makeFullBackup(state.data),
  };
  const backups = await BGTStore.loadBackups();
  backups.push(safetyBackup);
  await BGTStore.saveBackups(backups);

  // 恢复事务 3/5:全量恢复
  const restored = BGTStore.applyFullRestore(state.data, backup.data || {});
  state.data.groups = restored.groups;
  state.data.workspaces = restored.workspaces;
  state.data.records = restored.records;
  state.data.settings = restored.settings;
  await persistAndRender();

  // 恢复事务 4/5:撤销 = 恢复到安全留底(完整回滚,含 settings/records)
  const safetyId = safetyBackup.id;
  toast(tr('已从备份恢复 {g} 组 / {w} 工作区', { g: state.data.groups.length, w: state.data.workspaces.length }), {
    actionLabel: tr('撤销'),
    duration: 8000,
    onAction: async () => {
      const list = await BGTStore.loadBackups();
      const safety = list.find((b) => b.id === safetyId);
      if (!safety) { toast(tr('安全留底已不存在,无法撤销')); return; }
      const back = BGTStore.applyFullRestore(state.data, safety.data);
      state.data.groups = back.groups;
      state.data.workspaces = back.workspaces;
      state.data.records = back.records;
      state.data.settings = back.settings;
      await persistAndRender();
      toast(tr('已回滚到恢复前状态'));
    },
  });
}

/** 数据控制中心:本机/WebDAV/第三方 三行状态 + 验证最新备份 */
export async function renderStorageLine() {
  let bytes = 0;
  try { bytes = await BGTStore.getStorageUsage() || 0; } catch (e) { /* 忽略 */ }
  let backups = [];
  try { backups = await BGTStore.loadBackups(); } catch (e) { /* 忽略 */ }
  const kb = bytes > 1024 ? (bytes / 1024).toFixed(1) + ' KB' : bytes + ' B';
  const local = $('#dcLocalDetail');
  if (local) {
    local.textContent = tr('{size} · {g} 组 · {w} 工作区 · {r} 条记录 · {b} 份每日备份', {
      size: kb, g: state.data.groups.length, w: state.data.workspaces.length,
      r: (state.data.records || []).length, b: backups.length,
    });
  }

  const cloud = $('#dcCloudDetail');
  const dot = $('#dcCloudDot');
  const w = state.data.settings.webdav || {};
  const configured = !!(w.url && w.url.startsWith('http'));
  if (cloud && dot) {
    if (!configured) {
      dot.classList.remove('dc__dot--ok');
      cloud.textContent = tr('未配置 — 填写下方表单,备份到你自己掌控的网盘');
    } else if (state.data.settings.lastCloudBackupAt) {
      dot.classList.add('dc__dot--ok');
      cloud.textContent = tr('已配置 · 最近云端备份 {time}', { time: new Date(state.data.settings.lastCloudBackupAt).toLocaleString() });
    } else {
      dot.classList.remove('dc__dot--ok');
      cloud.textContent = tr('已配置 · 尚未备份过');
    }
  }

  // 打开设置时自动验证一次最新备份
  verifyLatestBackup(false);
}

/** 验证最新每日备份:结构/指纹/规模,结果逐条展示 */
export async function verifyLatestBackup(report) {
  const out = $('#verifyResult');
  if (!out) return;
  let backups = [];
  try { backups = await BGTStore.loadBackups(); } catch (e) { /* 预览模式 */ }
  if (!backups.length) {
    out.textContent = tr('暂无可验证的备份');
    return;
  }
  const latest = backups[backups.length - 1];
  // 传完整备份节点(manifest + data);verifyBackup 现为异步(SHA-256 重算)
  const result = await BGTStore.verifyBackup(latest);
  const when = new Date(latest.at).toLocaleString();

  // 安全渲染:textContent + 结构化子元素,不使用 innerHTML(备份数据不可信)
  out.textContent = '';
  const head = document.createElement('b');
  head.textContent = tr('备份时间 {time}', { time: when });
  out.appendChild(head);
  out.appendChild(document.createElement('br'));
  for (const c of result.checks) {
    const line = document.createElement('span');
    line.className = c.ok ? 'ok' : 'bad';
    line.textContent = (c.ok ? '✓ ' : '✗ ') + c.label + (c.detail ? '(' + c.detail + ')' : '');
    out.appendChild(line);
    out.appendChild(document.createElement('br'));
  }
  const verdict = document.createElement('span');
  verdict.className = result.ok && !result.legacy ? 'ok' : 'bad';
  verdict.textContent = result.ok
    ? (result.legacy
        ? tr('旧格式无哈希,建议重新创建备份')
        : tr('完整性验证通过'))
    : tr('验证失败,已阻止以此备份恢复');
  out.appendChild(verdict);
}
