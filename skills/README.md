# skills/ — 仅供开发使用的第三方技能包

本目录存放 Google Chrome 团队为编码智能体发布的 **Modern Web Guidance** 技能,
本项目的 Chrome 扩展合规审校(v3.11.3)就是照着它的 `chrome-extensions` 技能做的。

| 项 | 值 |
| --- | --- |
| 来源 | npm 包 `modern-web-guidance` |
| 版本 | `0.0.190`(skill-version `2026_08_06-8570fe7c`,见 `chrome-extensions/skill-version.txt`) |
| 安装 | `npx modern-web-guidance@latest install --choose` → 选 `chrome-extensions` |
| 上游文档 | https://developer.chrome.com/docs/extensions/ai/build-with-ai |
| 许可 | Apache-2.0(副本见 `LICENSE-modern-web-guidance.txt`) |

## 内容

- `chrome-extensions/SKILL.md` —— 20 条 MV3 强制规则 + 发布到 Chrome Web Store 的工作流
  (其中 Part 2 要求项目维护 `CHROMEWEBSTORE.md`,见仓库根目录)
- `chrome-extensions/references/extensions/` —— 19 篇 API 参考(service worker 生命周期、
  消息传递、storage、权限、omnibox、side panel、popup、右键菜单、图标、CSP 等)
- `chrome-extensions/references/webstore/` —— 4 篇发布参考(`CHROMEWEBSTORE.md` 模板、
  隐私政策指引、上架前审查清单、商店文案规范)

## 注意

- **不参与打包**:`tools/pack.js` 用显式白名单,只装运行时目录,本目录不会进入商店包。
- 这是上游内容,请勿就地修改;升级请重新 `npx modern-web-guidance@latest install` 覆盖。
- 审校结论已落进项目文档:实现层的偏差修在代码里,结论记录在 `ARCHITECTURE.md` 第 4 节
  与仓库根的 `CHROMEWEBSTORE.md`。
