# 本地验证与 Chromium 截图

隔离运行时以合成身份登录，测试中的姓名、项目、内容和公开地址均为合成资料。

| 检查 | 结果 |
| --- | --- |
| TypeScript、Vinext Build | 通过 |
| 最终定向测试 | 42/42 |
| Users 全量回归 | 178/178，覆盖 S2 会话与失败状态、注册/邮箱验证/恢复、账户与密码、我的网站与关闭的业务入口 |
| S3 离线校验 | Node 767/767，Python 110/110；包含隔离运行时、SQL 源和 ACL |
| S4.6 Chromium | 315 项交互断言、54 组尺寸检查。覆盖双语 Focus/Status、固定公开导航、链接与邮箱验证、独立撤销、视图和键盘焦点 |
| S4.5 浏览器复跑 | Projects、Skills、Awards 308 项断言、54 组尺寸检查 |
| S4.4 浏览器复跑 | Profile、Introduction、Education、Experience 218 项断言、36 组尺寸检查 |
| S4.5 页面基线对照 | 28 组认证与账户页面样式和 8 组 Dashboard、我的网站几何测量一致 |
| 离开提醒 | Chromium 触发原生离开提示，留在页面后未保存的 Contact 文案仍在 |
| 预览安全 | 合成登录邮箱没有进入编辑器或预览，显式公开邮箱独立。预览没有外部或业务请求，特殊字符保持纯文本 |

在 Users 目录运行 `npm run typecheck`、`npm run build`、`node --test tests/*.test.mjs`、`npm run test:s3`。浏览器记录与截图校验见 [browser-checks.json](evidence/browser-checks.json) 和 [SHA256SUMS.json](evidence/SHA256SUMS.json)。

| 窗口 | 主工作区实测 |
| ---: | --- |
| 1440px | 513px 编辑 / 627px 预览 |
| 1280px | 441px 编辑 / 539px 预览 |
| 1175px | 393.75px 编辑 / 481.25px 预览 |
| 1174、1024、900、768、390、320px | 原有单栏切换，保留输入、预览滚动和视图控件焦点 |

## 截图

| 场景 | 证据 |
| --- | --- |
| Contact 桌面 | [中文](evidence/contact-zh-desktop.png) · [English](evidence/contact-en-desktop.png) |
| 两组 Contact 条目 | [Focus 多条记录](evidence/focus-records.png) · [三种 Status](evidence/status-types.png) |
| Links 桌面 | [中文](evidence/links-zh-desktop.png) · [English](evidence/links-en-desktop.png) · [公开邮箱、GitHub、LinkedIn](evidence/public-links-details.png) |
| 公开导航与完整网站 | [导航文字](evidence/website-navigation.png) · [Contact 实时预览](evidence/contact-full-preview.png) |
| 窄屏 | [编辑](evidence/narrow-edit.png) · [完整预览](evidence/narrow-preview.png) |
| 手机 | [中文](evidence/mobile-zh.png) · [English](evidence/mobile-en.png) |
| 既有 Dashboard 框架与 45/55 对照 | [S4.5 基线](evidence/s4.5-projects-baseline.png) · [S4.6 同场景](evidence/s4.6-projects-regression.png) |

## 本地专项自审

从 S4.5 HEAD 对照差异，检查 Contact 的两个顺序作用域、Profile 字段保留、邮箱输入数据来源、URL 和文字渲染、导航固定键、S2 保护及业务闭态。实测修正了 Status 类别控件标签可能混入选项文字的问题，改为按条目 ID 显式关联，并按控件标签复测三类状态。校验现有工作区及阶段截图，未发现需改动的上游文件。此项记录仅代表本地专项自审。独立官方审查以 GitHub 状态为准。
