# 品牌图形来源与许可(CREDITS)

> 本目录存放 Tab Harbor 商店素材所用的开源图形**原件**(SVG),供 `tools/make-icons.js`
> 与 `tools/make-promo.js` 长期复用。换图标 = 换这里的 SVG + 重跑脚本,不改代码。

| 文件 | 来源 | 许可 | 修改 |
| --- | --- | --- | --- |
| `sailboat-fill.svg` | [Phosphor Icons · sailboat-fill](https://phosphoricons.com/)(unpkg `@phosphor-icons/core@2.1.1/assets/fill/sailboat-fill.svg`) | MIT | 无(按原样嵌入,由脚本重新着色/缩放) |
| `anchor.svg` | [Lucide · anchor](https://lucide.dev/icons/anchor)(unpkg `lucide-static@0.462.0/icons/anchor.svg`) | ISC | 无(备用图形,当前未用于成品) |

## 许可全文(摘录)

- **Phosphor Icons — MIT**:Permission is hereby granted, free of charge, to any person
  obtaining a copy of this software and associated documentation files (the "Software"),
  to deal in the Software without restriction…(标准 MIT 全文,见
  <https://github.com/phosphor-icons/core/blob/main/LICENSE>)
- **Lucide — ISC**:Permission to use, copy, modify, and/or distribute this software for any
  purpose with or without fee is hereby granted…(标准 ISC 全文,见
  <https://lucide.dev/license>)

两者均允许商用、修改与再分发,无需署名;本文件即为署名与溯源记录。

## 再生方法

```bash
node tools/make-icons.js    # → icons/icon16/32/48/64/128.png(帆船 + 品牌渐变圆角底)
node tools/make-promo.js    # → store-assets/promo-440.png、promo-1400.png(商店促销图)
```
