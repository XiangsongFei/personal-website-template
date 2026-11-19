# S4.6 收尾测试与截图

全部浏览器数据为隔离账号和合成资料。两套参考页通过本地渲染取公开站及旧 CMS 的版本化 JSX 和 CSS，数据使用相同的[合成简历](evidence/ui-final/synthetic-resume.json)。参考页屏蔽网络资源，省略生产数据加载、交互背景和文件。公开站线上请求超时，线上像素检验仍未完成。

| 运行项目 | 结果 |
| --- | --- |
| `npm run typecheck` / `npm run build` | 通过 |
| Users 全量测试 | 180/180，覆盖 S2 会话、Cookie、Host、Origin、no-store、退出、注册邮箱验证、恢复及账户管理 |
| S3 离线回归 | Node 767/767、Python 110/110 |
| Chromium 实际交互 | 101 项断言、九个窗口宽度。覆盖字段投射、两种内容语言、分类、排序删除、Methods、撤销、原生离开提醒、焦点、滚动、安全请求及双语阈值 |
| S4.1–S4.6 页面样式回归 | S4.6 基线的 28 组账户与认证页面和 8 组 Dashboard、「我的网站」几何结果一致 |

桌面主网格 1440px 为 513/627px，1280px 为 441/539px，1175px 为 393.75/481.25px。1174、1024、900、768、390、320px 按原条件切换单栏。测试包括空值、双短值、任一语言长值、双长值、emoji、特殊字符、URL、动态字号测量相关阈值、窗口变窄与变宽和焦点保留。原生离开提醒显示后取消离开，已输入的工作经历继续保留。详见 [浏览器断言与实测](evidence/ui-final/browser-checks.json) 和 [PNG 校验](evidence/ui-final/SHA256SUMS.json)。

## 三方视觉对照

| 真实 Chromium 截图 | 中文桌面 | English 桌面 | 中文手机 | English 手机 |
| --- | --- | --- | --- | --- |
| 公开站源码参考 | [中文](evidence/ui-final/public-desktop-zh.png) | [English](evidence/ui-final/public-desktop-en.png) | [中文](evidence/ui-final/public-mobile-zh.png) | [English](evidence/ui-final/public-mobile-en.png) |
| 旧 CMS 源码参考 | [中文](evidence/ui-final/cms-desktop-zh.png) | [English](evidence/ui-final/cms-desktop-en.png) | [中文](evidence/ui-final/cms-mobile-zh.png) | [English](evidence/ui-final/cms-mobile-en.png) |
| S4 真实预览 | [中文](evidence/ui-final/s4-desktop-zh.png) | [English](evidence/ui-final/s4-desktop-en.png) | [中文](evidence/ui-final/s4-mobile-zh.png) | [English](evidence/ui-final/s4-mobile-en.png) |

[布局、教育和工作中文](evidence/ui-final/s4-desktop-site-zh.png) · [工作与项目英文](evidence/ui-final/s4-timeline-en.png) · [联系页中文](evidence/ui-final/s4-contact-zh.png) · [联系页 English](evidence/ui-final/s4-contact-en.png)

[短标题两列](evidence/ui-final/inputs-paired.png) · [桌面长标题上下](evidence/ui-final/inputs-long-stacked.png) · [320px 上下](evidence/ui-final/inputs-mobile-stacked.png) · [Methods 两种语言](evidence/ui-final/methods-independent.png)
