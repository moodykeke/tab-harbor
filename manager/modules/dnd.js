/**
 * Tab Harbor — dnd:拖拽(组内排序、跨组移动、分组排序、边缘滚动、悬停展开)
 */
import { state, $, $$, persist, persistAndRender } from './core.js';
import { renderGroups } from './render.js';

export function clearDropMarks() {
  $$('.drop--before, .drop--after, .drop--into, .drop--above, .drop--below, .dragging')
    .forEach((el) => el.classList.remove('drop--before', 'drop--after', 'drop--into', 'drop--above', 'drop--below', 'dragging'));
}

export function moveTab(srcGid, tabId, dstGid, index) {
  const src = state.data.groups.find((g) => g.id === srcGid);
  const dst = state.data.groups.find((g) => g.id === dstGid);
  if (!src || !dst) return false;
  const i = src.tabs.findIndex((t) => t.id === tabId);
  if (i < 0) return false;
  const tab = src.tabs.splice(i, 1)[0];
  let idx = index;
  if (src === dst && i < index) idx = index - 1;
  dst.tabs.splice(Math.max(0, Math.min(idx, dst.tabs.length)), 0, tab);
  return true;
}

function moveGroup(srcId, dstId, place) {
  const from = state.data.groups.findIndex((g) => g.id === srcId);
  if (from < 0) return;
  const group = state.data.groups.splice(from, 1)[0];
  let to = state.data.groups.findIndex((g) => g.id === dstId);
  if (to < 0) { state.data.groups.splice(from, 0, group); return; }
  if (place === 'below') to += 1;
  state.data.groups.splice(to, 0, group);
}

export function bindDnD() {
  const list = $('#groupList');

  list.addEventListener('dragstart', (e) => {
    const grip = e.target.closest && e.target.closest('.group__grip');
    const tabEl = e.target.closest && e.target.closest('.tab');
    if (grip) {
      const card = grip.closest('.group');
      state.dragInfo = { type: 'group', groupId: card.dataset.id };
      card.classList.add('dragging');
    } else if (tabEl) {
      state.dragInfo = { type: 'tab', groupId: tabEl.dataset.group, tabId: tabEl.dataset.id };
      tabEl.classList.add('dragging');
    } else {
      e.preventDefault();
      return;
    }
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', 'better-group-tabs');
  });

  list.addEventListener('dragover', (e) => {
    if (!state.dragInfo) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    clearDropMarks();

    // 接近视口边缘时自动滚动
    edgeScroll(e.clientY);

    // 悬停在折叠分组上稍候自动展开
    const overCard = e.target.closest('.group');
    if (overCard && overCard.classList.contains('group--collapsed')) {
      if (state.expandTimer == null || state.expandTarget !== overCard) {
        clearTimeout(state.expandTimer);
        state.expandTarget = overCard;
        state.expandTimer = setTimeout(() => {
          const grp = state.data.groups.find((g) => g.id === state.expandTarget.dataset.id);
          if (grp) {
            grp.collapsed = false;
            state.expandTarget.classList.remove('group--collapsed');
            persist();
          }
          state.expandTimer = null;
        }, 650);
      }
    } else {
      clearTimeout(state.expandTimer);
      state.expandTimer = null;
    }

    if (state.dragInfo.type === 'tab') {
      const tabEl = e.target.closest('.tab');
      if (tabEl && !(tabEl.dataset.group === state.dragInfo.groupId && tabEl.dataset.id === state.dragInfo.tabId)) {
        const r = tabEl.getBoundingClientRect();
        tabEl.classList.add(e.clientY < r.top + r.height / 2 ? 'drop--before' : 'drop--after');
        return;
      }
      const listEl = e.target.closest('.tabs');
      if (listEl) listEl.classList.add('drop--into');
      return;
    }
    const card = e.target.closest('.group');
    if (card && card.dataset.id !== state.dragInfo.groupId) {
      const r = card.getBoundingClientRect();
      card.classList.add(e.clientY < r.top + r.height / 2 ? 'drop--above' : 'drop--below');
    }
  });

  list.addEventListener('drop', (e) => {
    if (!state.dragInfo) return;
    e.preventDefault();
    const info = state.dragInfo;
    clearDropMarks();
    state.dragInfo = null;
    clearTimeout(state.expandTimer);
    state.expandTimer = null;
    clearInterval(state.scrollTimer);

    if (info.type === 'tab') {
      let dstGid = null;
      let index = null;
      const tabEl = e.target.closest('.tab');
      const listEl = e.target.closest('.tabs');
      const card = e.target.closest('.group');
      if (tabEl) {
        dstGid = tabEl.dataset.group;
        const dst = state.data.groups.find((g) => g.id === dstGid);
        const di = dst.tabs.findIndex((t) => t.id === tabEl.dataset.id);
        const r = tabEl.getBoundingClientRect();
        index = e.clientY < r.top + r.height / 2 ? di : di + 1;
      } else if (listEl) {
        dstGid = listEl.dataset.group;
        index = state.data.groups.find((g) => g.id === dstGid).tabs.length;
      } else if (card) {
        dstGid = card.dataset.id;
        index = state.data.groups.find((g) => g.id === dstGid).tabs.length;
      }
      if (dstGid && moveTab(info.groupId, info.tabId, dstGid, index)) persistAndRender();
    } else {
      const card = e.target.closest('.group');
      if (card && card.dataset.id !== info.groupId) {
        const r = card.getBoundingClientRect();
        moveGroup(info.groupId, card.dataset.id,
          e.clientY < r.top + r.height / 2 ? 'above' : 'below');
        persistAndRender();
      }
    }
  });

  list.addEventListener('dragend', () => {
    state.dragInfo = null;
    clearTimeout(state.expandTimer);
    state.expandTimer = null;
    clearInterval(state.scrollTimer);
    clearDropMarks();
  });

  /** 拖拽时接近视口上下边缘自动滚动 */
  function edgeScroll(y) {
    clearInterval(state.scrollTimer);
    if (y < 70) {
      state.scrollTimer = setInterval(() => window.scrollBy(0, -14), 16);
    } else if (y > window.innerHeight - 70) {
      state.scrollTimer = setInterval(() => window.scrollBy(0, 14), 16);
    }
  }
}
