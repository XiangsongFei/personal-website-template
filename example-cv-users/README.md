# Example CV Users

S2 普通用户账户应用，与同仓库的 `resume-admin/` 并列。独立使用 Vinext、Cloudflare Workers、Supabase Auth 和 SQLite Durable Object。目标入口为 `https://admin.example-cv.com`；旧 CMS 未来保留在独立的 `cms-admin.example-cv.com`，仍使用原项目和权限。

**S2 本地开发及五项核心真实验收已完成。尚未提交、部署或切换正式入口。** 当前发布配置保持 `USERS_MODE=disabled`。本地真实验收不能代替未来正式域名及托管 Worker/DO 验收。

## 本地启动

使用已锁定的 Node **24.13.0**，不升级依赖。进入本包，确认 `node --version`，按锁文件安装依赖后运行：

```sh
npm ci
npm run dev
```

打开 `http://localhost:8795/`。运行器先构建本包，再启动本地 workerd、SQLite DO 和无网络回退的合成 Auth；不读取 `.env`/`.dev.vars`，不连接真实 Supabase，不发送邮件。没有热更新，修改后需停止再启动。

仅使用 `example.invalid` 合成邮箱，在本机页面设置演示密码。合成验证码和预置账号用法见 `tests/auth-fixture.mjs`；它们不是任何真实用户的凭据。勿向本地演示页输入真实密码或验证码。Safari 会话检查应使用另行批准的可信 HTTPS，不能将 HTTP 回环行为当作生产 TLS 验证。

退出演示会话后，在原终端输入 `stop`，等待 `Local runtime stopped`；分别确认进程退出与对应端口释放。不按进程名批量停止其他服务。

```sh
npm run build
npm run typecheck
npm test
```

测试使用本地 workerd 与合成上游，不需要真实账户或云端资源。`npm test` 会构建并运行包含 18 秒超时和停止超时场景的测试。

## 页面

`/` → `/login`；`/register`、`/verify-email`、`/forgot-password`、`/reset-password`、`/account`、`/change-password`。API 为 `/api/account/*`，退出仅 POST。`/auth/callback` 不交换 URL 凭据，引导回数字码流程。旧 `/user/*` 不再使用，`/api/admin/v1/*` 明确拒绝。

账户页只提供本人账户状态及 S2 安全操作；不读取旧 CMS 简历资料，不包含 S3 多租户、编辑器或 AI 功能。

## 文档与版本

- [架构与复用边界](docs/ARCHITECTURE.md)
- [配置及安全边界](docs/CONFIGURATION.md)
- [本地测试与可信 HTTPS](docs/TESTING.md)
- [S2 结项、真实验收与历史 UNKNOWN](docs/S2-CLOSEOUT.md)
- [部署前清单](RELEASE-CHECKLIST.md)
- [GitHub 交付清单与本轮整理结果](docs/DELIVERY.md)

固定业务构建：`676c5c7c083f63be14c71be12dd79ccab67ec504bd7d89887bcb05ed8e29a1df`。历史真实 PASS 继续绑定当时各批工具和实际配置；本轮工具迁移的版本独立记录，不给新工具补写真实 PASS。

证书、私钥、真实账户资料、环境凭据及 `.runtime/` 原始记录不随仓库交付。HTTPS 工具只使用本包固定的 `.runtime/tls/` 材料，不导入历史探针；没有证书或系统未信任时安全拒绝启动，不自动安装或放宽信任。
