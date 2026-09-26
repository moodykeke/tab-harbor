# store-assets/ — Chrome Web Store 上架素材

这些图**不是画的,是抓的**:用扩展自带的预览模式(真实 HTML/CSS/JS + `mock-chrome` 演示数据)
在无头 Chrome 里渲染后截图。生成方式可复现:

```bash
node dev-server.js          # 终端 A:预览服务(127.0.0.1:8642)
node tools/make-screenshots.js   # 终端 B:抓图,输出到本目录
```

脚本用 Node 自带的 `WebSocket` 直接说 Chrome DevTools Protocol,不需要 puppeteer 之类的依赖。

## 文件

| 文件 | 尺寸 | 内容 |
| --- | --- | --- |
| `screenshot-1-groups.png` | 1280×800 | 分组主页:侧栏统计、分组卡片、每行的站点与域名 |
| `screenshot-2-timeline.png` | 1280×800 | 时间轴:港湾周报(本周入港 / 最常停泊 / 日期芯片)+「工作记录」与「收藏分组」两个分区,记录带 +N/−M 差分 |
| `screenshot-3-workspaces.png` | 1280×800 | 工作区:含多窗口工作区(卡片标注窗口数) |
| `screenshot-4-data-control.png` | 1280×800 | 设置页数据控制中心:本机用量 / 你的 WebDAV / **第三方服务器:从未** |
| `screenshot-5-popup.png` | 640×400 | 工具栏弹窗:保存当前窗口(实时标签数)、泊位条、收工、侧边栏入口 |

## CWS 要求对照

- 至少 1 张,尺寸 **1280×800** 或 **640×400** —— 本目录 5 张全部合规(已逐一核验像素)
- 商店图标 128×128 —— 用 `icons/icon128.png`(已核验为真实 128×128,非缩放复用)
- **小促销图 440×280(推荐)** —— 尚未制作,见 `CHROMEWEBSTORE.md` 的 Graphics 表
- 截图必须反映当前版本的真实界面 —— 每次 UI 有改动后请重跑上面的脚本覆盖

## 注意

- 演示数据定义在 `shared/mock-chrome.js` 的 `seed`;截图里的分组/工作区/记录都来自它。
- 这里不含任何真实用户数据。
- **不参与打包**:`tools/pack.js` 的显式白名单不会把本目录装进商店 zip
  (CWS 审查清单也要求把 `store-assets/*` 排除在包外)。
