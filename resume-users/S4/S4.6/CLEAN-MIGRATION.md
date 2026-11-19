# S4.6 干净迁移验收

来源为原 PR #47。原阶段父提交为 `365dcf8fa123f09391e4bb0792caf5ede0151e92`，原最终 HEAD 为 `48cfa9331f5add64f9e738746addb676228e892b`。
干净父提交为 `afca9c7cccbd7e5f78ac17290ae4ee2037ee3ca9`。完成业务重建后的 HEAD 为 `bed86c7abfe20ffbeea637a124b6e52e97d9313d`。本记录随后作为本阶段交付证据提交。最终分支 HEAD 和 PR 检查以 GitHub 为准。

## 树及公开信息核对

应用与测试按各源提交的阶段专属差异重新写入。与原阶段最终树相比，只有已获审的 S4.1 改密和 Dashboard 故障页四路径差异。原 #42–#47 的提交均未进入干净祖先链。

保留原合成公开预览、布局和测试证据。链接拒绝用例均属合成测试。 原证据保持原始字节。每个重建提交在提交前检查文本、JSON、PNG 和范围，使用 GitHub noreply 提交身份。新截图仅来自本地合成身份。

## 实际运行

- TypeScript 和 Build 通过。Node 24.22.1，冻结依赖。
- 本阶段定向测试 39 项通过，0 失败，0 跳过。
- Chromium 157.0.8103.79 已实际运行。[核对清单和结果](clean-migration-evidence/chromium-results.json) · [证据摘要](clean-migration-evidence/SHA256SUMS.json)
- 最终 Users 回归。182 项通过，0 项跳过。S3 Node 767 项及 Python 110 项离线回归通过
- Users npm audit。0 vulnerabilities
- Public。生产构建及 52 项测试通过
- Admin。lint、构建及 2169 项前端测试通过，27 项跳过
- S2 Chromium。登录、注册、验证 OTP、会话内改密、恢复 OTP、重置和登出后回退均通过。S4.1 429、503 和改密对比度修复同步核对

S4.6 正式 UI 冻结保持 `PARTIAL`。当前通过范围为本地合成验证，线上公开站的像素级一致性仍待核查。

独立复核在本阶段 PR 描述中绑定最终 HEAD。堆叠目标的托管 CI 和官方 Codex Review 分别以实际回执计。
发布、真实站点读取和创建、真实保存、Storage 与 AI 仍保持原闭态。S3.5 为 `HOLD`，S3.6 为 `REAL_NOT_RUN`。
