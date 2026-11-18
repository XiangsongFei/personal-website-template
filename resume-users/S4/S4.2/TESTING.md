# S4.2 测试与浏览器证据

日期：2026-11-19（Asia/Shanghai）。全部使用既有 `.invalid` 合成 Auth 和隔离本地环境，没有真实站点、真实账户或生产 Secret。

## 自动化

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm run build`，完整 npm test 内再次构建 | PASS |
| 新模型 8 + 站点路由 7 + Dashboard 8 + 账户 4 专项 | 27/27 PASS |
| 完整 `npm test` Users | 155/155 PASS |
| 完整 S3 Node | 767/767 PASS |
| 完整 S3 Python | 110/110 PASS（21+8+15+24+12+14+7+4+5） |
| `git diff --check`、实际 scope 及摘要核对 | PASS |

完整测试在最终状态文案调整后重新执行，退出码为 0。日志在本地忽略目录 `.runtime/s42-{typecheck,build,targeted,full-tests}.log`；未更改依赖、锁文件或测试门槛。S3 离线通过不代表真实业务验收。

模型/适配测试覆盖显式可信空结果、坏/空/不完整回执、账户不符、拒绝/撤销、资料白名单、非法 siteId/Slug、超过单站点容量、异常收敛、引用隔离及 Slug 语法。没有把 S3 candidate 的 `{site:null}` 或网络错误转成 empty。

真实 Worker 测试覆盖未登录、子路径/编码路径/HEAD/RSC、已登录私有响应 `private, no-store` / `Vary: Cookie`、Auth 网络故障 503 与限流 429、退出/过期 Cookie、并发账户隔离、恶意 site_id/slug/state 查询、关闭的业务 API 和 405 非读取方法。既有 S2 全套 OTP、登录、密码/恢复、重放/UNKNOWN、Cookie/Session 和 Host/Origin 回归保留。

## 真实浏览器

Playwright CLI headed Chromium，实际页面 `http://localhost:8795/dashboard/website` 经过原 S2 合成身份登录；组件验收文档独立运行于 `http://127.0.0.1:8796/`。二者的证据严格区分：

- [app-browser.json](evidence/app-browser.json)：31 项检查。匿名跳转、Dashboard 导航、220px 侧栏、默认 unavailable 而非 empty、中英与 1440/900/768/390/320px、输入校验/错误焦点、Slug 修正后清除过时错误、内容/UI 语言独立、创建禁用、关闭/刷新清空、客户端站点参数无效、原账户刷新/退出及退出后私有页面阻断。零业务 API 请求，零页面 JS 异常。
- [fixtures-browser.json](evidence/fixtures-browser.json)：101 项组件检查。六状态 × 两语 × 五宽度无横向溢出；只在 ready 显示站点摘要；拒绝/撤销无引导创建；不存在公开 URL；三步选择/返回/禁用/丢弃、移动导航 Escape 与焦点、零业务/外部请求和 JS 异常。合成状态有明确 banner，此入口不是受保护业务读取或真实权限验收。

首轮截图发现修正 Slug 后旧错误仍暂存，已在局部输入状态中修正，并通过最终真实页面检查。该改动不涉及原 S2 表单。截图还区分未接入真实页面与合成的“无站点/已有站点”，避免误将后者当成真实账户事实。

## S4.1 / S2 不变证明

- 修改前保存 704 个已跟踪文件摘要；仅原 Dashboard 组件及其链接白名单测试两个既有文件变化，其余 702 个原文件字节不变。新源码/测试/材料另行 scope 核查。[source-invariants.json](evidence/source-invariants.json) 记录受保护源码摘要。
- 五个禁止修改的认证页面 × 中英 × 1440/390px，20/20 计算样式与 S4.1 完全一致。[public-styles.json](evidence/public-styles.json) 可对照 S4.1 已提交基线。
- 20 张认证页面及4张账户/密码桌面/手机截图，共24对；全部尺寸相同，20对像素完全相同。其余4对各1–18个边缘像素差异，最大单通道10/255；没有排版、文案、布局变化。没有宣称所有 PNG 字节全等，细节/坐标/哈希见 [regression.json](evidence/regression.json)。
- Dashboard CSS/Token、Root Layout、账户局部 CSS、密码表单及 S2/Worker 均未改；旧 Overview 内容保留。导航新增本阶段页面是预期变化。

## 截图与复现

提交16张未经图片编辑的真实浏览器截图，覆盖实际中英桌面/手机、三步引导、六种合成状态，以及登录/账户前后对照。文件和 SHA256 见 [evidence/](evidence/) 与 [SHA256SUMS.json](evidence/SHA256SUMS.json)。其余原始截图、脚本和完整日志保留在 `.runtime/s4.2-browser-qa/`、`.runtime/output/playwright/s4.2/`。

在 package 目录使用现有 Node24.22.1，`npm run dev` 启动实际隔离页面；使用合成用户，输入 `stop` 关闭。构建变化前需确认旧进程停止。六状态组件入口使用 `node node_modules/vite/bin/vite.js --config tests/site-ui-qa/vite.config.ts`，只绑定本机 127.0.0.1:8796。测试入口不接入生产业务，不能拿它的 state query 当正式页面能力。

## GitHub 验证限制

本地全部通过不等于官方审查或 Required CI。依赖 PR 的目标分支不是 main；现有 workflow 仅监听 main，预期不会触发 Required CI。最新实际状态须查看本步骤 PR 和最终交付报告。没有通过修改 workflow 或无关依赖绕过该限制。
