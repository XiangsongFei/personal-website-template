# 配置说明

> **2026-11-07 日期说明：** “已核对上游策略与应用预期”中的值及链接版恢复邮件描述保留为原采集时点快照，不是当前Auth全量配置。后续永久OTP迁移已有独立回读记录，本次未重新读取Supabase模板或策略。
>
> 仓库默认值、前置查询的生产绑定与后续配置核对要求见[生产配置与邮件记录](S2-PRODUCTION-CLOSEOUT-2026-11-07.md#5-生产配置邮件与回退边界)，不据旧表直接重新部署。

配置只由可信服务端绑定提供。URL 参数、客户端字段或 Cookie 不能开启受控模式、选择项目或替换上游。所有表格均不包含实际凭据。

|名称|用途/要求|
|---|---|
|USERS_MODE|默认 disabled；生产 production；合成 isolated；受控本机 controlled-real，三种工作模式的来源/项目约束独立|
|USERS_PROJECT_REF|生产和受控仅 makwjnbubmrmopjhzror；合成仅 isolated-users|
|USERS_SUPABASE_URL|目标项目精确 HTTPS URL；合成仅 https://users.auth.example.invalid|
|USERS_APP_ORIGIN|生产仅 https://admin.example-cv.com；受控仅 https://127.0.0.1:8787；合成独立回环来源|
|USERS_PUBLISHABLE_KEY|该项目 publishable key，必须由操作者在服务端安全配置；不提交实际值，不用 service-role/admin key|
|USERS_CURRENT_PASSWORD_POLICY|默认 UNVERIFIED；只读核对上游当前密码要求后才能声明 ON，不改变上游策略|
|USERS_RECOVERY_STATE|SQLite Durable Object 命名空间绑定；类 RecoveryState、迁移 users-v1；本机测试使用本机存储|
|ASSETS|本包 dist/client 静态资源绑定|

受控本机专用字段：`USERS_CONTROLLED_EXECUTOR`、`BATCH`、`BUILD`、`APPROVAL`、`EXPIRES_AT`（均带 USERS_CONTROLLED_ 前缀）及 `USERS_CONTROLLED_EGRESS` 服务绑定。必须完整绑定已批准批次、构建/配置摘要和短期限，不能从请求开启。执行器在上游调用前检查账户摘要、阶段、操作和独立额度，持久记账后才发送。超时不退额度；必要清理额度不能用于补做业务。正式配置不得包含这些本机绑定。

## 已核对上游策略与应用预期

下列是 S2 验收时点的脱敏配置事实，不保证未来没有漂移。发布前只读复核，不自动修改。

|设置|验收时值|应用预期/说明|
|---|---|---|
|注册、Email provider、确认邮箱|开启|注册后必须邮箱验码|
|密码最短长度|8|本应用新密码更严格，为12–128；现有密码登录不套用新密码下限|
|附加字符要求/泄漏保护|默认无附加字符要求/关闭|本轮未更改|
|要求当前密码|开启|普通改密提交 current_password；已真实通过|
|Secure password change|关闭|验收未安排额外重新认证邮件；若漂移需停止并重新审阅预算，不关闭安全设置|
|OTP|6位/120秒|注册与恢复共享上游期限；不是授权600秒|
|SMTP同用户间隔|60秒|应用重发同为60秒，刷新不自动重发|
|项目邮件/小时|30|不等于执行时剩余额度|
|验码、注册/登录|每IP每5分钟30次|不等于应用DO尝试窗口|
|刷新限额|每IP每5分钟150次|主动刷新真实回执与缓存读取分开|
|JWT|3600秒|未为了测试调短|
|刷新重用检测/重用窗口|开启/10秒|不等于请求超时|
|会话总时长/闲置/单会话|0 never/0 never/关闭|按验收时界面记录|
|注册邮件|数字码 Token|验证码页配套|
|恢复邮件最终状态|黑白双语 ConfirmationURL 链接|数字码入口公开启用须另批配套切换|
|Password changed|开启|仅观察正常改密自然通知，不补发|

Site URL 当时为本机开发默认地址，允许列表保留旧恢复流程规则；本批数字码 API 不传 redirectTo，不依赖链接交换。正式域名、回调及允许来源仍需独立核对，不能把历史规则直接当作发布配置。

## 本地 HTTPS 工具配置

`scripts/https/policy.json` 只含公开指纹、固定来源与Node版本/可执行文件摘要，不含个人路径、账户或钥匙串状态。现有 Node 可执行文件必须匹配已核实的相同字节与版本，检查的是当前进程 PID 对应的 process.execPath，不依据名称 node、argv0 或 process.title 放行。

材料固定为本包 `.runtime/tls/server.crt`、`server.key` 和只读链评估所需 `ca.crt`，全部忽略、不随包提供、不从环境或请求任意选择。服务器证书仅允许原绑定的非CA leaf、SAN仅127.0.0.1、serverAuth及有效期；任何不匹配均停止。不是新证书生成或安装授权。

系统工具路径 `/usr/bin/security`、`/usr/bin/sandbox-exec`、Apple Frameworks 属于macOS依赖，不是历史仓库依赖。Python工具的 `S2_VERIFIED_NODE` 是本机操作者选择执行文件的位置；执行前仍校验相同二进制摘要，不接受不同Node。
