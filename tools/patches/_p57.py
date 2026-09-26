import io

p = 'background.js'
s = io.open(p, encoding='utf-8').read()
changed = []

def sub(old, new, label):
    global s, changed
    if old in s:
        s = s.replace(old, new, 1)
        changed.append(label)

# 1) makeLocalBackup 指纹 → stateFingerprint
sub("""  const fingerprint = JSON.stringify([payload.groups, payload.workspaces, payload.records, payload.settings]);""",
    """  const fingerprint = BGTStore.stateFingerprint(payload);""", 'fingerprint')

# 2) cloudBackupNow:meta 拆分(settings 不再存 lastCloudBackupAt)
sub("""  const res = await webdavRequest('PUT', settings.webdav, BACKUP_FILE, JSON.stringify(envelope));
  if (!res.ok) return { ok: false, reason: 'http-' + res.status };
  data.settings.lastCloudBackupAt = Date.now();
  await BGTStore.persist(data);
  return { ok: true, file: webdavUrl(settings.webdav, BACKUP_FILE), lastCloudBackupAt: data.settings.lastCloudBackupAt };
}""",
    """  const res = await webdavRequest('PUT', settings.webdav, BACKUP_FILE, JSON.stringify(envelope));
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
}""", 'cloud meta')

# 3) runDailyBackup:本地去重与云重试解耦
sub("""    const settings = (await BGTStore.load()).settings;
    if (settings.dailyBackup && settings.webdav && settings.webdav.auto && webdavConfigured(settings)) {
      const up = await cloudBackupNow(settings);
      if (up && up.ok && up.lastCloudBackupAt) {
        const d2 = await BGTStore.load();
        d2.settings.lastCloudBackupAt = up.lastCloudBackupAt;
        await BGTStore.persist(d2);
      }
    }""",
    """    const settings = (await BGTStore.load()).settings;
    if (settings.dailyBackup && settings.webdav && settings.webdav.auto && webdavConfigured(settings)) {
      await cloudBackupNow(settings); // 云同步判定走 meta.cloudSyncedFingerprint,与本地去重解耦,失败可重试
    }""", 'daily decouple')

# 4) saveWindow:accepted 语义(P1-2)——路由+剩余都算已保存,关闭用 accepted
sub("""  const dupCount = countRepeatedUrls(data, group);
  group.title = opts.title || defaultGroupTitle();
  const ruled = applyRulesOnGroup(data, group, settings);
  group = ruled.group;
  if (group) data.groups.unshift(group);
  await BGTStore.persist(data);

  // 先开管理页(保住窗口不被关空),再按设置关闭已保存标签
  if (settings.openManagerAfterSave && !opts.fromManager) {
    await chrome.tabs.create({ url: chrome.runtime.getURL(BGTStore.MANAGER_PAGE) });
  }
  if (group) await closeSavedTabs(rawTabs, group, settings);
  return { ok: true, saved: group ? group.tabs.length : 0, dupCount, autoRouted: ruled.routed };
}""",
    """  const dupCount = countRepeatedUrls(data, group);
  group.title = opts.title || defaultGroupTitle();
  const ruled = applyRulesOnGroup(data, group, settings);
  group = ruled.group;
  if (group) data.groups.unshift(group);
  await BGTStore.persist(data);

  // 先开管理页(保住窗口不被关空),再按设置关闭已保存标签
  if (settings.openManagerAfterSave && !opts.fromManager) {
    await chrome.tabs.create({ url: chrome.runtime.getURL(BGTStore.MANAGER_PAGE) });
  }
  // accepted = 剩余分组标签 + 已被规则自动归组的标签(P1-2:它们同样"已保存",都应关闭)
  const acceptedTabs = (group ? group.tabs : []).concat(ruled.routedTabs || []);
  if (acceptedTabs.length) await closeSavedTabs(rawTabs, { tabs: acceptedTabs }, settings);
  return {
    ok: true,
    saved: acceptedTabs.length + ruled.routedCount,
    dupCount,
    autoRouted: ruled.routed,
  };
}""", 'saveWindow accepted')

io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('applied:', changed)
