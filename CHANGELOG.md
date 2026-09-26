# 更新日志 · Changelog

Tab Harbor · 标签港湾 — 所有显著变更记录于此。
格式参考 Keep a Changelog;版本号语义:Major.Minor.Patch。

---

## [3.11.4-dev] — 架构前置(Wave 1)

> 主题:手册 Wave 1 的"不新增用户可见功能"项。按 `DEV-HANDBOOK.md` §6 推进。
> 本段在发布前会持续追加;已落条目均通过全部门禁。

### Decided(写入模型 · 手册决策 1 / WP-1.1)
- **ADR-001:按集合分键存储**(`docs/ADR-001-write-model.md`)。实测依据:合成库
  (120 组/1440 标签/300 记录)中 records 占整包 **78.1%**(811KB/1039KB),而 manager
  高频写(改名/置顶/拖拽)只动 groups —— 今天每笔都在白付 78% 的 records 税。
  决策:`bgtMeta`/`bgtGroups`/`bgtWorkspaces`/`bgtRecords` 四键,跨集合写走单次
  `set()` 保原子;迁移照抄 v1→v2 先例(留底 + 原子切换)。实现(迁移 WP)另行合入,
  验收断言已写入 ADR §9
- **发现并记录 mock 层既有偏差**:`shared/mock-chrome.js` 的 `storage.local.set()` 只认
  `bgtData` 键,其余键静默丢弃(违反手册规矩 10 同口径)。修复列入迁移 WP,ADR §6.4

### Added(工程能力)
- **CI 接线(WP-1.4)**:`.github/workflows/ci.yml` —— push/PR 跑 `node tools/test-all.js`。
  推上托管平台前 dormant。perf 相对基线机制与"不要在 CI 机器上重记基线"写入文件注释
- **审核包纳入 `docs/` 目录**(决策记录随审核包分发,今后 ADR 增补无需改 pack 清单)

### Fixed(文档与代码对齐 · 手册规矩 6)
- **手册 §3 审核包数字失实**:原文"73 项 / 740.1 KB"是手册自身被装入审核包之前的旧值,
  同一 commit 内即失效。改为"以当次 `pack.js` 输出为准"的稳健写法,消除这类自指失实

---

## [3.11.3] — 接线收口(Wiring Closure)

> 主题:把"接线层"纳入门禁。本版不含新功能。
> 起因:v3.11.2 出包时四套测试 57/57 全绿,而同一个包里 5 个功能是真死的、
> 34% 的体积是测试代码、还夹带了一份内部备忘录。门禁看不见接线层,是根本原因。

### Fixed(P0 · 功能静默失效)
- **重命名从不落盘**:`manager/modules/events.js` 漏 import `send` —— 分组与工作区重命名
  只改了内存,刷新即回滚
- **工作区删标签抛异常**:同文件漏 import `persistAndRenderSoon`(上一轮把该处改为防抖写
  却未同步 import 行,属自造回归)
- **"包含全部窗口"无效**:消息路由漏传 `allWindows`,勾选后仍只存聚焦窗口
  (3.11.1 的 CHANGELOG 曾声称已修复,实际未修)
- **omnibox 泊位建议静默失效**:调用了从未注入的 `t()`,异常被 catch 吞掉
- **"替换当前窗口"退化为"合并"**:`chrome.windows.getLastFocused()` 未带 `populate: true`,
  `cur.tabs` 为 undefined,原有标签永远清不掉

### Fixed(架构一致性)
- **去重全链路统一到 URLIdentity**:`buildGroup` / `closeSavedTabs` / `mergeSimilarPair` /
  `batchMerge` / `tidyByDomain` 此前用原始 URL 字符串比较,而 `similarGroups` 用归一化键
  算相似度 —— 导致"建议合并 → 合并不掉 → 再次建议"的用户可见矛盾。统一到
  `keySet` / `dedupeTabs` / `appendNewTabs` 三个唯一入口
- **恢复文档宣称的防抖落盘**:`persistAndRenderSoon` 此前全仓只有一个调用点(即上面那个
  坏掉的),折叠/排序/主题等纯 UI 态实际都是全库重写。现按文档语义接入这些调用点
- **omnibox 监听器改为 SW 顶层注册**(MV3 纪律):此前写在 `onInstalled`/`onStartup` 回调里,
  既可能在冷启动时机缺失,又会在同一实例内重复注册导致建议出现两遍

### Fixed(按 Chrome 官方 `chrome-extensions` 技能审校 · 详见 ARCHITECTURE 第 4 节)
- **侧边栏入口在真机上点了没反应**:`sidePanel.open()` 需要用户手势,而原实现先在 SW 侧
  `await chrome.windows.getCurrent()` —— 跨 sendMessage 的手势只在那一条消息的第一个同步
  轮次内有效,await 一次即失效,异常又被 catch 吞掉。改为 windowId 由 popup 取好传参、
  `open()` 成为路由第一条语句;popup 失败时给可见提示并回退管理页,不再静默关闭
- **`minimum_chrome_version` 由 114 上调为 116**:116 才是 `chrome.sidePanel.open()` 的下限
  (已对照 Chrome 官方 sidePanel 参考核实)
- **地址栏 Enter / Alt+Enter 行为错误**:`onInputEntered` 忽略 `disposition`,三条路径都开
  前台新标签 —— Enter 不复用当前标签、Alt+Enter 抢焦点。改为按
  `currentTab` / `newForegroundTab` / `newBackgroundTab` 分支
- **地址栏无命中时下拉框空白**:补 `setDefaultSuggestion`(带 `<match>` 高亮)
- **右键菜单动作毫无反馈**(SKILL 强制规则 9):动作成功后徽章闪 ✓ 2.2s
- **右键菜单可能永远停在旧内容**:重建用的是 `setTimeout(800)` 防抖,SW 在窗口内被回收
  即丢失(service-worker.md 规则 3:计时器随 SW 消失)。改为"在飞则合并"的循环,零计时器
- **5 处 `.then()` 链**改为 async/await(store 的三个读取器与 verifyBackup、events/sidepanel 的 onChanged)
- **英文商店描述超限**:211 字符,超出 CWS 的 132 字符硬上限(改前 157 亦超)→ 压到 126
- **侧栏版本号硬编码 `v3.11.2`**:发新版本后界面继续撒谎 → 改为运行时从 manifest 读取
- **侧栏仍写着已被推翻的"数据仅存本地"** → 与全站隐私表述对齐
- **时间轴分区混乱**:工作记录与收藏分组各自带"今天/昨天"桶标签却没有分区标题,同一个
  "昨天"出现两次;且「收藏分组」标题 append 在它所标注内容**之后**。加分区标题并调整顺序

### Added(上架材料 —— 按技能 Part 2 补齐)
- **`CHROMEWEBSTORE.md`**:列表文案(中英)、单句用途、类目、9 项权限逐条理由、
  隐私数据披露表、版本历史、审查备注 —— 提交后台时可直接粘贴
- **`PRIVACY.md`**:隐私政策全文(按技能的标准政策结构);发布到公开 URL 后填入 CHROMEWEBSTORE.md
- **`store-assets/` 5 张商店截图**(1280×800 ×4 + 640×400 ×1,已逐一核验像素):
  此前一张都没有,而 CWS 要求至少 1 张。由 `tools/make-screenshots.js` 用无头 Chrome +
  Node 内置 WebSocket 直连 CDP 抓取真实预览界面,零新增依赖
- **`skills/`**:归档 Chrome 团队的 `chrome-extensions` 技能包(含来源、版本、许可说明)
- 预览演示数据补齐:此前只有 2 个分组、无工作区无记录,预览里时间轴/工作区/周报/洞察**全是空的**;
  现补成 5 分组 + 2 工作区(含多窗口)+ 5 条跨天收工记录

### Added(验证能力 —— 接缝门禁与可复现打包)
- `test/helpers/sw-env.js` + `test/sw-routes.js`:**Service Worker 运行时 harness**。
  在 `vm` 上下文中真实加载 `background.js` 与 `shared/*.js`(真实 importScripts 语义),
  内置内存版 `chrome.*`(窗口/标签世界、storage、事件监听器)与消息投递。全部 12 条消息路由
  与全部事件监听器都有断言
- `test/seams.js`:8 项静态契约 —— UI→SW 路由一致性、mock↔生产路由镜像(差异只能来自
  显式豁免表)、三个页面的 DOM id 契约
- `tools/check-globals.js`:零依赖的未声明标识符检查(漏 import 这一类 P0 的回归闸)。
  它在修复前对 v3.11.2 源码报出上述前两个缺陷
- `tools/test-all.js`:发布门禁,任一失败非零退出
- `tools/pack.js`:**可复现打包**。零依赖 ZIP 写入器(zlib deflateRaw)、显式白名单
  (散落文件天然进不来)、页面引用完整性校验、zip 内时间戳固定(源码不变则 SHA-256 不变)

### Changed
- 打包与测试口径写进文档:`node tools/pack.js` / `node tools/test-all.js`
- 隐私表述与代码事实对齐:`_locales` 商店描述与 README 不再声称"无任何网络请求",
  改为"唯一网络出口是用户自行配置的 WebDAV"(原文与自家 WebDAV 代码自相矛盾)
- `_locales/en` 的 `extName` 由 `"Tab Harbor · Tab Harbor"` 改为 `"Tab Harbor"`
- 版本号全面对齐到 3.11.3(此前 manifest 3.11.2 / README v3.5.0 / ARCHITECTURE v3.10.2 /
  提交说明 v3.11.0 且指向一个不存在的 zip 名)
- **启用 git 版本控制**;git 之前的历史补丁脚本归档到 `tools/patches/`(只读,附说明)

### 测试
- 7 套 **97** 项:`store 37` + `perf 9` + `i18n 5` + `integration 9` + `sw-routes 29` + `seams 8`(另加 lint 门禁)
- 变异验证(证明测试本身有效):换回 v3.11.2 的 `background.js` → `sw-routes` 报 5 项 FAIL;
  把 `case 'saveWorkspace':` 改名 → `seams` 报 4 项 FAIL;换回旧 `store.js` 的同一 fixture
  下 `buildGroup(dedupe:true)` 保留 3 条、修复后 1 条
- 按 Chrome 官方 `chrome-extensions` 技能审校:20 条强制规则 + 30 项 Output Checklist +
  上架前审查清单逐条对照,结论与"仍需真机确认"清单见 ARCHITECTURE 第 4 节

## [3.11.2] — 性能守卫强化

### Changed
- perf 基准升级为 best-of-3(取三次最优),消除 CI/本地 CPU 抖动导致的假失败
- 时间轴桶标签走 tr()(EN 翻译补齐);工作记录支持搜索过滤
### Fixed
- v1 裸 payload(无 manifest)在统一入口识别后 payload 为空的边角崩溃

## [3.11.1] — Trust Closure(信任闭环)

> 主题:完成外部深审的全部 P0/P1,测试体系升级为"真实业务链路断言"。本版不含新功能。

### Fixed(P0 · 来自外部深审)
- **备份验证 UI 必崩**:验证最新备份未 await 异步 verifyBackup,且只传 payload 丢失 manifest —— v2 备份被误判为旧格式。修复后传完整节点并安全渲染(textContent 替代 innerHTML)
- **WebDAV v2 备份无法恢复**:上传 `full-envelope` 信封但解析器只认 v1 `full` —— 写出/读回协议不一致。parseBackup 统一返回 `{legacy, manifest, data}`,cloudRestore 走单一验证器(哈希不匹配 → 阻断恢复)
- **本地"覆盖恢复"信任违约**:UI 声称"恢复前自动备份"但实际未创建;撤销只回滚 groups/workspaces(丢 records/settings)。改为**恢复事务**:验证 → 阻断 → 安全留底(完整 state 含哈希)→ 全量恢复 → 撤销 = 从留底完全回滚
- **跨上下文双写竞争**:重命名走后台串行端点(renameGroup/renameWorkspace),消除与 Alt+S 后台保存的竞争(Single Writer 第一步;mutate 队列此前零调用点)

### Fixed(P1)
- **多窗口收工参数丢失**:消息路由漏传 `allWindows`,勾选"包含全部窗口"仍只存聚焦窗口
- **自动归组后的关闭语义**:被规则分流走的标签现在也算"已保存"并一并关闭;saved 计数 = 剩余 + 归组
- **Record 去重工作区感知**:contextHash 纳入 workspaceId——不同项目即使标签相同也各自入账;同项目同内容才跳过
- **lastEventId 保留**:覆盖更新工作区时不再被 normalize 冲掉(URLIdentity 事件计数依赖)
- **云备份重试解耦**:本地去重不再阻断云端上传;云同步状态迁移到独立 meta(`bgtCloudMeta`:cloudSyncedFingerprint/lastCloudError)
- **备份指纹去运行态污染**:stateFingerprint 不再包含 lastCloudBackupAt 等运行字段
- **mock 与生产去重**:mock 的"仅存新增"改用 `BGTStore.filterOnlyNew`,不再复制业务逻辑
- **savedAt 统一工厂**:所有标签入账走 `makeStoredTab`(消除"添加当前标签页/右键菜单"savedAt 回退为分组创建时间的污染)
- **添加标签身份键重复检查**(manager 与右键菜单行为统一)
- **HTTP WebDAV 显式警告**(凭据明文传输提示,建议 HTTPS)
- **验证结果安全渲染**(textContent 替代 innerHTML;备份数据不可信)

### Changed
- i18n 检查升级为**穷尽式**:tr() 键 + 三个页面 HTML 文本节点/title/placeholder 全扫描 + `i18n-whitelist.json` 白名单;本轮新增 55 键,EN 全覆盖成为可证明事实

## [3.11.0] — Trust Release(信任版)

> 主题:我可以放心把工作交给它。本版不含新功能,全部投入数据可信链路与真机缺陷。

### Fixed(P0 · 信任性)
- **"仅存新增"语义反转**:后台过滤误用 `!known.has`,导致新增标签被删、已收藏标签被留。过滤逻辑提取为可测纯函数 `filterOnlyNew`,并新增端到端回归测试(旧行为断言必须返回新增项)
- **"验证备份"恒真**:`内容指纹一致` 检查带 `|| true`,永远通过。重写为 **Backup Manifest(v2 信封)+ SHA-256 payloadHash**:验证时逐项重算(可解析/来源/结构/工作区·记录·设置可读/SHA-256 一致/清单计数一致),篡改可检出(有测试);旧格式(无哈希)诚实标注"旧格式无哈希,建议重新创建备份",不参与通过判定
- **Full Backup 语义统一**:去重指纹此前漏 records/settings;本地恢复此前不含 settings 而云端恢复含。统一为 `applyFullRestore`:settings 全量还原、仅本机 WebDAV 配置保留;备份指纹覆盖全量状态

### Changed(Trust Release 其余项)
- URL 规范化全链路统一:`countRepeatedUrls` / `routeTabsByRules` / `applyRoutedGroups` 全部改用身份键(此前混用原始 URL,utm 变体同批次会重复)
- **Operation 模型与实现对齐**(消除双真相):撤销栈项即 `makeOperation` 产生的 Operation(`{type: DELETE_GROUP/…, payload, inverse: RESTORE_LIST}`),undo/redo = 执行 inverse;动作调用点传入语义类型
- **URLIdentity 事件计数**:`seenCount` = 唯一 capture 事件数(同一次收工在工作区与记录中的两份引用凭 `lastEventId` 只计 1 次),`referenceCount` = 文档引用数;×N 徽章改用真实"保存次数"
- 保存/收工失败提示透出后台具体原因(便于真机定位)
- 新增 `test/i18n.js` 完整性自动检查:EN 表覆盖全部 `tr()` 键 / `_locales` 对齐 / 静态文案抽检 / 占位符一致

### 测试
- 34 项功能断言(test-store)+ 9 项性能基准(perf)+ 4 项 i18n 完整性 —— 三套全绿

---

## [3.10.x] — 性能与真机稳定

### [3.10.2]
- 审计修复 7 项:来源链菜单空引用崩溃;本地/云端备份恢复丢失 records;智能去重范围收窄为"仅对比收藏分组";时间轴 EN 翻译缺失;时间轴记录支持搜索过滤;洞察 chips 上限 12;版本文案断链

### [3.10.1]
- **真机热修**:`saveWindow` 引用作用域外 `msg.__onlyNewKeys` 导致每次保存 ReferenceError(预览 mock 无法暴露的类别);保存/收工失败提示透出后台原因

### [3.10.0]
- 性能专项:URL 归一化 LRU 缓存(1 万条,最旧逐出);低价值状态变更防抖落盘(300ms,pagehide 兜底);列表 DocumentFragment 批量挂载;右键菜单指纹守卫;撤销栈 10 步
- 压力基线(120 组 1440 标签 + 150 记录):全量渲染 103ms / 搜索 8.8ms / 时间轴 24.4ms / 堆 25.3MB / 零错误
- 新增 `test/perf.js`(9 项基准);审计修复:全量指纹补 records/settings、创建型操作撤销精确回滚

---

## [3.9.0] — 港湾周报

- 时间轴顶部纯本地节奏摘要:本周入港 N 次 · 比上周 ±X% · 最常停泊域名
- 日期芯片"把这一天找回来":当天记录并集(身份键去重)转分组,可撤销
- 修复创建型操作(找回/快照转分组)的撤销语义:合并式 → 精确回滚

## [3.8.0] — 洞察 → 规则闭环 + 多步撤销

- 高频域名榜(按去重网址数排序)+ 一键转规则(预填跳转设置补全分组名)
- 多步撤销 `Ctrl+Z` / `Ctrl+Shift+Z`(10 步,合并式语义,不覆盖期间编辑)
- 保存 Toast 展示自动归组数量;EN 缺键补全

## [3.7.0] — 数字速泊 + 数据控制中心

- 置顶分组自动占用 1–9 号泊位:popup 数字键/点击、omnibox `harbor 2`、卡片角标三处一致
- 数据控制中心:本机 / 你的 WebDAV / 第三方服务器(从未)三行状态;**验证最新备份**;记录最近云端备份时间
- 周期校准:每日备份闹钟 12h → 6h(与文档一致)

## [3.6.0] — 工作记忆内核

- **URLIdentity**:URL 归一化(fragment/追踪参数剥离/尾斜杠/host 小写;业务 query 不合并)+ 来源链聚合(分组+工作区+记录 → 首末出现/次数/引用)
- **Record 不可变工作日志**:每次收工入账(hash 相同跳过,上限 300)
- **时间差分**:+N/−M 徽章对比上一记录
- **当时现场**:差分清单 + 全部标签 + 来源链徽章;**回到那一刻**三方式(续航恢复/完整恢复/转为分组)
- **智能去重**:保存前预检"N 个中 M 个已收藏,只存新增?"
- Operation 形状冻结(`{type, payload, inverse}`);审计修复 7 项(含本地/云端恢复丢 records)

## [3.5.0] — 多窗口工作区

- 收工可勾选"包含全部窗口"(每显示器一条,`windows[]`);开工逐窗口还原或扁平合并;卡片按窗口分组展示;删除标签双结构同步

## [3.4.0] — 双语

- 中英双语,按浏览器语言自动切换(`_locales` + 轻量字典,中文原文即键,EN 查表)

## [3.3.0] — 时间轴 + 键盘 + 引导 + 仪表

- 时间轴视图(今天/昨天/近 7 天/更早);键盘列表导航(↑↓/Enter/Del);首次引导卡;存储仪表;审计修复(合并撤销/导入字段/全归档空态/Enter 失焦/菜单竞态)

## [3.2.0] — 三层备份 + WebDAV + 自动规则

- 崩溃快照(30 分钟,3 份)/ 每日全量备份 / WebDAV 云备份(测试连接/立即备份/云端恢复)
- 保存时自动套用整理规则;相似分组建议(重叠 ≥80% 一键合并);开工三选(后台/前台/替换);恢复失败逐个容错反馈;删除确认默认关(撤销兜底)

## [3.1.0] — 工作区

- 收工 `Alt+Shift+W` 命名存盘并关标签;开工一键恢复;同名覆盖更新;popup 内联命名

## [3.0.0] — 品牌重塑

- 更名 **Tab Harbor · 标签港湾**;海洋视觉与全新帆船图标(程序化生成);omnibox 关键词 `harbor`;导出格式迁移;内部存储键保持兼容(老用户数据无缝延续)

## [2.2.0] — 重复保存统计

- 标签级 `savedAt` 记录;×N 徽章与保存历史菜单;重复统计面板

## [2.1.0] — 自动化与入口

- 崩溃快照、右键菜单存入分组、omnibox 搜索、Side Panel 常驻侧栏、批量操作、命令面板 `Ctrl+K`、原生标签组导入、按域名整理、保存时自动规则、置顶/归档、快捷键帮助

## [2.0.0] — MV3 全面重写

- Manifest V3 Service Worker;零依赖(移除 Mithril/Sortable/moment);保存选项(排除固定/当前页/重复/特殊页);恢复方式(后台/前台/新窗口/原生标签组/选择性恢复);拖拽整理;搜索;合并式撤销;导入导出;亮暗主题

## [1.1.0] — 原始版本(Better Group Tabs,2021)

- Manifest V2;基础保存/恢复/分组列表(已被本项目完全取代,数据可自动迁移)
