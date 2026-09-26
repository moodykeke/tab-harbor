/**
 * Tab Harbor — ui:Toast、确认框、自绘菜单、小组件
 */
import { state, $, h, persistAndRender, firstChar } from './core.js';
import { pushUndoOp } from './ops.js';
import { ICONS } from './icons.js';

export function toast(msg, opts) {
  opts = opts || {};
  const t = h('div', { class: 'toast' }, h('span', { text: msg }));
  const dismiss = () => { t.classList.remove('toast--in'); setTimeout(() => t.remove(), 250); };
  if (opts.actionLabel) {
    const b = h('button', { class: 'toast__action', text: opts.actionLabel });
    b.addEventListener('click', () => { dismiss(); if (opts.onAction) opts.onAction(); });
    t.appendChild(b);
  }
  $('#toastWrap').appendChild(t);
  requestAnimationFrame(() => t.classList.add('toast--in'));
  setTimeout(dismiss, opts.duration || 4500);
}

/**
 * 撤销:合并式恢复——只找回被删的,不覆盖撤销期间的其他编辑。
 * groupsBefore:操作前快照;listKey: groups | workspaces。
 */
export function offerUndo(label, groupsBefore, duration, listKey, type) {
  pushUndoOp(label, groupsBefore, listKey, type); // 同步登记到 Ctrl+Z 撤销栈
  toast(label, {
    actionLabel: tr('撤销'),
    duration: duration || 6000,
    onAction: async () => {
      const current = listKey === 'workspaces' ? state.data.workspaces : state.data.groups;
      const merged = BGTStore.mergeGroups(groupsBefore, current);
      if (listKey === 'workspaces') state.data.workspaces = merged;
      else state.data.groups = merged;
      await persistAndRender();
    },
  });
}

export function confirmDialog(opts) {
  return new Promise((resolve) => {
    const dlg = $('#confirmDialog');
    $('#confirmTitle').textContent = opts.title || tr('确认操作');
    $('#confirmText').textContent = opts.text || '';
    const ok = $('#confirmOk');
    ok.textContent = opts.okText || tr('删除');
    ok.onclick = () => { dlg.close(); resolve(true); };
    $('#confirmCancel').onclick = () => { dlg.close(); resolve(false); };
    dlg.oncancel = () => resolve(false);
    dlg.showModal();
  });
}

/* ---------------- 自绘下拉菜单 ---------------- */

export function closeMenu() {
  if (!state.menuState) return;
  state.menuState.cleanup();
  state.menuState.el.remove();
  state.menuState = null;
}

/**
 * 在 anchor 按钮下方弹出菜单。
 * items: { label, icon?, danger?, checked?, onPick? } 或 '-'(分隔线)
 */
export function openMenu(anchor, items) {
  if (state.menuState && state.menuState.anchor === anchor) { closeMenu(); return; }
  closeMenu();

  const menu = h('div', { class: 'menu', role: 'menu' });
  for (const it of items) {
    if (it === '-') { menu.appendChild(h('div', { class: 'menu__sep' })); continue; }
    const row = h('button', {
      class: 'menu__item' + (it.danger ? ' menu__item--danger' : ''),
      type: 'button', role: 'menuitem',
    },
      h('span', { class: 'menu__icon', html: it.icon || '' }),
      h('span', { class: 'menu__label', text: it.label }),
      it.checked ? h('span', { class: 'menu__check', html: ICONS.check }) : null,
    );
    row.addEventListener('click', () => { closeMenu(); if (it.onPick) it.onPick(); });
    menu.appendChild(row);
  }
  document.body.appendChild(menu);

  // 定位:默认与按钮右缘对齐;越界时翻转/收进视口
  const r = anchor.getBoundingClientRect();
  const mw = menu.offsetWidth;
  const mh = menu.offsetHeight;
  let x = r.right - mw;
  if (x < 8) x = Math.max(8, r.left);
  if (x + mw > window.innerWidth - 8) x = window.innerWidth - mw - 8;
  let y = r.bottom + 6;
  if (y + mh > window.innerHeight - 8) y = Math.max(8, r.top - mh - 6);
  menu.style.left = `${Math.round(x)}px`;
  menu.style.top = `${Math.round(y)}px`;

  const onDocDown = (e) => {
    if (!menu.contains(e.target) && !anchor.contains(e.target)) closeMenu();
  };
  const onKey = (e) => { if (e.key === 'Escape') closeMenu(); };
  const cleanup = () => {
    document.removeEventListener('mousedown', onDocDown, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('scroll', closeMenu, true);
    window.removeEventListener('resize', closeMenu);
  };
  setTimeout(() => {
    document.addEventListener('mousedown', onDocDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', closeMenu, true);
    window.addEventListener('resize', closeMenu);
  }, 0);

  state.menuState = { el: menu, anchor, cleanup };
  requestAnimationFrame(() => menu.classList.add('menu--in'));
}

/* ---------------- 小组件 ---------------- */

export function iconBtn(act, title, icon, extraClass) {
  return h('button', {
    class: 'iconbtn' + (extraClass ? ' ' + extraClass : ''),
    'data-act': act, title, html: icon,
  });
}

export function faviconPair(tab, hueVal) {
  const fav = h('img', { class: 'tab__fav', src: BGTStore.faviconUrl(tab.url) || 'about:blank', alt: '' });
  const avatar = h('span', { class: 'tab__avatar', text: firstChar(tab.title), hidden: true });
  avatar.style.setProperty('--h', hueVal);
  fav.addEventListener('error', () => { fav.remove(); avatar.hidden = false; });
  return [fav, avatar];
}
