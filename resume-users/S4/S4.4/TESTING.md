# 测试与视觉证据

使用 Node 24.22.1 与仓库锁定依赖。构建后在隔离的 localhost Worker 和真实 Chromium 下使用合成 S2 身份输入合成内容。提交的证据仅含合成示例截图和断言结果。

| 检查 | 结果 |
| --- | --- |
| TypeScript、Vinext Build | PASS |
| Education 分步定向 | 17/17 |
| 最终定向 | 29/29 |
| Users 全套 | 165/165 |
| S3 离线 Node / Python | 767/767、110/110 |
| Chromium S4.4 / S4.3 | 218 / 170 项断言通过 |
| 离开提醒 | Education 单模块有改动时触发浏览器提醒，取消离开后仍保留条目 |
| 已有页面视觉回归 | 28 组账户及认证页、8 组既有工作区测量与 S4.3 一致 |

浏览器检查包括 1440、1280、1175、1174、1024、900、768、390、320px，双语和 16px 字号下两种模块无横向溢出。1440px 列宽实测 513/627px，1280px 为 441/539px。1175px 位于双栏阈值，1174px 进入单栏。所有语言和模块切换保持各自输入。覆盖五类 Education、空分类、暑期专属字段往返、Custom 名称、Experience 两语五字段、字面特殊字符及长文本、添加、上下移动、顺序与 ID、删除确认、单模块取消、完整站点、独立滚动及隐藏预览初开定位。S4.3 Profile/Introduction 的页面检查重新运行。

Worker 回归覆盖匿名及旧会话、到期与会话清理、Auth 503/429、private/no-store、未开放业务接口、账户与站点页面。浏览器流程验证匿名、退出后拦截以及零业务/外部请求。官方审查与 Required CI 单独记录。

首轮 Chromium 发现教育下拉框的无障碍名称包含选项，已改为显式标签关联并对齐控件。复跑验证隐藏预览在布局观察器完成定位后正确对齐。最终截图、断言和测量来自同一构建。

| 场景 | 截图 |
| --- | --- |
| Education 中英双栏 | [中文](evidence/education-zh-desktop.png) · [English](evidence/education-en-desktop.png) |
| Summer School | [课程名称、描述与预览](evidence/summer-school-editor.png) |
| Experience 中英双栏 | [中文](evidence/experience-zh-desktop.png) · [English](evidence/experience-en-desktop.png) |
| 多条记录移动 | [移动前](evidence/education-order-before.png) · [移动后](evidence/education-order-after.png) |
| 全站内自动定位 | [Education](evidence/education-auto-location.png) · [Experience 空列表](evidence/experience-auto-location.png) |
| 窄屏 1024px | [编辑](evidence/narrow-edit.png) · [完整预览](evidence/narrow-preview.png) |
| 手机 390px | [中文](evidence/mobile-zh.png) · [English](evidence/mobile-en.png) |
| 同一 Introduction 场景的外壳与比例 | [S4.3 基线](evidence/s4.3-introduction-baseline.png) · [S4.4](evidence/legacy-introduction-zh-desktop.png) |

[浏览器结果](evidence/browser-checks.json) · [SHA256](evidence/SHA256SUMS.json)
