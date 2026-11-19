# S4.1 账户与安全 UI 补充

日期：2026-11-19（Asia/Shanghai）。基线 `2690a82352705413aa24f9779dd9a6f7d659960c`；沿用分支 `codex/s4-1-dashboard-foundation-20261118` 和 PR #42。应用源码仍在 `example-cv-users/`，没有迁移目录或覆盖历史工作区。

## 页面与交互

`/account` 使用 960px 内容区、品牌 Header、工作台面包屑、页面标题及细线分区。显示现有服务端身份验证后传入的邮箱、邮箱已确认及登录状态；账户标识继续通过默认折叠的原生 details 受控查看。密码管理进入原 `/change-password`；当前会话保留刷新及退出；底部返回工作台。没有设备列表、最近登录时间或虚构账户资料。

`/change-password` 使用 720px 页面内容区和最大 520px 表单，保留当前密码、新密码、确认密码、显示密码按钮、密码提示及所有反馈；新增面包屑和返回账户入口。主提交按钮继续使用深色。手机端堆叠分区和操作，保持完整的三项密码输入。

颜色延用 UI Design V1：白色背景、`#242424` 主文字、`#737373` 辅助文字、`#E8E8E8` 分割线、少量 `#688574` / `#466453`。新局部样式优先读取 Dashboard 语义 Token，提供相同值的局部 fallback，没有增加根级 Token、绿色面板、重阴影或动效。

## 最小修改与认证边界

| 文件（相对仓库根） | 修改 |
| --- | --- |
| `example-cv-users/app/_components/account-workspace.tsx` | 新增两页专用双语导航、标题、返回入口；历史缓存恢复时隐藏私有内容并重新经过服务端验证 |
| `example-cv-users/app/account-management.css` | 新增账户页标记限定的外壳宽度、Header、分区及表单局部样式 |
| `example-cv-users/app/_components/account-home.tsx` | 已验证邮箱显式展示、账户标识折叠查看、密码及当前会话分区；UI 单独标记刷新/退出的进行状态 |
| `example-cv-users/app/account/page.tsx` | 在原有服务端 ctx.user / AccountUnavailable 分支外使用局部页面容器 |
| `example-cv-users/app/change-password/page.tsx` | 使用局部容器；原 ChangePasswordForm 和错误分支保留 |
| `example-cv-users/tests/account-management-ui.test.mjs` | 四项路由、身份、导航、错误/no-store、刷新/退出集成测试 |

Root Layout、共享 AccountShell / UiLocaleProvider / users.css、Dashboard、密码表单、表单字段组件、认证 API、session、Worker、RecoveryState、密码规则、操作 ID 和重放保护均未修改。两页仍读取现有 requestContext 的已验证身份；没有客户端认证替代、身份伪造或业务 API 开口。账户操作继续使用原 sendAccountAction 及锁，不改变请求参数和错误分支；pendingAction 仅改进操作中按钮文字。

`/login`、`/register`、`/verify-email`、`/forgot-password`、`/reset-password` 的 JSX、样式、文案、交互和认证流程均未修改。新 CSS 仅由账户两页引入，以 `.account-workspace` 或包含该标记的 `.auth-screen:has(...)` 作用域限定；唯一子布局类名也只出现在账户容器内。

未调整依赖、锁文件或 CI 门槛；没有 Supabase、数据库、Owner/Test API、Secret、生产配置、Cloudflare、DNS 或流量写入。全部账户及密码操作来自现有 `.invalid` 合成 Auth 和隔离 Miniflare；离线通过不代表 S3 真实业务验收。

## 证据与后续条件

测试、样式回归和专项自审见 [ACCOUNT-SECURITY-TESTING.md](ACCOUNT-SECURITY-TESTING.md)，真实浏览器截图与可核查 JSON 位于 [account-security-evidence/](account-security-evidence/)。本轮不开发 S4.2。

本地 UI 可使用现有 Node 24.22.1：在 `example-cv-users/` 执行 `npm run build` 后 `npm run dev`，地址 `http://localhost:8795/login`，不要使用真实用户。该脚本只接入合成 Auth，无生产凭证读取或网络回退；构建产物改变后需先输入 `stop` 确认旧进程关闭，再启动，避免旧资源清单失效。浏览器截图中的邮箱是合成账户。

受控远程预览仍受既有 Host/Origin/Cookie/回调兼容条件约束，本轮没有启用 Worker Preview URL 或更改 Access。正式部署仍需解决 Required CI 安全审计和完成官方审查，并独立验证部署环境。S3.5 HOLD、S3.6 真实业务未验收、PR #40 安全阻断及 PR #41/#42 未合并状态保留。
