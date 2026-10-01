/**
 * Tab Harbor — 预览模式运行时冒烟扫描:node tools/smoke-preview.js
 *
 * 为什么需要它
 * ------------
 * Syntax 门禁只证明"能解析",不证明"跑起来无错"。v3.24.0 的管理页白屏之所以
 * 能在门禁全绿的情况下溜进三个版本,就是因为没有任何一套自动化的"点一遍"检查。
 * 本工具在无头 Chrome 里加载三个页面(全部走 mock-chrome 演示数据),模拟用户
 * 点击主要交互,收集三类信号,任一非空即失败:
 *   1. 未捕获 JS 异常(Runtime.exceptionThrown,含 promise 拒绝)
 *   2. console.error 输出
 *   3. 资源加载失败(Network.loadingFailed —— 能抓到 CSS url()/动态引用的缺文件,
 *      pack.js 的引用完整性只查 HTML 的 src/href,查不到 CSS)
 *
 * 前置:预览服务已在 127.0.0.1:8642 运行(node dev-server.js)
 * 用法:node tools/smoke-preview.js [--chrome <路径>] [--port 9444]
 */
'use strict';

const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { findChrome } = require('./chrome-shot.js');

const ROOT = path.join(__dirname, '..');
const BASE = 'http://127.0.0.1:8642';
/* CDP 调试端口要避开常见服务:本机 9444 被系统服务 KDService.exe 占用,
   Chrome 绑定失败 + HTTP 探测连到该服务会被无限挂起 —— 探测因此必须带超时。 */
const PORT = 19222;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---- 极简 CDP 客户端(与 make-screenshots.js 同款,零依赖) ---- */
class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.seq = 0;
    this.pending = new Map();
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (m.error) reject(new Error(m.method + ' → ' + JSON.stringify(m.error)));
        else resolve(m.result);
      }
    });
  }
  send(method, params, sessionId) {
    const id = this.seq += 1;
    const msg = { id, method, params: params || {} };
    if (sessionId) msg.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(msg));
    });
  }
}

async function waitForHttp(url, tries) {
  for (let i = 0; i < (tries || 60); i += 1) {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 2000); // 端口被无关服务占用时会挂而不拒,必须限时
      const r = await fetch(url, { signal: ctl.signal });
      clearTimeout(timer);
      if (r.ok) return await r.json();
    } catch (e) { /* 未就绪或被占用,重试 */ }
    await sleep(250);
  }
  throw new Error('等待 ' + url + ' 超时(端口可能被无关服务占用,换 --port 或检查 netstat)');
}

async function evaluate(cdp, sessionId, expr) {
  const r = await cdp.send('Runtime.evaluate', {
    expression: expr, returnByValue: true, awaitPromise: true,
  }, sessionId);
  if (r.exceptionDetails) {
    throw new Error('页面内异常: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description
      || r.exceptionDetails.text));
  }
  return r.result && r.result.value;
}

async function waitFor(cdp, sessionId, expr, label, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 8000);
  while (Date.now() < deadline) {
    if (await evaluate(cdp, sessionId, '!!(' + expr + ')')) return;
    await sleep(120);
  }
  throw new Error('等待条件超时: ' + label);
}

/** 点击存在才点的元素;不存在则记入 missing(结构漂移本身就是要抓的信号)。
 *  CLICK_OPT:可选元素(如首次引导卡,可能本来就不在),缺席不算漂移。 */
const CLICK = (sel) => `(() => { const el = document.querySelector(${JSON.stringify(sel)});
  if (el) { el.click(); return true; } return false; })()`;
const CLICK_OPT = (sel) => `(() => { const el = document.querySelector(${JSON.stringify(sel)});
  if (el) { el.click(); return true; } return 'optional-absent'; })()`;
const TYPE = (sel, text) => `(() => { const el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return false; el.value = ${JSON.stringify(text)};
  el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`;
const KEY_ESCAPE = `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }))`;

/* ---- 冒烟步骤表:每步 { name, navigate, wait, actions[], settle } ---- */
const STEPS = [
  {
    name: 'manager · 今天首页(默认视图)',
    navigate: BASE + '/manager/manager.html',
    wait: "document.querySelector('#appVersion')",
    actions: [
      CLICK('#btnWelcomeDismiss'),
      CLICK('#viewGroups'), CLICK('#viewWorkspaces'), CLICK('#viewTimeline'), CLICK('#viewToday'),
    ],
    settle: "document.querySelector('#viewToday').classList.contains('active')",
  },
  {
    name: 'manager · 分组视图与列表交互',
    navigate: BASE + '/manager/manager.html',
    // 3.17.0 起默认视图是「今天」:分组卡片要点了 Tab 才渲染,不能在点击前就等卡片
    wait: "!!document.querySelector('#viewGroups')",
    actions: [
      CLICK_OPT('#btnWelcomeDismiss'),
      CLICK('#viewGroups'),
      CLICK('#btnArchived'), CLICK('#btnArchived'),
      CLICK('#btnToggleAll'), CLICK('#btnToggleAll'),
      CLICK('#groupList .group .group__head'),
      TYPE('#searchInput', '设计'),
    ],
    settle: "document.querySelectorAll('#groupList .group').length >= 3",
  },
  {
    name: 'manager · 洞察面板',
    navigate: BASE + '/manager/manager.html',
    wait: "!!document.querySelector('#btnDupStats')",
    actions: [CLICK('#btnDupStats'), KEY_ESCAPE, CLICK('#btnTidy'), KEY_ESCAPE],
    settle: "true",
  },
  {
    name: 'manager · 设置对话框(同页入口)',
    navigate: BASE + '/manager/manager.html',
    wait: "!!document.querySelector('#btnSettings')",
    actions: [CLICK('#btnSettings'), CLICK('#btnVerifyBackup'), KEY_ESCAPE, CLICK('#themeBtn'), CLICK('#themeBtn')],
    settle: "true",
  },
  {
    name: 'manager · 设置页冷加载(#settings 数据控制中心)',
    navigate: BASE + '/manager/manager.html#settings',
    wait: "document.querySelector('#settingsDialog') && document.querySelector('#settingsDialog').open",
    actions: [CLICK('#btnClearObs'), CLICK('#btnExportTrail')],
    settle: "!!document.querySelector('#dcLocalDetail') && document.querySelector('#dcLocalDetail').textContent.length > 5",
  },
  {
    name: 'popup · 保存/泊位/收工',
    navigate: BASE + '/popup/popup.html',
    wait: "document.querySelectorAll('.pp__item').length >= 2",
    actions: [
      CLICK('#optPinned'), CLICK('#optActive'),
      CLICK('#btnSave'), CLICK('#btnSaveAll'), CLICK('#btnClockOut'),
      CLICK('#btnOpenSettings'),
    ],
    settle: "!!document.querySelector('.pp__head')",
  },
  {
    name: 'sidepanel · 列表与搜索',
    navigate: BASE + '/sidepanel/sidepanel.html',
    wait: "document.querySelector('#spGroups') || document.querySelector('#spEmpty')",
    actions: [TYPE('#spSearch', '设计'), CLICK('#spManager')],
    settle: "!!document.querySelector('.sp__head, .sp__head')",
  },
];

async function main() {
  const argv = process.argv.slice(2);
  const chromeIdx = argv.indexOf('--chrome');
  const chromePath = chromeIdx >= 0 ? argv[chromeIdx + 1] : findChrome();

  try { await fetch(BASE + '/manager/manager.html'); } catch (e) {
    throw new Error('预览服务未运行。先执行:node dev-server.js');
  }

  const profile = path.join(os.tmpdir(), 'th-smoke-' + Date.now());
  const chrome = spawn(chromePath, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', '--force-device-scale-factor=1',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + profile,
    'about:blank',
  ], { stdio: 'ignore' });

  const jsErrors = [];      // 未捕获异常
  const consoleErrors = []; // console.error
  const netFailures = [];   // 资源加载失败
  const missingSel = [];    // 交互点缺失(结构漂移)

  try {
    const ver = await waitForHttp('http://127.0.0.1:' + PORT + '/json/version');
    const ws = new WebSocket(ver.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
    const cdp = new Cdp(ws);

    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params && m.params.exceptionDetails;
        jsErrors.push(d.text + ' ' + ((d.exception && d.exception.description) || '').split('\n').slice(0, 2).join(' | '));
      } else if (m.method === 'Runtime.consoleAPICalled'
        && m.params.type === 'error') {
        consoleErrors.push((m.params.args || []).map((a) => a.value || a.description || '').join(' ').slice(0, 300));
      } else if (m.method === 'Network.loadingFailed') {
        netFailures.push((m.params.errorText || 'failed') + ' — ' + (m.params.type || ''));
      }
    });

    const t = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const a = await cdp.send('Target.attachToTarget', { targetId: t.targetId, flatten: true });
    const sid = a.sessionId;
    console.log('cdp attached');
    // 看门狗:任何 45s 无 CDP 往返即视为挂死,打出在途调用并退出(防静默悬挂)
    cdp.send('Runtime.enable', {}, sid).catch(() => {});
    let inflight = 0;
    const origSend = cdp.send.bind(cdp);
    cdp.send = (method, params, s) => { inflight += 1; return origSend(method, params, s).finally(() => { inflight -= 1; }); };
    const watchdog = setInterval(() => {
      if (inflight > 0) {
        console.error('WATCHDOG: ' + inflight + ' 个 CDP 调用在途超过 45s,判定挂死');
        console.error('最后步骤: ' + (lastStep || '(未开始)'));
        chrome.kill(); process.exit(2);
      }
    }, 45000);
    await cdp.send('Page.enable', {}, sid);
    await cdp.send('Runtime.enable', {}, sid);
    await cdp.send('Network.enable', {}, sid);
    await cdp.send('Emulation.setDeviceMetricsOverride',
      { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }, sid);

    let failedSteps = 0;
    let lastStep = '';
    for (const step of STEPS) {
      lastStep = step.name;
      console.log('  … ' + step.name);
      const before = jsErrors.length + consoleErrors.length + netFailures.length;
      try {
        await cdp.send('Page.navigate', { url: step.navigate }, sid);
        await waitFor(cdp, sid, step.wait, step.name + ' 就绪');
        await sleep(350); // 让渲染与异步初始化落地
        for (const act of step.actions) {
          const ok = await evaluate(cdp, sid, act);
          if (ok === false) {
            const mSel = /querySelector\((".*?")\)/.exec(act);
            missingSel.push(step.name + ' ← ' + (mSel ? mSel[1] : act.slice(0, 60)));
          }
          await sleep(120);
        }
        await sleep(300);
        await waitFor(cdp, sid, '(' + step.settle + ')', step.name + ' settle');
      } catch (e) {
        failedSteps += 1;
        console.error('  FAIL 步骤: ' + step.name + ' — ' + String(e.message).split('\n')[0]);
        continue;
      }
      const after = jsErrors.length + consoleErrors.length + netFailures.length;
      const dirty = after > before;
      console.log('  ' + (dirty ? 'WARN' : 'PASS') + ' ' + step.name
        + (dirty ? '  (本步新增信号 ' + (after - before) + ' 条)' : ''));
    }

    console.log('');
    const report = (title, arr) => {
      console.log(title + ': ' + arr.length + ' 条');
      for (const l of arr.slice(0, 12)) console.log('  · ' + String(l).replace(/\s+/g, ' ').slice(0, 220));
    };
    report('未捕获 JS 异常', jsErrors);
    report('console.error', consoleErrors);
    report('资源加载失败', netFailures);
    report('交互点缺失(结构漂移)', missingSel);

    const total = jsErrors.length + consoleErrors.length + netFailures.length;
    console.log('\n结论: ' + (total === 0 && failedSteps === 0
      ? '三页主要交互零异常、零缺资源' + (missingSel.length ? '(另有交互点缺失提示,见上)' : '')
      : '存在 ' + total + ' 条运行时信号 / ' + failedSteps + ' 个步骤失败 —— 见上'));
    process.exitCode = (total === 0 && failedSteps === 0) ? 0 : 1;
  } finally {
    chrome.kill();
  }
}

main().catch((e) => { console.error(e && e.message || e); process.exit(1); });
