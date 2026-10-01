/**
 * Tab Harbor — 生成商店截图:node tools/make-screenshots.js
 *
 * 为什么需要它
 * ------------
 * Chrome Web Store 要求至少 1 张 1280×800 或 640×400 的截图(v3.11.3 之前一张都没有)。
 * 截图必须来自真实界面,不能画。这里用**扩展自带的预览模式**(dev-server + mock-chrome
 * 的演示数据)在无头 Chrome 里真实渲染并抓图:
 *   - 零依赖:直接用 Node 22 的内置 WebSocket 说 Chrome DevTools Protocol
 *   - 抓的是真界面:同一套 HTML/CSS/JS,只是数据来自 mock
 *
 * 前置:预览服务已在 127.0.0.1:8642 运行(node dev-server.js)
 * 用法:node tools/make-screenshots.js [--out store-assets]
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 9333;
const BASE = 'http://127.0.0.1:8642';

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  path.join(os.homedir(), 'AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'),
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

function findChrome() {
  for (const p of CHROME_CANDIDATES) if (fs.existsSync(p)) return p;
  throw new Error('未找到 Chrome,请用 --chrome <路径> 指定');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 极简 CDP 客户端(基于 Node 内置 WebSocket) */
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
    const id = (this.seq += 1);
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
      const r = await fetch(url);
      if (r.ok) return await r.json();
    } catch (e) { /* 还没起来 */ }
    await sleep(250);
  }
  throw new Error('等待 ' + url + ' 超时');
}

/** 在页面里执行一段表达式并返回 JSON 值 */
async function evaluate(cdp, sessionId, expr) {
  const r = await cdp.send('Runtime.evaluate', {
    expression: expr, returnByValue: true, awaitPromise: true,
  }, sessionId);
  if (r.exceptionDetails) throw new Error('页面内异常: ' + JSON.stringify(r.exceptionDetails.text));
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

const SHOTS = [
  {
    file: 'screenshot-1-groups.png',
    w: 1280, h: 800,
    navigate: BASE + '/manager/manager.html',
    // 3.17.0 起默认视图是「今天」:先等页面就绪,再显式切到「分组」并等卡片渲染
    ready: "!!document.querySelector('#viewGroups')",
    after: "if (document.querySelector('#btnWelcomeDismiss')) document.querySelector('#btnWelcomeDismiss').click();"
      + " document.querySelector('#viewGroups').click()",
    readyAfter: "document.querySelectorAll('#groupList .group').length >= 3",
    note: '分组主页(保存下来的分组卡片)',
  },
  {
    file: 'screenshot-2-timeline.png',
    w: 1280, h: 800,
    after: "document.querySelector('#viewTimeline').click()",
    readyAfter: "document.querySelectorAll('#timelineList .tl-row').length >= 3",
    note: '时间轴:港湾周报 + 按天工作记录与差分',
  },
  {
    file: 'screenshot-3-workspaces.png',
    w: 1280, h: 800,
    after: "document.querySelector('#viewWorkspaces').click()",
    readyAfter: "document.querySelectorAll('#wsList .ws').length >= 2",
    note: '工作区(含多窗口工作区)',
  },
  {
    file: 'screenshot-4-data-control.png',
    w: 1280, h: 800,
    // 必须开新 target:从 manager.html 跳到 manager.html#settings 属于同文档片段导航,
    // 页面不会重新加载,manager.js 的 init()(里面才处理 #settings)也就不会跑。
    // 真实用法(从弹窗 chrome.tabs.create 打开该 URL)是新标签冷加载,所以这里也走冷加载。
    newTarget: true,
    navigate: BASE + '/manager/manager.html#settings',
    ready: "document.querySelector('#settingsDialog') && document.querySelector('#settingsDialog').open",
    readyAfter: "!!document.querySelector('#dcLocalDetail') && document.querySelector('#dcLocalDetail').textContent.length > 5",
    note: '设置页数据控制中心(本机 / WebDAV / 第三方服务器:从未)',
  },
  {
    file: 'screenshot-5-popup.png',
    w: 640, h: 400,
    newTarget: true,
    navigate: BASE + '/popup/popup.html',
    ready: "document.querySelectorAll('#berthRow .pp__berth').length >= 1",
    note: '工具栏弹窗(保存 / 泊位速恢复 / 收工)',
  },
];

async function main() {
  const argv = process.argv.slice(2);
  const outIdx = argv.indexOf('--out');
  const outDir = path.resolve(ROOT, outIdx >= 0 ? argv[outIdx + 1] : 'store-assets');
  const chromeIdx = argv.indexOf('--chrome');
  const chromePath = chromeIdx >= 0 ? argv[chromeIdx + 1] : findChrome();

  try { await fetch(BASE + '/manager/manager.html'); } catch (e) {
    throw new Error('预览服务未运行。先执行:node dev-server.js');
  }
  fs.mkdirSync(outDir, { recursive: true });

  const profile = path.join(os.tmpdir(), 'th-shot-profile-' + Date.now());
  const chrome = spawn(chromePath, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', '--force-device-scale-factor=1',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + profile,
    'about:blank',
  ], { stdio: 'ignore' });

  try {
    const ver = await waitForHttp('http://127.0.0.1:' + PORT + '/json/version');
    const ws = new WebSocket(ver.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve);
      ws.addEventListener('error', reject);
    });
    const cdp = new Cdp(ws);

    // 页面错误收集:失败时打印出来,免得"等待条件超时"这种没头没尾的报错
    const pageErrors = [];
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params && m.params.exceptionDetails;
        pageErrors.push((d && d.text) + ' ' + ((d && d.exception && d.exception.description) || ''));
      }
    });

    // 同一个 target 连续复用:每次新建 target 会因 localStorage/执行上下文切换而不稳
    let cur = null;   // { targetId, sessionId }
    let curSize = '';

    async function attachNew() {
      if (cur) await cdp.send('Target.closeTarget', { targetId: cur.targetId }).catch(() => {});
      const t = await cdp.send('Target.createTarget', { url: 'about:blank' });
      const a = await cdp.send('Target.attachToTarget', { targetId: t.targetId, flatten: true });
      await cdp.send('Page.enable', {}, a.sessionId);
      await cdp.send('Runtime.enable', {}, a.sessionId);
      cur = { targetId: t.targetId, sessionId: a.sessionId };
      curSize = '';
    }

    for (const shot of SHOTS) {
      const size = shot.w + 'x' + shot.h;
      if (shot.newTarget || !cur || curSize !== size) await attachNew();
      if (curSize !== size) {
        await cdp.send('Emulation.setDeviceMetricsOverride',
          { width: shot.w, height: shot.h, deviceScaleFactor: 1, mobile: false }, cur.sessionId);
        curSize = size;
      }
      if (shot.navigate) {
        await cdp.send('Page.navigate', { url: shot.navigate }, cur.sessionId);
        await waitFor(cdp, cur.sessionId, shot.ready, shot.file + ' 首屏', 15000);
      }
      if (shot.after) {
        // after 反复重试直到 readyAfter 通过:静态元素出现 ≠ 模块已绑定事件,
        // 点击可能落在 init() 之前而无效 —— 重试对绑定时序免疫(3.17 改默认视图时踩过)。
        const deadline = Date.now() + 12000;
        for (;;) {
          await evaluate(cdp, cur.sessionId, shot.after);
          if (await evaluate(cdp, cur.sessionId, '!!(' + (shot.readyAfter || 'true') + ')')) break;
          if (Date.now() > deadline) {
            throw new Error(shot.file + ' 操作后条件超时: ' + (shot.readyAfter || 'true'));
          }
          await sleep(200);
        }
      } else if (shot.readyAfter) {
        await waitFor(cdp, cur.sessionId, shot.readyAfter, shot.file + ' 内容就绪', 10000);
      }
      await sleep(700); // 过渡动画与图标

      const png = await cdp.send('Page.captureScreenshot',
        { format: 'png', captureBeyondViewport: false }, cur.sessionId);
      const file = path.join(outDir, shot.file);
      fs.writeFileSync(file, Buffer.from(png.data, 'base64'));
      const kb = (fs.statSync(file).size / 1024).toFixed(1);
      console.log('  ' + size + '  ' + shot.file + '  ' + kb + ' KB   ' + shot.note);
      if (pageErrors.length) {
        console.log('      页面报错: ' + pageErrors.slice(-3).join(' | '));
        pageErrors.length = 0;
      }
    }
    ws.close();
    console.log('\n截图已输出到 ' + path.relative(ROOT, outDir) + '(尺寸符合 CWS 要求:1280×800 或 640×400)');
  } finally {
    chrome.kill();
    await sleep(600);
    // 临时 profile 的清理是尽力而为:Chrome 刚退出时可能仍占着个别文件(EBUSY),
    // 这不该让整个脚本以失败退出 —— 截图已经写好了。
    try {
      fs.rmSync(profile, { recursive: true, force: true });
    } catch (e) {
      console.log('(提示:临时 profile 未能立即删除,可稍后手动清理 ' + profile + ')');
    }
  }
}

main().catch((e) => { console.error('生成截图失败:', e.message); process.exit(1); });
