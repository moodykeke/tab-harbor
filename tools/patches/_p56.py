import io

p = 'background.js'
s = io.open(p, encoding='utf-8').read()

# 1) saveWindow:filterOnlyNew + accepted 语义(路由+剩余全部算已保存)
old = """  // 智能去重(仅存新增):manager 预检传入"要保存的新增身份键集合"
  const newOnly = BGTStore.filterOnlyNew(group.tabs, opts.onlyNewKeys);
  if (opts.onlyNewKeys && opts.onlyNewKeys.length && !newOnly.length) {
    return { ok: true, saved: 0, allKnown: true };
  }
  group.tabs = newOnly;"""
new = """  // 智能去重(仅存新增):manager 预检传入"要保存的新增身份键集合"
  const newOnly = BGTStore.filterOnlyNew(group.tabs, opts.onlyNewKeys);
  if (opts.onlyNewKeys && opts.onlyNewKeys.length && !newOnly.length) {
    return { ok: true, saved: 0, allKnown: true };
  }
  group.tabs = newOnly;
  const acceptedRawTabs = newOnly.slice(); // 本轮真正会落库的标签(含后续自动归组)"""
assert old in s, 'B1 saveWindow filter'
s = s.replace(old, new, 1)

# 2) countRepeatedUrls 规范化
old = """function countRepeatedUrls(data, group) {
  const seen = new Set();
  for (const g of data.groups) {
    for (const t of g.tabs) seen.add(t.url);
  }
  return group.tabs.filter((t) => seen.has(t.url)).length;
}"""
new = """function countRepeatedUrls(data, group) {
  const seen = new Set();
  for (const g of data.groups) {
    for (const t of g.tabs) seen.add(BGTStore.normalizeUrl(t.url).key);
  }
  return group.tabs.filter((t) => seen.has(BGTStore.normalizeUrl(t.url).key)).length;
}"""
assert old in s, 'B2 countRepeated'
s = s.replace(old, new, 1)

# 3) makeLocalBackup:manifest + 全量指纹
old = """async function makeLocalBackup(force) {
  const data = await BGTStore.load();
  const payload = BGTStore.makeFullBackup(data);
  const fingerprint = JSON.stringify([payload.groups, payload.workspaces]);
  const backups = await BGTStore.loadBackups();
  const last = backups[backups.length - 1];
  if (!force && last && last.fingerprint === fingerprint) return { ok: true, skipped: true };
  backups.push({ id: BGTStore.genId('b'), at: Date.now(), fingerprint, data: payload });
  await BGTStore.saveBackups(backups);
  return { ok: true, skipped: false, count: backups.length };
}"""
new = """async function makeLocalBackup(force) {
  const data = await BGTStore.load();
  const payload = BGTStore.makeFullBackup(data);
  // 全量指纹:覆盖 groups/workspaces/records/settings(不含运行态 meta)
  const fingerprint = BGTStore.stateFingerprint(payload);
  const backups = await BGTStore.loadBackups();
  const last = backups[backups.length - 1];
  if (!force && last && last.fingerprint === fingerprint) return { ok: true, skipped: true, fingerprint };
  const payloadHash = await BGTStore.hashPayload(payload);
  const manifest = BGTStore.makeBackupManifest(payloadHash, payload,
    chrome.runtime.getManifest ? chrome.runtime.getManifest().version : '');
  backups.push({ id: BGTStore.genId('b'), at: Date.now(), fingerprint, manifest, data: payload });
  await BGTStore.saveBackups(backups);
  return { ok: true, skipped: false, count: backups.length, fingerprint };
}"""
assert old in s, 'B3 makeLocalBackup'
s = s.replace(old, new, 1)

# 4) cloudBackupNow:信封 + meta
old = """async function cloudBackupNow(settings) {
  if (!webdavConfigured(settings)) return { ok: false, reason: 'no-config' };
  const data = await BGTStore.load();
  const payload = BGTStore.makeFullBackup(data, { stripSecrets: true });
  const res = await webdavRequest('PUT', settings.webdav, BACKUP_FILE, JSON.stringify(payload));
  if (!res.ok) return { ok: false, reason: 'http-' + res.status };
  data.settings.lastCloudBackupAt = Date.now();
  await BGTStore.persist(data);
  return { ok: true, file: webdavUrl(settings.webdav, BACKUP_FILE), lastCloudBackupAt: data.settings.lastCloudBackupAt };
}"""
new = """async function cloudBackupNow(settings) {
  if (!webdavConfigured(settings)) return { ok: false, reason: 'no-config' };
  const data = await BGTStore.load();
  const payload = BGTStore.makeFullBackup(data, { stripSecrets: true });
  const payloadHash = await BGTStore.hashPayload(payload);
  const envelope = {
    app: 'tab-harbor',
    kind: 'full-envelope',
    manifest: BGTStore.makeBackupManifest(payloadHash, payload,
      chrome.runtime.getManifest ? chrome.runtime.getManifest().version : ''),
    data: payload,
  };
  const res = await webdavRequest('PUT', settings.webdav, BACKUP_FILE, JSON.stringify(envelope));
  if (!res.ok) {
    const meta = await BGTStore.loadCloudMeta();
    meta.lastCloudError = 'http-' + res.status;
    await BGTStore.saveCloudMeta(meta);
    return { ok: false, reason: 'http-' + res.status };
  }
  const meta = await BGTStore.loadCloudMeta();
  meta.lastCloudBackupAt = Date.now();
  meta.cloudSyncedFingerprint = BGTStore.stateFingerprint(payload);
  meta.lastCloudError = '';
  await BGTStore.saveCloudMeta(meta);
  return { ok: true, file: webdavUrl(settings.webdav, BACKUP_FILE), lastCloudBackupAt: meta.lastCloudBackupAt };
}"""
assert old in s, 'B4 cloudBackupNow'
s = s.replace(old, new, 1)

# 5) cloudRestore:单一验证器(parseBackup 信封 → verifyBackup)+ applyFullRestore
old = """  let payload;
  try {
    payload = BGTStore.parseBackup(res.text);
  } catch (e) {
    return { ok: false, reason: 'bad-file' };
  }
  // 恢复前先在本地留一份全量备份(可回退)
  await makeLocalBackup(true);
  const data = await BGTStore.load();
  data.groups = payload.groups.map((g) => BGTStore.normalizeGroup(g));
  data.workspaces = (payload.workspaces || []).map((w) => BGTStore.normalizeWorkspace(w));
  if (Array.isArray(payload.records)) {
    data.records = payload.records.map((r) => BGTStore.normalizeRecord(r)).slice(-BGTStore.RECORDS_MAX);
  }
  // 云端备份里的设置不覆盖本机 webdav 配置
  const webdav = data.settings.webdav;
  data.settings = BGTStore.normalizeSettings(payload.settings);
  data.settings.webdav = webdav;
  await BGTStore.persist(data);
  return { ok: true, groups: data.groups.length, exportedAt: payload.exportedAt };
}"""
new = """  let parsed;
  try {
    parsed = BGTStore.parseBackup(res.text); // 统一返回 {legacy, manifest, data}
  } catch (e) {
    return { ok: false, reason: 'bad-file' };
  }
  // 单一验证器:v2 信封哈希不匹配 → 阻断恢复;v1 旧格式 → 诚实警告后放行
  const verdict = await BGTStore.verifyBackup({ manifest: parsed.manifest, data: parsed.data });
  if (!verdict.ok && !parsed.legacy) return { ok: false, reason: 'hash-mismatch' };
  // 恢复前先在本地留一份全量备份(可回退)
  await makeLocalBackup(true);
  const data = await BGTStore.load();
  const restored = BGTStore.applyFullRestore(data, parsed.data);
  data.groups = restored.groups;
  data.workspaces = restored.workspaces;
  data.records = restored.records;
  data.settings = restored.settings; // 本机 WebDAV 配置由 applyFullRestore 保留
  await BGTStore.persist(data);
  const meta = await BGTStore.loadCloudMeta();
  meta.cloudSyncedFingerprint = BGTStore.stateFingerprint(payload = parsed.data);
  await BGTStore.saveCloudMeta(meta);
  return { ok: true, groups: data.groups.length, legacy: parsed.legacy,
    exportedAt: parsed.manifest ? parsed.manifest.createdAt : '' };
}"""
assert old in s, 'B5 cloudRestore'
s = s.replace(old, new, 1)

# 6) runDailyBackup:云重试与本地去重解耦
old = """    const settings = (await BGTStore.load()).settings;
    if (settings.dailyBackup && settings.webdav && settings.webdav.auto && webdavConfigured(settings)) {
      const up = await cloudBackupNow(settings);
      if (up && up.ok && up.lastCloudBackupAt) {
        const d2 = await BGTStore.load();
        d2.settings.lastCloudBackupAt = up.lastCloudBackupAt;
        await BGTStore.persist(d2);
      }
    }"""
new = """    const settings = (await BGTStore.load()).settings;
    if (settings.dailyBackup && settings.webdav && settings.webdav.auto && webdavConfigured(settings)) {
      await cloudBackupNow(settings); // 云端同步状态由 meta.cloudSyncedFingerprint 判定,与本地去重解耦
    }"""
assert old in s, 'B6 daily'
s = s.replace(old, new, 1)

# 7) runDailyBackup 前置 local.skipped 不再阻断云端(把 local.skipped 只用于本地)
old = """async function runDailyBackup() {
  try {
    const local = await makeLocalBackup(false);
    if (local.skipped) return;"""
new = """async function runDailyBackup() {
  try {
    await makeLocalBackup(false); // 本地去重独立判定
    const settings = (await BGTStore.load()).settings;"""
assert old in s, 'B6b daily head'
s = s.replace(old, new, 1)

io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('background batch1 ok')
