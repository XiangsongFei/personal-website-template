# S4.0 检查与单独复核记录

日期：2026-11-18（Asia/Shanghai）。审查对象仅为本目录六份 Markdown，基线 `e137f553469e9ace26bbfcd8a0359e4e1160ad9d`。这是成文后另行执行的证据与范围复核，由本轮同一执行者完成；未声称有第二名独立审查人或 GitHub 人工批准。

## 文件与 Git 检查

| 检查 | 结果及范围 |
| --- | --- |
| 实际目录/Git 归属 | 已核对实际绝对路径、git common dir、origin、HEAD、原分支和全部59个初始 worktree；新建第60个用于 S4.0 |
| 原工作区保护 | 初始128条 status 原样保留；对3295条已修改/未跟踪文件建立本地字节摘要并复核，未将它们复制或纳入提交 |
| 文档完整性 | 六份 UTF-8 Markdown、内部链接与目录索引可达；仅本目录新增文件，应用源码、依赖锁、SQL、配置、测试及旧文档均无修改 |
| Git diff | 暂存后执行 diff --cached --check、变更路径白名单及实际 diff 阅读；只包含本目录六个 A 文件，无 rename/delete，无无关修改 |
| 原应用保留 | 与固定 main 比较所有既有跟踪路径；S2账户/密码/验证、旧CMS/Public、S3及部署文件字节未改 |
| CI 分类器 | 现有脚本的28项测试通过；六个实际文档路径分类为 Admin=false、Public=false、Users=false、Admin dependencies=false |
| 本地工具 | 登录shell未提供 node 命令，使用已安装 Node v24.13.0 的绝对路径运行上述纯标准库 gate 测试；未安装/升级依赖，未运行 npm audit fix |
| 私有材料/Secret | 检查新增内容仅含状态、公开 SHA、文件名、必要路径和非敏感摘要；没有 JWT、Cookie、密码、私钥、实际环境文件或原始运行回执 |

实际 Commit、远端 HEAD、PR 和最终 CI 不能在 Commit 前预填。本轮最终用户报告和 GitHub PR 提供实际回执；可用 `git log -1 -- resume-users/S4/S4.0` 定位独立提交。若远端检查失败，保留失败状态，不修改检查逻辑或自动合并。

## 独立于编写阶段的复核清单

| 项目 | 复核结论 |
| --- | --- |
| 是否错误移动/重命名 Users 应用 | 否；仅新建用户指定的材料父目录，源码继续在 example-cv-users |
| 是否依赖原脏工作区/未合并PR代码 | 否；干净 main 基线；原CMS扩展与PR40仅作为状态证据，未复制实现 |
| 是否覆盖七类指定审查对象 | 是；Dashboard、导航、双语、排序、预览、Activity Log、Version History均有源码位置和复用界限 |
| 是否声称本轮已运行视觉/生产测试 | 否；明确仅源码/交互合同审查，浏览器验收待提取时执行 |
| 是否将新页面保护交给前端 | 否；发现Worker仅保护两条现有账户页，S4.1必须补新页服务端验证 |
| 是否遗漏旧权限/API边界 | 否；明确旧admin API、直接DML、Owner/QA、Test、固定目标、Storage及Secret不可迁用 |
| 是否把设计或离线PASS当真实业务完成 | 否；保留S3.3/S3.4历史隔离事实，S3.5 HOLD和S3.6 REAL_NOT_RUN独立列出 |
| 是否采用较旧“待上传”状态覆盖最新S3回执 | 否；PR40以实际HEAD 5364bc7和Actions失败为准；五文件实际状态覆盖早期六文件描述 |
| 是否把文档CI通过当解除安全审计阻断 | 否；#40依赖审计/Required gate失败独立保留，未来业务保存/发布仍受阻 |
| 是否虚构既有S4逐项清单 | 否；12步为明确标注的建议映射，下一步先对齐用户既定编号/范围 |
| 是否自动部署/写数据库/继续S4.1 | 否；本轮仅S4.0文档，后续需另轮任务 |

复核结果：**文档范围可交付；真实业务能力仍有明确阻断，不构成S4业务验收或生产启用批准。** 本轮未调用生产 Supabase 或 Cloudflare，不通过建立测试账号、数据库连接、运行历史脚本、真实文件上传或清理历史证据来验证文档。

## CI 与安全审计边界

现有规则通过PR触发，不在普通branch push时单独触发。因此 Push 后创建专用PR验证，保持OPEN；不得无PR就声称Required CI成功。正常分类的应用/依赖套件SKIPPED只表示本次纯文档不适用，不能声称应用build、安全审计或真实数据库测试本轮通过。S4.0不修改现有规则，也不关闭或重跑#40失败的检查。

GitHub主分支ruleset继续要求 `Required PR validation gate`。本轮无Merge、自动Merge、强推或bypass。S3生产/隔离业务的权限与验收门槛仍按[依赖矩阵](04-dependencies-and-s3-handoff.md)保留。
