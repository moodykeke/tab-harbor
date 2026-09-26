# tools/patches/ — 历史补丁脚本(只存档,不要直接运行)

这里的 `_p*.py` 是 v3.10–v3.11 期间用于改源码的**一次性 Python 补丁脚本**。
它们的形式一律是:

```python
s = io.open('background.js', encoding='utf-8').read()
old = """..."""
new = """..."""
assert old in s, '某处锚点'
s = s.replace(old, new, 1)
io.open('background.js', 'w', encoding='utf-8', newline='\n').write(s)
```

## 为什么要留档

在 `git init`(2026-09,v3.11.3)之前,**这些脚本是本项目唯一的变更历史** ——
没有版本控制,改动的"谁、何时、为什么"只存在于脚本里,所以它们有史料价值,不能删。

## 为什么不要直接运行

1. **相对路径失效**:脚本假设工作目录是仓库根(直接写 `'background.js'`),
   现在它们在 `tools/patches/`,直接跑会 `FileNotFoundError` 或改错文件。
2. **锚点已过期**:脚本靠 `assert old in s` 定位,代码此后已演进,绝大多数锚点不再匹配;
   少数可能**部分匹配而误改**——这正是 v3.11.2 埋下 `events.js` 漏 import 事故的机制
   (见 `_p61.py`:它重写了 import 行,却没保留 `persistAndRenderSoon` 符号)。
3. **已被取代**:从 v3.11.3 起,变更历史由 git 承担。

需要复查某次改动时,请用 `git log -p` / `git show`;需要理解某个脚本做了什么,直接阅读即可。
