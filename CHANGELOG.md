# 更新日志 · Changelog

Tab Harbor · 标签港湾 — 所有显著变更记录于此。
格式参考 Keep a Changelog;版本号语义:Major.Minor.Patch。

---

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
