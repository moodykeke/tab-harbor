/**
 * Tab Harbor — 管理页入口
 * 模块图:core(状态/工具) ← icons / ui ← render ← actions ← settings
 *         events 绑定全部交互;dnd 独立拖拽层。共享全局:BGTStore / tr(经典脚本注入)。
 */
import { state, setRenderer } from './modules/core.js';
import { render } from './modules/render.js';
import { bindEvents } from './modules/events.js';
import { openSettings } from './modules/settings.js';

async function init() {
  state.data = await BGTStore.load();
  setRenderer(async () => render());
  bindEvents();
  render();
  applyVersionLabel();
  if (location.hash === '#settings') openSettings();
}

/**
 * 版本号从 manifest 读取,不在 HTML 里写死。
 * 此前侧栏硬编码 "v3.11.2",发到 3.11.3 后界面仍在撒谎 —— 版本号只应有一个来源。
 * 预览模式(mock)没有 runtime.getManifest,退回只显示品牌名,不猜版本。
 */
function applyVersionLabel() {
  const el = document.getElementById('appVersion');
  if (!el) return;
  let ver = '';
  try {
    if (chrome.runtime && chrome.runtime.getManifest) ver = chrome.runtime.getManifest().version || '';
  } catch (e) { /* 预览模式 */ }
  el.textContent = ver ? 'Tab Harbor v' + ver : 'Tab Harbor';
}

init();

