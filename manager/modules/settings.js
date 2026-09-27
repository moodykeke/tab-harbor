/**
 * Tab Harbor — settings:设置对话框、云端备份操作、清空全部
 */
import { state, $, send, persistAndRender, snapshotGroups } from './core.js';
import { toast, offerUndo, confirmDialog } from './ui.js';
import { renderBackups, renderSnapshots, renderStorageLine, verifyLatestBackup } from './actions.js';
import { render } from './render.js';

const SET_FIELDS = [
  ['setCloseSaved', 'closeSavedTabs'],
  ['setOpenManager', 'openManagerAfterSave'],
  ['setDedupe', 'dedupe'],
  ['setSkipSpecial', 'skipSpecialPages'],
  ['setAutoRules', 'autoApplyRules'],
  ['setDeleteOnRestore', 'deleteGroupOnRestore'],
  ['setConfirmDelete', 'confirmDelete'],
  ['setAutoSnapshot', 'autoSnapshot'],
  ['setObservation', 'observation'],
];

export function openSettings() {
  SET_FIELDS.forEach(([id, key]) => { $('#' + id).checked = !!state.data.settings[key]; });
  $('#setTidyRules').value = state.data.settings.tidyRules || '';
  const w = state.data.settings.webdav || {};
  $('#davUrl').value = w.url || '';
  $('#davUser').value = w.user || '';
  $('#davPass').value = w.pass || '';
  $('#davDir').value = w.dir || '';
  $('#davAuto').checked = w.auto;
  bindGarden();
  const clearBtn = $('#btnClearObs');
  if (clearBtn && !clearBtn.dataset.bound) {
    clearBtn.dataset.bound = '1';
    clearBtn.addEventListener('click', async () => {
      const res = await send({ action: 'clearObservation' });
      toast(res && res.ok ? tr('观测缓冲已清除') : tr('清除失败,后台服务不可用'), !!(res && res.ok));
    });
  }
  const expBtn = $('#btnExportTrail');
  if (expBtn && !expBtn.dataset.bound) {
    expBtn.dataset.bound = '1';
    expBtn.addEventListener('click', async () => {
      const res = await send({ action: 'exportTrail' });
      if (res && res.ok) toast(tr('阅读路径已导出({n} 步)→ {path}', { n: res.steps, path: res.path }));
      else if (res && res.reason === 'empty') toast(tr('当前没有观测轨迹'), true);
      else if (res && res.reason === 'no-garden') toast(tr('请先在上方选择本地文件夹'), true);
      else toast(tr('导出失败,后台服务不可用'), true);
    });
  }
  cloudStatus('idle');
  renderStorageLine();
  renderSnapshots();
  renderBackups();
  const btn = $('#btnVerifyBackup');
  if (btn && !btn.dataset.bound) {
    btn.dataset.bound = '1';
    btn.addEventListener('click', () => verifyLatestBackup(true));
  }
  $('#settingsDialog').showModal();
}

/** 从表单收集 WebDAV 配置;url 非法时返回 null */
function readCloudForm() {
  const url = $('#davUrl').value.trim();
  if (url && !/^https?:\/\//i.test(url)) {
    cloudStatus('err', tr('服务器地址需以 http(s):// 开头'));
    return null;
  }
  // Trust:HTTP 下凭据为 Base64 明文传输,必须显式知情(P2)
  if (url && /^http:\/\//i.test(url)) {
    cloudStatus('warn', tr('HTTP 未加密:WebDAV 凭据与备份内容将明文传输,建议改用 HTTPS'));
  }
  return {
    url,
    user: $('#davUser').value.trim(),
    pass: $('#davPass').value,
    dir: $('#davDir').value.trim(),
    auto: $('#davAuto').checked,
  };
}

function cloudStatus(kind, text) {
  const el = $('#cloudStatus');
  el.classList.remove('cloud__status--ok', 'cloud__status--err');
  el.classList.remove('cloud__status--ok', 'cloud__status--err', 'cloud__status--warn');
  if (kind === 'ok') { el.textContent = '✓ ' + text; el.classList.add('cloud__status--ok'); }
  else if (kind === 'err') { el.textContent = '✗ ' + text; el.classList.add('cloud__status--err'); }
  else if (kind === 'warn') { el.textContent = '⚠ ' + text; el.classList.add('cloud__status--warn'); }
  else if (kind === 'busy') { el.textContent = '… ' + text; }
  else {
    el.textContent = tr('备份文件:tab-harbor-backup.json;密码仅保存在本机,云端副本不含密码。');
  }
}

/** 为 WebDAV 服务器请求可选主机权限(用户手势中调用) */
async function ensureCloudPermission(url) {
  try {
    if (!chrome.permissions || !chrome.permissions.request || !url) return true;
    const origin = new URL(url).origin + '/*';
    const granted = await chrome.permissions.request({ origins: [origin] });
    return !!granted;
  } catch (e) {
    return false;
  }
}

/* ---------------- 本地文件夹 · 知识库入口(Wave 3.5 通道 + WP-3.4 证据段) ---------------- */

let gardenHandle = null;

function gardenStatusText() {
  const el = $('#gardenStatus');
  if (el) el.textContent = gardenHandle ? (gardenHandle.name + '/') : tr('未选择文件夹');
}

/** 特性检测守卫:无 FSA(旧浏览器/预览)时整节隐藏,不留死按钮 */
function bindGarden() {
  const section = $('#gardenSection');
  if (!section || typeof window === 'undefined' || !window.showDirectoryPicker || !window.BGTGarden) return;
  section.hidden = false;
  const pick = $('#btnGardenPick');
  if (pick.dataset.bound) { gardenStatusText(); return; }
  pick.dataset.bound = '1';
  pick.addEventListener('click', async () => {
    const h = await BGTGarden.pickGarden();
    if (!h) return;
    gardenHandle = h;
    await BGTGarden.saveGardenHandle(h); // 句柄存 IndexedDB,下次会话恢复(权限需再确认)
    gardenStatusText();
  });
  $('#btnGardenExportGroups').addEventListener('click', exportGroupsToGarden);
  $('#btnGardenExportDaily').addEventListener('click', exportDailyToGarden);
  BGTGarden.loadGardenHandle().then((h) => { if (h) { gardenHandle = h; } }).catch(() => {});
  gardenStatusText();
}

async function ensureGarden() {
  if (!gardenHandle) { toast(tr('请先选择文件夹'), true); return false; }
  if (!(await BGTGarden.ensurePermission(gardenHandle))) { toast(tr('文件夹权限未授予'), true); return false; }
  return true;
}

async function exportGroupsToGarden() {
  if (!(await ensureGarden())) return;
  const dir = await gardenHandle.getDirectoryHandle('groups', { create: true });
  for (const g of state.data.groups) {
    await BGTGarden.writeFile(dir, BGTGarden.safeFileName(g.title) + '.md', BGTGarden.groupMarkdown(g), false);
  }
  toast(tr('已导出 {n} 个分组到文件夹', { n: state.data.groups.length }));
}

async function exportDailyToGarden() {
  if (!(await ensureGarden())) return;
  const idx = BGTStore.buildUrlIdentity(state.data);
  const lineageOf = (url) => {
    const e = idx.get(BGTStore.normalizeUrl(url).key);
    const vs = e ? BGTStore.sourceVersions(e) : [];
    return vs.length > 1 ? 'v' + vs.length : '';
  };
  const { day, body } = BGTGarden.buildDailyEvidence(state.data, BGTGarden.dayKeyOf(Date.now()), lineageOf);
  const name = 'tab-harbor-' + day + '.md';
  let existing = '';
  try { existing = await BGTGarden.readTextFile(gardenHandle, name); } catch (e) { /* 首次创建 */ }
  const r = BGTGarden.applyManagedSection(existing, body); // 只动两标记之间,标记外逐字节保留
  await BGTGarden.writeFile(gardenHandle, name, r.content, true); // 覆盖前留底 .bak.md
  toast(r.replaced ? tr('证据段已更新(区段之外未动,已留底 .bak.md)') : tr('证据段已创建'));
}

export async function saveSettings() {
  const cloud = readCloudForm();
  if (!cloud) return;
  const patch = {};
  SET_FIELDS.forEach(([id, key]) => { patch[key] = $('#' + id).checked; });
  patch.tidyRules = $('#setTidyRules').value;
  if (cloud.url) {
    const granted = await ensureCloudPermission(cloud.url);
    if (!granted) {
      cloudStatus('err', tr('未授予对该服务器的访问权限,云端备份不可用(其余设置已保存)'));
    }
  }
  patch.webdav = cloud;
  // 决策 2:落盘走 SW 补丁(新鲜状态 + 只写 meta),本页快照不再有覆盖并发写的能力
  const res = await send({ action: 'saveSettings', patch });
  if (res && res.ok) state.data.settings = res.settings;
  render();
  $('#settingsDialog').close();
  toast(tr('设置已保存'));
}

export async function cloudAction(kind) {
  const cloud = readCloudForm();
  if (!cloud) return;
  if (cloud.url && !(await ensureCloudPermission(cloud.url))) {
    cloudStatus('err', tr('未授予对该服务器的访问权限'));
    return;
  }
  // 先把表单配置存下再执行(后台读取 settings.webdav)—— 同样走 SW 补丁
  const prev = state.data.settings.webdav;
  const saved = await send({ action: 'saveSettings', patch: { webdav: cloud } });
  if (!saved || !saved.ok) {
    cloudStatus('err', tr('保存云端配置失败'));
    return;
  }
  state.data.settings = saved.settings;
  cloudStatus('busy', kind === 'test' ? tr('正在连接…') : kind === 'now' ? tr('正在上传备份…') : tr('正在下载备份…'));
  const action = kind === 'test' ? 'cloudTest' : kind === 'now' ? 'cloudBackupNow' : 'cloudRestore';
  const res = await send({ action });
  if (res && res.ok) {
    if (kind === 'test') cloudStatus('ok', tr('连接成功,可以备份了'));
    else if (kind === 'now') { cloudStatus('ok', tr('已上传到云端')); renderBackups(); renderStorageLine(); }
    else {
      cloudStatus('ok', tr('已恢复 {n} 个分组(备份时间 {time})', { n: res.groups, time: new Date(res.exportedAt).toLocaleString() }));
      state.data = await BGTStore.load();
      render();
      render();
      renderBackups();
      renderStorageLine();
    }
  } else {
    await send({ action: 'saveSettings', patch: { webdav: prev } });
    state.data.settings.webdav = prev;
    const reason = res && res.reason || 'no-response';
    cloudStatus('err', kind === 'test' ? tr('连接失败(') + reason + ')' :
      kind === 'now' ? tr('备份失败(') + reason + ')' : tr('恢复失败(') + reason + ')');
  }
}

export async function clearAll() {
  if (!state.data.groups.length) { toast(tr('当前没有分组')); return; }
  const ok = await confirmDialog({
    title: tr('清空全部分组'),
    text: tr('将删除全部 {g} 个分组(共 {t} 个标签)。操作后可在提示中撤销。', { g: state.data.groups.length, t: BGTStore.totalTabCount(state.data) }),
    okText: tr('全部删除'),
  });
  if (!ok) return;
  const before = snapshotGroups();
  state.data.groups = [];
  await persistAndRender();
  offerUndo(tr('已清空全部分组'), before, 8000);
}
