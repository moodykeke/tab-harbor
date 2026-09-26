import io

# ============ render.js:三处 DocumentFragment 批量挂载 ============
p = 'manager/modules/render.js'
s = io.open(p, encoding='utf-8').read()

# 1) renderGroups
old = """  const berths = new Map(BGTStore.getBerths(state.data).map((b) => [b.id, b.berth]));
  for (const v of visible) listEl.appendChild(buildCard(v, q, urlIndex, berths));
  state.renderToken = structureToken();"""
new = """  const berths = new Map(BGTStore.getBerths(state.data).map((b) => [b.id, b.berth]));
  const frag = document.createDocumentFragment(); // 批量挂载,避免逐卡回流
  for (const v of visible) frag.appendChild(buildCard(v, q, urlIndex, berths));
  listEl.appendChild(frag);
  state.renderToken = structureToken();"""
assert old in s, 'groups frag'
s = s.replace(old, new, 1)

# 2) renderWorkspaces
old = """  for (const w of list) listEl.appendChild(buildWsCard(w, q));"""
new = """  const wsFrag = document.createDocumentFragment();
  for (const w of list) wsFrag.appendChild(buildWsCard(w, q));
  listEl.appendChild(wsFrag);"""
assert old in s, 'ws frag'
s = s.replace(old, new, 1)

# 3) renderTimeline:记录区与分组区都批量
old = """    if (shownRec) wrap.appendChild(day);
  }

  let shown = 0;"""
new = """    if (shownRec) tlFrag.appendChild(day);
  }

  let shown = 0;"""
assert old in s, 'tl rec frag'
s = s.replace(old, new, 1)
old = """  const records = (state.data.records || []).slice().sort((a, b) => b.createdAt - a.createdAt);
  if (records.length) {"""
new = """  const records = (state.data.records || []).slice().sort((a, b) => b.createdAt - a.createdAt);
  const tlFrag = document.createDocumentFragment();
  if (records.length) {"""
assert old in s, 'tl frag declare'
s = s.replace(old, new, 1)
old = """    if (shown) wrap.appendChild(h('p', { class: 'tl-day__label', text: tr('收藏分组') }));"""
new = """    if (shown) tlFrag.appendChild(h('p', { class: 'tl-day__label', text: tr('收藏分组') }));"""
assert old in s, 'tl group label frag'
s = s.replace(old, new, 1)
old = """    if (!shown && !records.length) {
    wrap.appendChild(h('p', {
      class: 'snapshot-empty',
      text: tr('还没有分组。保存一次后,这里会按天展示你的收藏轨迹。'),
    }));
  }
}"""
new = """    if (!shown && !records.length) {
    tlFrag.appendChild(h('p', {
      class: 'snapshot-empty',
      text: tr('还没有分组。保存一次后,这里会按天展示你的收藏轨迹。'),
    }));
  }
  wrap.appendChild(tlFrag);
}"""
assert old in s, 'tl tail frag'
s = s.replace(old, new, 1)

io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('render fragments ok')

# ============ events.js:低价值操作切换为防抖写 ============
p = 'manager/modules/events.js'
s = io.open(p, encoding='utf-8').read()
old = """import { state, $, $$, h, persist, persistAndRender } from './core.js';"""
new = """import { state, $, $$, h, persist, persistAndRender, persistAndRenderSoon } from './core.js';"""
assert old in s
s = s.replace(old, new)

# 折叠点击
old = """      const group = state.data.groups.find((g) => g.id === card.dataset.id);
      if (!group) return;
      group.collapsed = !group.collapsed;
      persistAndRender();
    });

    // 重命名与多选"""
new = """      const group = state.data.groups.find((g) => g.id === card.dataset.id);
      if (!group) return;
      group.collapsed = !group.collapsed;
      persistAndRenderSoon(); // UI 态:立即渲染,落盘防抖
    });

    // 重命名与多选"""
assert old in s, 'collapse soon'
s = s.replace(old, new)

# 重命名 change
old = """      group.title = e.target.value.trim();
      persistAndRender();
    });

    // 动作按钮"""
new = """      group.title = e.target.value.trim();
      persistAndRenderSoon();
    });

    // 动作按钮"""
assert old in s, 'rename soon'
s = s.replace(old, new)

# 归档切换 / 全部折叠
old = """    $('#btnArchived').addEventListener('click', () => {
      state.data.settings.showArchived = !state.data.settings.showArchived;
      persistAndRender();
    });
    $('#btnToggleAll').addEventListener('click', () => {
      const anyExpanded = state.data.groups.some((g) => !g.collapsed);
      state.data.groups.forEach((g) => { g.collapsed = anyExpanded; });
      persistAndRender();
    });"""
new = """    $('#btnArchived').addEventListener('click', () => {
      state.data.settings.showArchived = !state.data.settings.showArchived;
      persistAndRenderSoon();
    });
    $('#btnToggleAll').addEventListener('click', () => {
      const anyExpanded = state.data.groups.some((g) => !g.collapsed);
      state.data.groups.forEach((g) => { g.collapsed = anyExpanded; });
      persistAndRenderSoon();
    });"""
assert old in s, 'toolbar soon'
s = s.replace(old, new)

# collapse 动作(卡片折叠按钮)
old = """      case 'collapse':
        if (group) { group.collapsed = !group.collapsed; persistAndRender(); }
        break;"""
new = """      case 'collapse':
        if (group) { group.collapsed = !group.collapsed; persistAndRenderSoon(); }
        break;"""
assert old in s, 'collapse act soon'
s = s.replace(old, new)

# 排序 / 外观菜单
old = """        onPick: () => { state.data.settings.sortMode = key; persistAndRender(); },"""
new = """        onPick: () => { state.data.settings.sortMode = key; persistAndRenderSoon(); },"""
assert old in s, 'sort soon'
s = s.replace(old, new)
old = """        onPick: () => { state.data.settings.theme = key; persistAndRender(); },"""
new = """        onPick: () => { state.data.settings.theme = key; persistAndRenderSoon(); },"""
assert old in s, 'theme soon'
s = s.replace(old, new)

# ws 标题改名 / ws 删除标签
old = """      ws.title = e.target.value.trim();
      persist().then(renderWorkspaces);
    });"""
new = """      ws.title = e.target.value.trim();
      persistAndRenderSoon();
      renderWorkspaces();
    });"""
assert old in s, 'ws rename soon'
s = s.replace(old, new)
old = """        if (idx >= 0) { ws.tabs.splice(idx, 1); persist(); renderWorkspaces(); }"""
new = """        if (idx >= 0) { ws.tabs.splice(idx, 1); persistAndRenderSoon(); }"""
assert old in s, 'ws del-tab soon'
s = s.replace(old, new)

# 引导卡关闭
old = """    $('#btnWelcomeDismiss').addEventListener('click', async () => {
      state.data.settings.welcomed = true;
      await persistAndRender();
    });"""
new = """    $('#btnWelcomeDismiss').addEventListener('click', () => {
      state.data.settings.welcomed = true;
      persistAndRenderSoon();
    });"""
assert old in s, 'welcome soon'
s = s.replace(old, new)

# dnd 悬停展开的 persist 也走防抖(dnd.js 内)
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('events soon ok')

p = 'manager/modules/dnd.js'
s = io.open(p, encoding='utf-8').read()
old = """import { state, $, $$, persist, persistAndRender } from './core.js';"""
new = """import { state, $, $$, persistAndRenderSoon, persistAndRender } from './core.js';"""
assert old in s
s = s.replace(old, new)
old = """            if (grp) {
              grp.collapsed = false;
              state.expandTarget.classList.remove('group--collapsed');
              persist();
            }"""
new = """            if (grp) {
              grp.collapsed = false;
              state.expandTarget.classList.remove('group--collapsed');
              persistAndRenderSoon();
            }"""
assert old in s, 'dnd hover soon'
s = s.replace(old, new)
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('dnd soon ok')
