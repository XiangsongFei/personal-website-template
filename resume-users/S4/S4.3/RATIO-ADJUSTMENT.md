# S4.3 编辑区与完整网站预览比例调整

2026-11-19（Asia/Shanghai）。基线为 PR #44 的 `d19beb4e9463017cc40aa160a02a40a02dfc917b`。应用 diff 仅包含 `app/editor.css` 中的双栏轨道分配。工作区内宽从 875px 起采用 `minmax(0, 45fr) minmax(0, 55fr)`，比例以主区内容宽度为分母。保留编辑列右侧 24px、预览列左侧 24px 和 1px 分隔线。预览仍原尺寸渲染，Profile 字段继续按原有 190px 最小宽度自动排布。

| 浏览器宽度 | 主工作区 | 调整后编辑 / 预览列 | 可见预览宽度，调整前 → 调整后 |
| --- | ---: | ---: | ---: |
| 1440px | 1140px | 513 / 627px | 488 → 602px |
| 1280px | 980px | 441 / 539px | 416 → 514px |
| 1175px | 875px | 393.75 / 481.25px | 368.75 → 456.25px |

1174px 窗口时工作区为 874px，回到单栏。1175px 窗口采用双栏，Profile 表单自动改为每行一项。1280px 时英文 Profile 最窄的字段实测为 195px，1440px 时为 231px。两栏的内边距和字号与基线一致，Profile 和 Introduction 输入控件保持 16px。

类型检查、Vinext 构建和 23/23 项定向 Worker 回归通过。使用 S2 合成身份以同一套 Chromium 场景对照 1440、1280、1175、1174、1024、900、768、390、320px。新构建通过 170 项断言，覆盖 Profile 与 Introduction 中英文、表单宽度、完整预览、模块进入定位、输入时不跳转、预览独立滚动、窄屏面板切换后的输入和滚动、移动导航及保存和 AI 的禁用状态。28 组账户和认证页、8 组 Overview 与我的网站的外壳及页面测量与基线一致。用于对照的 Overview 和 5 张窄屏视图截图逐字节一致。原始测量与校验值见 [浏览器记录](evidence/ratio/browser-widths.json) 和 [SHA256](evidence/ratio/SHA256SUMS.json)。

| 1440px Introduction | 调整前 | 调整后 |
| --- | --- | --- |
| 中文 | [55:45](evidence/ratio/before-introduction-zh-desktop.png) | [45:55](evidence/ratio/after-introduction-zh-desktop.png) |
| English | [55:45](evidence/ratio/before-introduction-en-desktop.png) | [45:55](evidence/ratio/after-introduction-en-desktop.png) |

补充提交仍交付至 [PR #44](https://github.com/XiangsongFei/personal-website-template/pull/44)，目标为 S4.2 分支。S3.5 HOLD、S3.6 REAL_NOT_RUN 仍有效。Required CI 和官方 Code Review 的最新 HEAD 状态以该 PR 为准。
