# S2 生产上线结项记录（2026-11-07）

记录日期：2026-11-07，Asia/Shanghai。

本记录汇总已核实的生产上线事实、分版本验收及未关闭风险。它不是“全部生产验收通过”的声明，也不是后续 Git 交付、真实账户测试或云端变更授权。

本次本地文档准备批准编号：`S2_DOCS_LOCAL_PREP_20261107_01`。该批准仅覆盖独立文档 worktree、指定 Markdown 文件及本地检查，不是历史上传批准的替代证据。

## 1. 生产与源码基线

| 项目 | 已核实基线 |
|---|---|
| 仓库 | `XiangsongFei/personal-website-template` |
| GitHub main | `69d748c7770d0ca53dee727ad3e25eee66abfc8f` |
| Root tree | `a6a43214316c3406c11db1d22ac002e449dd2762` |
| Users tree | `755acf787ce8cfa9fc82fb027eaf01c2408d5e5b` |
| Users 锁文件 SHA-256 | `c8cc8a0b96c76e8eec73b7c0eb17621b1580dc8488d93f09523f859073779057` |
| Worker | `example-cv-users` |
| Worker Version | 9 |
| Version ID | `5085b2b5-bb5c-4b36-a80b-37c0c4c8ce93` |
| Deployment ID | `c424d0a9-ce01-4fb2-9e5b-a4ff0315f233` |
| 生产流量 | Version 9：100% |
| 正式入口 | `https://admin.example-cv.com` |
| Version 创建时间 | 2026-11-07 18:25:31，北京时间 |
| Promote 时间 | 2026-11-07 18:32:42，北京时间 |
| 上一个生产版本 | Version 8：`a8842c52-db88-49e5-9cd8-8e44bb493e49` |

[固定源码提交](https://github.com/XiangsongFei/personal-website-template/commit/69d748c7770d0ca53dee727ad3e25eee66abfc8f)包含已合并的[PR #34](https://github.com/XiangsongFei/personal-website-template/pull/34)。生产版本、流量和域名来自2026-11-07前置只读API查询；本次文档编辑未操作Cloudflare，也未重跑生产认证。

域名边界：`admin.example-cv.com` → `example-cv-users`；`cms-admin.example-cv.com` → `example-cv-admin`；`example-cv.com`及`www.example-cv.com` → `example-cv-public`。这是各自独立的Worker，Git合并不能代替其部署。旧CMS代码合并也不能证明其云端版本已经更新。

## 2. 发布关联链与独立验证边界

**状态：`PARTIAL_INDEPENDENT_VERIFICATION`。**

历史记录的发布工件集合 SHA-256：

`fd000e7ac1d6be90d9f2131a5f4c41147165a2c8101302a47ebd074eef43677d`

| 关联环节 | 证据与本轮核对 | 验证边界 |
|---|---|---|
| GitHub SHA → 本地源码 | 远端main与固定SHA一致；本地发布复现HEAD、两级tree、锁摘要及Users已跟踪文件匹配 | 已独立核实当前保留源码身份；未重新构建证明确定性复现 |
| 本地工件 → 逐文件清单 | 192个服务端文件、18个发布静态资源、3个客户端辅助文件逐项摘要匹配 | 已独立核实保留字节与历史清单一致 |
| 工件集合摘要 | 初始发布证据、最终差异审查和上传回执均记录同一`fd000e7a…` | 原始集合计算定义尚未定位，未独立重算确认；不能以不同算法所得摘要判定工件漂移 |
| 工件 → Version 9 | 历史上传回执关联固定源码、集合摘要和Version ID | 依赖历史执行及回读记录；本轮未重新独立比对全部云端模块字节 |
| Version 9 → 生产 | 前置只读查询确认指定Deployment以100%流量运行Version 9 | 属于查询时点事实，不保证之后无漂移 |
| 历史上传批准 | 未定位独立上传批准文件 | 不等于证明当时未经批准；本次文档批准不能补作历史上传批准 |

### 2.1 保留的本地发布材料

以下仅列非敏感材料名称和摘要，不附私有路径、工件或回执全文。原始材料继续本地保留，不因本次文档更新删除、移动或重写。

| 材料 | SHA-256 / 作用 |
|---|---|
| `release-evidence.json` | `ee5b1feb988bd06d4472e54e8552e6951dbb75fa4a688ba16db5013fcd91e05a`；初始`BLOCKED` |
| `final-delta-review.json` | `c035b055106f95a08e89f97b447204bc835a6d30643201993f428b98c650f2fe`；后续`S2_RELEASE_DELTA_REVIEW_PASS` |
| `server-module-manifest.json` | `4922a7adf005cec2112584298c924365c5e7deda535b7e3620a23b4bf242a1c4`；192个文件 |
| `static-asset-manifest.json` | `0d228343df66faa76d8ce5688957ea83e9b9b771bf4e130f09e22e7503f46f06`；18个发布资源及3个辅助文件 |
| `historical-comparison.json` | `bba36428f5b44a6f3c45b9bf194b83e5c36ac56c98cf756e7b983bc8c92d386c`；旧新工件差异 |
| Version 9上传`receipt.json` | `838c06bed5a1e58212b6551dbb1ce1968928653d360145de2ec7b1f11f430000`；历史上传及回读摘要 |

三份被初始发布证据引用的清单/比较材料，其实际摘要与引用值一致。原始`BLOCKED`不能因后续差异解释通过而改写；后续PASS仅表示所审差异阻断解除，不替代测试结果、GitHub正式代码审查或真实业务验收。

### 2.2 上传与Promote是两个阶段

历史回执记录186个模块/映射上传部分及18个静态资源，版本创建返回Version 9。上传后当时仍是Version 8占100%流量，回执为`S2_ZERO_TRAFFIC_VERSION_READY`，不是已切换生产的证明。

该回执的内容核对记录：98个运行模块无差异；88份sourcemap核心等价、逐字节相同数量为0；没有列出模块不匹配。sourcemap核心等价不能表述为88份映射逐字节一致。

后续独立的生产查询确认Version 9已被Promote至100%，对应第1节Deployment。不能把零流量上传回执里的Version 8状态误作当前生产状态。

## 3. 分版本测试与验收矩阵

下列结果分别绑定各自源码、工件、工具和环境，不混合、不相加、不自动转移给Version 9。

| 版本/环境 | 原结果 | 覆盖与限制 |
|---|---|---|
| 原Mac，PR #34候选 | 128 PASS / 0 FAIL / 0 SKIP | 已有本地日志；不是Version 9全链路生产回归 |
| 发布复现沙箱 | 126 PASS / 2 FAIL / 0 SKIP；测试退出1 | 安装、构建、类型检查退出0；两项进程定向收尾用例失败，保留FAIL |
| GitHub发布材料 | 124 PASS / 4个平台跳过 | 数量来自`release-evidence.json`；本轮未重新下载Actions完整日志独立计数，不将SKIPPED写成PASS |
| GitHub PR validation | success，运行`42356280389` | Users检查及Required Gate已有成功查询证据；不适用的其他项目Job为SKIPPED |
| 历史业务`676c5c7c…` | 真实PASS | 注册/确认、双浏览器登录、主动刷新/退出、普通改密、完整恢复及新密码登录；成功四批共54次上游请求、4封邮件 |
| 后续业务`65c3afe7…`，L-05 | 真实双浏览器PASS | Chrome/Safari独立登录、身份、主动刷新、Cookie写回、定向退出和私有页保护；15次上游请求 |
| 同期R-03 | PARTIAL_PASS / PASSWORD_UPDATE_REJECTED | 恢复申请和验码等部分通过；唯一改密422，Q2独立登录未执行 |
| 隔离workerd/SQLite DO | 合成PASS，按各批记录 | 包含持久化、并发一次消费、过期、中断/UNKNOWN不放行及恢复成功链；不等于云端攻击验证 |
| Version 9生产定向验证 | 用户报告PASS | 错误当前密码显示“当前密码不正确，请重新输入”；不是本次文档阶段重新实测 |
| Version 9后续生产密码恢复端到端验收 | USER_VERIFIED_FULL_PASS | 用户亲自执行并确认五步全部PASS，包含退出后新密码重新登录；详见第3.2节，不是本轮独立自动化验证 |
| Version 9全功能自动化生产回归 | NOT TESTED / 未取得同等完整证据 | 密码恢复链已有用户生产端到端PASS；不能扩展为所有功能、浏览器和场景的自动化回归PASS |

沙箱两项失败均位于进程定向终止/收尾验证；独立环境探针记录`ps`调用`EPERM`，支持环境兼容性阻断归因。该归因不改变退出1、126 PASS及2 FAIL，也不证明所有环境下均无工具问题。

发布复现测试日志SHA-256：`f6e7d944046d54a1069544de2cf0b7eaf7a00b40d640876adff61f25c8a42dba`。

[PR #34 CI](https://github.com/XiangsongFei/personal-website-template/actions/runs/42356280389)的绿色状态不能覆盖不同环境的失败，也不能替代完成代码审查。旧79项、85项、工具定向回归及当前128项不是可直接相加的独立总数。

### 3.1 历史UNKNOWN、停止与未测试项

- 旧探针改密UNKNOWN及之后独立密码状态核对分别保留；后续核对不倒写原回执。
- 首次注册UNKNOWN、额外停止握手UNKNOWN、首次信任撤销超时UNKNOWN分别保留；后续成功或收尾不证明历史请求未执行。
- L-01登录曾PASS，后续身份读取及定向退出出现ECONNRESET/UNKNOWN；本地Cookie清理不能证明远端退出成功。
- L-02网络预检中止、L-03授权阻断、L-04已消费回执/租约冲突；R-01浏览器能力阻断、R-02模板基线不一致。中止、未执行及业务0次不记为业务PASS。
- 原预检中止批次的正常stop回执未取得、旧模板回填超时及后续独立回读、早期FAIL与修复后复测均保留各自结论。
- 真实等待3600秒自然到期自动刷新仍为NOT TESTED；主动真实刷新和合成到期不替代该证据。
- 长期跨浏览器、完整生产路由/操作覆盖、多地域和真实云端并发攻击未取得同等完整证据。
- 历史Safari HTTP回跳根因、部分整窗关闭回执及未捕获的持久状态瞬间继续保留原边界，不补造证明。
- 各环境SKIPPED、PARTIAL_PASS、UNKNOWN、NOT EXECUTED和NOT TESTED不得因本次整理改成PASS。

### 3.2 Version 9后续生产密码恢复：`USER_VERIFIED_FULL_PASS`

**状态：`USER_VERIFIED_FULL_PASS`。证据类型：用户亲自执行并确认的生产端到端验收。** 截至2026-11-07，用户明确确认已在正式网站 `https://admin.example-cv.com` 完成Version 9密码恢复全部五步，结果如下：

| 步骤 | 用户确认结果 |
|---|---|
| 1. 点击忘记密码 | PASS |
| 2. 成功接收六位邮箱验证码 | PASS |
| 3. 验证验证码并设置新密码 | PASS |
| 4. 密码重置成功 | PASS |
| 5. 退出后使用新密码重新登录成功 | PASS |

五项全部PASS，密码恢复完整链路已有后续生产成功验收。来源是用户亲自执行后的明确确认，不是本轮独立自动化验证；本轮没有执行真实认证测试或读取账户数据。不编造具体测试时间、请求数量、请求日志、浏览器或其他未提供细节，也不将其标为全功能自动化端到端回归PASS。

这是历史R-03之后的独立生产验收记录，不改变R-03的PARTIAL_PASS、HTTP 422、该批Q2未执行、根因未唯一确定及恢复授权不可复用等原始事实和日志结论。后续成功不证明旧故障的唯一根因；其他原有UNKNOWN、NOT TESTED和SKIPPED也不被覆盖。

## 4. 未关闭的审查与恢复风险

### 4.1 PR #34：`REVIEW_NOT_COMPLETED`

PR #34已合并，Head为`f8802e8b0a152b96763e1c281832df5b43678f95`。GitHub Codex自动代码审查因额度限制未完成；前置及本轮文档准备前的只读查询中，正式review submissions为空，前置查询的review threads也为空。

[失败回执](https://github.com/XiangsongFei/personal-website-template/pull/34#issuecomment-6704649289)及[额度说明](https://github.com/XiangsongFei/personal-website-template/pull/34#issuecomment-6704649577)支持上述状态。不能声称正式代码审查通过，也不能仅凭失败状态推定发现某个具体漏洞。摘要隐藏字段不是可评审的具体发现清单。

本地发布差异审查、早期S2审查及测试均有自己的对象和范围，不替代此项。残余风险为中等；仍需适用的补充审查，尚未因本文自动接受或关闭。

### 4.2 R-03：HTTP 422及历史归因缺口

R-03保留原始FAIL / NOT FULL PASS，同时引用后续PARTIAL_PASS / PASSWORD_UPDATE_REJECTED分类。恢复申请200、recovery验码200、getUser三次200、JWKS一次200；唯一恢复改密上游422、应用422，随后定向退出204。Q2独立登录未执行，没有改密重试。

DO记录为`ready → attempted → rejected`，授权已消费不可复用。日志时间精度不足以独立证明亚毫秒顺序，不能宣称真实云端并发攻击通过。

用户说明误填原密码支持`same_password`解释，但当时执行器未保留精确上游错误码，`errorCode=null`。合成`same_password`和`weak_password`均可产生422及rejected，因此根因未唯一确定。该次是明确拒绝，不是改密结果UNKNOWN。

PR #34修改普通改密错误映射和防重放分支，不能据此宣称旧R-03故障已修复或归因。第3.2节记录Version 9后续生产密码恢复五步全部PASS，包含退出后新密码重新登录；密码恢复完整链路已有用户亲自确认的生产端到端成功验收，不能继续描述为完全缺少成功证据。

仍开放的是历史R-03的精确拒绝原因，以及独立自动化回归和请求级证据的覆盖边界。历史归因及独立证据方面的残余风险为中等；这不表示当前恢复功能未通过用户生产验收，也不等于剩余风险已接受。本次不重试旧授权，不创建新真实批次。

## 5. 生产配置、邮件与回退边界

| 配置 | 仓库安全默认值 | 前置查询的生产值 |
|---|---|---|
| `USERS_MODE` | `disabled` | `production` |
| `USERS_CURRENT_PASSWORD_POLICY` | `UNVERIFIED` | `ON` |
| 路由 | `routes=[]` | 独立Custom Domain：`admin.example-cv.com` |
| 发布资源 | 本地构建声明 | 生产ASSETS及独立RecoveryState绑定 |

前置查询只核对Secret名称/类型`USERS_PUBLISHABLE_KEY / secret_text`，未读取值。生产`ON`是Worker配置声明，不能代替对上游Auth策略的当前核验。本次保持源码安全默认值，不据本文直接部署。

永久六位OTP模板已有2026-11-07迁移及Dashboard独立全文回读记录：正文6472字节，SHA-256为`c483a4fe0c3cdc1fd8f517fb71a153215670cc0d60361ae3b79fceda4713b79c`。该记录不等于本次重新读取当前Supabase配置，也不填补R-03成功链缺口。Password Changed是独立通知；旧链接模板及历史回退证据保留。

重新部署前必须核对实际模式、密码策略声明、来源、ASSETS、DO、Secret元数据和域名映射。配置漂移具有较高发布风险；不得将仓库默认配置直接当作生产发布配置。

Version 8仅是已识别的前生产版本，不是自动安全回退目标。回退前需另行核对代码差异、配置、模板配套及持久状态兼容；回滚代码不会恢复已消费授权，也不能逆转已发生的Auth写入。尚无由本文批准的回退动作或风险豁免。

## 6. 结项范围与后续门槛

**S2生产上线事实已确认；Version 9密码恢复完整五步链路已有`USER_VERIFIED_FULL_PASS`，证据为用户亲自执行并确认的生产端到端验收。各批历史验收与后续报告分别记录；代码审查、历史R-03归因、独立自动化回归、发布证据独立性及其他未验证项仍开放。不得将该恢复链路PASS扩展为所有生产验收或全功能自动化端到端回归已闭环。**

- 可以进入S3只读设计；上述中等残余风险不构成停止该设计的已证实缺陷。
- S3授权/SQL实现前仍需固定可信身份、租户与角色合同，确定隔离测试目标和变更边界。
- 真实账户相关生产发布前，需结合Version 9用户生产恢复端到端PASS，对未覆盖场景、历史R-03归因、补充审查、发布关联链及回退方案作明确处置；本记录不代替接受风险的决定。
- 工件集合计算定义及独立上传批准文件继续查证，找不到时保留未验证；不补造历史文件。
- 自然到期刷新、长期浏览器及其他生产覆盖可以另行计划，真实操作必须另获授权。
- 本地文档完成后仅可申请下一阶段Git交付批准；Commit、Push、PR、Merge及部署均不在本次批准内。

## 7. 历史记录索引

- [本地结项及原真实PASS/UNKNOWN](S2-CLOSEOUT.md)、[脱敏真实验收摘要](evidence/real-acceptance-summary.json)。
- [最终代码审查与L-05/R-03](S2-FINAL-CODE-REVIEW.md)、[交付候选快照](FINAL-DELIVERY-CANDIDATE.md)。
- [历史交付整理](DELIVERY.md)、[历史发布前清单](../RELEASE-CHECKLIST.md)。
- [首轮整改](REMEDIATION-20261105.md)、[剩余依赖分析](SECURITY-DEPENDENCY-REVIEW.md)、[第二轮修复](SECURITY-REMEDIATION-ROUND2.md)、[第三轮修复](SECURITY-REMEDIATION-ROUND3.md)。
- [架构](ARCHITECTURE.md)、[配置](CONFIGURATION.md)、[测试及HTTPS工具](TESTING.md)。

这些文档及JSON保留原时间、构建和判断。本文只追加后续状态，不重新赋予旧批次执行权，不发布本地私有原始材料。
