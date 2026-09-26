/**
 * Tab Harbor — icons:图标与常量标签
 */

export const ICONS = {
  grip: '<svg viewBox="0 0 24 24"><circle cx="9" cy="6" r="1.7"/><circle cx="15" cy="6" r="1.7"/><circle cx="9" cy="12" r="1.7"/><circle cx="15" cy="12" r="1.7"/><circle cx="9" cy="18" r="1.7"/><circle cx="15" cy="18" r="1.7"/></svg>',
  chev: '<svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5-11-6.5Z"/></svg>',
  ext: '<svg viewBox="0 0 24 24"><path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M20 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4"/></svg>',
  copy: '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="m6 7 1 13a1 1 0 0 0 1 .9h8a1 1 0 0 0 1-.9L18 7"/><path d="M10 11v6M14 11v6"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  dots: '<svg viewBox="0 0 24 24"><path d="M12 5v.01M12 12v.01M12 19v.01"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="m5 13 4 4L19 7"/></svg>',
  pencil: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3Z"/><path d="m13.5 6.5 3 3"/></svg>',
  download: '<svg viewBox="0 0 24 24"><path d="M12 4v10m0 0 4-4m-4 4-4-4"/><path d="M5 18h14"/></svg>',
  upload: '<svg viewBox="0 0 24 24"><path d="M12 14V4m0 0 4 4m-4-4L8 8"/><path d="M5 18h14"/></svg>',
  moon: '<svg viewBox="0 0 24 24"><path d="M20 13.5A8 8 0 1 1 10.5 4 6.5 6.5 0 0 0 20 13.5Z"/></svg>',
  sort: '<svg viewBox="0 0 24 24"><path d="M4 7h16M7 12h10M10 17h4"/></svg>',
  pin: '<svg viewBox="0 0 24 24"><path d="M9 4h6l-1 7 3 3v2H7v-2l3-3-1-7Z"/><path d="M12 16v4"/></svg>',
  archive: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="5" rx="1"/><path d="M6 9v9a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V9"/><path d="M10 13h4"/></svg>',
  list: '<svg viewBox="0 0 24 24"><path d="M9 6h11M9 12h11M9 18h11"/><path d="m4 6 1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2"/></svg>',
  tabs: '<svg viewBox="0 0 24 24"><rect x="3" y="7" width="13" height="11" rx="2"/><path d="M8 7V5.5A1.5 1.5 0 0 1 9.5 4H19a2 2 0 0 1 2 2v8.5a1.5 1.5 0 0 1-1.5 1.5H16"/></svg>',
  briefcase: '<svg viewBox="0 0 24 24"><rect x="4" y="8" width="16" height="10" rx="2"/><path d="M9 8V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.5-2.3 1a7 7 0 0 0-2.1-1.3L14 3h-4l-.5 2.5a7 7 0 0 0-2.1 1.3l-2.3-1-2 3.5 2 1.5a7 7 0 0 0 0 2.4l-2 1.5 2 3.5 2.3-1a7 7 0 0 0 2.1 1.3L10 21h4l.5-2.5a7 7 0 0 0 2.1-1.3l2.3 1 2-3.5-2-1.5c.06-.4.1-.8.1-1.2Z"/></svg>',
};

export const SORT_LABELS = {
  manual: tr('手动排序'), newest: tr('最新创建'), oldest: tr('最早创建'),
  title: tr('按标题'), tabs: tr('按标签数'),
};

export const THEME_LABELS = { auto: tr('跟随系统'), light: tr('亮色'), dark: tr('暗色') };

export const NATIVE_COLOR_NAMES = {
  grey: tr('灰色'), blue: tr('蓝色'), red: tr('红色'), yellow: tr('黄色'), green: tr('绿色'),
  pink: tr('粉色'), purple: tr('紫色'), cyan: tr('青色'), orange: tr('橙色'),
};
