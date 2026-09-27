/**
 * Tab Harbor(原 Better Group Tabs)— 共享数据层
 * 在 background(service worker 经 importScripts)、popup、manager 之间共用。
 * 负责:存储结构(v3 分键,见 ADR-001;v1/v2 老数据自动迁移)、保存过滤逻辑、常用工具函数。
 */
(function (root) {
  'use strict';

  /* 存储布局(ADR-001,docs/ADR-001-write-model.md):
   * v2 及之前:单键 bgtData 整包重写(只读兼容,加载时自动迁移)。
   * v3 起:按集合分键 —— meta 恒随每次写入(回声令牌 + settings),集合按需。
   * 跨集合一致性写(迁移/恢复/导入)必须走单次 set(),多键单调用是单事务。 */
  const STORE_KEY = 'bgtData';            // v2 单 blob,仅作迁移源
  const META_KEY = 'bgtMeta';             // { schemaVersion, settings, updatedAt }
  const GROUPS_KEY = 'bgtGroups';
  const WORKSPACES_KEY = 'bgtWorkspaces';
  const RECORDS_KEY = 'bgtRecords';
  const EXCERPTS_KEY = 'bgtExcerpts';     // Wave 3.1 摘录集合(证据层,增量键:老布局无此键 ⇒ 空集,无需迁移)
  const EXCERPTS_MAX = 300;               // 滚动窗口:300 × ≤500 字符,最坏 <1MB,不触碰"MB 级内容"边界
  const EXCERPT_TEXT_MAX = 500;
  const LEGACY_BACKUP_KEY = 'bgtData_v2_backup';
  const STORAGE_SCHEMA = 3;               // 存储布局版本(数据形状仍是 DATA_VERSION)
  const SNAPSHOT_KEY = 'bgtSnapshots';
  const DATA_VERSION = 2;
  const MANAGER_PAGE = 'manager/manager.html';

  const DEFAULT_SETTINGS = {
    theme: 'auto',            // auto | light | dark
    closeSavedTabs: true,     // 保存后关闭已保存的标签页
    openManagerAfterSave: true, // 保存后打开管理页
    excludePinned: false,     // 保存时排除固定标签
    excludeActive: false,     // 保存时排除当前活动标签
    dedupe: true,             // 保存时忽略重复网址
    skipSpecialPages: true,   // 保存时忽略 chrome:// 等特殊页面
    deleteGroupOnRestore: false, // 恢复分组后删除该分组
    confirmDelete: false,     // 删除分组前需要确认(默认关:合并式撤销已兜底)
    sortMode: 'manual',       // 管理页排序:manual | newest | oldest | title | tabs
    autoSnapshot: true,       // 定时快照打开中的标签(崩溃恢复)
    showArchived: false,      // 管理页是否显示已归档分组
    tidyRules: '',            // 按域名整理规则,每行 `域名 => 分组名`
    autoApplyRules: false,    // 保存时自动套用整理规则分流
    dailyBackup: true,        // 每日本地全量备份(分组+工作区,保留 7 份)
    webdav: null,             // 云备份配置 {url,user,pass,dir,auto} — 密码仅存本机
    welcomed: false,          // 首次引导卡是否已确认
  };

  const WEBDAV_DEFAULTS = { url: '', user: '', pass: '', dir: '', auto: false };

  /**
   * 版本默认值迁移:v3.2 起删除确认默认关闭(撤销已兜底)。
   * 只对老数据执行一次,尊重此后用户在设置里的任何选择。
   */
  function applyVersionDefaults(data) {
    const s = data.settings;
    if (!s._v32DefaultsApplied) {
      s.confirmDelete = false;
      s._v32DefaultsApplied = true;
    }
    return data;
  }

  const SPECIAL_URL_RE =
    /^(chrome|edge|about|brave|vivaldi|opera|devtools|view-source|chrome-extension|moz-extension):/i;

  function genId(prefix) {
    return (prefix || 'g') + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function emptyData() {
    return {
      version: DATA_VERSION,
      groups: [],
      workspaces: [],
      records: [],
      excerpts: [],
      settings: Object.assign({}, DEFAULT_SETTINGS),
    };
  }

  /** 摘录(Wave 3.1):右键选中的文字,挂在来源页面的那次观测上 —— 证据层,只增不改。
   *  2.1b:workspaceId 在采集瞬间从"活窗口↔项目绑定"冻结而来(未绑定的窗口为 undefined)。 */
  function normalizeExcerpt(raw) {
    const x = raw && typeof raw === 'object' ? raw : {};
    return {
      id: typeof x.id === 'string' && x.id ? x.id : genId('e'),
      url: (x.url || '').trim(),
      text: String(x.text || '').trim().slice(0, EXCERPT_TEXT_MAX),
      tabTitle: typeof x.tabTitle === 'string' ? x.tabTitle : '',
      savedAt: Number(x.savedAt) || Date.now(),
      workspaceId: (typeof x.workspaceId === 'string' && x.workspaceId) ? x.workspaceId : undefined,
    };
  }

  function normalizeSettings(raw) {
    const out = Object.assign({}, DEFAULT_SETTINGS, raw && typeof raw === 'object' ? raw : {});
    out.webdav = Object.assign({}, WEBDAV_DEFAULTS,
      raw && raw.webdav && typeof raw.webdav === 'object' ? raw.webdav : {});
    return out;
  }

  function normalizeGroup(raw) {
    const g = raw && typeof raw === 'object' ? raw : {};
    return {
      id: typeof g.id === 'string' && g.id ? g.id : genId(),
      title: typeof g.title === 'string' ? g.title : '',
      createdAt: Number(g.createdAt) || Date.now(),
      collapsed: !!g.collapsed,
      pinned: !!g.pinned,
      archived: !!g.archived,
      tabs: (Array.isArray(g.tabs) ? g.tabs : []).map(function (t) {
        return {
          id: t && typeof t.id === 'string' && t.id ? t.id : genId('t'),
          url: (t && t.url) || '',
          title: (t && (t.title || t.url)) || '未命名标签',
          favIconUrl: (t && t.favIconUrl) || '',
          pinned: !!(t && t.pinned),
          // 保存时刻:老数据没有该字段,回退为分组创建时间(向后兼容)
          savedAt: Number(t && t.savedAt) || Number(g.createdAt) || Date.now(),
        };
      }),
    };
  }

  /* ---------------- Record:不可变工作日志 ---------------- */

  const RECORDS_MAX = 1000; // 日志容量上限。v3.19.0(ADR-002)起落盘为增量编码,单条 ~0.3-1KB:
                              // 1000 条 ≈ 16 个月@每天 2 次收工 —— 解决"300 条 ≈ 5 个月,花园要长青"的硬冲突

  function hashTabs(tabs, workspaceId) {
    // contextHash = 工作区身份 + 归一化 URL 顺序 + 置顶状态(窗口边界 v4.0 再纳入)
    let hash = 5381;
    const ws = String(workspaceId || '-');
    for (let i = 0; i < ws.length; i += 1) hash = ((hash * 33) ^ ws.charCodeAt(i)) >>> 0;
    for (const t of tabs || []) {
      const k = normalizeUrl(t.url).key + (t.pinned ? '!' : '');
      for (let i = 0; i < k.length; i += 1) hash = ((hash * 33) ^ k.charCodeAt(i)) >>> 0;
    }
    return hash.toString(36);
  }

  function normalizeRecord(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    if (r.delta && !r.tabs) {
      // ADR-002 增量形态:仅在未先经 expandRecords 的路径出现,轻校验透传
      const d = r.delta && typeof r.delta === 'object' ? r.delta : {};
      return {
        id: typeof r.id === 'string' && r.id ? r.id : genId('r'),
        createdAt: Number(r.createdAt) || Date.now(),
        title: typeof r.title === 'string' ? r.title : '',
        hash: typeof r.hash === 'string' ? r.hash : '',
        workspaceId: (r.workspaceId && typeof r.workspaceId === 'string') ? r.workspaceId : undefined,
        source: (r.source && typeof r.source === 'string') ? r.source : 'clockout',
        delta: {
          baseId: (d.baseId && typeof d.baseId === 'string') ? d.baseId : '',
          added: Array.isArray(d.added) ? d.added : [],
          removed: Array.isArray(d.removed) ? d.removed : [],
          order: Array.isArray(d.order) ? d.order : [],
        },
      };
    }
    const createdAt = Number(r.createdAt) || Date.now();
    const workspaceId = (r.workspaceId && typeof r.workspaceId === 'string') ? r.workspaceId : undefined;
    const tabs = (Array.isArray(r.tabs) ? r.tabs : []).map(function (t) {
      return {
        id: t && typeof t.id === 'string' && t.id ? t.id : genId('t'),
        url: (t && t.url) || '',
        title: (t && (t.title || t.url)) || '未命名标签',
        favIconUrl: (t && t.favIconUrl) || '',
        pinned: !!(t && t.pinned),
        savedAt: Number(t && t.savedAt) || createdAt,
      };
    });
    return {
      id: typeof r.id === 'string' && r.id ? r.id : genId('r'),
      createdAt: createdAt,
      title: typeof r.title === 'string' ? r.title : '',
      tabs: tabs,
      hash: typeof r.hash === 'string' && r.hash ? r.hash : hashTabs(tabs, workspaceId),
      workspaceId: (r.workspaceId && typeof r.workspaceId === 'string') ? r.workspaceId : undefined,
      source: (r.source && typeof r.source === 'string') ? r.source : 'clockout',
    };
  }

  /** 创建工作记录;hash 相同的连续记录不重复入账 */
  function makeRecord(payload) {
    const rec = normalizeRecord(payload);
    return rec;
  }

  function recordEqualsLast(records, rec) {
    // 连续 checkpoint 去重仅适用于:同一工作区 + 上下文完全一致。
    // 不同工作区即使标签相同也各自入账(项目身份优先于内容去重)。
    const last = records && records.length ? records[records.length - 1] : null;
    return !!last && last.workspaceId === rec.workspaceId && last.hash === rec.hash;
  }

  /** 工作区:整存整取的"工位",与分组(收藏夹)互补;windows[] 为多窗口结构 */
  function normalizeWorkspace(raw) {
    const w = raw && typeof raw === 'object' ? raw : {};
    const normTabs = function (list) {
      return (Array.isArray(list) ? list : []).map(function (t) {
        return {
          id: t && typeof t.id === 'string' && t.id ? t.id : genId('t'),
          url: (t && t.url) || '',
          title: (t && (t.title || t.url)) || '未命名标签',
          favIconUrl: (t && t.favIconUrl) || '',
          pinned: !!(t && t.pinned),
          savedAt: Number(t && t.savedAt) || Number(w.createdAt) || Date.now(),
        };
      });
    };
    const windows = Array.isArray(w.windows)
      ? w.windows.map(function (win) {
          return { tabs: normTabs(win && win.tabs) };
        }).filter(function (win) { return win.tabs.length; })
      : null;
    const flat = windows && windows.length
      ? windows.reduce(function (acc, win) { return acc.concat(win.tabs); }, [])
      : normTabs(w.tabs);
    return {
      id: typeof w.id === 'string' && w.id ? w.id : genId('w'),
      title: typeof w.title === 'string' ? w.title : '',
      createdAt: Number(w.createdAt) || Date.now(),
      lastRestoredAt: Number(w.lastRestoredAt) || 0,
      lastEventId: (w.lastEventId && typeof w.lastEventId === 'string') ? w.lastEventId : undefined,
      autoUpdate: !!w.autoUpdate, // 2.1a:用户在冲突可见后选了"更新它"→ 记住,此后同名收工零提示
      tabs: flat,                 // 扁平镜像(计数/导出/删除用)
      windows: windows && windows.length > 1 ? windows : undefined, // 多窗口结构(单窗口不落盘)
    };
  }

  function normalizeData(raw) {
    const d = raw && typeof raw === 'object' ? raw : {};
    const out = {
      version: DATA_VERSION,
      groups: Array.isArray(d.groups) ? d.groups.map(normalizeGroup) : [],
      workspaces: Array.isArray(d.workspaces) ? d.workspaces.map(normalizeWorkspace) : [],
      records: Array.isArray(d.records) ? d.records.map(normalizeRecord).slice(-RECORDS_MAX) : [],
      excerpts: Array.isArray(d.excerpts) ? d.excerpts.map(normalizeExcerpt).slice(-EXCERPTS_MAX) : [],
      settings: normalizeSettings(d.settings),
    };
    if (d.updatedAt) out.updatedAt = d.updatedAt;
    return out;
  }

  /** 读取全部数据(合并视图);发现 v3 分键直接组装,v2 单键自动迁移,发现 v1 结构(tabGroups/options)时自动迁移 */
  async function load() {
    const res = await chrome.storage.local.get([META_KEY, GROUPS_KEY, WORKSPACES_KEY, RECORDS_KEY, EXCERPTS_KEY, STORE_KEY, 'tabGroups', 'options']);
    const meta = res[META_KEY];
    if (meta && typeof meta === 'object') {
      return normalizeData({
        groups: res[GROUPS_KEY],
        workspaces: res[WORKSPACES_KEY],
        records: expandRecords(res[RECORDS_KEY]), // 磁盘为增量形态(ADR-002),读取即展开为全量
        excerpts: res[EXCERPTS_KEY],
        settings: meta.settings,
        updatedAt: meta.updatedAt,
      });
    }
    if (res[STORE_KEY] && typeof res[STORE_KEY] === 'object') {
      const data = normalizeData(res[STORE_KEY]);
      await migrateToSplitKeys(data, res[STORE_KEY]);
      return data;
    }
    if (Array.isArray(res.tabGroups) && res.tabGroups.length) {
      const data = migrateV1(res.tabGroups, res.options);
      await chrome.storage.local.set({ tabGroups_v1_backup: res.tabGroups });
      await chrome.storage.local.remove(['tabGroups', 'options']);
      await persist(data);
      return data;
    }
    return emptyData();
  }

  /** v2 单键 → v3 分键,一次性迁移:留底 → 单次原子写四键 → 移除旧键(先例:migrateV1) */
  async function migrateToSplitKeys(data, legacyRaw) {
    await chrome.storage.local.set({ [LEGACY_BACKUP_KEY]: legacyRaw });
    data.updatedAt = data.updatedAt || Date.now();
    await chrome.storage.local.set(buildWrites(data, null));
    await chrome.storage.local.remove([STORE_KEY]);
  }

  /** v1:tabGroups:[{id,date,title?,tabs:[{url,title,favIconUrl,pinned}]}] + options.deleteTabOnOpen */
  function migrateV1(tabGroups, options) {
    const data = emptyData();
    if (options && options.deleteTabOnOpen === 'yes') {
      data.settings.deleteGroupOnRestore = true;
    }
    data.groups = tabGroups.map(function (g) {
      return normalizeGroup({
        title: (g && g.title) || '已导入分组',
        createdAt: g && g.date,
        tabs: g && g.tabs,
      });
    });
    return data;
  }

  /* ---------------- 写入:令牌 + 队列 ---------------- */

  let lastWrittenAt = 0;
  let writeChain = Promise.resolve();

  /**
   * 串行化同一上下文内的写操作,避免并发读改写互相覆盖。
   * 跨上下文(Ctrl+S 快捷键 vs 管理页)由 onChanged 令牌过滤兜底。
   */
  function mutate(fn) {
    const run = writeChain.then(fn);
    writeChain = run.then(function () {}, function () {});
    return run;
  }

  async function persist(data, collections) {
    data.updatedAt = Date.now();
    lastWrittenAt = data.updatedAt;
    await chrome.storage.local.set(buildWrites(data, collections));
  }

  /**
   * 组装单次 set 的键集(ADR-001 §5):
   * - meta 恒写:跨上下文回声令牌(updatedAt)+ settings 都住这里;
   * - collections 指定被触集合({groups|workspaces|records:true}),缺省全量;
   * - 未被触的集合**不进键集** —— 这就是分键的收益所在,任何"顺手全量"都是回归;
   * - 被写集合在其写入路径上归一化(不再整包归一化,读取端 load 仍是单一合并入口)。
   */
  function buildWrites(data, collections) {
    const all = !collections;
    const out = {
      [META_KEY]: {
        schemaVersion: STORAGE_SCHEMA,
        settings: normalizeSettings(data.settings),
        updatedAt: data.updatedAt,
      },
    };
    if (all || collections.groups) out[GROUPS_KEY] = (data.groups || []).map(normalizeGroup);
    if (all || collections.workspaces) out[WORKSPACES_KEY] = (data.workspaces || []).map(normalizeWorkspace);
    if (all || collections.records) out[RECORDS_KEY] = encodeRecords(data.records); // ADR-002:增量编码 + 窗口
    if (all || collections.excerpts) out[EXCERPTS_KEY] = (data.excerpts || []).map(normalizeExcerpt).slice(-EXCERPTS_MAX);
    return out;
  }

  /** 是否为本上下文刚写入的变更(用于跳过 storage.onChanged 自回声) */
  function isSelfWrite(updatedAt) {
    return !!updatedAt && updatedAt === lastWrittenAt;
  }

  /* ---------------- 快照(崩溃恢复) ---------------- */

  async function loadSnapshots() {
    const res = await chrome.storage.local.get(SNAPSHOT_KEY);
    const list = res[SNAPSHOT_KEY];
    return Array.isArray(list) ? list : [];
  }

  async function saveSnapshots(list) {
    await chrome.storage.local.set({ [SNAPSHOT_KEY]: list.slice(-3) });
  }

  function makeSnapshot(tabs, at) {
    return {
      id: genId('s'),
      at: at || Date.now(),
      hash: tabs.map(function (t) { return t.url; }).join('\n'),
      tabs: tabs,
    };
  }

  /**
   * 合并式撤销:把"操作前快照"与"撤销时刻状态"合并。
   * 快照里被删的分组按原顺序恢复;撤销期间仍存在(或新建)的分组保留最新版本,
   * 因此撤销不会覆盖用户在这段时间内做的其他编辑。
   */
  function mergeGroups(before, current) {
    const live = new Map(current.map(function (g) { return [g.id, g]; }));
    const beforeIds = new Set(before.map(function (g) { return g.id; }));
    const out = [];
    for (const g of before) {
      out.push(live.get(g.id) || g); // 活着的用最新版,被删的恢复快照版
      live.delete(g.id);
    }
    for (const g of current) {
      if (!beforeIds.has(g.id)) out.push(g); // 撤销期间新建的分组追加到末尾
    }
    return out;
  }

  /* ---------------- 时间轴分桶与存储用量 ---------------- */

  /** 分组按创建时间分桶:今天 / 昨天 / 近 7 天 / 更早。返回 [{label, groups}] */
  function bucketByDay(groups, now) {
    now = now || Date.now();
    const DAY = 86400000;
    const startToday = new Date(now); startToday.setHours(0, 0, 0, 0);
    const t0 = startToday.getTime();
    const buckets = [
      { label: '今天', groups: [] },
      { label: '昨天', groups: [] },
      { label: '近 7 天', groups: [] },
      { label: '更早', groups: [] },
    ];
    for (const g of groups) {
      const at = Number(g.createdAt) || 0;
      if (at >= t0) buckets[0].groups.push(g);
      else if (at >= t0 - DAY) buckets[1].groups.push(g);
      else if (at >= t0 - 7 * DAY) buckets[2].groups.push(g);
      else buckets[3].groups.push(g);
    }
    return buckets.filter(function (b) { return b.groups.length; });
  }

  /** 本地存储用量(字节);getBytesInUse 不可用时按 JSON 长度估算 */
  function getStorageUsage() {
    try {
      if (chrome.storage.local.getBytesInUse) {
        return chrome.storage.local.getBytesInUse(null);
      }
    } catch (e) { /* 预览模式走估算 */ }
    try {
      let n = 0;
      for (let i = 0; i < localStorage.length; i += 1) {
        const k = localStorage.key(i);
        n += k.length + (localStorage.getItem(k) || '').length;
      }
      return Promise.resolve(n * 2); // UTF-16 近似
    } catch (e) {
      return Promise.resolve(0);
    }
  }

  /* ---------------- Operation:操作日志形状(冻结) ---------------- */

  const OP_TYPES = {
    DELETE_GROUP: 'DELETE_GROUP',
    DELETE_WORKSPACE: 'DELETE_WORKSPACE',
    CLEAR_GROUPS: 'CLEAR_GROUPS',
    BATCH_DELETE: 'BATCH_DELETE',
    MERGE_GROUPS: 'MERGE_GROUPS',
    TIDY_DOMAIN: 'TIDY_DOMAIN',
    RESTORE_LIST: 'RESTORE_LIST', // 通用反向操作:按快照合并恢复
    MOVE_TAB: 'MOVE_TAB',
    RENAME: 'RENAME',
    SET_RULES: 'SET_RULES',
  };

  /**
   * 操作 = { id, type, payload, inverse, createdAt }。
   * inverse 为反向操作描述({type, payload}),由执行器解释;
   * 多步撤销(Ctrl+Z / Ctrl+Shift+Z)将在后续阶段基于此结构实现。
   */
  function makeOperation(type, payload, inverse) {
    return {
      id: genId('op'),
      type: type,
      payload: payload || {},
      inverse: inverse || null,
      createdAt: Date.now(),
    };
  }

  /* ---------------- 全量备份(分组库+工作区,云端/本地共用格式) ---------------- */

  const BACKUP_KEY = 'bgtBackups';
  const BACKUP_KEEP = 7;
  const BACKUP_APP = 'tab-harbor';
  const BACKUP_SCHEMA = 2; // v1:裸 payload;v2:manifest + payloadHash(SHA-256)

  async function hashPayload(payload) {
    const json = JSON.stringify(payload);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(json));
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  /** 备份清单:验证时逐项重算,任何不一致即失败(不再有恒真检查) */
  function makeBackupManifest(payloadHash, payload, appVersion) {
    return {
      schemaVersion: BACKUP_SCHEMA,
      app: BACKUP_APP,
      kind: 'full',
      appVersion: appVersion || '',
      createdAt: new Date().toISOString(),
      payloadHash,
      groupsCount: Array.isArray(payload.groups) ? payload.groups.length : 0,
      workspacesCount: Array.isArray(payload.workspaces) ? payload.workspaces.length : 0,
      recordsCount: Array.isArray(payload.records) ? payload.records.length : 0,
      settingsIncluded: !!payload.settings,
    };
  }

  /** 全量备份负载;云端上传时剥离 WebDAV 密码 */
  function makeFullBackup(data, opts) {
    opts = opts || {};
    const settings = Object.assign({}, data.settings);
    if (opts.stripSecrets && settings.webdav) {
      settings.webdav = Object.assign({}, settings.webdav, { pass: '' });
    }
    return {
      app: BACKUP_APP,
      kind: 'full',
      version: DATA_VERSION,
      groups: data.groups,
      workspaces: data.workspaces || [],
      records: data.records || [],
      excerpts: data.excerpts || [],
      settings,
    };
  }

  /* ---------------- 云同步 meta(运行态,与用户设置分离) ---------------- */

  const CLOUD_META_KEY = 'bgtCloudMeta';

  async function loadCloudMeta() {
    const res = await chrome.storage.local.get(CLOUD_META_KEY);
    return res[CLOUD_META_KEY] || { lastCloudBackupAt: 0, cloudSyncedFingerprint: '', lastCloudError: '' };
  }

  function saveCloudMeta(meta) {
    return chrome.storage.local.set({ [CLOUD_META_KEY]: meta });
  }

  /** 当前全量状态指纹(本地备份去重与云端同步判定共用,不含运行态字段) */
  function stateFingerprint(payload) {
    return JSON.stringify([payload.groups, payload.workspaces, payload.records, payload.excerpts, payload.settings]);
  }

  async function loadBackups() {
    const res = await chrome.storage.local.get(BACKUP_KEY);
    const list = res[BACKUP_KEY];
    return Array.isArray(list) ? list : [];
  }

  function saveBackups(list) {
    return chrome.storage.local.set({ [BACKUP_KEY]: list.slice(-BACKUP_KEEP) });
  }

  /**
   * 解析备份文本,统一返回 { legacy, manifest, data }:
   * v2 信封 {kind:'full-envelope', manifest, data} → legacy:false
   * v1 裸 payload {kind:'full'}            → legacy:true, manifest:null
   * 其余 → throw 'not-full-backup'
   */
  function parseBackup(text) {
    const obj = JSON.parse(text);
    if (obj && typeof obj === 'object' && obj.app === BACKUP_APP
        && obj.kind === 'full-envelope' && obj.manifest && obj.data) {
      return { legacy: false, manifest: obj.manifest, data: obj.data };
    }
    if (obj && obj.app === BACKUP_APP && obj.kind === 'full') {
      return { legacy: true, manifest: null, data: obj };
    }
    throw new Error('not-full-backup');
  }

  /* ---------------- URLIdentity:URL 归一化与身份聚合 ---------------- */

  /** 明确的追踪参数:归一化时剥离;其余 query 一律视为不同页面 */
  const TRACKING_PARAMS = [
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id',
    'fbclid', 'gclid', 'msclkid', 'mc_eid', 'igshid', 'dclid',
  ];

  /**
   * URL 归一化:小写 host、去 fragment、剥离追踪参数、去路径尾斜杠。
   * 不同 query 视为不同页面(如 ?id=123 与 ?id=456 不合并)。
   */
  // 归一化缓存:同 URL 反复解析是渲染热路径(new URL 开销大)。
  // 键为原始串;超上限按插入序逐出最旧(Map 保序,O(1)),保留热条目。
  const urlCache = new Map();
  const URL_CACHE_MAX = 10000;

  function normalizeUrl(u) {
    const cached = urlCache.get(u);
    if (cached) {
      // 真 LRU(决策 4):命中即刷新近度(delete+重插移到尾),淘汰的永远是"最久未用"
      // 而不是"最早插入" —— 热条目不再被批量保存的新 URL 挤掉(此前实测 27ms → 674ms)
      if (urlCache.size > 1) { urlCache.delete(u); urlCache.set(u, cached); }
      return cached;
    }
    let url;
    try { url = new URL(u); } catch (e) {
      const r = { key: String(u || ''), host: '', hadFragment: false, stripped: 0 };
      urlCache.set(u, r);
      if (urlCache.size > URL_CACHE_MAX) urlCache.delete(urlCache.keys().next().value);
      return r;
    }
    let stripped = 0;
    for (const name of TRACKING_PARAMS) {
      if (url.searchParams.has(name)) { url.searchParams.delete(name); stripped += 1; }
    }
    const hadFragment = !!url.hash;
    url.hash = '';
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
    url.hostname = url.hostname.toLowerCase();
    const result = { key: url.toString(), host: url.hostname.replace(/^www\./, ''), hadFragment, stripped };
    urlCache.set(u, result);
    if (urlCache.size > URL_CACHE_MAX) urlCache.delete(urlCache.keys().next().value);
    return result;
  }

  /** 网址身份键(相似度比较与来源链共用) */
  function urlKey(u) {
    return normalizeUrl(u).key;
  }

  /*
   * 去重/查重的唯一入口。
   * 纪律:任何"这个标签是否已存在"的判断都必须走下面三个函数,禁止退回原始 URL 字符串比较。
   * 混用会直接损坏用户可见的闭环 —— similarGroups 用归一化键算出"80% 重叠"并建议合并,
   * 而合并若用原始串去重,合完仍然留着 https://x/a 与 https://x/a?utm_source=fb 两份,
   * 下次打开洞察又会看到同一条建议。
   */

  /** 标签集合的身份键集合 */
  function keySet(tabs) {
    const out = new Set();
    for (const t of tabs || []) out.add(normalizeUrl(t && t.url).key);
    return out;
  }

  /** 按身份键去重,保留首次出现者与原顺序 */
  function dedupeTabs(tabs) {
    const seen = new Set();
    const out = [];
    for (const t of tabs || []) {
      const k = normalizeUrl(t && t.url).key;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(t);
    }
    return out;
  }

  /** 把 list 中身份键尚未出现于 target 的标签就地追加到 target;返回追加条数 */
  function appendNewTabs(target, list) {
    const seen = keySet(target);
    let added = 0;
    for (const t of list || []) {
      const k = normalizeUrl(t && t.url).key;
      if (seen.has(k)) continue;
      seen.add(k);
      target.push(t);
      added += 1;
    }
    return added;
  }

  /**
   * 标签来源链(URLIdentity 聚合层):
   * 以归一化键聚合 分组 + 工作区 + 记录 三个来源,派生
   * firstSeenAt / lastSeenAt / seenCount / occurrences(来源引用)。
   * 不落盘——三个文档本身是不可变事实,派生视图永远一致。
   */
  /* ---------------- 派生索引指纹记忆化(WP-1.3) ----------------
   * buildUrlIdentity 的结果按"内容指纹"缓存在内存(派生索引永不落盘 —— 落盘会重新引入漂移)。
   * 指纹每次调用都重算:双路 FNV 滚动哈希、零分配、覆盖索引输入的**超集** ——
   * 任何内存中的改动(哪怕尚未落盘,如防抖窗口内的编辑)都会改变指纹,不存在过期窗口;
   * 假未中只损失性能,假命中需两路 64 位同时碰撞(~2^-64),方向上是安全的。 */

  let identityMemo = null; // { fp, index } 单槽:只缓存最近一次数据视图(渲染路径反复传同一份 state.data)
  let fp0 = 0, fp1 = 0;

  function fpField(v) {
    const s = v == null ? '' : String(v);
    for (let i = 0; i < s.length; i += 1) {
      const c = s.charCodeAt(i);
      fp0 = Math.imul(fp0 ^ c, 0x01000193) >>> 0;
      fp1 = Math.imul(fp1 + c, 0x85ebca6b) >>> 0;
    }
    // 字段边界哨兵:两路同时混入,防止 'ab'+'c' 与 'a'+'bc' 同指纹
    fp0 = Math.imul(fp0 ^ 0x1f, 0x01000193) >>> 0;
    fp1 = Math.imul(fp1 ^ 0x9e, 0x85ebca6b) >>> 0;
  }

  function identityFingerprint(data) {
    fp0 = 0x811c9dc5; fp1 = 0x9e3779b9;
    const fpTabs = function (list) {
      for (const t of list || []) { fpField(t.url); fpField(t.title); fpField(t.savedAt); }
    };
    // 与 buildUrlIdentityRaw 的消费顺序一致:wsEvent 预扫描 → groups → workspaces → records
    for (const w of data.workspaces || []) { if (w.lastEventId) { fpField('E'); fpField(w.id); fpField(w.lastEventId); } }
    for (const g of data.groups || []) { fpField('G'); fpField(g.id); fpField(g.title); fpField(g.createdAt); fpTabs(g.tabs); }
    for (const w of data.workspaces || []) { fpField('W'); fpField(w.id); fpField(w.title); fpField(w.createdAt); fpField(w.lastEventId); fpTabs(w.tabs); }
    for (const r of data.records || []) { fpField('R'); fpField(r.id); fpField(r.title); fpField(r.createdAt); fpTabs(r.tabs); }
    for (const x of data.excerpts || []) { fpField('X'); fpField(x.id); fpField(x.url); fpField(x.text); fpField(x.tabTitle); fpField(x.savedAt); fpField(x.workspaceId); }
    return fp0 + ',' + fp1;
  }

  /** 身份索引(带指纹记忆化)。返回值是共享缓存实例,调用方**只读**;需变更语义时改数据再调即可。 */
  function buildUrlIdentity(data) {
    const fp = identityFingerprint(data);
    if (identityMemo && identityMemo.fp === fp) return identityMemo.index;
    const index = buildUrlIdentityRaw(data);
    identityMemo = { fp: fp, index: index };
    return index;
  }

  function buildUrlIdentityRaw(data) {
    const wsEvent = new Map();
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
        // record 自身即事件(id);workspace 引用其 lastEventId;group 是独立收藏引用;
        // excerpt 是独立的内容级观测(Wave 3.1)
        const eventId = source === 'record' ? 'ev:' + refId
          : source === 'workspace' ? 'ev:' + (wsEvent.get(refId) || refId + ':static')
          : source === 'excerpt' ? 'ev:x:' + refId
          : 'ev:g:' + refId;
        entry.occurrences.push({
          source, refId, refTitle: refTitle || '', tabTitle: t.title || t.url, at, eventId,
        });
        if (t.title) entry.title = t.title; // 保留最近一次标题
      }
    };
    for (const g of data.groups || []) add('group', g.id, g.title, g.tabs, g.createdAt);
    for (const w of data.workspaces || []) add('workspace', w.id, w.title, w.tabs, w.createdAt);
    for (const r of data.records || []) add('record', r.id, r.title, r.tabs, r.createdAt);
    // 摘录作为第四种观测来源计入:occurrence 的 tabTitle 用 80 字片段(完整文本在集合本身,现场面板悬停可读)
    for (const x of data.excerpts || []) {
      const snip = x.text ? x.text.slice(0, 80) : x.url;
      add('excerpt', x.id, x.tabTitle || '', [{ url: x.url, title: snip, savedAt: x.savedAt }], x.savedAt);
    }
    for (const entry of index.values()) {
      entry.occurrences.sort(function (a, b) { return a.at - b.at; });
      const events = new Set();
      for (const o of entry.occurrences) events.add(o.eventId);
      entry.seenCount = events.size;
      entry.referenceCount = entry.occurrences.length;
    }
    return index;
  }

  /**
   * 全量恢复语义(本地备份与云端备份共用):
   * groups/workspaces/records/settings 全部还原;仅 WebDAV 配置属本机,不覆盖。
   */
  function applyFullRestore(current, payload) {
    const settings = normalizeSettings(payload.settings);
    settings.webdav = current.settings.webdav; // 本机云配置保留
    return {
      groups: (payload.groups || []).map((g) => normalizeGroup(g)),
      workspaces: (payload.workspaces || []).map((w) => normalizeWorkspace(w)),
      records: (payload.records || []).map((r) => normalizeRecord(r)).slice(-RECORDS_MAX),
      excerpts: (payload.excerpts || []).map((x) => normalizeExcerpt(x)).slice(-EXCERPTS_MAX),
      settings,
    };
  }

  /** 用原始 URL 在身份索引中查身份条目({ seenCount, referenceCount, occurrences[] }) */
  function lookupIndex(index, rawUrl) {
    return (index && index.get(normalizeUrl(rawUrl).key)) || { seenCount: 0, referenceCount: 0, occurrences: [] };
  }

  /* ---------------- Wave 3.2:稳定性分类器(判别的核心工程,先于 WP-3.3) ----------------
   * 纪律(手册 §7.1):内容在默认权限下不可观测,标题只是代理 —— 判定只能说"看到的事实"。
   * 输入为身份索引条目,输出结构化判定;用户可见措辞由 WP-3.3 决定,不在这里硬编码。
   * 朴素地在标题上做"逐字不同=新版本"会在首页类地址上爆炸(news.ycombinator.com 每次标题都不同),
   * 因此判据按手册三条:标题变化率 / 是否被主动保存过 / 差异形态(计数·时间戳=噪声;版本记号=真变化)。 */

  /** 折叠计数/时间噪声:(3)、[12]、时间、日期、"· N 条" 等 —— 折叠后相同视为同一标题 */
  function noiseFoldTitle(t) {
    return String(t || '')
      .replace(/[([]\s*\d+\s*[)\]]/g, '#')
      .replace(/\d{4}-\d{2}-\d{2}/g, '#')
      .replace(/\d{1,2}:\d{2}/g, '#')
      .replace(/\s*[·|]\s*\d+\s*(条|个|篇|项|则|items?|msgs?|messages?|results?|notifications?)\b/gi, ' #')
      .trim();
  }

  /** 标题尾部的版本记号(v2 / ver 3 / rev 7 / 第 2 版)—— 只认尾部,降低误报 */
  function versionNumberOf(title) {
    const s = String(title || '');
    const m = s.match(/(?:^|[\s([])(?:v|ver|rev|r)\.?\s*(\d+)$/i) || s.match(/(\d+)\s*版$/);
    return m ? Number(m[1]) : null;
  }

  /** WP-3.3:版本谱系 —— 标题观测按"噪声折叠标题"分组成版本,零新增采集。
   *  折叠纪律与 classifyStability 同源((3)/日期/时间是噪声不是版本)。
   *  摘录是内容型观测(tabTitle 是片段而非页面标题):不参与标题分组,
   *  按"采集时刻正在生效的版本"挂载(首个 firstAt ≤ at 的最新版本)。
   *  每版:{ key, title(该版最近一次原始标题), count, firstAt, lastAt, sources[] },
   *  按 firstAt 升序(v1 在前);标题观测的归属用 noiseFoldTitle(o.tabTitle) 对 key 查。 */
  function sourceVersions(entry) {
    const occ = (entry && Array.isArray(entry.occurrences)) ? entry.occurrences : [];
    const byKey = new Map();
    const passthrough = [];
    for (const o of occ) {
      if (o.source === 'excerpt') { passthrough.push(o); continue; }
      const k = noiseFoldTitle(o.tabTitle) || '(空)';
      let v = byKey.get(k);
      if (!v) {
        v = { key: k, title: String(o.tabTitle || ''), count: 0, firstAt: o.at, lastAt: o.at, sources: [] };
        byKey.set(k, v);
      }
      v.count += 1;
      v.firstAt = Math.min(v.firstAt, o.at);
      v.lastAt = Math.max(v.lastAt, o.at);
      if (o.tabTitle) v.title = String(o.tabTitle);
      if (v.sources.indexOf(o.source) < 0) v.sources.push(o.source);
    }
    const versions = Array.from(byKey.values()).sort((a, b) => a.firstAt - b.firstAt);
    if (!versions.length && passthrough.length) {
      // 只有摘录观测的网址:单一"版本",标题用首条片段,不做谱系切分
      versions.push({ key: '(excerpt-only)', title: String(passthrough[0].tabTitle || ''), count: 0,
        firstAt: passthrough[0].at, lastAt: passthrough[0].at, sources: [] });
    }
    for (const o of passthrough) {
      let target = versions[0];
      for (const v of versions) if (v.firstAt <= o.at) target = v;
      if (target) {
        target.count += 1;
        target.lastAt = Math.max(target.lastAt, o.at);
        if (target.sources.indexOf(o.source) < 0) target.sources.push(o.source);
      }
    }
    return versions;
  }

  /** WP-2.3 统一搜索:跨 收藏分组 / 项目(工作区)/ 历史(记录) 的匹配(纯函数,渲染层消费)。
   *  每类上限 limits(默认 8);归档分组不参与;历史按新到旧。 */
  function searchAll(data, q, limits) {
    const ql = String(q || '').trim().toLowerCase();
    const out = { groups: [], workspaces: [], records: [] };
    if (!ql) return out;
    const lim = limits || 8;
    const tabHit = (tabs) => (tabs || []).some((t) =>
      (t.title || '').toLowerCase().includes(ql) || (t.url || '').toLowerCase().includes(ql));
    for (const g of (data.groups || [])) {
      if (out.groups.length >= lim) break;
      if (!g.archived && ((g.title || '').toLowerCase().includes(ql) || tabHit(g.tabs))) out.groups.push(g);
    }
    for (const w of (data.workspaces || [])) {
      if (out.workspaces.length >= lim) break;
      if ((w.title || '').toLowerCase().includes(ql) || tabHit(w.tabs)) out.workspaces.push(w);
    }
    for (const r of (data.records || []).slice().reverse()) {
      if (out.records.length >= lim) break;
      if ((r.title || '').toLowerCase().includes(ql) || tabHit(r.tabs)) out.records.push(r);
    }
    return out;
  }

  function classifyStability(entry) {
    const occ = (entry && Array.isArray(entry.occurrences)) ? entry.occurrences : [];
    const obsCount = occ.length;
    const savedByUser = occ.some((o) => o.source === 'group');
    if (!obsCount) {
      return { verdict: 'unknown', obsCount: 0, distinctTitles: 0, titleChurn: 0, savedByUser: false, reasons: ['无观测'] };
    }
    const titles = occ.map((o) => String(o.tabTitle || ''));
    if (obsCount === 1) {
      return { verdict: 'single', obsCount, distinctTitles: 1, titleChurn: 0, savedByUser, reasons: ['仅观测一次,无从比较'] };
    }
    const distinct = Array.from(new Set(titles));
    const base = { obsCount, distinctTitles: distinct.length, savedByUser };
    if (savedByUser) base.reasons = ['存在收藏引用(被主动保存过)'];

    if (distinct.length === 1) {
      return Object.assign(base, { verdict: 'stable', titleChurn: 0,
        reasons: (base.reasons || []).concat(['历次观测标题一致']) });
    }
    const folded = Array.from(new Set(titles.map(noiseFoldTitle)));
    if (folded.length === 1) {
      return Object.assign(base, { verdict: 'stable', titleChurn: 0,
        reasons: (base.reasons || []).concat(['标题差异均为计数/时间噪声(折叠后一致)']) });
    }
    // 版本形态 A:尾部版本记号随时间单调递增(occurrences 已按 at 升序)
    const withVer = occ.map((o) => versionNumberOf(o.tabTitle)).filter((v) => v != null);
    const verDistinct = Array.from(new Set(withVer));
    if (verDistinct.length >= 2) {
      let mono = true;
      for (let i = 1; i < withVer.length; i += 1) if (withVer[i] <= withVer[i - 1]) { mono = false; break; }
      if (mono) {
        return Object.assign(base, { verdict: 'versioned', titleChurn: 1,
          reasons: (base.reasons || []).concat(['尾部版本记号随时间单调递进(v' + Math.min(...verDistinct) + '→v' + Math.max(...verDistinct) + ')']) });
      }
    }
    // 版本形态 B:草稿态 → 定稿态
    const DRAFT_RE = /draft|wip|草稿|初稿/i;
    const FINAL_RE = /final|定稿|正式版|发布$/i;
    if (DRAFT_RE.test(titles[0]) && FINAL_RE.test(titles[titles.length - 1])) {
      return Object.assign(base, { verdict: 'versioned', titleChurn: 1,
        reasons: (base.reasons || []).concat(['观测序列呈草稿→定稿形态']) });
    }
    return Object.assign(base, { verdict: 'dynamic',
      titleChurn: Number((folded.length / obsCount).toFixed(2)),
      reasons: (base.reasons || []).concat(['不同标题数(噪声折叠后 ' + folded.length + ')/ 观测数 ' + obsCount + ',标题乱跳,按动态页面对待']) });
  }

  /* ---------------- WP-5.3:定时变化摘要(结构化 delta,非生成式) ----------------
   * 回答"什么变了":内容变了的来源(版本谱系)/ 项目来源集变化(最近两次收工的差分)/
   * 三周未回(曾经常来)/ 新枢纽页(窗口内新出现且高频的 host)。 */

  function changeReport(data, now) {
    now = now || Date.now();
    const DAY = 86400000;
    const winFrom = now - 7 * DAY;
    const staleFrom = now - 21 * DAY;
    const out = { changedSources: [], projectChanges: [], staleSources: [], newHubs: [] };

    // 1) 内容变了的来源:窗口内出现了新版本的网址(版本谱系 ≥2 且最新版首现在窗口内)
    for (const entry of buildUrlIdentity(data).values()) {
      const vs = sourceVersions(entry);
      if (vs.length < 2) continue;
      const latest = vs[vs.length - 1];
      if (latest.firstAt >= winFrom) {
        out.changedSources.push({ key: entry.key, title: latest.title, versions: vs.length, lastAt: entry.lastSeenAt });
      }
    }
    out.changedSources.sort((a, b) => b.lastAt - a.lastAt);

    // 2) 项目来源集变化:每个工作区最近两条记录的标签集差分
    const byWs = new Map();
    for (const r of (data.records || [])) {
      if (!r.workspaceId) continue;
      if (!byWs.has(r.workspaceId)) byWs.set(r.workspaceId, []);
      byWs.get(r.workspaceId).push(r);
    }
    for (const [wsId, list] of byWs) {
      const sorted = list.slice().sort((a, b) => a.createdAt - b.createdAt);
      const last = sorted[sorted.length - 1];
      const prev = sorted[sorted.length - 2];
      if (!last || !prev || last.createdAt < winFrom) continue;
      const d = diffTabs(prev.tabs, last.tabs);
      if (d.added.length || d.removed.length) {
        const ws = (data.workspaces || []).find((w) => w.id === wsId);
        out.projectChanges.push({
          wsId, wsTitle: ws ? ws.title : '', at: last.createdAt,
          added: d.added.map((t) => t.url), removed: d.removed.map((t) => t.url),
        });
      }
    }

    // 3) 三周未回:引用 ≥2 且最近出现早于 21 天前
    for (const entry of buildUrlIdentity(data).values()) {
      if (entry.referenceCount >= 2 && entry.lastSeenAt && entry.lastSeenAt < staleFrom) {
        out.staleSources.push({ key: entry.key, title: entry.title, lastAt: entry.lastSeenAt, refCount: entry.referenceCount });
      }
    }
    out.staleSources.sort((a, b) => a.lastAt - b.lastAt);
    out.staleSources = out.staleSources.slice(0, 8);

    // 4) 新枢纽页:窗口内**首次**出现且窗口内引用 ≥3 次的 host
    const hostWin = new Map();
    const hostEver = new Set();
    for (const r of (data.records || [])) {
      const hosts = new Set();
      for (const t of (r.tabs || [])) hosts.add(normalizeUrl(t.url).host);
      for (const h of hosts) {
        hostEver.add(h);
        if (r.createdAt >= winFrom && r.createdAt <= now) {
          if (!hostWin.has(h)) hostWin.set(h, { host: h, firstAt: r.createdAt, count: 0 });
          hostWin.get(h).count += 1;
        }
      }
    }
    for (const v of hostWin.values()) {
      // "新" = 首次出现落在窗口内(此前的历史记录里从未见过该 host)
      const seenBefore = (data.records || []).some((r) => r.createdAt < winFrom
        && (r.tabs || []).some((t) => normalizeUrl(t.url).host === v.host));
      if (!seenBefore && v.count >= 3) out.newHubs.push(v);
    }
    out.newHubs.sort((a, b) => b.count - a.count);

    return out;
  }

  /* ---------------- 相似分组洞察 ---------------- */

  /**
   * 相似分组:非归档分组两两比较,网址键 Jaccard 相似度 ≥ threshold 时报告。
   * 返回 [{aId, aTitle, bId, bTitle, score, shared}] 按相似度降序。
   */
  function similarGroups(data, threshold) {
    threshold = typeof threshold === 'number' ? threshold : 0.8;
    const groups = data.groups.filter(function (g) { return !g.archived && g.tabs.length >= 2; });
    const keys = groups.map(function (g) {
      return new Set(g.tabs.map(function (t) { return urlKey(t.url); }));
    });
    const out = [];
    for (let i = 0; i < groups.length; i += 1) {
      for (let j = i + 1; j < groups.length; j += 1) {
        let shared = 0;
        for (const k of keys[i]) if (keys[j].has(k)) shared += 1;
        const union = keys[i].size + keys[j].size - shared;
        const score = union ? shared / union : 0;
        if (score >= threshold) {
          out.push({
            aId: groups[i].id, aTitle: groups[i].title || '未命名分组',
            bId: groups[j].id, bTitle: groups[j].title || '未命名分组',
            score: score, shared: shared,
          });
        }
      }
    }
    return out.sort(function (x, y) { return y.score - x.score; });
  }

  /* ---------------- 泊位:置顶分组的速泊编号 ---------------- */

  /**
   * 置顶(未归档)分组按当前顺序占用 1–9 号泊位。
   * popup 数字键 / omnibox `harbor 2` / 卡片角标共用此定义。
   */
  function getBerths(data) {
    return (data.groups || [])
      .filter(function (g) { return g.pinned && !g.archived && g.tabs.length; })
      .slice(0, 9)
      .map(function (g, i) { return { berth: i + 1, id: g.id, title: g.title || '未命名分组', tabs: g.tabs.length }; });
  }

  /** 泊位反查:id → 编号(1–9 或 0 表示未占位) */
  function berthOf(data, groupId) {
    const b = getBerths(data).find(function (x) { return x.id === groupId; });
    return b ? b.berth : 0;
  }

  /* ---------------- 备份完整性验证 ---------------- */

  /**
   * 验证一份每日备份:存在性/结构合法性/内容指纹一致/规模统计。
   * 返回 { ok, checks: [{label, ok, detail}] }。
   * 异步:需要重算 SHA-256(全篇 async/await,无 .then() 链)。
   */
  async function verifyBackup(node) {
    const checks = [];
    let ok = true;
    let legacy = false;
    const push = function (label, pass, detail) {
      checks.push({ label, ok: !!pass, detail: detail || '' });
      if (!pass) ok = false;
    };
    push('可解析', !!node && typeof node === 'object');
    if (!node || typeof node !== 'object') return { ok, legacy, checks };

    // 统一入口:{manifest, data} 包装;v1 裸 payload(含 kind:'full')也直接作为 payload
    let manifest = null;
    let payload = null;
    if (node && node.manifest && node.data) {
      manifest = node.manifest;
      payload = node.data;
    } else if (node && (node.data || node.groups || node.workspaces || node.records
        || node.settings || node.kind === 'full')) {
      // v1 裸格式:payload 挂在 data 子键(可能为空 → 用节点本身)
      payload = node.data || node;
    }
    if (manifest && manifest.payloadHash) legacy = false;
    push('来源合法', !!payload && payload.app === BACKUP_APP && payload.kind === 'full',
      payload ? String(payload.app || '?') + '/' + String(payload.kind || '?') : 'nothing');
    if (!payload || payload.app !== BACKUP_APP || payload.kind !== 'full') {
      return { ok, legacy, checks };
    }
    if (!manifest) legacy = true; // v1 旧格式:无清单
    const groups = Array.isArray(payload.groups) ? payload.groups : null;
    push('结构合法', !!groups, groups ? groups.length + ' groups' : 'missing');
    const workspaces = Array.isArray(payload.workspaces) ? payload.workspaces : [];
    push('工作区可读', Array.isArray(workspaces), workspaces.length + ' workspaces');
    const records = Array.isArray(payload.records) ? payload.records : [];
    push('记录可读', Array.isArray(records), records.length + ' records');
    push('设置可读', !!payload.settings && typeof payload.settings === 'object', '');

    const finish = () => ({ ok, legacy, checks });

    if (!(manifest && typeof manifest.payloadHash === 'string')) {
      // 旧格式:诚实标注,不参与整体通过判定,但给出重新备份建议
      legacy = true;
      push('完整性哈希', false, '旧格式无哈希 —— 建议重新创建备份');
      return finish();
    }
    push('清单完整', manifest.payloadHash.length === 64,
      'schema ' + manifest.schemaVersion + ' · app ' + (manifest.appVersion || '?'));
    const hash = await hashPayload(payload);
    push('SHA-256 一致', hash === manifest.payloadHash, manifest.payloadHash.slice(0, 12) + '…');
    push('清单 groupsCount', manifest.groupsCount === (groups ? groups.length : 0),
      manifest.groupsCount + ' / ' + (groups ? groups.length : 0));
    push('清单 workspacesCount', manifest.workspacesCount === workspaces.length,
      manifest.workspacesCount + ' / ' + workspaces.length);
    push('清单 recordsCount', manifest.recordsCount === records.length,
      manifest.recordsCount + ' / ' + records.length);
    push('设置已包含', !!manifest.settingsIncluded, '');
    return finish();
  }

  /* ---------------- StoredTab 工厂 ---------------- */

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

  /* ---------------- 智能去重过滤(仅存新增) ---------------- */

  /**
   * 智能去重过滤:onlyNewKeys 是"当前窗口中已收藏过的身份键集合"(由管理页预检计算)。
   * 语义:剔除这些已收藏键,保留真正的新增标签。
   * (v3.10 曾把此逻辑写反:保留了已收藏、剔除了新增 —— 已修复并有回归测试)
   */
  function filterOnlyNew(tabs, onlyNewKeys) {
    if (!Array.isArray(onlyNewKeys) || !onlyNewKeys.length) return tabs.slice();
    const known = new Set(onlyNewKeys);
    return tabs.filter((t) => !known.has(normalizeUrl(t.url).key));
  }

  /* ---------------- 时间差分 ---------------- */

  /**
   * 两个标签集合的差分(按归一化键):
   * added = next 有而 prev 无;removed = prev 有而 next 无;kept = 相同数。
   */
  function diffTabs(prevTabs, nextTabs) {
    const prevKeys = new Map();
    for (const t of prevTabs || []) prevKeys.set(normalizeUrl(t.url).key, t);
    const nextKeys = new Map();
    for (const t of nextTabs || []) nextKeys.set(normalizeUrl(t.url).key, t);
    const added = [];
    for (const [key, t] of nextKeys) if (!prevKeys.has(key)) added.push(t);
    const removed = [];
    for (const [key, t] of prevKeys) if (!nextKeys.has(key)) removed.push(t);
    return { added, removed, kept: nextKeys.size - added.length };
  }

  /* ---------------- Wave 5.1:Delta 历史存储(ADR-002) ----------------
   * 内存全量、磁盘增量:消费方(时间轴/身份索引/周报/统一搜索/证据段)永远拿到全量记录;
   * 落盘时窗口内首条存全量、后续存与上一条的差分(added/removed,复用 diffTabs 的身份键口径),
   * 并保留 order(身份键序列)—— 标签顺序是"现场"的一部分,重建不得重排。
   * 记录自描述(有 tabs=全量,有 delta=增量),旧数据零迁移;编码时的窗口截断
   * 自动把留存首条物化为全量 —— 链不可能断。 */

  /** 全量记录链 → 存储形态(首全量 + 增量),并应用滚动窗口(RECORDS_MAX) */
  function encodeRecords(fullList) {
    const kept = (fullList || []).slice(-RECORDS_MAX);
    const out = [];
    for (let i = 0; i < kept.length; i += 1) {
      if (i === 0) { out.push(kept[i]); continue; }
      const d = diffTabs(kept[i - 1].tabs, kept[i].tabs);
      out.push({
        id: kept[i].id, createdAt: kept[i].createdAt, title: kept[i].title,
        hash: kept[i].hash, workspaceId: kept[i].workspaceId, source: kept[i].source,
        delta: (function () {
          const removedKeys = d.removed.map(function (t) { return normalizeUrl(t.url).key; });
          const actual = (kept[i].tabs || []).map(function (t) { return normalizeUrl(t.url).key; });
          // 默认重建序 = 基序(去掉 removed)+ added 依 next 序追加;与实际一致时省略 order
          const def = [];
          const seen = new Set();
          for (const t of kept[i - 1].tabs) {
            const k = normalizeUrl(t.url).key;
            if (removedKeys.indexOf(k) < 0 && !seen.has(k)) { def.push(k); seen.add(k); }
          }
          for (const t of d.added) {
            const k = normalizeUrl(t.url).key;
            if (!seen.has(k)) { def.push(k); seen.add(k); }
          }
          const same = actual.length === def.length && actual.every(function (k, idx) { return k === def[idx]; });
          const delta = { baseId: kept[i - 1].id, added: d.added, removed: removedKeys };
          if (!same) delta.order = actual;
          return delta;
        })(),
      });
    }
    return out;
  }

  /** 存储形态(可混合旧全量与新增量)→ 全量记录链;断链条目(基被裁/损坏)跳过其 delta 形态 */
  function expandRecords(storedList) {
    const out = [];
    const byId = new Map();
    for (const r of (storedList || [])) {
      const rec = r && typeof r === 'object' ? r : {};
      if (rec.delta && rec.delta.baseId) {
        const base = byId.get(rec.delta.baseId);
        if (base) {
          const map = new Map();
          for (const t of base.tabs) map.set(normalizeUrl(t.url).key, t);
          for (const key of (rec.delta.removed || [])) map.delete(key);
          for (const t of (rec.delta.added || [])) map.set(normalizeUrl(t.url).key, t);
          const tabs = (rec.delta.order || []) // order 省略 ⇒ 用 map 序(基序减 removed 加 added),即编码时的默认重建序
            .map(function (k) { return map.get(k); })
            .filter(function (t) { return !!t; });
          // order 之外新增(异常兜底)附到尾部,不丢数据
          for (const t of map.values()) if (!tabs.includes(t)) tabs.push(t);
          const full = {
            id: rec.id, createdAt: rec.createdAt, title: rec.title, hash: rec.hash,
            workspaceId: rec.workspaceId, source: rec.source, tabs: tabs,
          };
          byId.set(full.id, full);
          out.push(full);
          continue;
        }
      }
      if (Array.isArray(rec.tabs)) { // 全量记录(或旧格式)
        byId.set(rec.id, rec);
        out.push(rec);
      }
    }
    return out;
  }

  /* ---------------- 港湾周报(纯本地节奏摘要) ---------------- */

  /**
   * 周报:滚动 7 天 vs 前 7 天的入港节奏 + 本周最常停泊域名 + 有记录的日清单。
   * days[].tabs 为当天全部记录标签的并集(按身份键去重),供"把这一天找回来"。
   */
  function weeklyReport(data, now) {
    now = now || Date.now();
    const DAY = 86400000;
    const records = (data.records || []).slice().sort((a, b) => a.createdAt - b.createdAt);
    const thisFrom = now - 7 * DAY;
    const lastFrom = now - 14 * DAY;

    const thisWeek = records.filter((r) => r.createdAt >= thisFrom).length;
    const lastWeek = records.filter((r) => r.createdAt >= lastFrom && r.createdAt < thisFrom).length;
    let deltaPct = null;
    if (lastWeek > 0) deltaPct = Math.round(((thisWeek - lastWeek) / lastWeek) * 100);

    const hosts = new Map();
    for (const r of records) {
      if (r.createdAt < thisFrom) continue;
      for (const t of r.tabs) {
        const identity = normalizeUrl(t.url);
        if (!identity.host) continue;
        const h = hosts.get(identity.host) || { host: identity.host, count: 0 };
        h.count += 1;
        hosts.set(identity.host, h);
      }
    }
    const topHost = Array.from(hosts.values()).sort((a, b) => b.count - a.count)[0] || null;

    const dayMap = new Map();
    for (const r of records) {
      if (r.createdAt < now - 14 * DAY) continue;
      const d = new Date(r.createdAt); d.setHours(0, 0, 0, 0);
      const key = d.getTime();
      const e = dayMap.get(key) || { at: key, count: 0, tabs: [] };
      e.count += 1;
      dayMap.set(key, e);
    }
    const days = Array.from(dayMap.values()).sort((a, b) => b.at - a.at).map((e) => {
      const seen = new Set();
      const tabs = [];
      for (const r of records) {
        const d = new Date(r.createdAt); d.setHours(0, 0, 0, 0);
        if (d.getTime() !== e.at) continue;
        for (const t of r.tabs) {
          const k = normalizeUrl(t.url).key;
          if (!seen.has(k)) { seen.add(k); tabs.push(t); }
        }
      }
      return { at: e.at, count: e.count, tabs };
    });

    return { thisWeek, lastWeek, deltaPct, topHost, days };
  }

  /* ---------------- 高频域名(洞察 → 规则闭环) ---------------- */

  /**
   * 域名频率榜:按身份索引聚合到 host 维度。
   * 返回 [{host, urls(去重网址数), seenTotal(累计保存次数), lastSeenAt}] 按网址数降序。
   */
  function topHosts(data, limit) {
    limit = limit || 8;
    const hosts = new Map();
    for (const entry of (buildUrlIdentity(data)).values()) {
      if (!entry.host) continue;
      let h = hosts.get(entry.host);
      if (!h) { h = { host: entry.host, urls: 0, seenTotal: 0, lastSeenAt: 0 }; hosts.set(entry.host, h); }
      h.urls += 1;
      h.seenTotal += entry.seenCount;
      h.lastSeenAt = Math.max(h.lastSeenAt, entry.lastSeenAt);
    }
    return Array.from(hosts.values())
      .sort((a, b) => b.urls - a.urls || b.seenTotal - a.seenTotal)
      .slice(0, limit);
  }

  /* ---------------- 规则分流(保存时自动套用) ---------------- */

  /**
   * 把新保存的标签按规则分流:命中规则的进入以规则命名的桶,未命中的留在 rest。
   * 返回 {routes: [{name, tabs[]}], rest: [tab…]},各桶内与 rest 内均按 url 去重。
   */
  function routeTabsByRules(tabs, rules) {
    const routes = [];
    const byName = new Map();
    const rest = [];
    const seenRest = new Set();
    for (const t of tabs) {
      const identity = normalizeUrl(t.url);
      let name = null;
      for (const r of rules) {
        if (identity.host && (identity.host === r.domain || identity.host.endsWith('.' + r.domain))) { name = r.name; break; }
      }
      if (!name) {
        if (!seenRest.has(identity.key)) { seenRest.add(identity.key); rest.push(t); }
        continue;
      }
      if (!byName.has(name)) {
        const bucket = { name: name, tabs: [], _seen: new Set() };
        byName.set(name, bucket);
        routes.push(bucket);
      }
      const bucket = byName.get(name);
      if (!bucket._seen.has(identity.key)) { bucket._seen.add(identity.key); bucket.tabs.push(t); }
    }
    for (const b of routes) delete b._seen;
    return { routes: routes, rest: rest };
  }

  /** 把分流结果合并进分组库:同名(未归档)分组追加去重,否则新建;返回新增组数 */
  function applyRoutedGroups(data, routes) {
    let created = 0;
    for (const route of routes) {
      const existing = data.groups.find(function (g) {
        return !g.archived && (g.title || '') === route.name;
      });
      if (existing) {
        appendNewTabs(existing.tabs, route.tabs);
      } else {
        data.groups.unshift(normalizeGroup({ title: route.name, createdAt: Date.now(), tabs: route.tabs }));
        created += 1;
      }
    }
    return created;
  }

  /* ---------------- 按域名整理规则 ---------------- */

  /** 解析多行规则文本:`github.com => 代码`,支持 * 后缀匹配任意子域 */
  function parseRules(text) {
    return String(text || '').split('\n').map(function (line) {
      const m = line.split('=>');
      if (m.length < 2) return null;
      const domain = m[0].trim().toLowerCase().replace(/^\*\./, '');
      const name = m.slice(1).join('=>').trim();
      if (!domain || !name) return null;
      return { domain: domain, name: name };
    }).filter(Boolean);
  }

  /** 域名按规则归组;无规则匹配时返回域名本身作为分组名 */
  function ruleTarget(rules, hostname) {
    const host = String(hostname || '').toLowerCase();
    for (const r of rules) {
      if (host === r.domain || host.endsWith('.' + r.domain)) return r.name;
    }
    return host;
  }

  /**
   * 保存过滤:按设置剔除固定标签/当前页/特殊页/重复网址,并生成 v2 标签对象。
   * 返回 null 表示没有可保存的标签。
   */
  function buildGroup(rawTabs, settings, opts) {
    opts = opts || {};
    const seen = new Set();
    const now = Date.now();
    const tabs = [];
    for (const t of rawTabs) {
      const url = (t && t.url) || '';
      if (settings.excludeActive && opts.activeUrl && url === opts.activeUrl) continue;
      if (t.pinned && settings.excludePinned) continue;
      if (settings.skipSpecialPages && SPECIAL_URL_RE.test(url)) continue;
      if (!url || url === 'about:blank') continue;
      const key = normalizeUrl(url).key; // 去重按身份键,与全局 URLIdentity 一致
      if (settings.dedupe && seen.has(key)) continue;
      seen.add(key);
      tabs.push(makeStoredTab(t, now)); // 记录本次保存时刻,用于重复保存统计
    }
    if (!tabs.length) return null;
    return normalizeGroup({ title: opts.title || '', createdAt: now, tabs: tabs });
  }

  function totalTabCount(data) {
    return (data.groups || []).reduce(function (n, g) { return n + g.tabs.length; }, 0);
  }

  /** 新分组的默认标题,如「9月24日 20:45」 */
  function defaultGroupTitle() {
    const d = new Date();
    const p = function (n) { return String(n).padStart(2, '0'); };
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  /** MV3 官方 favicon 服务;失败时返回空串,由调用方回退到首字母头像 */
  function faviconUrl(pageUrl) {
    try {
      return chrome.runtime.getURL('_favicon/?pageUrl=' + encodeURIComponent(pageUrl) + '&size=32');
    } catch (e) {
      return '';
    }
  }

  const api = {
    STORE_KEY: STORE_KEY,
    META_KEY: META_KEY,
    GROUPS_KEY: GROUPS_KEY,
    WORKSPACES_KEY: WORKSPACES_KEY,
    RECORDS_KEY: RECORDS_KEY,
    EXCERPTS_KEY: EXCERPTS_KEY,
    EXCERPTS_MAX: EXCERPTS_MAX,
    EXCERPT_TEXT_MAX: EXCERPT_TEXT_MAX,
    LEGACY_BACKUP_KEY: LEGACY_BACKUP_KEY,
    STORAGE_SCHEMA: STORAGE_SCHEMA,
    SNAPSHOT_KEY: SNAPSHOT_KEY,
    DATA_VERSION: DATA_VERSION,
    MANAGER_PAGE: MANAGER_PAGE,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    SPECIAL_URL_RE: SPECIAL_URL_RE,
    genId: genId,
    emptyData: emptyData,
    normalizeGroup: normalizeGroup,
    normalizeWorkspace: normalizeWorkspace,
    normalizeExcerpt: normalizeExcerpt,
    normalizeData: normalizeData,
    load: load,
    persist: persist,
    mutate: mutate,
    isSelfWrite: isSelfWrite,
    loadSnapshots: loadSnapshots,
    saveSnapshots: saveSnapshots,
    makeSnapshot: makeSnapshot,
    parseRules: parseRules,
    ruleTarget: ruleTarget,
    buildUrlIdentity: buildUrlIdentity,
    lookupIndex: lookupIndex,
    searchAll: searchAll,
    encodeRecords: encodeRecords,
    changeReport: changeReport,
    expandRecords: expandRecords,
    classifyStability: classifyStability,
    sourceVersions: sourceVersions,
    noiseFoldTitle: noiseFoldTitle, // UI 侧把 occurrence 归入版本时使用(与索引/分类器同一折叠纪律)
    normalizeUrl: normalizeUrl,
    URL_CACHE_MAX: URL_CACHE_MAX,
    urlCacheHas: function (u) { return urlCache.has(u); }, // 仅供门禁观测 LRU 淘汰行为(决策 4 断言)
    diffTabs: diffTabs,
    makeRecord: makeRecord,
    filterOnlyNew: filterOnlyNew,
    makeStoredTab: makeStoredTab,
    parseBackup: parseBackup,
    CLOUD_META_KEY: CLOUD_META_KEY,
    loadCloudMeta: loadCloudMeta,
    saveCloudMeta: saveCloudMeta,
    stateFingerprint: stateFingerprint,
    hashPayload: hashPayload,
    makeBackupManifest: makeBackupManifest,
    BACKUP_SCHEMA: BACKUP_SCHEMA,
    applyFullRestore: applyFullRestore,
    normalizeRecord: normalizeRecord,
    recordEqualsLast: recordEqualsLast,
    RECORDS_MAX: RECORDS_MAX,
    OP_TYPES: OP_TYPES,
    makeOperation: makeOperation,
    getBerths: getBerths,
    topHosts: topHosts,
    weeklyReport: weeklyReport,
    berthOf: berthOf,
    verifyBackup: verifyBackup,
    mergeGroups: mergeGroups,
    normalizeWorkspace: normalizeWorkspace,
    bucketByDay: bucketByDay,
    getStorageUsage: getStorageUsage,
    applyVersionDefaults: applyVersionDefaults,
    BACKUP_KEY: BACKUP_KEY,
    makeFullBackup: makeFullBackup,
    loadBackups: loadBackups,
    saveBackups: saveBackups,
    parseBackup: parseBackup,
    urlKey: urlKey,
    keySet: keySet,
    dedupeTabs: dedupeTabs,
    appendNewTabs: appendNewTabs,
    similarGroups: similarGroups,
    routeTabsByRules: routeTabsByRules,
    applyRoutedGroups: applyRoutedGroups,
    migrateV1: migrateV1,
    buildGroup: buildGroup,
    totalTabCount: totalTabCount,
    defaultGroupTitle: defaultGroupTitle,
    faviconUrl: faviconUrl,
  };

  root.BGTStore = api;
})(typeof self !== 'undefined' ? self : this);
