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
  if (location.hash === '#settings') openSettings();
}

init();

