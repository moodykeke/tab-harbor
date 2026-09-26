# ADR-001:写入模型 —— 按集合分键存储

- **状态**:已采纳(Accepted)。推翻窗口:分键迁移合入主线之前 —— 那之前推翻只花一次会议,之后推翻要付一次数据迁移。
- **日期 / 基线**:2026-09-26,基于 `fe84ace`(v3.11.3 接线收口)。
- **决策人**:开发侧,依 `DEV-HANDBOOK.md` §5 决策 1 的授权范围产出;负责人可否决,否决理由请回写本文件。
- **关联**:`DEV-HANDBOOK.md` §5 决策 1、§6 WP-1.1;`ARCHITECTURE.md`「v4.0 的硬前置:写入模型必须先拍板」。

---

## 1. 问题

今天所有数据住在单个 `chrome.storage.local` 键 `bgtData` 里,**每次落盘都是全库 blob 重写**,且多个上下文各持一份内存快照、各自整包覆盖。写拓扑(全部为代码事实):

| 写入方 | 方式 | 位置 |
| --- | --- | --- |
| manager 页 | 持有 `state.data` 快照,`persist()` 整包写,调用点数十处 | `manager/modules/core.js:109` |
| popup | 用自己早先读到的快照 load→改→整包写 | `popup/popup.js:138,142` |
| SW | 仅 `renameGroup` / `renameWorkspace` 走 `mutate()` 串行队列 + 读改写 | `background.js:656,665` |
| 串行化 | `mutate()` 的写链**只在单个上下文内有效**;跨上下文靠 `onChanged` 回声令牌过滤,无合并 | `shared/store.js:238` |
| 落盘 | `persist()` = `normalizeData(整包)` + 单键 `set` | `shared/store.js:244` |

v3.12 的项目内 checkpoint 时间线、v4.0 的被动 checkpoint 与 Delta 历史,设计目标都是**成倍放大写频次与体量**,且 records 随时间单调增长。在这条写入路径上继续叠加,每一次放大的成本都是「全库体量 × 写频次」。

## 2. 实测证据

方法:与 `test/perf.js` 同构的合成库(120 组 / 1440 标签 / 300 记录 / 20 标签每记录),Node 22.9,序列化耗时取 20 轮最小值。手册 §3 的官方写路径基线(0.79MB / 2.9ms 归一化 + 35.2ms 序列化克隆)为同形状、更短字符串的数据集,与本测比例一致。

| 集合 | 体量 | 占整包 | 单独序列化 | 典型写入方 |
| --- | --- | --- | --- | --- |
| `records` | 811.1 KB | **78.1%** | 8.0ms | 每日收工追加 1 次 |
| `groups` | 226.9 KB | 21.8% | 2.3ms | 改名/置顶/拖拽/归档,manager 高频 |
| `workspaces` | 0.7 KB | 0.1% | <0.1ms | 低频 |
| `settings` | ~0 | ~0 | <0.1ms | 低频 |
| **整包** | **1038.7 KB** | 100% | 12.1ms | —— 今天所有写入的实际成本 |

两个直接推论:

- manager 最高频的写(改一个分组标题、拖一个标签)**只动 groups**,却每次白付 78% 的 records 序列化与写入;
- 每日收工**只追加 records**,却每次重写全部 groups。

另有两项结构事实影响决策:

- `chrome.storage.local.set({ a, b, … })` **多键单调用是单事务** —— 分键不必牺牲跨集合原子性;
- **mock 层已有偏差**:`shared/mock-chrome.js:290` 的 `set()` 只认 `obj.bgtData`,其余键被静默丢弃。这与本决策无关也违反规矩 10(同口径),分键迁移必须一并修正。

## 3. 选项

| 维度 | A · 按集合分键 | B · blob + 写入预算 |
| --- | --- | --- |
| 高频小写的成本 | 只付被触集合(改名 2.3ms / 227KB) | 永远付整包(12.1ms / 1039KB,且随历史增长) |
| 跨集合原子性 | 多键单次 `set()` 保持 | 天然具备 |
| 配额(manifest 已声明 `unlimitedStorage`,无硬上限) | 消除每笔写随全库增长的放大 | 每笔写的体量与耗时仍随单键体积无界增长(Delta 历史下持续恶化) |
| 对 WP-5.1(Delta 历史) | 承载:records 独立增长、独立淘汰 | 阻塞:必须拒绝或降级 |
| 对决策 2(Single Writer) | 缩小丢更新爆炸半径(按集合隔离) | 无改善 |
| 迁移成本 | 一次性(§6,先例 v1→v2) | 零 |
| 失败模式 | 迁移缺陷(有留底 + 回滚) | 预算被功能需求蚕食,事后仍要回到 A |

## 4. 决策

**选 A:按集合分键。** 并附加一条硬约束:

> **跨集合的一致性写必须在同一次 `chrome.storage.local.set()` 调用里**(迁移、恢复、导入都属于此类)。分键的收益来自"只写被触集合",原子性来自"多键单调用",两者都要,缺一即退回 blob 的缺点。

## 5. 键结构(v3)

| 键 | 内容 | 形状 |
| --- | --- | --- |
| `bgtMeta` | `{ schemaVersion: 3, settings, updatedAt }` | 非集合态 + 回声令牌 |
| `bgtGroups` | `[Group]` | `normalizeGroup` 输出,不变 |
| `bgtWorkspaces` | `[Workspace]` | 不变 |
| `bgtRecords` | `[Record]` | 不变;滚动窗口仍由读取端 `slice(-RECORDS_MAX)` 保证 |

接口形状刻意保持两条不变,把改动面压到最小:

- **读取端零改动**:`load()` 一次 `get` 四键 → 组装 → `normalizeData()`。合并视图的形状、所有纯函数、备份、指纹、渲染层全部照旧。
- **回声令牌协议零改动**:跨上下文过滤仍比对单一 `updatedAt`,只是它搬家到 `bgtMeta`。
- **写入端是唯一改动**:`persist(data, { collections })` 只写被触集合 + `bgtMeta`,单次 `set()`。

## 6. 迁移方案(一次性、原子、留底)

1. `load()` 探测:`bgtMeta.schemaVersion === 3` 走新路径;否则若存在旧 `bgtData` → 迁移。
2. 迁移照抄 v1→v2 的先例(`shared/store.js:197-211`):先把旧值存 `bgtData_v2_backup` 留底,再**单次 `set()` 写入全部四个新键**,成功后 `remove('bgtData')`。
3. 备份兼容:`makeFullBackup` 消费合并视图,负载格式不变;旧 v2 备份文件恢复时走同一条 `normalizeData` → 分键写入,不需要版本分支。`stateFingerprint` 输入不变。
4. mock 同口径:`mock-chrome.js` 的 `set()` 改为逐键通用写入、`remove()` 补齐 —— 消除 §2 末尾列出的既有偏差。
5. 回滚:`bgtData_v2_backup` + 本地/云端备份均未动,回滚即恢复旧键。

## 7. 被否决的 B —— 完整理由(否决即终审,复提需新证据)

- **预算对路线图不成立**:被动 checkpoint 的 dirty 检测要求高频写,每次都付 78% 的 records 税;预算要么挡住 v4.0 主线,要么被蚕食到名存实亡。
- **放大无界**:blob 下单次写成本 = f(全库体量),Delta 历史让体量单调增长 —— B 的成本曲线随时间恶化,A 的与被触集合成正比。
- **方向相反**:B 的产出物是一份"拒绝清单"(哪些功能不做),A 的产出物是一条承载路径。本项目当前阶段的瓶颈是出口与蒸馏(手册附录),不该用架构决策预先否决它们。
- B 的唯一优势(零迁移)是一次性成本,换来的是永久税。

## 8. 后果与代价(诚实清单)

- 改动面:`shared/store.js`(`load`/`persist`/迁移/mock 引用)、`shared/mock-chrome.js`(存储 shim)、`manager/modules/core.js` 与 `popup/popup.js` 的 `persist` 调用点(签名加参,默认全量)、测试夹具。
- `normalizeData` 从"读写共用入口"收敛为"读取端合并器";`persist` 不再整包归一化 —— 这是行为差异,迁移 WP 必须带证伪断言(见 §9)。
- 多上下文丢更新**只缩小不消除**(按集合隔离了爆炸半径):popup 的 groups 快照覆盖仍可能丢 manager 并发改动。WP-1.2 Single Writer 仍必须做,且应在分键落地**之后**做 —— SW 端点按最终键形状写一次,不写两遍。
- manifest 已声明 `unlimitedStorage`(无硬配额)——**但配额不是放大器,写路径成本才是**:序列化与克隆耗时随单键体量线性增长,分键消除的是"每笔写都付全库成本",不是体积本身。WP-5.1 的 Delta 设计仍需自带淘汰策略(`RECORDS_MAX` 只对 records 滚动窗口)。

## 9. 迁移 WP 的验收(在手册 §8 六条之外追加)

1. **迁移真发生**:构造旧 v2 blob,新代码 `load()` 后断言四个新键出现且 `bgtData` 已移除。
2. **分键收益可证伪**:仅触 groups 的 `persist` 断言**不产生** `bgtRecords` 键写入(mock 层可观测)。把实现改回整包写,此断言必须变红。
3. **原子性**:迁移单测中断言四个新键由单次 `set()` 写入(mock 层记录调用次数)。
4. mock 通用化后,`test/seams.js` 的 `PREVIEW_UNSUPPORTED` 豁免表**不得**为此新增条目。
