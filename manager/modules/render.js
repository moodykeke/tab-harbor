/**
 * Tab Harbor — render:主渲染层(分组 / 工作区 / 时间轴三视图 + 搜索轻量路径)
 */
import { state, $, $$, h, relTime, hueOf, hostOf, firstChar, fmtDate, persistAndRender } from './core.js';
import { ICONS, SORT_LABELS, THEME_LABELS } from './icons.js';
import { iconBtn, faviconPair } from './ui.js';

function applyTheme() {
  document.documentElement.dataset.theme = state.data.settings.theme;
  $('#themeLabel').textContent = tr('外观:') + (THEME_LABELS[state.data.settings.theme] || tr('跟随系统'));
}

export function showKbdFocus(cards) {
  cards.forEach((c, i) => c.classList.toggle('group--kbd', i === state.kbdIndex));
  const el = cards[state.kbdIndex];
  if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

export function clearKbdFocus() {
  $$('.group--kbd').forEach((c) => c.classList.remove('group--kbd'));
  state.kbdIndex = -1;
}

export function render() {
  applyTheme();
  $('#statGroups').textContent = state.data.groups.length;
  $('#statTabs').textContent = BGTStore.totalTabCount(state.data);
  $('#statWorkspaces').textContent = state.data.workspaces.length;
  $('#sortLabel').textContent = SORT_LABELS[state.data.settings.sortMode] || tr('手动排序');
  $('#viewGroups').classList.toggle('active', state.view === 'groups');
  $('#viewWorkspaces').classList.toggle('active', state.view === 'workspaces');
  $('#viewTimeline').classList.toggle('active', state.view === 'timeline');
  $('#groupList').hidden = state.view !== 'groups';
  $('#wsList').hidden = state.view !== 'workspaces';
  $('#timelineList').hidden = state.view !== 'timeline';
  const wsCount = $('#viewWsCount');
  wsCount.hidden = !state.data.workspaces.length;
  wsCount.textContent = ` ${state.data.workspaces.length}`;
  $('#btnArchived').hidden = state.view !== 'groups';
  $('#btnToggleAll').hidden = state.view !== 'groups' || !state.data.groups.length;
  $('#btnClockOutTop').hidden = state.view !== 'workspaces';
  renderWelcome();
  if (state.view === 'groups') {
    $('#btnArchived').textContent = state.data.settings.showArchived ? tr('隐藏归档') : tr('显示归档');
    pruneSelection();
    renderGroups();
    updateBatchBar();
  } else if (state.view === 'workspaces') {
    $('#emptyState').hidden = true;
    renderWorkspaces();
  } else {
    $('#emptyState').hidden = true;
    renderTimeline();
  }
  clearKbdFocus();
}

/* ---------------- 首次引导卡 ---------------- */

function renderWelcome() {
  const show = state.view === 'groups'
    && !state.data.groups.length && !state.data.workspaces.length
    && !state.data.settings.welcomed;
  $('#welcomeCard').hidden = !show;
}

/* ---------------- 时间轴视图 ---------------- */

/** 日期芯片文案:今天/昨天/M/D(带星期) */
function dayChipLabel(at) {
  const now = new Date();
  const d = new Date(at);
  const startOf = (x) => { const c = new Date(x); c.setHours(0, 0, 0, 0); return c.getTime(); };
  if (startOf(d) === startOf(now)) return tr('今天');
  if (startOf(d) === startOf(now) - 86400000) return tr('昨天');
  return d.toLocaleDateString([], { month: 'numeric', day: 'numeric', weekday: 'short' });
}

function renderTimeline() {
  const wrap = $('#timelineList');
  wrap.textContent = '';
  const q = state.query.trim().toLowerCase();
  const match = (g) => !q
    || (g.title || '').toLowerCase().includes(q)
    || g.tabs.some((t) => (t.title || '').toLowerCase().includes(q)
      || (t.url || '').toLowerCase().includes(q));

  const buckets = BGTStore.bucketByDay(state.data.groups.filter((g) => !g.archived));
  $('#mainTitle').textContent = tr('时间轴');
  $('#mainSub').textContent = tr('按天浏览工作记录与收藏历史');

  // 工作记录(不可变日志):按天分桶,逐条带与上一记录的差分
  const records = (state.data.records || []).slice().sort((a, b) => b.createdAt - a.createdAt);
  if (records.length) {
    // 港湾周报:滚动 7 天节奏 + 最常停泊 + 日期找回芯片
    const rep = BGTStore.weeklyReport(state.data);
    const strip = h('div', { class: 'tl-report' });
    strip.appendChild(h('span', { class: 'tl-report__main', text: tr('本周入港 {n} 次', { n: rep.thisWeek }) }));
    if (rep.deltaPct != null) {
      strip.appendChild(h('span', {
        class: 'tl-report__delta ' + (rep.deltaPct >= 0 ? 'up' : 'down'),
        text: tr('比上周 {pct}%', { pct: (rep.deltaPct >= 0 ? '+' : '') + rep.deltaPct }),
      }));
    }
    if (rep.topHost) {
      strip.appendChild(h('span', {
        class: 'tl-report__host',
        text: tr('最常停泊:{host}({n} 次)', { host: rep.topHost.host, n: rep.topHost.count }),
      }));
    }
    for (const d of rep.days.slice(0, 7)) {
      const label = dayChipLabel(d.at);
      strip.appendChild(h('button', {
        class: 'tl-report__day', type: 'button',
        title: tr('把这一天找回来'),
        text: label + ' · ' + d.count,
        onclick: async () => {
          const a = await import('./actions.js');
          a.findBackDay(d.at);
        },
      }));
    }
    wrap.appendChild(strip);
  }

  // 工作记录(不可变日志):按天分桶,逐条带与上一记录的差分
  if (records.length) {
    const asc = records.slice().reverse();
    const diffOf = new Map();
    for (let i = 0; i < asc.length; i += 1) {
      diffOf.set(asc[i].id, i > 0 ? BGTStore.diffTabs(asc[i - 1].tabs, asc[i].tabs) : null);
    }
    const recBuckets = BGTStore.bucketByDay(records);
    const day = h('section', { class: 'tl-day' });
    let shownRec = 0;
    for (const bucket of recBuckets) {
      day.appendChild(h('p', { class: 'tl-day__label', text: tr(bucket.label) }));
      for (const r of bucket.groups) {
        shownRec += 1;
        const d = diffOf.get(r.id);
        const diffBadge = d
          ? h('span', { class: 'tl-diff', title: tr('相比上一记录'),
              html: '<b class="tl-diff--add">+' + d.added.length + '</b> <b class="tl-diff--rem">−' + d.removed.length + '</b>' })
          : h('span', { class: 'tl-diff', text: tr('初次记录') });
        day.appendChild(h('button', {
          class: 'tl-row', type: 'button', style: `--h:${hueOf(r.id)}`,
          'data-rec': r.id, title: tr('点击查看当时现场'),
        },
          h('span', { class: 'tl-row__time', text: new Date(r.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }),
          h('span', { class: 'tl-row__title', text: r.title || tr('未命名分组') }),
          diffBadge,
          h('span', { class: 'tl-row__meta', text: tr('{n} 个标签', { n: r.tabs.length }) }),
        ));
      }
    }
    if (shownRec) wrap.appendChild(day);
  }

  let shown = 0;
  for (const bucket of buckets) {
    const rows = bucket.groups.filter(match);
    if (!rows.length) continue;
    shown += rows.length;
    const day = h('section', { class: 'tl-day' },
      h('p', { class: 'tl-day__label', text: tr(bucket.label) }));
    for (const g of rows) {
      const hueVal = hueOf(g.id);
      const row = h('div', { class: 'tl-row', style: `--h:${hueVal}`, 'data-id': g.id },
        h('span', { class: 'sp__dot' }),
        h('button', {
          class: 'tl-row__title', type: 'button', 'data-tl-act': 'locate',
          text: g.title || tr('未命名分组'), title: tr('点击定位到该分组'),
        }),
        h('span', { class: 'tl-row__meta', text: tr('{n} 个标签 · {time}', { n: g.tabs.length, time: relTime(g.createdAt) }) }),
        h('button', {
          class: 'btn', type: 'button', 'data-tl-act': 'restore',
          title: tr('恢复到当前窗口(后台打开)'), text: tr('恢复'),
        }),
      );
      day.appendChild(row);
    }
    wrap.appendChild(day);
  }
  if (shown) wrap.appendChild(h('p', { class: 'tl-day__label', text: tr('收藏分组') }));
  if (!shown && !records.length) {
    wrap.appendChild(h('p', {
      class: 'snapshot-empty',
      text: tr('还没有分组。保存一次后,这里会按天展示你的收藏轨迹。'),
    }));
  }
}

/** 清理已不存在的选中项 */
function pruneSelection() {
  const ids = new Set(state.data.groups.map((g) => g.id));
  for (const id of Array.from(state.selected)) if (!ids.has(id)) state.selected.delete(id);
}

/** 结构令牌:分组/标签的构成未变化时,搜索可以只切换可见性 */
export function structureToken() {
  return state.data.groups.map((g) => [g.id, g.collapsed ? 1 : 0, g.pinned ? 1 : 0,
    g.archived ? 1 : 0, g.tabs.map((t) => t.id).join(',')].join(':')).join('|');
}

/** 置顶优先、归档垫底,其余按所选模式排序 */
function sortVisible(visible) {
  const mode = state.data.settings.sortMode;
  visible.sort((a, b) => {
    if (a.g.archived !== b.g.archived) return a.g.archived ? 1 : -1;
    if (!!a.g.pinned !== !!b.g.pinned) return a.g.pinned ? -1 : 1;
    if (mode === 'newest') return b.g.createdAt - a.g.createdAt;
    if (mode === 'oldest') return a.g.createdAt - b.g.createdAt;
    if (mode === 'title') return (a.g.title || '').localeCompare(b.g.title || '', 'zh-CN');
    if (mode === 'tabs') return b.g.tabs.length - a.g.tabs.length;
    return 0; // manual:保持数据顺序(V8 sort 稳定)
  });
}

export function renderGroups() {
  const listEl = $('#groupList');
  listEl.textContent = '';
  const q = state.query.trim().toLowerCase();
  const urlIndex = BGTStore.buildUrlIdentity(state.data);

  let visible = state.data.groups
    .filter((g) => state.data.settings.showArchived || !g.archived)
    .map((g) => {
      const titleMatch = !q || (g.title || '').toLowerCase().includes(q);
      const matchedTabs = q
        ? g.tabs.filter((t) =>
            (t.title || '').toLowerCase().includes(q) || (t.url || '').toLowerCase().includes(q))
        : g.tabs;
      const tabsToShow = q && !titleMatch ? matchedTabs : g.tabs;
      return { g, show: titleMatch || matchedTabs.length > 0, tabsToShow };
    })
    .filter((v) => v.show);

  sortVisible(visible);

  // 空状态
  const emptyState = $('#emptyState');
  const allArchived = state.data.groups.length > 0 && state.data.groups.every((g) => g.archived);
  if (!state.data.groups.length && !q) {
    emptyState.hidden = false;
    $('#emptyTitle').textContent = tr('港湾还是空的');
    $('#emptyDesc').textContent = tr('点击下方按钮,把当前窗口的标签页一键收进港湾。');
    $('#btnEmptySave').hidden = false;
  } else if (!visible.length && allArchived) {
    emptyState.hidden = false;
    $('#emptyTitle').textContent = tr('所有分组都已归档');
    $('#emptyDesc').textContent = tr('点击右上角「显示归档」查看它们,或在分组菜单中取消归档。');
    $('#btnEmptySave').hidden = true;
  } else if (!visible.length) {
    emptyState.hidden = false;
    $('#emptyTitle').textContent = tr('没有匹配的结果');
    $('#emptyDesc').textContent = tr('换个关键词试试,搜索范围包括分组名、标签标题和网址。');
    $('#btnEmptySave').hidden = true;
  } else {
    emptyState.hidden = true;
  }

  const shownTabs = visible.reduce((n, v) => n + v.tabsToShow.length, 0);
  $('#mainTitle').textContent = q ? tr('搜索结果') : tr('全部分组');
  $('#mainSub').textContent = q
    ? tr('匹配 {a} 组 · {b} 个标签', { a: visible.length, b: shownTabs })
    : tr('共 {a} 组 · {b} 个标签', { a: state.data.groups.length, b: BGTStore.totalTabCount(state.data) });

  const berths = new Map(BGTStore.getBerths(state.data).map((b) => [b.id, b.berth]));
  const frag = document.createDocumentFragment(); // 批量挂载,避免逐卡回流
  for (const v of visible) frag.appendChild(buildCard(v, q, urlIndex, berths));
  listEl.appendChild(frag);
  state.renderToken = structureToken();
}

function buildCard(v, q, urlIndex, berths) {
  const g = v.g;
  const hueVal = hueOf(g.id);
  const metaText = q && v.tabsToShow.length !== g.tabs.length
    ? tr('匹配 {a} / 共 {b} 个标签 · {time}', { a: v.tabsToShow.length, b: g.tabs.length, time: relTime(g.createdAt) })
    : tr('{n} 个标签 · {time}', { n: g.tabs.length, time: relTime(g.createdAt) });

  const head = h('header', { class: 'group__head' },
    h('input', {
      class: 'group__check', type: 'checkbox', title: tr('选择此分组(批量操作)'),
      ...(state.selected.has(g.id) ? { checked: 'true' } : {}),
    }),
    h('span', { class: 'group__grip', draggable: 'true', title: tr('拖动调整分组顺序'), html: ICONS.grip }),
    iconBtn('collapse', g.collapsed ? tr('展开分组') : tr('折叠分组'), ICONS.chev, 'group__chev'),
    g.pinned ? h('span', {
      class: 'group__pinflag',
      text: '📌' + (berths && berths.get(g.id) ? String(berths.get(g.id)) : ''),
      title: berths && berths.get(g.id) ? tr('泊位 {n}', { n: berths.get(g.id) }) : tr('已置顶'),
    }) : null,
    h('input', {
      class: 'group__title', value: g.title, placeholder: tr('未命名分组'),
      title: tr('点击重命名'), draggable: 'false', 'spellcheck': 'false',
    }),
    g.archived ? h('span', { class: 'group__archbadge', text: tr('已归档') }) : null,
    h('span', { class: 'group__meta', text: metaText }),
    h('div', { class: 'group__actions' },
      h('div', { class: 'split' },
        h('button', {
          class: 'split__main', type: 'button', 'data-act': 'restore',
          title: tr('恢复到当前窗口(后台打开)'), html: ICONS.play + '<span>' + tr('恢复') + '</span>',
        }),
        h('button', {
          class: 'split__chev', type: 'button', 'data-act': 'restore-menu',
          title: tr('更多恢复方式'), html: ICONS.chev,
        }),
      ),
      h('button', {
        class: 'iconbtn iconbtn--dots', type: 'button', 'data-act': 'more',
        title: tr('更多操作'), html: ICONS.dots,
      }),
    ),
  );

  const ul = h('ul', { class: 'tabs', 'data-group': g.id });
  if (!v.tabsToShow.length) {
    ul.appendChild(h('li', {
      class: 'tabs__empty',
      text: tr('空分组 —— 可以从其他分组拖入标签,或点下方「添加当前标签页」。'),
    }));
  }
  for (const t of v.tabsToShow) ul.appendChild(buildTabRow(t, hueVal, g.id, urlIndex));

  const foot = h('footer', { class: 'group__foot' },
    h('button', {
      class: 'group__add', 'data-act': 'addcurrent', title: tr('把当前活动标签页加入该分组'),
      html: ICONS.plus + '<span>' + tr('添加当前标签页') + '</span>',
    }),
  );

  return h('section', {
    class: 'group' + (g.collapsed ? ' group--collapsed' : '') + (g.archived ? ' group--archived' : ''),
    'data-id': g.id, style: `--h:${hueVal}`,
  }, head, ul, foot);
}

function buildTabRow(t, hueVal, gid, urlIndex) {
  const [fav, avatar] = faviconPair(t, hueVal);

  // 重复保存徽章:同一网址存过多组时显示 ×N,点击查看每次日期并跳转
  const identity = urlIndex ? BGTStore.lookupIndex(urlIndex, t.url) : null;
  const dupCount = identity ? identity.seenCount : 0;
  const refs = identity ? identity.occurrences : [];
  let dupBadge = null;
  if (dupCount > 1) {
    const tip = tr('已保存 {n} 次:', { n: dupCount }) +
      refs.map((o) => tr('{date}({group})', { date: fmtDate(o.at), group: o.refTitle || tr('未命名分组') })).join('、');
    dupBadge = h('button', {
      class: 'tab__dup', type: 'button', 'data-act': 'dup',
      title: tip, text: '×' + dupCount,
    });
  }

  return h('li', { class: 'tab', draggable: 'true', 'data-id': t.id, 'data-group': gid },
    fav,
    avatar,
    h('a', {
      class: 'tab__link', href: t.url, target: '_blank', rel: 'noopener',
      text: t.title || t.url, title: t.title,
    }),
    t.pinned ? h('span', { class: 'tab__pin', text: '📌', title: tr('固定标签') }) : null,
    h('span', { class: 'tab__host', text: hostOf(t.url), title: hostOf(t.url) }),
    dupBadge,
    h('button', { class: 'tab__del', 'data-act': 'del-tab', title: tr('从此分组移除'), html: ICONS.x }),
  );
}


/* ---------------- 工作区视图 ---------------- */

export function renderWorkspaces() {
  const listEl = $('#wsList');
  listEl.textContent = '';
  const q = state.query.trim().toLowerCase();
  const list = state.data.workspaces
    .filter((w) => !q
      || (w.title || '').toLowerCase().includes(q)
      || w.tabs.some((t) => (t.title || '').toLowerCase().includes(q)
        || (t.url || '').toLowerCase().includes(q)))
    .sort((a, b) => b.createdAt - a.createdAt);

  $('#mainTitle').textContent = tr('工作区');
  $('#mainSub').textContent = tr('共 {n} 个工作区 · 收工存整窗,开工一键恢复', { n: state.data.workspaces.length });
  $('#wsEmpty').hidden = list.length > 0;

  const wsFrag = document.createDocumentFragment();
  for (const w of list) wsFrag.appendChild(buildWsCard(w, q));
  listEl.appendChild(wsFrag);
}

function buildWsCard(w, q) {
  const hueVal = hueOf(w.id);
  const open = state.wsOpen.has(w.id);
  const windows = (w.windows && w.windows.length) ? w.windows : null;
  const winCount = windows ? windows.length : 1;
  const meta = h('span', { class: 'group__meta' });
  meta.innerHTML = (winCount > 1
    ? tr('{t} 个标签 · {w} 个窗口 · 收于 {time}', { t: w.tabs.length, w: winCount, time: relTime(w.createdAt) })
    : tr('{n} 个标签 · 收于 {time}', { n: w.tabs.length, time: relTime(w.createdAt) }))
    + (w.lastRestoredAt ? ' · <span class="ws__last">' + tr('开工于 {time}', { time: relTime(w.lastRestoredAt) }) + '</span>' : '');

  const head = h('header', { class: 'group__head ws__head' },
    iconBtn('ws-toggle', open ? tr('收起') : tr('展开'), ICONS.chev, 'group__chev'),
    h('input', {
      class: 'ws__title', value: w.title, placeholder: tr('未命名工作区'),
      title: tr('点击重命名'), draggable: 'false', 'spellcheck': 'false',
    }),
    q ? h('span', { class: 'group__meta', text: tr('{n} 个标签', { n: w.tabs.length }) }) : meta,
    h('div', { class: 'group__actions' },
      h('div', { class: 'split' },
        h('button', {
          class: 'split__main', type: 'button', 'data-act': 'ws-open',
          title: tr('开工:在新窗口恢复整个工作区'), html: ICONS.play + '<span>' + tr('开工') + '</span>',
        }),
        h('button', {
          class: 'split__chev', type: 'button', 'data-act': 'ws-open-menu',
          title: tr('更多开工方式'), html: ICONS.chev,
        }),
      ),
      h('button', {
        class: 'iconbtn iconbtn--dots', type: 'button', 'data-act': 'ws-more',
        title: tr('更多操作'), html: ICONS.dots,
      }),
    ),
  );

  const ul = h('ul', { class: 'tabs' });
  if (!w.tabs.length) {
    ul.appendChild(h('li', { class: 'tabs__empty', text: tr('该工作区没有标签。') }));
  }
  const addTabRow = (t) => {
    const [fav, avatar] = faviconPair(t, hueVal);
    ul.appendChild(h('li', { class: 'tab', 'data-id': t.id },
      fav, avatar,
      h('a', {
        class: 'tab__link', href: t.url, target: '_blank', rel: 'noopener',
        text: t.title || t.url, title: t.title,
      }),
      t.pinned ? h('span', { class: 'tab__pin', text: '📌', title: tr('固定标签') }) : null,
      h('span', { class: 'tab__host', text: hostOf(t.url), title: hostOf(t.url) }),
      h('button', { class: 'tab__del', 'data-act': 'ws-del-tab', title: tr('从此工作区移除'), html: ICONS.x }),
    ));
  };
  if (windows) {
    // 多窗口:按窗口分组展示
    windows.forEach((win, i) => {
      ul.appendChild(h('li', {
        class: 'ws__win-header',
        text: tr('窗口 {n} · {m} 个标签', { n: i + 1, m: win.tabs.length }),
      }));
      for (const t of win.tabs) addTabRow(t);
    });
  } else {
    for (const t of w.tabs) addTabRow(t);
  }

  return h('section', {
    class: 'group ws' + (open ? '' : ' group--collapsed'),
    'data-id': w.id, style: `--h:${hueVal}`,
  }, head, ul);
}

/* ---------------- 搜索轻量路径 ---------------- */

/** 数据结构未变时,搜索只切换可见性,不重建 DOM */
export function applySearchLight() {
  const q = state.query.trim().toLowerCase();
  let shownGroups = 0;
  let shownTabs = 0;
  $$('#groupList .group').forEach((card) => {
    const g = state.data.groups.find((x) => x.id === card.dataset.id);
    if (!g) return;
    const titleMatch = !q || (g.title || '').toLowerCase().includes(q);
    let shown = 0;
    const total = g.tabs.length;
    card.querySelectorAll('.tab').forEach((row) => {
      const t = g.tabs.find((x) => x.id === row.dataset.id);
      if (!t) { row.hidden = true; return; }
      const hit = !q
        || (t.title || '').toLowerCase().includes(q)
        || (t.url || '').toLowerCase().includes(q);
      row.hidden = !!q && !titleMatch && !hit;
      if (!row.hidden) shown += 1;
    });
    const emptyRow = card.querySelector('.tabs__empty');
    if (emptyRow) emptyRow.hidden = !!q;
    card.hidden = !!q && !(titleMatch || shown > 0);
    if (!card.hidden) { shownGroups += 1; shownTabs += shown; }
    const meta = card.querySelector('.group__meta');
    if (meta) {
      meta.textContent = q && shown !== total
        ? tr('匹配 {a} / 共 {b} 个标签 · {time}', { a: shown, b: total, time: relTime(g.createdAt) })
        : tr('{n} 个标签 · {time}', { n: total, time: relTime(g.createdAt) });
    }
  });
  $('#mainTitle').textContent = q ? tr('搜索结果') : tr('全部分组');
  $('#mainSub').textContent = q
    ? tr('匹配 {a} 组 · {b} 个标签', { a: shownGroups, b: shownTabs })
    : tr('共 {a} 组 · {b} 个标签', { a: state.data.groups.length, b: BGTStore.totalTabCount(state.data) });
}

/* ---------------- 批量操作条 ---------------- */

export function updateBatchBar() {
  const bar = $('#batchBar');
  bar.hidden = state.selected.size === 0;
  $('#batchCount').textContent = tr('已选 {n} 组', { n: state.selected.size });
  $('#batchAll').textContent = state.selected.size ? tr('取消全选') : tr('全选');
}
