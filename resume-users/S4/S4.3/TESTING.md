# S4.3 测试及视觉对比

| 检查 | 结果 |
| --- | --- |
| TypeScript / Vinext Build | PASS / PASS |
| 编辑器、Dashboard、网站和账户定向回归 | 23/23 |
| 完整 Users Workers 套件 | 159/159 |
| S3 离线 Node / Python | 767/767、110/110 |
| Chromium | 71 项脚本断言及一次实际离开提醒 |
| Git diff 及证据哈希 | PASS |

使用已有 Node 24.22.1 和锁定依赖。Users 构建后分别运行 `node --test tests/*.test.mjs` 和 `npm run test:s3`。S3 离线测试结论适用于本地工作，真实保存与发布仍为 REAL_NOT_RUN。

## 安全与交互

单元和实际 Worker 测试覆盖双语内容、取消范围、20,000 UTF-16 单元、非法文本、匿名 HEAD/RSC、已认证私有响应、会话撤销、身份读取错误、旁路 API 保持关闭和编辑路由的非读取方法限制。原 S2 会话、Worker、API、Cookie、Host 和 Origin 检查使用基线实现。

真实 Chromium 通过现有 S2 合成账号打开工作区。验证 1440、1280、1024、900、768、390、320px 的中英布局、模块入口、全站章节、单栏切换保留表单实例和滚动位置、自动定位、输入时不重定位、手动浏览、语言独立、取消的模块范围、移动导航键盘操作、离开提醒，以及退出后拦截。离开提醒通过浏览器实际出现的 `beforeunload` 对话框核实，关闭弹窗后继续验证未退出和取消修改。编辑流程记录为零外部和业务请求、零未捕获 JS 异常。

## 对照 S4.1

从 `e95e9616c0dddb25f69a46a82b123ad4edc43f48` 导出和构建基线，在相同本地 Host 及 Chromium 下执行。证据包含 S4.1 原始 Dashboard 和 S4.3 Overview 与 Profile。

- Sidebar、品牌、Header、移动菜单、Header 内语言选择和账户入口的测量值在中英两语、1440/390px 下等同。四组与全部条目文本顺序相同。允许的变化包括新增两个可点模块、当前项高亮、位置导航值及可用性说明文字。
- 账户、改密、登录、注册、邮箱验证、忘记及重置密码在中英两语、1440/390px 下共 28 组测量一致。测试选择了标题、Header、品牌、语言选择及表单控件的几何尺寸和计算样式。
- S4.2 网站界面及既有 Overview 的 Worker 测试通过。Dashboard 内容可用性的文案反映本地编辑已开放，实际保存待验收。未改两页原有布局。

## 截图

| 场景 | 文件 |
| --- | --- |
| S4.1 Dashboard / 本轮 Dashboard 对照 | [S4.1](evidence/overview-s41-compare.png) · [S4.3](evidence/overview-s43-compare.png) |
| Profile 中文桌面双栏 | [Profile](evidence/profile-zh-desktop.png) |
| Introduction 中文 / 英文桌面双栏 | [中文](evidence/introduction-zh-desktop.png) · [English](evidence/introduction-en-desktop.png) |
| 在完整预览中浏览 Experience | [体验完整预览](evidence/full-site-experience.png) |
| 1024px 单栏切换 | [编辑](evidence/narrow-edit-en.png) · [完整网站预览](evidence/narrow-preview-en.png) |
| 390px 手机 | [中文编辑](evidence/mobile-edit-zh.png) · [English edit](evidence/mobile-edit-en.png) · [中文界面预览，英文简历内容](evidence/mobile-preview-zh.png) |

截图保持 Chromium 原图。样例仅覆盖本轮可编辑字段，其他模块以全站结构中的空状态呈现。图像、检查结果及样式对照可通过 [SHA256SUMS.json](evidence/SHA256SUMS.json) 核验。
