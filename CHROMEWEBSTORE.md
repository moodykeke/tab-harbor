# Chrome Web Store Listing — Tab Harbor · 标签港湾

> Last Updated: 2026-09-26
> 本文件是提交 Chrome Web Store 时的唯一事实来源(列表文案 / 权限理由 / 隐私披露 / 版本历史)。
> 按 Google Chrome 团队 `chrome-extensions` 技能的要求维护(技能包见 `skills/`)。
> **本文件不得打进商店 zip** —— `tools/pack.js` 的显式白名单已排除根目录 `.md`。

---

## Store Listing

**Extension Name** [REQUIRED]

- zh_CN(默认语言):`Tab Harbor · 标签港湾`
- en:`Tab Harbor`

> 与 `manifest.json` 的 `__MSG_extName__` 一致(`_locales/*/messages.json`)。≤75 字符 ✅

**Short Description** [REQUIRED]

- zh_CN(70 字符):`标签页的避风港:一键保存与恢复分组、工作区、按域名整理、命令面板与崩溃快照。数据只存本机;可选的云端备份只上传到你自己配置的 WebDAV。`
- en(126 字符):`Save and restore tab groups & workspaces, tidy by domain. Data stays on your machine; optional backup only to your own WebDAV.`

> 与 `manifest.json` 的 `__MSG_extDesc__` 一致。CWS 硬上限 132 字符,两者均在限内 ✅
> (v3.11.3 修正:英文描述此前 211 字符,已超限)

**Detailed Description** [REQUIRED] — ≤16,000 字符

zh_CN:

```
标签会关闭,工作脉络不该消失。

Tab Harbor 把你打开的标签存成可复用的分组与工作区,随时一键还原 —— 全部数据留在你自己的电脑上。

■ 保存与恢复
· 一键保存当前窗口、或全部窗口的标签,自动跳过重复、固定标签和内部页面(可选)
· 四种恢复方式:当前窗口后台打开、前台打开、新窗口、或直接还原成 Chrome 原生标签组
· 可以只勾选其中几个标签恢复,不必整组搬回来

■ 工作区:整存整取的“工位”
· 收工:把当前窗口整体存成一个命名工作区并关掉标签,腾出一台干净的浏览器
· 多显示器:勾选“包含全部窗口”,每个窗口各存一条,开工时逐窗口还原
· 开工:新窗口还原 / 合并进当前窗口 / 替换当前窗口

■ 工作记忆:每一次收工都有记录
· 每次收工自动入账,时间轴按天排列,并显示与上一条记录的差异(+新增 / −移除)
· 点开任意一条记录即可回到当时现场:当时开了哪些标签、之后新增了什么、关掉了什么
· 三种“回到那一刻”:续航恢复(只补现在缺的)、完整恢复、转为分组收藏

■ 整理与洞察
· 按域名整理:一键把所有标签按站点重新归组,支持自定义规则(如 github.com => 代码)
· 保存时自动套用规则,新标签自动落到对应分组
· 重复保存统计:同一个网址存过几次、每次存在哪个分组,点一下就能跳过去
· 相似分组提醒:两个分组重叠超过 80% 时建议合并,一键合并
· 港湾周报:本周收工几次、比上周多还是少、最常停留的站点

■ 效率
· 数字速泊:置顶的分组占用 1–9 号泊位,弹窗里按数字键即可恢复
· 地址栏搜索:输入 harbor 加关键词直接找已保存的标签
· 命令面板 Ctrl+K、键盘导航、拖拽整理、批量合并/导出/删除
· 多步撤销 Ctrl+Z / Ctrl+Shift+Z

■ 数据与隐私
· 所有数据默认只存在你自己的电脑上
· 没有账号,没有我们的服务器,没有统计埋点,没有任何广告
· 可选的云备份只上传到你自己的网盘(WebDAV:坚果云 / Nextcloud / 群晖等),
  上传前会自动去掉你的密码;不配置就完全不联网
· 自动备份:崩溃快照保留 3 份,本地完整备份保留 7 份;你也可以随时导出 JSON 自己保管

■ 怎么开始
1. 点扩展图标 →「保存当前窗口标签」
2. 管理页会自动打开,标签已经按分组排好
3. 想腾空浏览器时点「收工」,把整窗存成工作区;下次「开工」一键还原

■ 关于权限
Tab Harbor 只申请完成上述功能必需的权限:读取标签、本地存储、定时备份、
网站图标、导入/还原原生标签组、右键菜单、侧边栏。
访问网站服务器的权限只在你填写自己的 WebDAV 地址时、针对那一个地址申请。

反馈与问题:<!-- 填写支持邮箱或 Issues 地址 -->
```

en:

```
Your tabs are temporary. Your work history shouldn't be.

Tab Harbor saves the tabs you have open as reusable groups and workspaces you can restore
with one click — with all your data staying on your own computer.

■ SAVE & RESTORE
· Save the current window, or every window at once. Duplicates, pinned tabs and internal
  pages are skipped (configurable)
· Four ways to restore: in the background, in the foreground, in a new window, or straight
  into a native Chrome tab group
· Restore only the tabs you tick, instead of the whole group

■ WORKSPACES — the whole window, saved as one unit
· Clock out: save the current window as a named workspace and close its tabs, leaving you a
  clean browser
· Multi-monitor: tick "include all windows" to keep one entry per window and restore them
  window by window
· Start work: restore into a new window, merge into the current one, or replace it

■ WORK HISTORY — every clock-out is recorded
· Each clock-out is logged automatically on a day-by-day timeline, with a diff against the
  previous entry (what was added, what was dropped)
· Open any entry to see the exact scene: what was open, what arrived later, what closed
· Three ways back: resume (open only what's missing now), full restore, or turn it into a
  saved group

■ TIDY UP & INSIGHT
· Tidy by domain: regroup all tabs by site in one click, with your own rules
  (e.g. github.com => code)
· Apply those rules automatically as you save
· Duplicate tracking: how many times a URL was saved, and which group each copy is in —
  click to jump there
· Similar-group hints: when two groups overlap by more than 80%, merge them in one click
· Weekly report: how often you clocked out, how that compares with last week, and where you
  spent the most time

■ SPEED
· Numbered berths: pinned groups take slots 1–9 — press a number in the popup to restore
· Address-bar search: type harbor plus a keyword to find a saved tab
· Command palette (Ctrl+K), keyboard navigation, drag-and-drop, batch merge/export/delete
· Multi-step undo with Ctrl+Z / Ctrl+Shift+Z

■ YOUR DATA AND PRIVACY
· Everything is stored on your own computer by default
· No account, no server of ours, no analytics, no advertising
· The optional cloud backup goes only to your own WebDAV storage (Nextcloud, Synology,
  Jianguoyun…), and your password is stripped before upload. Leave it unconfigured and
  Tab Harbor never goes online at all
· Automatic backups rotate on their own: 3 crash snapshots, 7 local full backups; you can
  also export JSON whenever you like

■ GETTING STARTED
1. Click the toolbar icon → "Save current window tabs"
2. The manager page opens with your tabs already grouped
3. When you want a clean browser, click "Clock out" to save the whole window as a
   workspace; "Start work" brings it back

■ ABOUT PERMISSIONS
Tab Harbor asks only for what the features above need: read tabs, local storage, scheduled
backups, site icons, import/restore native tab groups, the right-click menu, and the side
panel. Access to web servers is requested only for the single address you enter if you
configure your own WebDAV backup.

Feedback: <!-- support email or issues URL -->
```

**Category** [REQUIRED]

`Productivity`

**Single Purpose** [REQUIRED]

`Saves the tabs you choose as reusable groups and workspaces, and restores them later.`

**Primary Language** [REQUIRED]

`Chinese (Simplified)` — English is fully supported as a second language
(`default_locale: zh_CN`, `_locales/en` present).

---

## Graphics & Assets

| Asset | Dimensions | Status | Filename |
|-------|-----------|--------|----------|
| Store Icon [REQUIRED] | 128×128 PNG | ✅ Ready | `icons/icon128.png` |
| Screenshot 1 [REQUIRED] | 1280×800 | ✅ Ready | `store-assets/screenshot-1-groups.png` |
| Screenshot 2 [RECOMMENDED] | 1280×800 | ✅ Ready | `store-assets/screenshot-2-timeline.png` |
| Screenshot 3 [RECOMMENDED] | 1280×800 | ✅ Ready | `store-assets/screenshot-3-workspaces.png` |
| Screenshot 4 | 1280×800 | ✅ Ready | `store-assets/screenshot-4-data-control.png` |
| Screenshot 5 | 640×400 | ✅ Ready | `store-assets/screenshot-5-popup.png` |
| Small Promo Tile [RECOMMENDED] | 440×280 | ⬜ Not created | |
| Marquee Promo Tile | 1400×560 | ⬜ Not created | |

> 图标尺寸已逐个核验(16/32/48/64/128 均为真实像素尺寸,非同一张图复用)。
> 截图由 `node dev-server.js` 的预览页 + 无头 Chrome 生成,详细做法见 `store-assets/README.md`。

### Screenshot Notes

1. **groups** — 分组主页:侧栏统计(分组/标签/工作区)、两张分组卡片、每行的站点与域名。
   展示"保存下来的东西长什么样"。
2. **timeline** — 时间轴:顶部港湾周报("本周入港 N 次 · 比上周 ±X% · 最常停泊"),
   下面是按天排列的工作记录,每条带 +N/−M 差分徽章。
3. **workspaces** — 工作区:多窗口工作区卡片(标注"2 个窗口")与开工/更多开工方式入口。
4. **data control** — 设置页顶部数据控制中心:本机用量 / 你的 WebDAV / **第三方服务器:从未**,
   以及"验证最新备份"的逐项 ✓。这张直接对应隐私叙事。
5. **popup** — 工具栏弹窗:保存当前窗口(带实时标签数)、泊位条、收工入口、侧边栏入口。

> 截图取自扩展自带的预览模式(内置演示数据),界面与真实扩展一致,未做美化或虚构功能。

---

## Permissions Justification

> 提交时开发者后台会为每个权限提供独立输入框。以下为可直接粘贴的英文理由。
> 原则:说清"哪个用户可见功能需要它",不要写"功能需要"这类空话。

| Permission | Type | Justification |
|------------|------|---------------|
| `tabs` | permissions | Required to save and restore tabs. Tab Harbor must read each tab's URL and title (without this permission those fields are silently `undefined`) and must create or close the tabs it restores. This is the extension's core function. |
| `storage` | permissions | Required to store the saved groups, workspaces and work history on the user's own device. Nothing is sent anywhere; this is local-only storage. |
| `unlimitedStorage` | permissions | Keeps local backups from failing as the library grows. A heavy user accumulates up to 300 work-history entries plus 3 crash snapshots and 7 rotating full backups; the default 10 MB quota can be exceeded over time, which would silently break the automatic backup. |
| `favicon` | permissions | Displays each saved tab's site icon in the group, workspace and history lists, using Chrome's local favicon cache. No network request is made to fetch icons. |
| `alarms` | permissions | Schedules the two periodic maintenance jobs: a crash snapshot every 30 minutes and a local full backup every 6 hours. A Manifest V3 service worker cannot use `setTimeout` for this because it is shut down when idle, so nothing would ever run. |
| `tabGroups` | permissions | Two user-facing features: importing the current window's existing Chrome tab groups into Tab Harbor, and restoring a saved group back as a native Chrome tab group. |
| `contextMenus` | permissions | Adds "Save this page as a new group" and "Save into an existing group" to the page right-click menu, so a single page can be saved without opening the manager. |
| `sidePanel` | permissions | Provides the optional always-available side panel that lists saved groups next to the page you are reading. |
| `http://*/*`, `https://*/*` | host_permissions (**optional**) | Requested **per origin at runtime**, only for the single WebDAV server address the user types in when they choose to configure cloud backup — used to upload and download their backup file. No host permission is requested, and no network request is made, unless the user configures this feature. Declared as `optional_host_permissions` so the user is asked at that moment rather than at install. |

**审查提示**:`optional_host_permissions` 用的是最宽的 `http(s)://*/*` 模式,
但实际只针对用户填的那一个 origin 申请(`settings.js` 里 `new URL(url).origin + '/*'`)。
这是 WebDAV 场景的标准做法(服务器地址由用户任意填写,无法预先枚举)。

---

## Privacy & Data Use

### Data Collection

**Does the extension collect user data?** — 按 CWS 的定义("collection" = 传输离开设备):
**默认否**。所有数据只写入本机扩展存储;唯一的例外是用户**自行配置并启用**的 WebDAV 云备份,
且目的地是用户自己的服务器。

| Data Type | Collected? | Transmitted Off-Device? | Purpose | Shared with Third Parties? |
|-----------|-----------|------------------------|---------|---------------------------|
| Personally identifiable info | No | No | — | No |
| Health info | No | No | — | No |
| Financial info | No | No | — | No |
| Authentication info | Yes — WebDAV 用户名/密码(仅当用户配置云备份时) | No — 仅存本机,从不上传 | 登录用户自己的 WebDAV 服务器 | No |
| Personal communications | No | No | — | No |
| Location | No | No | — | No |
| Web history | Yes — 用户**主动保存**的标签 URL 与标题 | 仅当用户启用 WebDAV 备份,且仅发往用户自己的服务器;上传副本已剥离密码 | 保存与恢复标签 | No |
| User activity | Yes — 用户自己的分组/工作区/记录组织方式与设置 | 同上(仅随用户启用的云备份) | 还原用户的工作现场 | No |
| Website content | No | No | 扩展不读取网页内容、无内容脚本 | No |

### Data Use Certification

- [x] Data is NOT sold to third parties
- [x] Data is NOT used for purposes unrelated to the extension's core functionality
- [x] Data is NOT used for creditworthiness or lending purposes

---

## Privacy Policy

**Privacy Policy URL** [REQUIRED — 待填写]

```
<!-- 发布后填入,例如 https://<账号>.github.io/<仓库>/PRIVACY.md -->
```

> 政策全文见仓库根 `PRIVACY.md`(按技能包的"Standard Policy"结构撰写)。
> 提交前必须:① 发布到公开 URL;② 亲自访问确认不是 404(死链会被自动拒绝);
> ③ 与上面「Data Collection」表格逐项对照一致。

---

## Distribution

**Visibility**: Public
**Regions**: All regions

## Developer Info

**Publisher Name** [REQUIRED — 待填写]

**Contact Email** [REQUIRED — 待填写]
<!-- 会公开显示;必须是可收信的邮箱,Google 的整改通知发到这里 -->

**Support URL / Email** [RECOMMENDED — 待填写]

**Homepage URL** [RECOMMENDED — 待填写]

---

## Version History

| Version | Date | Changes | Status |
|---------|------|---------|--------|
| 3.14.0 | 2026-09-27 | 开工后窗口与项目自动绑定(仅本机会话,浏览器关闭即消失);绑定窗口里存的摘录自动归属该项目并在来源菜单显示项目名 | Draft |
| 3.13.0 | 2026-09-27 | 行为变更:同名收工不再静默覆盖 —— 对话框实时显示将被更新的工作区,「更新它」(默认,选择被记住)或「新建一个」(允许重名);选过后每天重复收工零提示;默认时间戳命名的主路径零变化 | Draft |
| 3.12.2 | 2026-09-27 | 修复:同名收工(内容相同)会丢失工作区事件引用导致 ×N 徽章虚高、并重置"开工于…"时间(v3.11.1 该项修复的补全);测试基建修复 | Draft |
| 3.12.1 | 2026-09-26 | 数据层:稳定性分类器(标题变化率按噪声折叠口径 / 保存意图 / 版本记号单调递进 → 稳定·版本化·动态判定,界面呈现随后续版本);URL 缓存改真 LRU(热条目不再被挤掉);README/ARCHITECTURE 与代码事实全面对齐 | Draft |
| 3.12.0 | 2026-09-26 | 出口与蒸馏·一:右键「把选中文字存为摘录」(零新权限,复用已声明的 `contextMenus`);摘录作为第四种观测来源计入网址身份索引(×N 徽章与重复洞察可见,可一键复制全文);证据层纪律:只增不改、单条 ≤500 字、滚动窗口 300 条 | Draft |
| 3.11.4 | 2026-09-26 | 架构前置:存储层按集合分键(ADR-001,旧数据首次加载自动迁移并留底,无用户可见变化);重命名等高频写不再整包重写;Single Writer 收口设置类写入;派生索引指纹记忆化;CI 门禁接线。决策记录 `docs/ADR-001-write-model.md` 随审核包分发 | Draft |
| 3.11.3 | 2026-09-26 | 修复 5 个静默失效的功能(重命名未落盘、工作区删标签报错、多窗口收工参数丢失、替换当前窗口失效、地址栏泊位建议失效);去重全链路统一;地址栏 Enter/Alt+Enter 行为修正;右键菜单动作给出反馈;侧边栏打开失败不再静默;`minimum_chrome_version` 由 114 上调至 116(`sidePanel.open()` 的真实下限);英文描述由 211 字符压到 126(超限修正);新增商店材料与隐私政策 | Draft |
| 3.11.2 | 2026-09 | 性能守卫强化(基准 best-of-3、时间轴桶标签翻译) | — |
| 3.11.1 | 2026-09 | 信任闭环:备份验证可检出篡改、WebDAV v2 信封读写一致、恢复事务(留底/回滚)、重命名收口到后台串行 | — |
| 3.11.0 | 2026-09 | Trust Release:仅存新增语义反转修复、Backup Manifest + SHA-256 真实验证、Full Backup 语义统一、URL 规范化全链路统一 | — |
| 3.10.x | 2026-09 | 性能专项(LRU 缓存、防抖落盘、DocumentFragment 批量挂载)+ 真机热修 | — |
| 3.5.0 | 2026 | 多窗口工作区 | — |
| 3.0.0 | 2026 | 更名 Tab Harbor · 标签港湾,品牌重塑,数据键保持兼容 | — |

---

## Review Notes

### Known Issues / Limitations

- **`minimum_chrome_version: 116`** —— `chrome.sidePanel.open()` 需要 116;114 会装得上但侧边栏入口不可用。
- **WebDAV 密码以明文存于本机 `chrome.storage.local`** —— 不上传、不外泄,但共享浏览器配置下不建议使用。已在隐私政策与设置页提示中说明。
- **WebDAV 备份是整包覆盖,不是增量同步** —— 单文件 `tab-harbor-backup.json`。
- **无内容脚本** —— 扩展不读取、不注入任何网页内容;所有功能基于标签元数据与用户主动保存的内容。
- **本扩展不发起任何第三方网络请求** —— 可用 DevTools Network 面板自查:不做任何操作时零请求。

### Rejection History

| Date | Reason | Fix Applied | Resubmitted |
|------|--------|-------------|-------------|
| — | 尚无 | — | — |
