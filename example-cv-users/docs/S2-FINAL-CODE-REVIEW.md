# S2 最终代码审查与交付准备

审查及 P2 定向修复复核日期：2026-11-06（Asia/Shanghai）。范围：当前 remediation worktree、PR #32、已有脱敏及本地原始证据。首次审查 NO_GO 与修复前报告副本保留在本地；本修订追加修复事实，不替换历史批次结果。

## 1. 结论与授权边界

**GO_WITH_ACCEPTED_RISK：两项已确认的 P2 代码阻断已经定向修复，可以申请下一阶段 Git 交付、PR 更新及正式 Review；剩余发布风险仍须用户单独确认，当前尚未视为接受。** 该结论不批准本轮提交/推送，也不批准合并或生产启用。两项修改均在本地受控验收工具；核对导入图及业务/产物摘要后，未发现生产业务导入这些模块。本轮未发现新的明确 P0/P1 缺陷；这不是全面无漏洞保证。

现有 PR 可以继续只读代码讨论。不能把其绿色 CI 用作本地未提交工具的通过证明，也不能据此合并或部署。工具修复已完成；下一阶段仍需更新准确的交付文件清单并取得新 Head 的 CI。生产启用前，仍需用户单独决定是否接受新构建恢复成功链路的证据缺口。本报告不代用户接受该风险。

用户已经决定结束所有当前真实认证验收：不执行 R-04，不重跑 L-05。**“新构建真实成功恢复改密及Q2独立登录未取得PASS证据。”** 不删除恢复功能，不因缺少该证据修改业务逻辑。

首次审查为只读；本次按用户批准，仅修改本地授权/执行工具、对应隔离测试及此报告。未修改 app/、lib/、worker/、依赖或生产配置；未进行真实认证、发信、改密、云端配置或 Keychain 写入；未 add、commit、push、更新 PR、merge 或部署。

## 2. 当前 Git、PR 与版本

|项目|本轮核对结果|
|---|---|
|仓库|XiangsongFei/personal-website-template|
|工作分支|codex/s2-users-remediation-20261105|
|本地 HEAD / PR Head|b687ef55e9e07f41cf84b21fdcc8cd1dae1317d4|
|本地 main|e175a1517aef1cc0156c92e17e695fe1c4f840d9|
|远程 main|a0a82f30b3e5129f7a68d9e6dfe2693fb7eaa8a2|
|Merge base|a0a82f30b3e5129f7a68d9e6dfe2693fb7eaa8a2|
|相对远程 main|领先 3，落后 0；当前 remediation 分支不再有原分支落后 115 个提交的问题|
|原 S2 分支|codex/s2-users-delivery-20261105，仍为 17f99e3d9e1a42166257cc18aceb31d302d27dee|
|PR #32|[open / Draft](https://github.com/XiangsongFei/personal-website-template/pull/32)，未合并；GitHub 返回 mergeable=true|
|正式 Review|本轮读取 reviews=[]、review threads=[]；没有正式批准结论|
|暂存区|空；本轮未暂存文件|

PR 三个提交依次为原 S2 的 cherry-pick、第一轮修复 5136030888dda7d095efa84e779e5c513a1f3107、最终已推送修复 b687ef55。PR #31 未修改或关闭。

PR 相对 main 为 **106 文件：103 新增、3 修改、0 删除**。103 个文件均在本包；3 个共享 CI 文件为 `.github/workflows/pr-validation.yml`、`.github/scripts/pr-validation-gate.mjs`、`.github/scripts/pr-validation-gate.test.mjs`。未混入旧 CMS 或公站源码。PR 文件与本地已提交 HEAD 对应；以下未提交内容尚不在 PR。

|摘要|当前审查对象|
|---|---|
|当前业务|65c3afe790ece8f5616e873fd8870803d4bef0e89cdeeec528c5439a054e37fd|
|当前本地工具（平台测试修复后）|209ed8b87b44b69d57eff3403e2442cd046366d12b268cbb771745fd9466dee6|
|两项安全P2修复后工具（历史）|9f968ce70c538b84361e89d86acbc512b1f9e4af3dea7388774d443d485712c0|
|修复前审查/R-03 工具|8f69d51aac2dbabbc7798ca5713e87239e78598eb6f7f5bebd73ae859e6689a7|
|PR 已提交工具|ca13d8df89daa6a8da4bcac0b10396c6384a2a2885763ae9884d6799d3630b74|
|锁文件|c8cc8a0b96c76e8eec73b7c0eb17621b1580dc8488d93f09523f859073779057|
|现有构建产物|c1651d696bb5dc9ec3cbceb456b6ab0c0a34f3c609bc67db54a4f277c035ce48|
|Node|24.22.1，内置 undici 7.30.1|
|本机 Node 二进制 SHA-256|6f32069480ec14d52b6d7b1f3c7124cfbbc46203abf5ddf5c65b127435f3f329|
|历史五项真实 PASS 业务|676c5c7c083f63be14c71be12dd79ccab67ec504bd7d89887bcb05ed8e29a1df|

本轮重新核对文件摘要。文档不在业务/工具摘要输入内；新增本报告不重生成或改写历史构建。当前业务与 PR 的业务版本一致，工具版本不同。

## 3. 未提交文件与交付分类

首次审查前为 3 个 tracked 修改、9 个 untracked 文件；本报告随后新增。本次修复开始时完整保留这些内容，结束时为 6 个 tracked 修改、10 个 untracked 文件，共16个待审路径，暂存区仍为空。本次没有增加新的非忽略文件，也没有删除文件。以下路径相对本包。

|文件|Git 状态|分类及建议|
|---|---|---|
|scripts/controlled-real.mjs|修改|B：受控执行器；本轮已修复 F-01/F-02，待批准交付|
|scripts/controlled-https.mjs|修改|B：本机入口/协调/停止；随执行器复核|
|tests/controlled-real.test.mjs|修改|B：更新 legacy 批次拒绝断言|
|tests/registration-mini.test.mjs|修改|B：更新策略拒绝及 UNKNOWN 不重试断言|
|tests/mutation-mini.test.mjs|修改|B：更新 legacy 策略拒绝断言|
|tests/session-mini.test.mjs|修改|B：隔离测试；UNKNOWN、204、超时、ECONNRESET 与停止竞态回归已补齐|
|scripts/approval-receipt.mjs|未跟踪|B：批准回执与原子协调；未知策略已改为默认拒绝|
|scripts/approval-receipt.schema.json|未跟踪|B：回执结构；JSON schema 不能替代运行时校验|
|scripts/controlled-runtime.mjs|未跟踪|B：租约绑定及实际 API 合成预检|
|scripts/manual-dashboard-evidence.mjs|未跟踪|B：限定的人工证据检查，不是独立云端读取|
|scripts/recovery-preflight.mjs|未跟踪|B：实际 Worker/SQLite DO 合成恢复预检|
|tests/approval-receipt.test.mjs|未跟踪|B：回执正反例及并发测试|
|tests/manual-dashboard-evidence.test.mjs|未跟踪|B：人工来源、字段、哈希和期限测试|
|tests/recovery-receipt.test.mjs|未跟踪|B：恢复配置、协调和阶段测试|
|tests/run-lease.test.mjs|未跟踪|B：30 分钟租约、应用/API 兼容及到期测试|
|docs/S2-FINAL-CODE-REVIEW.md|未跟踪、本轮修订|B：脱敏审查与发布建议|

分类定义与其余文件：

- **A，正式运行必需**：现有 PR 的 app/、lib/、worker/、精确依赖与锁文件、RSC/Vite/Worker/DO 配置。生产 Worker 不导入上述本机批准工具。
- **B，开发/验收工具应交付**：上表、现有 HTTPS 身份/停止/叶证书工具及相关合成测试。不得把机器状态、真实回执或账户证据随工具交付。工具内项目/UID 摘要是范围约束，不是凭据；仍应按交付隐私策略审阅，不附真实账户资料。
- **C，仅本地保留**：`.runtime/`、真实批次候选/回执/lease、人工 Dashboard 导出、真实会话与请求日志、DO 数据库、信任快照、证书和私钥、本地环境配置、历史原始验收目录。它们不应进入 Git，不能为脱敏而删除原记录。
- **D，非交付运行材料**：dist、node_modules（含重复目录）、缓存、增量类型文件、审查临时合成脚本/日志。无需随仓库提交；本轮未删除任何此类文件。

若仅纳入现有 106 文件、9 个新工具/测试及本报告，未来清单为 116 文件；修复后的实际内容仍须重新生成逐文件 SHA 清单，不能沿用原 86 文件清单或旧工具摘要。本轮没有建立新提交候选或暂存这些文件。

## 4. 核心业务与权限审查

|范围|审查结论及依据|
|---|---|
|注册及邮箱确认|`lib/account/api.ts` 的 signup/verify 路径与 6 位 signup OTP 配套；确认身份后才建立账户状态。新构建有合成证据，真实注册 PASS 仅属于历史构建，不重跑注册。|
|密码登录/身份|服务端受控目标、邮箱及签名 claims、issuer/audience/sub/session 与 getUser 一致性检查；不使用 user_metadata 作为权限依据。L-05 提供当前构建双浏览器真实证据。|
|Session/Cookie|账户与 recovery 使用分离的 `__Host-` Cookie；Secure、HttpOnly、SameSite=Lax、Path=/，无 Domain；限制读写分块和名称。SSR 请求上下文隔离，响应 no-store/Vary Cookie。|
|续期|显式 `/api/account/refresh` 调用上游并写回更新 Cookie，后续身份使用更新会话。L-05 是主动续期，不是等待 3600 秒自然到期测试。SSR 的 Cookie 写回约束参见 [Supabase SSR 文档](https://supabase.com/docs/guides/auth/server-side/advanced-guide)。|
|定向退出|上游 scope=local；未知结果不能当作远端退出成功。F-02 是已修复的本地执行器清理问题，不否定 L-05 已取得的明确退出回执。不能声称已签发 Access Token 即刻全部失效。|
|普通改密|要求当前账户身份、已核对的当前密码策略及字段白名单；恢复授权不能替代普通改密。历史真实 PASS 保留，新构建不宣称重新取得此项真实 PASS。|
|恢复 OTP|发送后在本应用验码，type=recovery；核对恢复事件、邮箱、用户及 session。不是普通登录会话换取恢复授权。|
|恢复授权|DO 存储事务、随机授权哈希、账户/项目/用户/session 绑定；先原子领取并持久化，再调用 updateUser；失败/UNKNOWN 不退授权。|
|DO 持久状态|SQLite 参数化查询、transactionSync 与 storage.sync；以持久状态判定一次性使用及过期，不以进程 Map 作为关键授权。隔离 workerd/DO 并发与重启测试不等于真实云端攻击测试。参见 [DO SQLite 文档](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)。|
|Origin/CSRF|精确允许来源、JSON/Fetch Metadata、请求体与字段限制；安全返回路径，无任意 redirectTo。Cookie 的 SameSite 不是唯一 CSRF 防线。|
|数据隔离|账户键包含项目和规范化邮箱摘要；独立 Users Supabase、Cookie、DO 与 Worker；旧管理路由拒绝，不代理旧凭据。|
|模式隔离|`lib/config.ts:24-49` 仅可信服务端绑定能选择模式。默认 disabled；production 精确项目/HTTPS 来源；isolated 仅合成项目和回环；controlled-real 需本机来源、执行器、短期配置、egress。客户端参数不能开启。|
|部署配置|`wrangler.jsonc` 默认 disabled、CURRENT_PASSWORD_POLICY 未验证、workers_dev/preview 关闭、无正式 routes；仅声明独立 SQLite DO 迁移，不证明云端已创建。正式环境不得携带受控 egress、真实批次或测试上游。|

当前审查未发现公开前端的真实 service_role/secret、跨项目查询或客户端开启本机测试模式路径。供应链审计和模式约束不替代部署后来源、资源绑定、访问控制与缓存验收。

## 5. 恢复邮件的最终产品决定：永久六位验证码

**正式产品使用黑白双语 6 位邮箱验证码；Reset Password 正文永久采用已确认的 `{{ .Token }}` 版本。不会把每次恢复前切换、结束后恢复链接当作正式操作流程。** 这项决定尚未在云端执行。

### 5.1 代码已经适配，旧链接不是活动认证链

- `lib/account/api.ts:248` 通过 resetPasswordForEmail 触发恢复邮件，不传 redirectTo；后续 verifyOtp 使用 recovery 类型与六位 token。
- `app/_components/recovery-otp-form.tsx`、reset-password-form 和相应 API/DO 按验证码、恢复会话及一次性授权运作。OTP 120 秒、重发 60 秒、验码后授权 600 秒是三种不同期限。
- `app/auth/callback/page.tsx` 仅提示回到发起操作的浏览器输入验证码，没有交换链接 code 或 TokenHash。`worker/index.ts:24-25` 对旧 callback/reset 查询参数去除后跳转；没有旧链接自动建会话或跳过 DO 授权的路径。
- 历史 Site URL/允许回调中可能保留旧值；当前应用不依赖这些链接完成恢复。正式上线只读核对兼容性，不自动删除可能被其他流程使用的配置。

Reset Password 与 Password Changed 是不同模板：前者交付恢复凭证，后者仅在密码成功改变后提供安全通知。应保持 Password Changed 开启且保持既定黑白双语视觉，不把 OTP 填入该通知。Supabase 模板变量和模板区分见 [官方邮件模板说明](https://supabase.com/docs/guides/auth/auth-email-templates)。

### 5.2 历史材料及当前模板证据

|材料|字节数 / SHA-256|用途|
|---|---|---|
|链接版正文|6265 / e63acc29afefb1488e2ef53ce55a93a9c61078fdf09f90c38cc45e85b8ab4acf|历史备份、必要回滚，不是最终产品默认|
|主题|42 / 6693f071726efd3afcbcce5b56ffb481dbc92097ddcd4928427e648af112b977|本批主题基线|
|验证码版正文|6472 / c483a4fe0c3cdc1fd8f517fb71a153215670cc0d60361ae3b79fceda4713b79c|已核验候选；保持视觉和正文原样|
|错误聊天副本|6263 / 1f4626631431438d593a8f78f69948dec3f0a9d7f755974f364a39da7768f109|历史差异证据，禁止作为回滚基线|

6263 与 6265 的差异为按钮表格前空行和末尾换行，未发现其他文字、结构或变量变化。各副本保留，不自动规范化。R-03 最终回读的主题/正文恢复到上述链接版基线，来源为 **MANUAL_DASHBOARD_RECHECK**：用户重开 Safari Dashboard 后复制，Codex 核对收到的完整字节。不冒称 Codex 独立云端读取，也不声称证明 Supabase 底层存储字节保真。本轮没有重新读取云端模板；当前云端状态以最后回退证据为准，不作为永久切换已完成的证明。

### 5.3 一次性上线迁移方案（待单独批准）

1. 在公开启用恢复入口之前，批准一次模板迁移窗口，核对目标项目；暂停并行恢复配置操作。实际读取当时主题/完整正文并备份、计算 SHA、保存可独立执行的回滚材料。不能直接把历史哈希当成当前云端事实。
2. 核对邮件 OTP 为 6 位/120 秒、发送间隔及相关 Auth 策略；不为迁移关闭安全设置。核对批准的验证码候选完整哈希、`{{ .Token }}` 和正文；不得出现 `{{ .ConfirmationURL }}` 或 `{{ .TokenHash }}` 作为恢复交互。
3. 只永久替换 Reset Password Body，主题不动。不得修改 Password Changed、其他邮件、SMTP、会话或数据库配置。若未来另批 Management API，只允许 recovery content 字段，不创建高权限 Token。
4. 保存后重新打开远端模板，独立获取完整 Body 和 Subject；与批准文件逐字节及完整 SHA 比较。若只能人工读取，明确来源与边界；不能凭预览、按钮或保存提示认定完成。无法解释的规范化差异先停止启用。
5. 确认一致后，按另行批准的发布/验证窗口配套启用应用。成功后**保持验证码版永久运行**；不在每次用户恢复后回填链接。实际邮件或成功恢复验证均需独立批准，本轮不执行，也不自动安排 R-04。
6. 回滚必须配套：先停止新应用恢复业务进入，再恢复上线前实际备份的模板和必要配置，重新独立回读主题及正文。现有应用只有整体 USERS_MODE=disabled 安全开关，没有独立恢复开关；使用整体停用或回退到已验证的兼容版本需事先评估影响并获批。不能只恢复链接模板却继续公开仅支持 OTP 的页面。历史 6265 字节仅在确认它是该次批准回滚对象时使用。
7. 写入/回填超时保留 UNKNOWN，先只读确认实际状态，不盲目再次写入。回退无法确认时明确保留云端未解决状态，不能宣布上线收尾成功。

交付前需定向更新 `docs/CONFIGURATION.md:38`、`docs/S2-CLOSEOUT.md`、`RELEASE-CHECKLIST.md` 及当前交付说明的历史/目标用语；将“一次性永久迁移 + 回读 + 配套回滚”纳入正式上线清单。建议将已核验且无个人信息的通用 OTP HTML 作为正式模板源纳入未来文件清单，而非让上线依赖 `.runtime`。本轮只写此建议，未改这些文件或复制运行材料。历史记录中临时切换/回退的事实保持原样。

## 6. 真实验收终态与证据索引

|项目|原业务构建 676c5c7c…|新业务构建 65c3afe7…|
|---|---|---|
|注册、邮箱确认、新身份|真实 PASS|合成 PASS；未重做真实注册|
|Chrome/Safari 登录和身份|真实 PASS|L-05 真实 PASS|
|两浏览器主动续期、Cookie、退出|真实 PASS|L-05 真实 PASS|
|普通改密|真实 PASS|源码路径未改，合成覆盖；没有新的真实普通改密 PASS|
|完整恢复改密/新密码登录|真实 PASS|合成成功链路 PASS；R-03 为 PARTIAL_PASS / PASSWORD_UPDATE_REJECTED|
|真实一小时到期自动续期|NOT TESTED|NOT TESTED；主动刷新不能替代|
|托管 Worker/DO/正式域名|NOT TESTED|NOT TESTED|

证据入口（相对本包；`.runtime` 均仅本地，不进入 Git）：

|证据|路径及适用范围|
|---|---|
|旧构建脱敏真实结果|`docs/evidence/real-acceptance-summary.json`：注册、双浏览器登录/续期、普通改密、完整恢复四批，对应五项功能；保留各批工具/配置摘要|
|三轮修复与本地结果|`docs/SECURITY-REMEDIATION-ROUND3.md`、`docs/evidence/security-round3-20261105/verification.json` 与其 build-manifest；不是新构建全部真实 PASS|
|双浏览器可信 HTTPS 合成|`docs/evidence/https-session-20261106.json`；系统浏览器信任、RSC/会话兼容，非真实 Supabase|
|L-05|`.runtime/S2-USERS-REAL-L-SESSION-20261106-05/EXECUTION-RESULT.md` 及该批执行审计；当前业务、工具 0f24fe59723ccfd9e87c4fde1ea08716ace0f3c2abaad778de0206af1c9b96e9|
|R-03|`.runtime/S2-USERS-REAL-R-RECOVERY-20261106-03/EXECUTION-RESULT.md`、`execution/execution-summary.json` 与原事件、DO 观察记录；该批执行工具 8f69d51a…|
|本轮复核|`.runtime/S2-FINAL-REVIEW-20261106/`：摘要、审计、42 项定向测试、28 项 gate 测试、两个工具缺陷反例与 422 归因反例|

**L-05：PASS。** 两浏览器独立会话，真实登录、UID、主动 refresh、Cookie 写回、后续身份和定向退出及退出后拒绝访问全部通过；实际 15/36，上游无 UNKNOWN、越界或网络异常。会话、服务、端口和临时信任收尾有原始回执。不是全部 36 次额度用尽，也不是自动到期续期。

**R-03：PARTIAL_PASS / PASSWORD_UPDATE_REJECTED。** 申请/收件、recovery 验码、UID、持久授权和拒绝后状态、定向退出/模板回退及环境收尾有明确证据；唯一改密 422，没有 Q2 登录。旧原始报告“完整目标未通过/FAIL”保留，本报告追加最终部分通过分类，两者不代表改密成功。

|R-03 实际上游类别|次数/回执|
|---|---|
|恢复申请|1 / 200|
|recovery 验码|1 / 200|
|getUser|3 / 200|
|JWKS|1 / 200|
|恢复改密|1 / 422|
|定向退出|1 / 204|
|Q2 独立登录|0 / NOT EXECUTED|
|合计|8/18；身份池 4/10；没有追加业务或改密重试|
|邮件|恢复码 1，黑白双语可读；Password Changed 0；总数 1/2|

DO 持久记录 ready → attempted → rejected，授权已消费不可再次改密。源码等待持久原子领取后才 PUT；本地合成链路支持该顺序。DO 观察与 network_call 时间处于同一毫秒，精度不同，不能从日志字符串排序声称独立证明亚毫秒先后。早期该诊断被修正的记录保留；不能写成真实云端并发攻击 PASS。

### 6.1 HTTP 422 的归因边界

用户报告误把原密码当作新密码，与上游明确拒绝一致。但执行器 `scripts/controlled-real.mjs:259` 只保留 invalid_credentials，实际改密事件 errorCode=null；业务 `lib/account/api.ts:343-346` 将 same_password、weak_password、重新认证等多种已知拒绝映射为同一个 422/通用提示。

本轮实际 Worker/SQLite DO 隔离反例：合成 same_password 与 weak_password 都得到 422、resetRejected、grant=rejected（`rejection-attribution.json`）。因此现有证据不足以唯一证明上游返回 same_password。结论为“用户说明支持该解释，上游精确原因未完全归因”，既不推定业务代码故障，也不宣称已排除所有运行时影响。可在未来另批工具修复中仅记录安全错误码枚举，不记录完整响应或凭据；本轮未修改。

### 6.2 历史与收尾

- L-01 登录曾 PASS，后续 getUser 与定向退出 ECONNRESET/UNKNOWN；主动续期和 Safari 未执行，远端退出 UNKNOWN 不因本地 Cookie 清除而改变。
- L-02 网络预检中止；L-03 授权状态阻断；L-04 回执已消费、本地租约冲突 503、真实上游 0；各历史候选、授权与中止结果均不复用、不覆盖。
- R-01 浏览器能力阻断、R-02 模板基线不一致均是预检停止，不是真实业务 PASS；原注册 UNKNOWN、早期 FAIL、模板回填工具超时及最终独立回读是分别保留的结论。
- R-03 恢复会话明确退出 204、Cookie 清理、用户关闭窗口；所属 PID 消失，8787 及内部端口释放；显式临时叶证书信任撤销，证书当时仍有效且有效 SSL 返回原始 -67843；模板主题/6265 字节正文独立人工回读匹配。没有用“证书过期导致验证失败”冒充信任恢复。
- 这些是已记录的收尾，不是本轮重新操作 Keychain 或云端。原本没有 Q2 登录会话，不能声称清理了不存在的成功新会话。

## 7. 本地授权与验收工具审查

在指定 receipt 策略下，共用协调器绑定原始候选字节、工具、项目、UID、scope、证据及回执。租约目录要求当前用户/0700，O_EXCL + fsync 标记防并发/重放；claim 失败不删标记。两个入口共享进程内不可伪造的 WeakMap context，attach 一次。候选最多 12h、回执最多 60m、单次运行最多 30m、证据 60m；实际截止取适用期限最早值，并预留证书 60m 安全边界，未放宽应用 40m。

LIVE_READ 与 MANUAL_DASHBOARD_RECHECK 分开字段校验。人工策略限定当前项目、特定恢复批次、账户摘要、字段集合、两次基线和一次验证码远端交付、用户确认与时间/哈希，不自动当成所有配置已验证。USER_CONFIRMED 不能伪装 LIVE_READ。批次特定的历史白名单不应作为未来无限复用授权。

真实请求前的账户/阶段/操作/额度检查、持久记账、无凭据泄漏日志、禁止未中介外连、已花额度不退与改密不重试等机制仍在。启动器使用实际 API + 合成上游 + SQLite DO 预检，未只检查单个配置模块。

本地 receipt 是可信操作者文件，不是密码学签名的聊天批准证明；有本机同用户任意文件写权限的人处于信任边界内。文件摘要检查也不等于运行期间文件系统不可变；未来启动须避免同用户并行构建/改工具造成检查后变化，不据此宣称解决所有 TOCTOU。以下两个问题为首次审查的修复前事实，不能用该信任边界解释掉；本轮修复及新增验证见第11节。

### F-01 [P2，已修复] 未识别的授权策略降级到旧批准字段（修复前）

修复前位置：`scripts/approval-receipt.mjs:9`，`scripts/controlled-real.mjs:59-83`，`scripts/controlled-https.mjs:29-44,58-59`。

usesReceipt 只识别三个字符串；其他值返回 false，两个入口转而接受 legacy 的 APPROVED/executable/VERIFIED 字段。隔离反例保留实际恢复批次 ID、账户/项目及 manifest，改为未知 approvalPolicy 和旧式内部授权字段，可在没有 receipt 时创建执行器并 arm 恢复步骤；实际 HTTPS --check 也通过。发送边界为拒绝替身，上游真实调用 0。

影响：本机有配置写权限的操作者可绕过已承诺的一次性 receipt/来源/原子消费要求。不是客户端可触发的生产认证绕过，但属于待交付验收工具的 fail-open 约束缺陷。

最小修复建议：真实入口对未知/缺失 policy 拒绝；如保留历史兼容，只允许明确、不可误用于新批次的离线/历史范围。不能靠改批次字段关闭 receipt。两种入口均补“不认识/丢失策略仍拒绝”的实际启动器回归，不改历史候选或生产业务。

### F-02 [P2，已修复] UNKNOWN 定向退出被自动收尾再次发送（修复前）

修复前位置：`scripts/controlled-real.mjs:213-215,259-264,324-329`，`scripts/controlled-https.mjs:86-105`；`tests/session-mini.test.mjs:70-72` 修复前反而期待两次 UNKNOWN 清理调用。

隔离反例使用实际 Worker/DO 与合成上游：登录/续期后，第一次 logout 已进入替身服务器，但响应模拟 ECONNRESET 丢失，应用 503、结果 UNKNOWN；随后调用与 stop/租约结束/EOF 相同的 cleanup，退出请求从 1 变成 2。退出额度虽仍限制次数，却没有阻止同一 UNKNOWN 目标的自动重试。

影响：违背 UNKNOWN 不盲目重复规则；可能重复真实定向请求。未证明 R-03 或 L-05 实际发生该问题；其已明确 204 不受本反例改写。不是全局退出，也不是自动重试密码修改。

最小修复建议：按明确会话保存退出 in-flight/HTTP/UNKNOWN 状态；自动 cleanup 跳过已有 UNKNOWN/in-flight 目标，保留未确认结果及已用额度，仅清理其他确定目标。若将来要再次处理该目标，应单独明确授权，不能默认消耗预留。补 stop/EOF/到期无第二次发送回归，更新当前期待重复的测试。

修复前反例及结果保留在本地 `tool-guards-repro.json`，真实认证 0。首次审查的42项常规测试没有覆盖这两个反例；本轮新增回归并修正了旧的重复退出断言，见第11节。

## 8. 安全扫描与工作区保护

对 PR 106 文件、9 个本地新增工具/测试及本报告进行文本模式、Git 路径和导入/日志审阅。未发现真实密码、OTP、Cookie、JWT、service_role/secret、真实 publishable 值、私钥、原始测试邮箱/UID或运行数据库混入交付路径。合成 fixture 的键样式文本经具体调用范围核对，不是实际云端凭据；不是全局忽略真实密钥。

扫描不保证识别所有编码或所有泄漏形式。未读取本地秘密内容来“证明没有秘密”；本地安全配置仅应由忽略规则保护并在未来暂存审查排除。`.runtime`、证书/私钥、信任状态、环境文件、数据库、HAR、构建目录和 node_modules 均不在建议交付文件内。

原工作区 57 个既有 tracked 修改未触碰，CMS/公站 diff 的 SHA 与审查开始快照一致。未 reset/clean、覆盖或暂存旧项目；未操作 B1 项目、其他工作区内容或历史验收。主分支和原 S2 分支不变。

## 9. 本地验证与 GitHub CI 的适用范围

|验证|本轮结果|范围/限制|
|---|---|---|
|业务、工具、锁及现有产物摘要|一致|重新读当前文件；不是重新构建|
|精确依赖|React/DOM/RSC 19.2.9；Vite 8.1.6；Vinext 1.0.0；RSC plugin 0.5.34；CF plugin 1.66.0；Wrangler 4.154.0；Miniflare 5.20261023.1-beta；Satori 0.33.5；其 fflate 0.7.5|保留三轮锁文件修复，不装新包或 audit fix|
|完整 npm audit --json|复用首次最终审查结果：Critical/High/Moderate/Low 全0|本轮锁及依赖未变，不重新安装或重复审计；不是永远安全保证|
|npm audit --omit=dev|复用首次最终审查结果：0|锁及依赖未变；不将开发依赖风险直接忽略|
|npm ls --all --json|不完全干净：115 项 extraneous|均为被忽略 node_modules 中带重复后缀的目录；未见 canonical 缺失/invalid peer；不当作 115 个新漏洞，也不宣称依赖树干净|
|TypeScript|PASS|当前源码，关闭增量写回|
|本轮受影响模块回归|75/75 PASS，0 FAIL/0 SKIPPED|10个测试模块，包含实际API/workerd/SQLite DO、授权/人工证据/租约、各 mini 及停止工具；不与旧42或85相加|
|CI 分类/Required gate 单测|28/28 PASS|当前共享 gate 文件|
|两项工具反例|修复前复现；修复后对应拒绝/不重试回归通过|新增9项测试、修正旧断言，见第11节；无真实认证|
|422 多原因反例|符合现有映射|证明归因非唯一，不证明 R-03 当时究竟哪个原因|
|完整构建/全量 85 测试|复用匹配业务与锁的已有结果|本轮未重跑 npm ci/构建/全量85；没有修改业务或依赖，不假称本轮全量执行|

本地重复 node_modules 影响可复现性，且审计不为任意额外目录背书。下一次批准提交后的干净 CI 用 npm ci 重建；本轮未删除目录或更改锁文件以掩盖问题。

远端实际 [PR validation #107](https://github.com/XiangsongFei/personal-website-template/actions/runs/42066678494) 对应 b687ef55，状态如下：

|Job|实际结论|
|---|---|
|Classify PR changes|PASS|
|Users build, typecheck, and local Workers tests|PASS；实际 Node 24.22.1，npm ci/build/typecheck/test/audit 已运行；测试共85，83 PASS、2 SKIPPED（macOS限定），0 FAIL；audit 0|
|Local Supabase SQL tests|PASS|
|Candidate database and Worker compatibility|PASS；不能当成 Users 正式云端已部署|
|Admin frontend, Worker, and build|PASS|
|Public tests and production build|PASS|
|Verify production migration staging|PASS；不等于实际线上迁移执行|
|Admin dependency audit|SKIPPED：未改 Admin 依赖文件，符合分类条件，不标为 PASS|
|Required PR validation gate|PASS|

共享 workflow/gate 变化按保守规则运行多项目检查。Admin 安装日志仍显示 9 项历史 Moderate，未修改旧 CMS 锁文件、未隐藏审计；独立依赖审计仅在该项目依赖文件改变时成为本 PR 必需项。

本轮重新读取确认 PR 仍为原 Head、106文件、open/Draft，PR validation #107 仍为 success。上述 GitHub 绿色结果**未覆盖当前6个 tracked 改动、9个 untracked 工具/测试和本报告**。PR 当前无正式 Review；mergeable=true 只说明 GitHub 当时未报告文本冲突，不证明分支保护已满足或允许合并。现有 PR 描述、旧摘要/交付清单尚未包含 L-05 与 R-03 终态；后续获批更新时须同步脱敏说明及新工具摘要。

## 10. 风险分级、最小处理与下一阶段

|级别/编号|问题|范围与最小处理|决策性质|
|---|---|---|---|
|P0/P1|本轮未发现明确生产业务缺陷|受限于代码/隔离证据，非全面安全认证|不作无风险保证|
|P2 F-01，已修复|授权策略降级|真实入口只接受明确策略；两个入口拒绝回归已通过|不再阻断代码交付|
|P2 F-02，已修复|UNKNOWN 退出自动重试|会话级一次请求状态、清理合并与停止竞态回归已通过|不再阻断代码交付|
|P2 证据缺口|新构建没有真实成功恢复改密/Q2 登录 PASS|保留旧真实成功、新合成成功、新部分真实三层；不继续真实测试；用户另行决定发布风险|正式启用前须单独接受，未替用户接受|
|P2 可观测性|422 上游原因未完全归因|未来工具可安全记录有限错误码，禁止正文/凭据|不能用推断抵消证据缺口|
|P2 发布配置|OTP 永久迁移、正式来源/资源及安全配置尚未完成|按第5节和独立部署审批执行，不改变业务实现|部署前阻断，不把未部署当成本地业务失败|
|P2 交付准确性|本地工具未入 PR、旧清单/描述未更新、远端 CI未覆盖|修复后定向测试、新摘要、明确文件清单、批准提交/推送后跑 CI|最终交付前处理|
|已知限制|一小时自然到期续期、托管 DO/Worker、正式域名未验收|发布清单及后续另批受控验证；不伪造 PASS|独立线上任务|

正式部署前还需审阅日志/追踪与隐私保留策略（当前 observability.enabled=false）、错误监控、DO 数据保留/清理、独立资源绑定、Custom Domain/TLS/Access/缓存、旧 CMS 域名迁移及安全回退。不得把其他数据库兼容 Job 当成 Users 托管验收。相关操作均需另批，不在本轮执行。

本轮 F-01/F-02 定向修复已经完成。下一步可申请 Git 交付：按当前文件重新生成交付候选和准确哈希清单，更新脱敏交付说明及永久 OTP 上线清单，取得提交/推送/PR 更新批准后，再验证实际新 Head 的 Users 与 Required Gate。旧86文件清单不能直接使用，不能自动把 Draft 转 Ready。

**阶段判断：GO_WITH_ACCEPTED_RISK（按用户本轮定义：代码阻断已解除，剩余风险需要单独确认；风险尚未被自动接受）。** 可以准备并申请下一阶段 Git 交付和正式 Review。本轮不执行提交/推送；合并和生产启用仍未批准。R-03 的成功恢复改密/Q2 登录缺口保持不变，不自动补测或改为 PASS，不进入部署或 S3。


## 11. P2 定向修复闭环（2026-11-06）

### 11.1 实际修改及影响范围

本轮精确修改8个文件：

1. `scripts/approval-receipt.mjs`：usesReceipt 对不在三个精确 v1 策略中的值抛出 approval_policy_denied，不再返回 false 以触发隐式 legacy 路径。缺失、null、空串、拼写错误、错误版本、布尔/数字/数组/对象均拒绝。
2. `scripts/controlled-real.mjs`：移除真实 validateBatch 中的 approvalStateMatches 分支；明确离线替身参数仍需 OFFLINE_TRANSPORT_TEST 与 example.invalid 合成账户。保留该历史检查函数供纯检查测试，不让历史 APPROVED/executable 字段产生真实授权。新增退出状态、清理合并与关闭后的未确认状态保留。
3. `tests/approval-receipt.test.mjs`：新增策略/旧字段降级拒绝和实际 HTTPS CLI 早期拒绝2项；同时复核正确策略、错误 receipt schema、原摘要/期限/重放/跨进程原子消费规则。
4. `tests/session-mini.test.mjs`：新增7项（lost/timeout/ECONNRESET三种 UNKNOWN、并发明确退出、两种实际 stop 在途竞态、超时后迟到响应）；修正原重复退出断言。
5. `tests/registration-mini.test.mjs`：原测试期待两次 UNKNOWN 退出，改为一次且保留 UNKNOWN/已用额度；更新缺失策略的拒绝断言。
6. `tests/controlled-real.test.mjs`：更新旧批准字段批次的明确策略拒绝断言；不修改业务期待或请求额度。
7. `tests/mutation-mini.test.mjs`：同上，保留完整合成恢复成功与 DO 领取顺序测试。
8. `docs/S2-FINAL-CODE-REVIEW.md`：本修订。

`controlled-https.mjs` 本身本轮没有再次改写；它已有未提交修改被完整保留，并通过共用 usesReceipt 调用取得新拒绝规则，实际 CLI 回归验证两入口一致。其他此前未提交的授权/证据/租约工具也未被覆盖。本轮没有增加全局 APPROVED 开关或新的历史兼容执行入口。

重新检查源代码导入与现有构建：app/lib/worker 不导入受控脚本；正式业务源码、配置、依赖锁与产物的 SHA 均未改变。生产业务无需因本次工具改动重跑真实认证。运行配置的40分钟上限和工具30分钟租约保持不变。

### 11.2 退出状态、持久审计与并发

- 每个本批明确会话在上游发送前记账，并同步发布 IN_FLIGHT 状态；运行内以会话标识去重，审计只写请求编号/账户别名/结果，不写 Token 或 Cookie。
- 取得明确回执记录 HTTP/status；UNKNOWN 不释放额度、不自动再次发送。同一会话的任何既有退出尝试均不由自动清理重试；本轮没有提供新的“再次授权退出”开关。
- 多个 cleanup 调用共享在途 Promise，先等待已接收的应用请求和出站操作，再清理。cleaning 期间拒绝新入口，并在读取 POST body 后再次检查以处理竞态。
- 自动清理仅对尚未尝试退出的已知会话发送一次 scope=local 请求；其他业务失败后的已知会话仍可独立定向清理，不是用全局退出或重复 UNKNOWN 目标完成收尾。
- 迟到响应不将已结束的 UNKNOWN 改成成功；收到204的会话已关闭，重复 stop/cleanup 不再发送。停止函数已有单次 Promise 规则保持不变。
- 清除内存会话材料后，snapshot/close审计仍保留未确认会话数量及 UNKNOWN；本地窗口、Cookie、服务和端口清理不能覆盖远端状态。硬终止前的 IN_FLIGHT 审计不能推定远端未执行；独占批次/回执标记阻止进程重启后重放。

### 11.3 实际测试结果及证据

新日志只写入被忽略的 `.runtime/S2-P2-REMEDIATION-20261106/`，不覆盖旧批次或上次审查日志。

|验证|结果|说明|
|---|---|---|
|修复前最小回归|5项失败，记录 red-tests.log|包含缺失策略拒绝缺失、UNKNOWN重复发送和并发清理不一致；保留原失败证据|
|首轮受影响回归|72/73，通过72、失败1|唯一失败是旧注册测试仍期待2次UNKNOWN退出；未修改功能掩盖失败，改为验证一次与保留UNKNOWN|
|最终受影响回归|75/75 PASS，0 FAIL/0 SKIPPED|regression-final.log；含新增9项、实际Worker/API/SQLite DO、两种 stop 在途竞态、明确204、超时/ECONNRESET/响应丢失，以及原额度/期限/UID/摘要/重放/并发拒绝|
|TypeScript|PASS|typecheck.log，--noEmit --incremental false|
|CI 分类与 Required Gate 单测|28/28 PASS|ci-gate.log；共享CI源文件未修改|
|实际 HTTPS 启动入口|PASS（拒绝用例）|未知/缺失/对象/错误版本在应用预检及读取证书/系统信任前拒绝；无 Keychain 操作、无服务启动、无真实上游|
|正常 LIVE_READ / 人工证据|PASS|原受限验证、错误来源/摘要/项目/UID/过期拒绝和一次消费回归保留；未放宽人工来源或虚构云端读取|
|敏感信息/忽略路径|复核无新增实际敏感内容|交付文件扫描及测试日志哨兵检查；本地真实证据继续排除，不等于扫描可证明所有编码无风险|
|GitHub CI|原 b687ef55 的成功结果仍有效|未提交这些修改，未触发新 CI；不宣称远端已覆盖新工具|

本轮没有运行真实认证、邮件、密码更新、模板操作或 Keychain 写入。已匹配的旧业务构建/浏览器/真实验收证据复用，不把75项工具回归与历史85项相加。

### 11.4 复核结论及独立发布条件

已复现的两条绕过/重复发送路径在新增回归中关闭；本次受影响验证没有发现新的明确代码阻断。此结论限定于本轮代码和测试覆盖，不宣称本地文件授权抵御同用户任意改代码，也不为未知攻击面作保证。

第11节P2修复时工具完整 SHA-256：`9f968ce70c538b84361e89d86acbc512b1f9e4af3dea7388774d443d485712c0`，后续平台测试修复摘要见第12节。业务、锁及产物见第2节，均不变。旧 R-03 工具摘要及所有历史候选/回执未迁移到新工具，不生成新批次或正式批准回执。

可以申请下一阶段 Git Commit/Push 及 PR 更新批准，但未在本轮执行。生产配置阶段仍须用户独立确认：

- 新构建真实成功恢复改密及Q2独立登录未取得PASS证据；R-03保持PARTIAL_PASS，停止真实补测的决定不等于接受发布风险。
- Reset Password将永久使用已核验的黑白双语六位 `{{ .Token }}` 模板；Password Changed保持独立安全通知。当前云端尚未批准永久切换，第5节的一次性迁移/实际全文回读/配套回滚仍待单独批准，不是逐次恢复操作。
- 正式Worker/DO/域名验收及真实等待一小时的到期自动续期仍未完成；PR绿色、主动续期或合成恢复不能替代这些证据。


## 12. Git交付前CI平台兼容性修复（2026-11-06）

交付预检另发现P2：`tests/approval-receipt.test.mjs`中两项测试直接启动仅支持macOS的HTTPS入口。GitHub Users Job运行于托管Ubuntu；assertCurrentNode先返回existing_node_required，原测试期待的授权错误码不匹配。此前macOS75项通过不能证明Linux CI通过，预检NO_GO_CI_PORTABILITY记录保留。

本轮按单独批准，**仅修改一个测试代码文件**`tests/approval-receipt.test.mjs`，另更新此报告及本地忽略目录的交付报告/哈希。未修改生产应用、授权策略、controlled-real/controlled-https、Node身份约束、DO、依赖或工作流；未安装或要求本地Ubuntu。

- 两项macOS HTTPS入口测试显式使用平台SKIP及理由；在macOS实际运行，在非macOS仅这两项显示SKIPPED，不伪造PASS。
- 原混合测试拆出“直接执行器缺少回执拒绝 + 共用协调器”跨平台测试，确认发送次数为0。跨平台继续运行未批准/伪造context、未知/缺失/无效类型/错误版本策略、旧字段降级、摘要及scope篡改、过期、重复消费、跨进程并发领取及来源拒绝等8项测试。
- 不将整个文件跳过，不放宽existing_node_required，也不将任意错误码当成授权正确拒绝。

|验证|实际结果|边界|
|---|---|---|
|Mac定向授权文件|10/10 PASS，0 SKIPPED|包含两项实际macOS入口拒绝测试|
|Mac受影响授权/人工证据/恢复回执/租约模块|25/25 PASS，0 FAIL/0 SKIPPED|包含上述10项；两数字不相加|
|隔离Linux平台分支|8 PASS、2 SKIPPED、0 FAIL|仅在隔离Node测试进程替换process.platform，执行同一测试文件；不是Linux二进制或真实Ubuntu执行|
|TypeScript|PASS|--noEmit --incremental false|
|分类器/Required Gate|28/28 PASS|工作流未修改|
|新Head GitHub托管Ubuntu CI|NOT RUN|尚未Commit/Push；最终以新Head真实Actions结果为准|

本地证据：`.runtime/S2-CI-PORTABILITY-20261106/mac-authorization.log`、`simulated-linux.log`、`typecheck.log`、`ci-gate.log`。平台模拟脚本仅位于忽略目录，不随仓库交付、不被生产或启动器加载。未进行真实认证、邮件或Keychain操作。

新工具SHA-256：`209ed8b87b44b69d57eff3403e2442cd046366d12b268cbb771745fd9466dee6`。业务`65c3afe790ece8f5616e873fd8870803d4bef0e89cdeeec528c5439a054e37fd`、锁`c8cc8a0b96c76e8eec73b7c0eb17621b1580dc8488d93f09523f859073779057`及现有产物摘要不变。未改动的其他测试模块仍复用第11节证据，不宣称重新全量运行75项或全部应用测试。

交付仍为6个tracked修改、10个untracked文件，共16项，最新分类B=15、C=1（正式文档），无A类业务改动；以更新后的本地files.json逐文件SHA为准，不复用旧白名单摘要。两项安全P2与此平台兼容性P2均已修复，在本轮覆盖内未发现新失败或代码阻断。可以申请Commit/Push及后续PR审查批准；结论保持GO_WITH_ACCEPTED_RISK，剩余发布风险仍未被自动接受。新Head的实际CI是后续交付门禁，不把模拟结果当作远端通过。

L-05 PASS、R-03 PARTIAL_PASS及真实成功恢复改密/Q2登录证据缺口保持。用户不再真实补测；永久6位验证码模板是产品方向、云端迁移仍需另批；Password Changed保留独立安全通知。本轮不Commit/Push、修改PR、云端或Keychain，不部署。
