import io

p = 'shared/store.js'
s = io.open(p, encoding='utf-8').read()

# ============ 1) parseBackup:v1/v2 统一为 {legacy, manifest, data} ============
old = """  function parseBackup(text) {
    const obj = JSON.parse(text);
    if (!obj || obj.app !== BACKUP_APP || obj.kind !== 'full') {
      throw new Error('not-full-backup');
    }
    if (!Array.isArray(obj.groups)) throw new Error('no-groups');
    return obj;
  }"""
new = """  /**
   * 解析备份文本,统一返回 { legacy, manifest, data }:
   * v2 信封 {kind:'full-envelope', manifest, data} → legacy:false
   * v1 裸 payload {kind:'full'}            → legacy:true, manifest:null
   * 其余 → throw 'not-full-backup'
   */
  function parseBackup(text) {
    const obj = JSON.parse(text);
    if (!obj || typeof obj === 'object' && obj.app === BACKUP_APP
        && obj.kind === 'full-envelope' && obj.manifest && obj.data) {
      return { legacy: false, manifest: obj.manifest, data: obj.data };
    }
    if (obj && obj.app === BACKUP_APP && obj.kind === 'full') {
      return { legacy: true, manifest: null, data: obj };
    }
    throw new Error('not-full-backup');
  }"""
assert old in s, 'A parseBackup'
s = s.replace(old, new, 1)

# ============ 2) makeStoredTab 工厂(统一 savedAt,禁止手写 Tab 对象) ============
old = """  /* ---------------- 智能去重过滤(仅存新增) ---------------- */"""
new = """  /* ---------------- StoredTab 工厂 ---------------- */

  /**
   * 唯一的标签落库入口:任何来源(保存/收工/右键/导入/原生组)都必须经此构造,
   * 保证 savedAt = 采集时刻(不再回退为分组创建时间,污染时间洞察)。
   */
  function makeStoredTab(chromeTab, capturedAt) {
    const at = Number(capturedAt) || Date.now();
    return {
      id: genId('t'),
      url: (chromeTab && chromeTab.url) || '',
      title: (chromeTab && (chromeTab.title || chromeTab.url)) || '未命名标签',
      favIconUrl: (chromeTab && chromeTab.favIconUrl) || '',
      pinned: !!(chromeTab && chromeTab.pinned),
      savedAt: at,
    };
  }

  /* ---------------- 智能去重过滤(仅存新增) ---------------- */"""
assert old in s, 'A makeStoredTab'
s = s.replace(old, new, 1)

# ============ 3) Record 去重:工作区感知的 contextHash ============
old = """  function normalizeRecord(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const createdAt = Number(r.createdAt) || Date.now();"""
new = """  function normalizeRecord(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const createdAt = Number(r.createdAt) || Date.now();
    const workspaceId = (r.workspaceId && typeof r.workspaceId === 'string') ? r.workspaceId : undefined;"""
assert old in s, 'C normalizeRecord head'
s = s.replace(old, new, 1)

old = """    return {
      id: typeof r.id === 'string' && r.id ? r.id : genId('r'),
      createdAt: createdAt,
      title: typeof r.title === 'string' ? r.title : '',
      tabs: tabs,
      hash: typeof r.hash === 'string' && r.hash ? r.hash : hashTabs(tabs),
      workspaceId: (r.workspaceId && typeof r.workspaceId === 'string') ? r.workspaceId : undefined,
      source: (r.source && typeof r.source === 'string') ? r.source : 'clockout',
    };
  }"""
new = """    return {
      id: typeof r.id === 'string' && r.id ? r.id : genId('r'),
      createdAt: createdAt,
      title: typeof r.title === 'string' ? r.title : '',
      tabs: tabs,
      hash: typeof r.hash === 'string' && r.hash ? r.hash : hashTabs(tabs, workspaceId),
      workspaceId: workspaceId,
      source: (r.source && typeof r.source === 'string') ? r.source : 'clockout',
    };
  }"""
assert old in s, 'C normalizeRecord tail'
s = s.replace(old, new, 1)

old = """  function recordEqualsLast(records, rec) {
    const last = records && records.length ? records[records.length - 1] : null;
    return !!last && last.hash === rec.hash;
  }"""
new = """  /**
   * 连续 checkpoint 去重仅适用于:同一工作区 + 上下文完全一致。
   * 不同工作区即使标签相同也各自入账(项目身份优先于内容去重)。
   */
  function recordEqualsLast(records, rec) {
    const last = records && records.length ? records[records.length - 1] : null;
    return !!last && last.workspaceId === rec.workspaceId && last.hash === rec.hash;
  }"""
assert old in s, 'C recordEqualsLast'
s = s.replace(old, new, 1)

old = """  function hashTabs(tabs) {
    let hash = 5381;
    for (const t of tabs || []) {
      const k = normalizeUrl(t.url).key;
      for (let i = 0; i < k.length; i += 1) hash = ((hash * 33) ^ k.charCodeAt(i)) >>> 0;
    }
    return hash.toString(36);
  }"""
new = """  function hashTabs(tabs, workspaceId) {
    // contextHash = 工作区身份 + 归一化 URL 顺序 + 置顶状态(窗口边界 v4.0 再纳入)
    let hash = 5381;
    const ws = String(workspaceId || '-');
    for (let i = 0; i < ws.length; i += 1) hash = ((hash * 33) ^ ws.charCodeAt(i)) >>> 0;
    for (const t of tabs || []) {
      const k = normalizeUrl(t.url).key + (t.pinned ? '!' : '');
      for (let i = 0; i < k.length; i += 1) hash = ((hash * 33) ^ k.charCodeAt(i)) >>> 0;
    }
    return hash.toString(36);
  }"""
assert old in s, 'C hashTabs'
s = s.replace(old, new, 1)

# ============ 4) 云 meta 拆分(lastCloudBackupAt / cloudSyncedHash 出 settings) ============
old = """  function loadBackups() {"""
new = """  /* ---------------- 云同步 meta(运行态,与用户设置分离) ---------------- */

  const CLOUD_META_KEY = 'bgtCloudMeta';

  function loadCloudMeta() {
    return chrome.storage.local.get(CLOUD_META_KEY).then(function (res) {
      return res[CLOUD_META_KEY] || { lastCloudBackupAt: 0, cloudSyncedFingerprint: '', lastCloudError: '' };
    });
  }

  function saveCloudMeta(meta) {
    return chrome.storage.local.set({ [CLOUD_META_KEY]: meta });
  }

  /** 当前全量状态指纹(本地备份去重与云端同步判定共用,不含运行态字段) */
  function stateFingerprint(payload) {
    return JSON.stringify([payload.groups, payload.workspaces, payload.records, payload.settings]);
  }

  function loadBackups() {"""
assert old in s, 'D cloud meta'
s = s.replace(old, new, 1)

# ============ 5) 导出 ============
old = """    filterOnlyNew: filterOnlyNew,"""
new = """    filterOnlyNew: filterOnlyNew,
    makeStoredTab: makeStoredTab,
    parseBackup: parseBackup,
    CLOUD_META_KEY: CLOUD_META_KEY,
    loadCloudMeta: loadCloudMeta,
    saveCloudMeta: saveCloudMeta,
    stateFingerprint: stateFingerprint,"""
# parseBackup 可能已导出?检查
if 'parseBackup: parseBackup,' in s:
    s = s.replace(old.replace('    parseBackup: parseBackup,\n', ''), old, 1)
assert 'makeStoredTab: makeStoredTab' in s, 'A5 exports'
assert 'loadCloudMeta: loadCloudMeta' in s, 'A5 exports2'
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('store ok')
