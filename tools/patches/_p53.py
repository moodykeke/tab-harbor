import io, json, os, zipfile

# ============ README ============
p = 'README.md'
s = io.open(p, encoding='utf-8').read()
s = s.replace('# Tab Harbor · 标签港湾 v3.10.2', '# Tab Harbor · 标签港湾 v3.11.0(Trust Release)')
s = s.replace('- **保存前智能去重**:"17 个中 12 个已收藏,只存新增的 5 个?"',
              '- **保存前智能去重**:"17 个中 12 个已收藏,只存新增的 5 个?"(v3.11 修复语义反转并有端到端回归)')
s = s.replace('- **每日全量备份** :每 6 小时把分组 + 工作区完整存档,保留最近 7 份;设置中可一键覆盖恢复(恢复前自动再留底,可撤销)',
              '- **每日全量备份**:每 6 小时把分组+工作区+记录完整存档(Backup Manifest + SHA-256 payloadHash,篡改可检出),保留最近 7 份;一键覆盖恢复(恢复前自动留底;设置全量还原,本机 WebDAV 配置保留)')
s = s.replace('- **重复保存统计(网址级)、**相似分组建议**(重叠 ≥80% 一键合并)、**高频域名 → 一键转规则**',
              '- **重复保存统计(事件计数)**:×N = 唯一保存事件数(同一次收工的工作区+记录引用不重复计);相似分组建议(重叠 ≥80% 一键合并);高频域名 → 一键转规则')
if 'v3.11.0(Trust Release)' not in s:
    s = s.replace('# Tab Harbor · 标签港湾 v3.10.2', '# Tab Harbor · 标签港湾 v3.11.0(Trust Release)')
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('readme ok')

# ============ ARCHITECTURE.md:信任链 + 路线图对齐 ============
p = 'ARCHITECTURE.md'
s = io.open(p, encoding='utf-8').read()
s = s.replace('# Tab Harbor · 标签港湾 — 架构与功能说明(v3.10.2)',
              '# Tab Harbor · 标签港湾 — 架构与功能说明(v3.11.0 Trust Release)')

old = '| 每日全量备份 | 6 小时(启动补跑) | 7 份 | 分组+工作区+记录,可一键覆盖恢复(恢复前自动留底) |'
new = '| 每日全量备份 | 6 小时(启动补跑) | 7 份 | 分组+工作区+记录+设置;**Backup Manifest + SHA-256 payloadHash**(v2 信封,篡改可检出;v1 旧格式诚实标注"无哈希") |'
assert old in s, 'arch backup row'
s = s.replace(old, new, 1)

old = '''**验证备份**:可解析 ✓ 来源 ✓ 结构 ✓ 工作区/记录可读 ✓ —— 不只报"成功"。'''
new = '''**验证备份**(v3.11 语义):逐项重算 —— 可解析 / 来源 / 结构 / 工作区与记录与设置可读 / **SHA-256 与清单一致 / 清单计数一致**。旧格式(无哈希)诚实标注并建议重建,不参与通过判定。

**身份计数语义(v3.11)**:`seenCount` = 唯一 capture 事件数(同一次收工在工作区与记录中的两份引用,凭 `lastEventId` 只计 1 次);`referenceCount` = 文档引用数。`×N` 徽章展示 seenCount,tooltip 列出全部引用。'''
assert old in s, 'arch verify'
s = s.replace(old, new, 1)

old = '''| Operation 操作 | 一致性模型 | `{type, payload, inverse, createdAt}`(形状已冻结) | "我做过什么,如何反悔" |'''
new = '''| Operation 操作 | 一致性模型(v3.11 实现对齐:撤销栈项即 Operation,undo/redo = 执行 inverse) | `{type, payload, inverse, createdAt}` | "我做过什么,如何反悔" |'''
assert old in s, 'arch operation'
s = s.replace(old, new, 1)

# 路线图对齐(用户规划的三个版本)
old = '''### 明确不做(定位护城河)

账号与厂商云同步、团队协作、联网 AI 功能——"无网络请求、数据自持"是隐私叙事与竞争差异的地基。'''
new = '''### 明确不做(定位护城河)

账号与厂商云同步、团队协作、联网 AI 功能——"无网络请求、数据自持"是隐私叙事与竞争差异的地基。

### 版本路线(v3.11 起的产品主线)

| 版本 | 主题 | 核心判断 |
| --- | --- | --- |
| **v3.11 — Trust Release**(本版) | 我可以放心把工作交给它 | 仅存新增语义反转修复;备份 Manifest + SHA-256 真实验证;Full Backup 语义统一(含 settings/records,指纹覆盖全量);URL 规范化全链路统一;Operation 模型与实现对齐;i18n 完整性自动检查 |
| **v3.12 — Memory First** | 我打开它,是为了继续工作 | 首页从"全部分组"改为 Today/Continue;Workspace → 稳定 Project ID;项目内 checkpoint 时间线;统一搜索(当前/项目/历史/收藏);首次引导重写为"继续昨天的工作" |
| **v4.0 — Browser Time Machine** | 我随时可以回到任何工作现场 | 被动 checkpoint(dirty → 意义变化检测);Context Snapshot v2(窗口几何/活动标签/原生标签组);Delta 历史存储;历史 Compare;从历史继续/分叉;智能 context resume |

**四根护城河**:Local-first Memory · Temporal Context · Context Recovery · Trust Architecture。
**开发决策标准**:任何新功能,如果不能让用户更容易"放心关闭、快速找回、无痛续上",就不应该进入核心层。'''
assert old in s, 'arch roadmap'
s = s.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('arch ok')

# ============ manifest 3.11.0 + 版本文案 ============
p = 'manifest.json'
m = json.load(io.open(p, encoding='utf-8'))
m['version'] = '3.11.0'
io.open(p, 'w', encoding='utf-8', newline='\n').write(json.dumps(m, ensure_ascii=False, indent=2) + '\n')

p = 'manager/manager.html'
s = io.open(p, encoding='utf-8').read()
s = s.replace('Tab Harbor v3.10.2 · 数据仅存本地', 'Tab Harbor v3.11.0 · 数据仅存本地')
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)

p = 'shared/i18n.js'
s = io.open(p, encoding='utf-8').read()
s = s.replace("'Tab Harbor v3.10.2 · 数据仅存本地': 'Tab Harbor v3.10.2 · All data stays local',",
              "'Tab Harbor v3.11.0 · 数据仅存本地': 'Tab Harbor v3.11.0 · All data stays local',")
s = s.replace("'v3.10.2 · 数据仅存本地': 'v3.10.2 · All data stays local',",
              "'v3.11.0 · 数据仅存本地': 'v3.11.0 · All data stays local',")
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('version ok')

# ============ 出包 v3.11.0 ============
EXCLUDE = {'dev-server.js', 'README.md', 'ARCHITECTURE.md'}
EXCLUDE_DIRS = {'test', 'tools'}
SHARED_KEEP = {'store.js', 'i18n.js', 'mock-chrome.js'}
root = os.getcwd()
parent = os.path.dirname(root)
ship = []
for dirpath, dirnames, filenames in os.walk(root):
    rel = os.path.relpath(dirpath, root)
    if rel == '.':
        dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIRS]
        filenames[:] = [f for f in filenames if not (f in EXCLUDE or f.startswith('_'))]
    else:
        top = rel.split(os.sep)[0]
        if top == 'shared':
            filenames[:] = [f for f in filenames if f in SHARED_KEEP]
    for f in filenames:
        full = os.path.join(dirpath, f)
        ship.append((os.path.relpath(full, root).replace(os.sep, '/'), full))
ship.sort()
zip_path = os.path.join(parent, 'tab-harbor-v3.11.0-cws.zip')
with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for relpath, full in ship:
        z.write(full, relpath)
with zipfile.ZipFile(zip_path) as z:
    assert z.testzip() is None and 'manifest.json' in z.namelist()
oldzip = os.path.join(parent, 'tab-harbor-v3.10.2-cws.zip')
if os.path.exists(oldzip):
    try: os.remove(oldzip)
    except OSError: pass
print('v3.11.0 zip:', round(os.path.getsize(zip_path) / 1024, 1), 'KB')
