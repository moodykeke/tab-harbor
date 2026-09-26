import io

# ============ store.js:lookupIndex 返回身份条目 + 事件计数 + lastEventId ============
p = 'shared/store.js'
s = io.open(p, encoding='utf-8').read()

# 1) normalizeWorkspace 保留 lastEventId
old = """      createdAt: Number(w.createdAt) || Date.now(),
      lastRestoredAt: Number(w.lastRestoredAt) || 0,
      tabs: flat,                 // 扁平镜像(计数/导出/删除用)"""
new = """      createdAt: Number(w.createdAt) || Date.now(),
      lastRestoredAt: Number(w.lastRestoredAt) || 0,
      lastEventId: (w.lastEventId && typeof w.lastEventId === 'string') ? w.lastEventId : undefined,
      tabs: flat,                 // 扁平镜像(计数/导出/删除用)"""
assert old in s, 'W lastEventId'
s = s.replace(old, new, 1)

# 2) buildUrlIdentity:事件计数(seenCount = 唯一 capture 事件;referenceCount = 文档引用数)
old = """    const index = new Map();
    const add = function (source, refId, refTitle, tabs, fallbackAt) {
      for (const t of tabs || []) {
        if (!t.url) continue;
        const identity = normalizeUrl(t.url);
        if (!identity.host && !identity.key) continue;
        let entry = index.get(identity.key);
        if (!entry) {
          entry = {
            key: identity.key, host: identity.host,
            title: t.title || t.url,
            firstSeenAt: Number(t.savedAt) || fallbackAt || 0,
            lastSeenAt: Number(t.savedAt) || fallbackAt || 0,
            seenCount: 0,
            occurrences: [],
          };
          index.set(identity.key, entry);
        }
        const at = Number(t.savedAt) || fallbackAt || 0;
        entry.firstSeenAt = Math.min(entry.firstSeenAt, at) || at;
        entry.lastSeenAt = Math.max(entry.lastSeenAt, at);
        entry.seenCount += 1;
        if (t.title) entry.title = t.title; // 保留最近一次标题
        entry.occurrences.push({ source, refId, refTitle: refTitle || '', tabTitle: t.title || t.url, at });
      }
    };
    for (const g of data.groups || []) add('group', g.id, g.title, g.tabs, g.createdAt);
    for (const w of data.workspaces || []) add('workspace', w.id, w.title, w.tabs, w.createdAt);
    for (const r of data.records || []) add('record', r.id, r.title, r.tabs, r.createdAt);
    for (const entry of index.values()) {
      entry.occurrences.sort(function (a, b) { return a.at - b.at; });
    }
    return index;
  }"""
new = """    const wsEvent = new Map();
    for (const w of data.workspaces || []) {
      if (w.lastEventId) wsEvent.set(w.id, w.lastEventId);
    }
    const index = new Map();
    const add = function (source, refId, refTitle, tabs, fallbackAt) {
      for (const t of tabs || []) {
        if (!t.url) continue;
        const identity = normalizeUrl(t.url);
        if (!identity.host && !identity.key) continue;
        let entry = index.get(identity.key);
        if (!entry) {
          entry = {
            key: identity.key, host: identity.host,
            title: t.title || t.url,
            firstSeenAt: Number(t.savedAt) || fallbackAt || 0,
            lastSeenAt: Number(t.savedAt) || fallbackAt || 0,
            seenCount: 0,       // 唯一 capture 事件数(真实"保存次数")
            referenceCount: 0,  // 文档引用数(工作区+记录+分组)
            occurrences: [],
          };
          index.set(identity.key, entry);
        }
        const at = Number(t.savedAt) || fallbackAt || 0;
        entry.firstSeenAt = Math.min(entry.firstSeenAt, at) || at;
        entry.lastSeenAt = Math.max(entry.lastSeenAt, at);
        // 事件去重:同一次收工会在工作区与记录中各留一份引用, eventId 相同只计一次
        const eventId = source === 'workspace' && wsEvent.get(refId)
          ? 'w:' + refId + ':' + wsEvent.get(refId)
          : source + ':' + refId;
        entry.occurrences.push({
          source, refId, refTitle: refTitle || '', tabTitle: t.title || t.url, at, eventId,
        });
        if (t.title) entry.title = t.title; // 保留最近一次标题
      }
    };
    for (const g of data.groups || []) add('group', g.id, g.title, g.tabs, g.createdAt);
    for (const w of data.workspaces || []) add('workspace', w.id, w.title, w.tabs, w.createdAt);
    for (const r of data.records || []) add('record', r.id, r.title, r.tabs, r.createdAt);
    for (const entry of index.values()) {
      entry.occurrences.sort(function (a, b) { return a.at - b.at; });
      const events = new Set();
      for (const o of entry.occurrences) events.add(o.eventId);
      entry.seenCount = events.size;
      entry.referenceCount = entry.occurrences.length;
    }
    return index;
  }"""
assert old in s, 'identity events'
s = s.replace(old, new, 1)

# 3) lookupIndex 返回身份条目(含 seenCount/referenceCount/occurrences)
old = """  /** 用原始 URL 在身份索引中查出现记录数组(时间升序) */
  function lookupIndex(index, rawUrl) {
    const entry = index && index.get(normalizeUrl(rawUrl).key);
    return entry ? entry.occurrences : [];
  }"""
new = """  /** 用原始 URL 在身份索引中查身份条目({ seenCount, referenceCount, occurrences[] }) */
  function lookupIndex(index, rawUrl) {
    return (index && index.get(normalizeUrl(rawUrl).key)) || { seenCount: 0, referenceCount: 0, occurrences: [] };
  }"""
assert old in s, 'lookupIndex entry'
s = s.replace(old, new, 1)

io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('store identity ok')

# ============ render.js:徽章用唯一事件数,提示列引用 ============
p = 'manager/modules/render.js'
s = io.open(p, encoding='utf-8').read()
old = """    const occurrences = urlIndex ? BGTStore.lookupIndex(urlIndex, t.url) : [];
    const dupCount = occurrences.length;
    let dupBadge = null;
    if (dupCount > 1) {
      const tip = tr('已保存 {n} 次:', { n: dupCount }) +
      occurrences.map((o) => tr('{date}({group})', { date: fmtDate(o.at), group: o.refTitle || tr('未命名分组') })).join('、');"""
new = """    const identity = urlIndex ? BGTStore.lookupIndex(urlIndex, t.url) : null;
    const dupCount = identity ? identity.seenCount : 0;
    const refs = identity ? identity.occurrences : [];
    let dupBadge = null;
    if (dupCount > 1) {
      const tip = tr('已保存 {n} 次:', { n: dupCount }) +
      refs.map((o) => tr('{date}({group})', { date: fmtDate(o.at), group: o.refTitle || tr('未命名分组') })).join('、');"""
assert old in s, 'render badge identity'
s = s.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('render ok')

# ============ actions.js:openDupMenu/recLineEl 适配条目;restoreBackup 全量恢复 ============
p = 'manager/modules/actions.js'
s = io.open(p, encoding='utf-8').read()

old = """  const occurrences = BGTStore.lookupIndex(BGTStore.buildUrlIdentity(state.data), tab.url);
  if (occurrences.length <= 1) { toast(tr('该网址只保存过 1 次')); return; }
  openMenu(anchor, occurrences.map((o) => ({"""
new = """  const identity = BGTStore.lookupIndex(BGTStore.buildUrlIdentity(state.data), tab.url);
  const occurrences = identity.occurrences;
  if (identity.seenCount <= 1) { toast(tr('该网址只保存过 1 次')); return; }
  openMenu(anchor, occurrences.map((o) => ({"""
assert old in s, 'openDupMenu entry'
s = s.replace(old, new, 1)

old = """function recLineEl(t, hueVal, identityIndex) {
  const occ = BGTStore.lookupIndex(identityIndex, t.url);
  const badge = occ.length > 1
    ? h('button', {
        class: 'rec-badge', type: 'button', text: '×' + occ.length,
        title: tr('已保存 {n} 次:', { n: occ.length }) +
          occ.map((o) => tr('{date}({group})', { date: fmtDate(o.at), group: o.refTitle || tr('未命名分组') })).join('、'),
        onclick: (e) => { e.stopPropagation(); openDupMenu(null, t, e.currentTarget); },
      })
    : null;"""
new = """function recLineEl(t, hueVal, identityIndex) {
  const identity = BGTStore.lookupIndex(identityIndex, t.url);
  const occ = identity.occurrences;
  const badge = identity.seenCount > 1
    ? h('button', {
        class: 'rec-badge', type: 'button', text: '×' + identity.seenCount,
        title: tr('已保存 {n} 次:', { n: identity.seenCount }) +
          occ.map((o) => tr('{date}({group})', { date: fmtDate(o.at), group: o.refTitle || tr('未命名分组') })).join('、'),
        onclick: (e) => { e.stopPropagation(); openDupMenu(null, t, e.currentTarget); },
      })
    : null;"""
assert old in s, 'recLineEl entry'
s = s.replace(old, new, 1)

# restoreBackup:走 applyFullRestore(全量语义统一)
old = """  const beforeGroups = state.data.groups.slice();
  const beforeWs = state.data.workspaces.slice();
  const payload = backup.data || {};
  state.data.groups = (payload.groups || []).map((g) => BGTStore.normalizeGroup(g));
  state.data.workspaces = (payload.workspaces || []).map((w) => BGTStore.normalizeWorkspace(w));
  if (Array.isArray(payload.records)) {
    state.data.records = payload.records.map((r) => BGTStore.normalizeRecord(r)).slice(-BGTStore.RECORDS_MAX);
  }
  await persistAndRender();"""
new = """  const beforeGroups = state.data.groups.slice();
  const beforeWs = state.data.workspaces.slice();
  const restored = BGTStore.applyFullRestore(state.data, backup.data || {});
  state.data.groups = restored.groups;
  state.data.workspaces = restored.workspaces;
  state.data.records = restored.records;
  state.data.settings = restored.settings;
  await persistAndRender();"""
assert old in s, 'restoreBackup full'
s = s.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('actions ok')
