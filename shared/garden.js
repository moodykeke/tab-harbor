/**
 * Tab Harbor — Garden(知识库/花园入口,Wave 3.5)
 *
 * 定位(手册 WP-3.5):不是"备份通道",是**知识库入口** —— 让捕获的工作记忆
 * 可以被蒸馏进用户自己的本地文件夹。
 * 纯函数(文件名/Markdown/托管区段)与浏览器部分(FSA 句柄 + IndexedDB)同文件,
 * 纯函数可在 node 门禁中证伪;浏览器部分全部特性检测守卫,缺失时安静退化。
 *
 * 托管区段纪律(WP-3.4):写入只发生在 BEGIN/END 标记**之间**,标记本身与
 * 标记之外的任何内容永不触碰;写前留底(*.bak.md),可回滚。
 */
(function (root) {
  'use strict';

  const SECTION_BEGIN = '<!-- tab-harbor:evidence:start -->';
  const SECTION_END = '<!-- tab-harbor:evidence:end -->';
  const DB_NAME = 'tab-harbor-garden';
  const STORE = 'handles';
  const HANDLE_KEY = 'garden';

  /* ---------------- 纯函数(node 可测) ---------------- */

  /** Windows/跨平台安全文件名:去路径符与控制符、压缩空白、去首尾点空格、限长 */
  function safeFileName(title) {
    const s = String(title || '')
      .replace(/[\\/:*?"<>|]/g, ' ')
      .replace(/[\x00-\x1f]/g, '')
      .replace(/\s+/g, ' ')
      .replace(/^[ .]+|[ .]+$/g, '');
    return (s.slice(0, 60) || 'untitled');
  }

  function mdLink(text, url) {
    return '[' + String(text || '').replace(/([\[\]])/g, '\\$1') + '](' + url + ')';
  }

  /** 分组 → Markdown(标题 + 链接清单,含保存日期) */
  function groupMarkdown(group) {
    const g = group || {};
    const lines = ['# ' + (g.title || '未命名分组'), ''];
    for (const t of (g.tabs || [])) {
      const at = t.savedAt ? ' — ' + new Date(t.savedAt).toLocaleDateString() : '';
      lines.push('- ' + mdLink(t.title || t.url, t.url) + at);
    }
    if (!lines.length || (g.tabs || []).length === 0) lines.push('- (' + '空分组' + ')');
    return lines.join('\n') + '\n';
  }

  function dayKeyOf(ts) {
    const d = new Date(Number(ts) || 0);
    const p = (n) => (n < 10 ? '0' + n : String(n));
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  /**
   * 某一天的证据段(WP-3.4):当天收工记录 + 摘录 + 版本变化。
   * 输入是合并视图数据(store.load 的形状),输出是**区段正文**(不含标记)。
   * lineageOf(url) → 'v3' | ''(可选):由调用方注入(管理页用 BGTStore.sourceVersions),
   * 不在这里直接依赖 store —— 纯函数保持可独立证伪。
   */
  function buildDailyEvidence(data, dayKey, lineageOf) {
    data = data || {};
    const day = dayKey || dayKeyOf(Date.now());
    const wsTitle = (id) => {
      const w = (data.workspaces || []).find((x) => x.id === id);
      return w ? w.title : '';
    };
    const lines = [];
    const records = (data.records || []).filter((r) => dayKeyOf(r.createdAt) === day);
    const excerpts = (data.excerpts || []).filter((x) => dayKeyOf(x.savedAt) === day);

    if (records.length) {
      lines.push('## 收工记录');
      for (const r of records) {
        const time = new Date(r.createdAt).toTimeString().slice(0, 5);
        lines.push('');
        lines.push('### ' + time + ' ' + (r.title || '记录') + '(' + (r.tabs || []).length + ' 个标签)');
        for (const t of (r.tabs || []).slice(0, 50)) {
          const ver = lineageOf ? lineageOf(t.url) : '';
          lines.push('- ' + mdLink(t.title || t.url, t.url) + (ver ? ' `(' + ver + ' 谱系)`' : ''));
        }
      }
    }
    if (excerpts.length) {
      lines.push('');
      lines.push('## 摘录');
      for (const x of excerpts) {
        const proj = x.workspaceId ? wsTitle(x.workspaceId) : '';
        lines.push('');
        lines.push('> ' + String(x.text || '').replace(/\n+/g, '\n> '));
        lines.push('> —— ' + mdLink(x.tabTitle || x.url, x.url) + (proj ? '(项目:' + proj + ')' : ''));
      }
    }
    if (!lines.length) lines.push('(当天没有收工记录或摘录)');
    return { day: day, body: lines.join('\n') + '\n' };
  }

  /**
   * 托管区段写入(WP-3.4 的核心纪律):
   * - 无标记 → 在文末追加标记区段;有标记 → 只替换两标记**之间**的内容,
   *   标记本身与标记之外的内容逐字节保留;
   * - 返回 { content, replaced, previousBody },调用方据此决定是否留底。
   */
  function applyManagedSection(existing, body) {
    const src = String(existing || '');
    const bi = src.indexOf(SECTION_BEGIN);
    const ei = src.lastIndexOf(SECTION_END);
    if (bi < 0 || ei < 0 || ei < bi) {
      const head = src ? src.replace(/\s*$/, '') + '\n\n' : '';
      return { content: head + SECTION_BEGIN + '\n' + body + SECTION_END + '\n', replaced: false, previousBody: '' };
    }
    const before = src.slice(0, bi);                       // 标记之前:逐字节保留
    const after = src.slice(ei + SECTION_END.length);      // 结束标记之后:逐字节保留
    const prevInner = src.slice(bi + SECTION_BEGIN.length, ei).replace(/^\n|\n$/g, '');
    return {
      content: before + SECTION_BEGIN + '\n' + body + SECTION_END + after,
      replaced: true,
      previousBody: prevInner,
    };
  }

  /* ---------------- 浏览器部分(FSA + IndexedDB,全部守卫) ---------------- */

  function idb() {
    return (typeof indexedDB !== 'undefined') ? indexedDB : null;
  }

  function withStore(mode, fn) {
    return new Promise((resolve, reject) => {
      const idb_ = idb();
      if (!idb_) { reject(new Error('no-indexeddb')); return; }
      const req = idb_.open(DB_NAME, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(STORE, mode);
        const st = tx.objectStore(STORE);
        let out;
        try { out = fn(st); } catch (e) { db.close(); reject(e); return; }
        tx.oncomplete = () => { db.close(); resolve(out && out.result !== undefined ? out.result : undefined); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      };
    });
  }

  async function saveGardenHandle(handle) {
    await withStore('readwrite', (st) => st.put(handle, HANDLE_KEY));
    return true;
  }

  function loadGardenHandle() {
    return withStore('readonly', (st) => st.get(HANDLE_KEY));
  }

  /** 句柄跨会话后权限需再确认(手册 WP-3.5 约束) */
  async function ensurePermission(handle) {
    if (!handle || !handle.queryPermission) return false;
    try {
      if ((await handle.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
      if (handle.requestPermission && (await handle.requestPermission({ mode: 'readwrite' })) === 'granted') return true;
    } catch (e) { /* 用户拒绝或无手势 */ }
    return false;
  }

  function pickGarden() {
    if (typeof window === 'undefined' || !window.showDirectoryPicker) return Promise.resolve(null);
    return window.showDirectoryPicker({ mode: 'readwrite' }).catch(() => null);
  }

  async function readTextFile(dirHandle, name) {
    const fh = await dirHandle.getFileHandle(name); // 不存在即抛
    const file = await fh.getFile();
    return file.text();
  }

  /** 写文件;leaveBackup 为真时先把现有内容写为 <name>.bak.md(写前留底,可回滚) */
  async function writeFile(dirHandle, name, content, leaveBackup) {
    if (leaveBackup) {
      try {
        const prev = await readTextFile(dirHandle, name);
        await writeFile(dirHandle, name.replace(/\.md$/, '') + '.bak.md', prev, false);
      } catch (e) { /* 文件不存在则无需留底 */ }
    }
    const fh = await dirHandle.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(content instanceof Uint8Array ? content : String(content));
    await w.close();
    return true;
  }

  const api = {
    SECTION_BEGIN: SECTION_BEGIN,
    SECTION_END: SECTION_END,
    safeFileName: safeFileName,
    groupMarkdown: groupMarkdown,
    dayKeyOf: dayKeyOf,
    buildDailyEvidence: buildDailyEvidence,
    applyManagedSection: applyManagedSection,
    saveGardenHandle: saveGardenHandle,
    loadGardenHandle: loadGardenHandle,
    ensurePermission: ensurePermission,
    pickGarden: pickGarden,
    readTextFile: readTextFile,
    writeFile: writeFile,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = { BGTGarden: api };
  else root.BGTGarden = api;
})(typeof window !== 'undefined' ? window : globalThis);
