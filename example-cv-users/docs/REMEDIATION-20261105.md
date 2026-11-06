# S2 PR #31 本地修复候选（2026-11-05）

结论：指定 React Critical 和 TLS 撤销 P2 缺陷已完成定向修复，Users CI 与门禁已接入；本地功能测试通过。但最新完整 Users npm audit 仍有 **8 High、2 Moderate、0 Critical**，因此本候选安全审查仍有阻断，不能写成全部修复或可部署。未推送、未创建替代 PR、未改变 #31。

## 版本与 Git 隔离

- 分支：`codex/s2-users-remediation-20261105`，独立 worktree；基础 main：`a0a82f30b3e5129f7a68d9e6dfe2693fb7eaa8a2`。
- 原 S2：`17f99e3d9e1a42166257cc18aceb31d302d27dee`；仅该提交 cherry-pick 到最新 main，得到 `bea1bb75d139416ea604e354fa2a81d18fd8b70f`，无冲突。基础 main 未含 Users 包。
- 本地 main 保持 `e175a1517aef1cc0156c92e17e695fe1c4f840d9`；原 S2 分支保持原提交。远端 main、原 S2 分支未变，#31 仍 open/Draft。
- 原工作区 3,621 个文件和 172 个历史记录文件逐一 SHA-256 对比无变化，原工作区 tracked diff 摘要未变；旧 CMS、公站及其他未提交成果未覆盖。未使用 reset/clean/rebase/强推。

## React 与锁文件

三个精确版本均为 **19.2.6 → 19.2.9**。官方 [GHSA-xqc2-xf4c-x3h3](https://github.com/react/react/security/advisories/GHSA-xqc2-xf4c-x3h3) 的 19.2 分支修复版本为 19.2.9；原 RSC 版本处于受影响范围。

Vinext 1.0.0-beta.2 的三个 peer 均为 `^19.2.6`，允许新补丁；@vitejs/plugin-rsc 0.5.26 为 `*`。React DOM 19.2.9 要求 React `^19.2.9`，RSC 19.2.9 要求 React/DOM `^19.2.9`，当前树满足，无 invalid peer、无旧 RSC 副本，也未安装 parcel/turbopack RSC 包。

npm 生成锁文件时曾移除无关 optional 节点，造成首次 npm ci 锁一致性失败。随后保留原锁的全部无关节点，只应用三个 React 节点及根声明的精确版本/完整性元数据；最终 npm ci 通过。未升级其他包、未运行 audit fix。

仍使用原 Vinext + Cloudflare Vite RSC/SSR 构建配置、Workers 页面/API 和 SQLite DO；未替换成 SPA 或旧探针。app/lib/worker 源码与原 S2 完全相同。

## HTTPS 定向撤销

- snapshot/plan/install 继续执行既有 Node、证书用途、有效期及私钥文件安全预检。
- 新 snapshot schema 2 保存公开 `server.pem`、`server.der`、完整指纹、UID、原三域状态及公共项计数；不保存私钥。文件属主、权限、硬链接和符号链接检查继续生效。
- restore/verify-restored 从本批公开快照读取，验证指纹、UID、原状态、安装账本及 scope；不要求当前证书未过期、原私钥/原证书/Node 路径仍存在。
- 只支持原先已验证的“三域显式记录均不存在、目标公共项原为 0”基线。原本已有证书或信任仍 fail closed，不覆盖、不误删。仅删除确属本批新加的叶证书用户 SSL 信任及其新公共项，不处理 CA、管理员域或系统域。
- 原子排他 attempt 账本保留；UNKNOWN/不完整结果不自动重试。重复成功 restore 仅确认现状，不重复系统写入，不覆写首次回执。
- 有效 SSL 复核也改用公开叶证书快照，无私钥依赖；仍检查真实日期与相同链/主机/用途。证书到期后显式撤销可完成，但到期失败不能记成有效信任恢复。
- 旧 schema 1 历史批次不自动迁移；原工具和历史回执继续保留在原工作区。

`tests/fixtures/tls-restore-offline.py` 执行真实 CLI 的目录绑定、快照、预检分支、账本和调度代码，仅截取 macOS 原生读取/命令边界。12 个场景覆盖正常安装/撤销、到期后的撤销、私钥/原证书/Node 丢失、错误指纹、其他 UID、错误安装记录、非 CA 证明缺失、管理员/系统/过宽信任、已有证书、快照符号链接、重复撤销及 UNKNOWN 不重试。到期和原生结果由隔离边界模拟；不是实际 Keychain 测试。所有 Keychain 写入为 0。

## CI 分类与必需门禁

| 变更范围 | Admin | Public | Users | Admin dependency audit |
|---|---|---|---|---|
| 仅 example-cv-users/（含文档） | 否 | 否 | 是 | 否 |
| resume-admin/ 普通源码 | 是 | 否 | 否 | 否 |
| resume-admin/package.json 或 package-lock.json | 是 | 否 | 否 | 是 |
| Public 源码/配置 | 否 | 是 | 否 | 否 |
| workflow / .github/scripts 共享门禁 | 是 | 是 | 是 | 仅同时变动 Admin 依赖文件时 |
| 未知非文档路径 | 是 | 是 | 是 | 仅同时变动 Admin 依赖文件时 |

多项目取并集，未知路径不能跳过应用验证。本候选修改了共享 CI，所以本候选将运行三个应用的相关测试，Admin audit 跳过有明确依赖文件规则；以后仅 Users 改动不再误触 Admin。

Users Job 使用 Node 24.13.0，在包目录运行 npm ci/build/typecheck/test，并运行不忽略失败的 npm audit。没有真实密钥、远程绑定或发信配置。必需门禁检查 Users applicability/result、Admin audit applicability/result，缺失/跳过/失败/取消均不能冒充 success。保留最新 main 的 Admin SQL/迁移/兼容矩阵及 Public job。Admin 原有审计从普通构建 job 分离，没有 continue-on-error。

Linux 仅明确跳过 macOS 专属的“指定 Mac Node 二进制 + PID”测试；其余证书/权限/撤销离线测试继续执行，生产工具的 macOS 身份保护没有放宽。GitHub Users Job 与 Ubuntu 执行目前 **NOT RUN**（本轮禁止推送）；本地同命令功能验证通过，audit 为 FAIL，不能宣称 GitHub CI 已通过。

## 验证结果

| 检查 | 本轮结果 |
|---|---|
| npm ci、完整 RSC 构建、typecheck | PASS |
| 完整 Node/workerd/DO 回归 | 80/80 PASS；0 跳过 |
| HTTPS 定向复核 | 5/5 Node 测试 PASS，其中 CLI fixture 内 12 个离线场景；与完整套件覆盖重叠 |
| 分类器 / Required gate / workflow 接线 | 28/28 PASS |
| workflow YAML 解析 | PASS，9 jobs |
| 本地合成浏览器 | 登录、账户刷新、受保护页面导航、主动状态刷新、POST 退出、退出后拒绝私有页 PASS |
| npm ls React / DOM / RSC | PASS，均仅 19.2.9 |
| 完整 Users npm audit | FAIL，8 High、2 Moderate、0 Critical |
| Admin 原锁只读 audit | 9 Moderate、0 High、0 Critical，锁文件未改 |
| 敏感字面量及禁止文件扫描 | 未发现命中；不是对任意编码秘密不存在的绝对保证 |
| 原 CMS / 公站差异（相对基础 main） | 0 |
| 真实认证、发信、改密、云端、Keychain、远端 Git 写入 | 均 0 |

浏览器只连接严格无外部回退的合成 Auth，未使用证书或 HTTPS 信任；无需重做已认可的视觉验收。浏览器已退出/关闭，本轮服务确认停止，8795 端口释放。临时日志、浏览器输出与本地状态留在忽略目录，不纳入提交。

## 仍阻断的依赖审计

8 个 High 是受影响依赖节点数，不能当作 8 个不同漏洞：

| 包 | 保留版本 | 来源 |
|---|---|---|
| @cloudflare/vite-plugin | 1.53.0 | miniflare / wrangler 传递 |
| miniflare | 5.20260815.0-alpha | sharp / undici 传递 |
| sharp | 0.35.2 | libheif / librsvg 公告 |
| undici | 7.29.0 | WebSocket、解压、缓存、TLS 等公告 |
| wrangler | 4.124.0 | miniflare 传递 |
| vinext | 1.0.0-beta.2 | image-size / @vercel/og 传递 |
| image-size | 2.0.2 | JXL/HEIF/ICNS 解析 DoS |
| vite | 8.0.13 | 开发服务、launch-editor 等公告 |

Moderate：@vercel/og、satori。精确公告/依赖链见 [verification.json](evidence/remediation-20261105/verification.json)。`npm audit --omit=dev` 为 0，但这些构建工具可参与最终 Worker 打包，不能据此忽略完整审计或证明部署不受影响。

最小后续权限：单独批准相容的 Vinext/Vite 与 Cloudflare Vite/Wrangler/Miniflare 依赖组定向安全升级，复核其 image-size/sharp/undici 等传递版本；保留精确锁与同一套回归。不能直接套用 npm 的全部自动修复建议（其中包含 Miniflare 降级/破坏性建议）。Admin 9 Moderate 另立旧 CMS 安全修复范围，本轮不升级、不创建 Issue。

## 哈希、文件及验收边界

- 业务：`439bbc1e421461e893a10e45bebdfbc71304c410351340b0a900217888f4d6b6`
- 工具：`d2231ed3f373c897e9ed47657968856c2b2e70d081b5678ce8538f91eabb149a`
- 锁文件：`1aa8075cc646c8ee2d57c478d58de697b2e0e393039b09eb25954f1e150b9a07`
- 构建产物：`a5148534c49c351e2b9cd74f57c7a9c2a323e8d825a33a5a950c1f2499b4e32c`
- CI 三文件摘要：`60b88008464ab5d37c5439379c7f731729a1a42a9d94818f6e2d41273b738b6a`

可逐文件复核 [build-manifest.json](evidence/remediation-20261105/build-manifest.json)。该业务/工具指纹算法不包括文档与共享 CI，所以 CI 单独列摘要；未排除本轮任何业务/锁文件变更来维持旧值。

本轮相对 cherry-pick 的文件范围：

- 修改 `.github/scripts/pr-validation-gate.mjs`、对应 `.test.mjs`、`.github/workflows/pr-validation.yml`。
- 修改 `example-cv-users/package.json`、`package-lock.json`。
- 修改 `scripts/https/leaf-trust-control.py`、`read-leaf-effective.py`。
- 修改 `tests/fixtures/tls-policy-offline.py`、`tests/tls-tools.test.mjs`。
- 新增 `tests/fixtures/tls-restore-offline.py`、`tests/tls-restore.test.mjs`。
- 修改 `docs/TESTING.md`；新增本报告、`docs/evidence/remediation-20261105/{build-manifest,verification}.json`。

共 15 个修复/证据文件；相对最新 main 为 94 个文件（91 新增、3 个共享 CI 修改、0 删除）。相对旧 S2 整个仓库的差异另外包含最新 main 的 115 个既有提交，不能把它们算成本轮修改旧 CMS；比较业务 app/lib/worker 时为 0 改动。

原业务 `676c5c7c…` 的五项真实 PASS、历史 UNKNOWN、Safari/Chrome、模板回填超时及所有原始回执均保持原版本适用范围。旧交付 86 文件清单与原 build-manifest 是历史冻结清单，不用于声称新候选仍为 86 个文件或真实 PASS。新候选只有本地测试通过，**尚未重新真实验收**。

若后续依赖修复完成，可申请一次最小真实集成回归：登录→身份→主动续期→定向退出；恢复关键路径是否需重测应按最终依赖/运行时差异单独批准，不能借用旧真实 PASS。不得自动重做注册或真实写操作。

当前可审阅本地修复候选及剩余 High 清单；不建议现在作为“阻断已全部解除”的替代 PR 推送。等待用户决定追加的依赖安全范围，再单独批准推送/替代 Draft PR。原 #31 保持不变，不合并、不部署。
