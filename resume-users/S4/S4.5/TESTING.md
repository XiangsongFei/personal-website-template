# 本地测试与真实 Chromium 证据

隔离运行时使用合成身份与合成文本。截图中的项目、技能和奖项为验收示例。

| 检查 | 结果 |
| --- | --- |
| TypeScript 和 Vinext Build | 通过 |
| S4.5 定向测试 | 35/35 |
| Users 全量回归 | 171/171，含匿名、会话失效、S2 账户和关闭的业务路由 |
| S3 离线回归 | Node 767/767，Python 110/110，包含隔离运行时、SQL 源与 ACL 检查 |
| S4.5 三模块 Chromium | 308 项断言，54 组尺寸，中英文 Methods 独立排序、父子稳定 ID、第二条记录的标签、技能预设和自定义、年份、长文本、取消、预览和响应布局 |
| Profile、Introduction、Education、Experience 浏览器回归 | 218 项断言、36 组尺寸 |
| S4.4 对照 | 28 组认证与账户路由样式、8 组工作区几何测量完全一致 |
| 离开保护 | Chromium 出现原生离开提醒，保留当前页时本地条目仍存在 |
| 安全专项 | 协议与凭据过滤、文字按原样显示、预览无外部和业务请求、登录保护及退出 |

适用命令在 Users 目录下运行，包含 `npm run typecheck`、`npm run build`、`node --test tests/*.test.mjs` 和 `npm run test:s3`。浏览器记录见 [browser-checks.json](evidence/browser-checks.json)，截图尺寸与校验值见 [SHA256SUMS.json](evidence/SHA256SUMS.json)。

| 窗口宽度 | 工作区实测 |
| ---: | --- |
| 1440px | 513px 编辑 / 627px 预览 |
| 1280px | 441px 编辑 / 539px 预览 |
| 1175px | 393.75px 编辑 / 481.25px 预览 |
| 1174、1024、900、768、390、320px | 原有单栏切换，输入和滚动位置保留 |

## 截图

| 验收场景 | 文件 |
| --- | --- |
| Projects 桌面双栏 | [中文](evidence/projects-zh-desktop.png) · [English](evidence/projects-en-desktop.png) |
| Methods 独立列表 | [中文](evidence/methods-zh.png) · [English](evidence/methods-en.png) |
| 多项目顺序 | [移动前](evidence/projects-order-before.png) · [移动后](evidence/projects-order-after.png) |
| Skills 类别 | [预设](evidence/skills-preset.png) · [Custom](evidence/skills-custom.png) |
| Awards 桌面 | [中文](evidence/awards-zh-desktop.png) · [English](evidence/awards-en-desktop.png) |
| 完整网站自动定位 | [Projects](evidence/projects-auto-location.png) · [Skills](evidence/skills-auto-location.png) · [Awards](evidence/awards-auto-location.png) |
| 窄屏 | [编辑](evidence/narrow-edit.png) · [完整预览](evidence/narrow-preview.png) |
| 手机 | [中文](evidence/mobile-zh.png) · [English](evidence/mobile-en.png) |
| 旧工作区对照 | [S4.4 Education](evidence/s4.4-education-baseline.png) · [S4.5 Education](evidence/s4.5-education-regression.png) |

## 本地专项审查

检查从 S4.4 HEAD 开始的源码差异，核对应用作用域、导航与预览、本地身份与位置、每语言映射、仅文字的链接投射、非持久化状态和测试证据。发现多条折叠记录共享项目链接或技能类别控件 ID，已改为由 React 前缀与每条记录的稳定 ID 组成。最终构建和三模块浏览器验证已复查第二条记录的链接和类别标签。检查 Git 空白错误和既有工作区清单，未发现待修复的问题。本地专项审查与 GitHub Required CI、官方 Codex Review 各自记录。
