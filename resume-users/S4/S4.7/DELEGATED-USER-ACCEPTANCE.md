# S4.7 委托用户功能验收

2026-11-28，Codex 通过真实 Dashboard 代为完成用户验收。独立运行 `s47-user-acceptance-r01` 的终态为 `LOCAL_PASS_CLEANED`。G-READ 和 G-SAVE 均为 `LOCAL_PASS`。结论为 `S4_7_DELEGATED_USER_ACCEPTANCE_PASS`，已具备 `S4_7_READY_FOR_GITHUB_DELIVERY`。线上验收与生产部署状态沿用现有记录。

## 真实浏览器结果

| 栏目或流程 | 结果 | 核验内容 |
| --- | --- | --- |
| Dashboard | PASS | Chrome 实际登录表单、工作台概览、左侧导航、中英文界面和独立预览语言。编辑器内部切换期间页面未卸载。 |
| Profile | PASS | 中英文姓名与共享页脚均保存并回读。延迟转交原始 Worker 回执期间继续输入，新编辑仍显示未保存，Introduction 的未保存状态也保留。 |
| Introduction | PASS | 双语内容保存、刷新和重登回读。清空编辑字段时可见填写示例，已提交的历史与回执只包含合成履历正文。 |
| Education | PASS | 先提交三条记录，再修改、删除和排序。刷新后稳定 UUID 和双语字段顺序与第二版一致。 |
| Experience | PASS | 双语职位和组织，真实新增、修改、删除、排序，刷新回读第 2 版。 |
| Projects | PASS | 真实新增、编辑、删除与排序。双语题名和 UUID 刷新后保持。独立记录名修改保留栏目标题。 |
| Skills | PASS | 在表单中明确采用预设并填写内容，按稳定 UUID 上移、删除并修改指定行。刷新回读第 2 版，未采用示例未持久化。 |
| Awards | PASS | 真实新增、修改、删除、排序。刷新回读第 2 版。 |
| Contact | PASS | 中英文联系标题与可联系状态经真实保存并刷新。 |
| Links | PASS | 公开邮箱初始为空。保存并回读独立公开邮箱、GitHub 与中英文 LinkedIn 链接，预览读取对应链接。 |
| Website Text 与自定义标题 | PASS | 双语文案与六个栏目标题保存后，从独立标签页直接打开编辑器。匹配两种语言的导航、编辑器标题、面包屑、未保存栏目名和右侧预览。 |
| Alice/Bob | PASS | Alice 重登后读回相同站点的 Profile、Introduction 和自定义标题。两次退出都由独立 SQL 证明旧 Session 已移除、原刷新令牌不可用。Bob 在 Chrome 读取独立站点，初始无 Alice 的内容、标题或待核对定位器。 |
| 原生 Safari | PASS | Safari 18.6 使用 Bob 本轮已登录的 GoTrue Session，完成独立 Profile 读取、编辑、保存和刷新。1400×848 CSS 视口未出现横向溢出，编辑和预览区域均可用。 |

Chrome 158 检查期间未记录控制台警告、错误或未捕获页级异常。Chrome 观察到的 64 次 HEAD 为工作区身份和会话复核。真实用户保存操作使用不同原键，未观察到重复提交。Safari 的资源时间记录可核对文本请求路径，本轮 Safari 资源时间记录的状态码字段不可用。Safari 保存通过原始 HTTP 200 及回执核对，读取通过表单刷新与独立数据库结果核对。

本轮未发现需要修复的安全、持久化或交互缺陷。合成预演修正了验收驱动对共享字段、稳定记录身份、项目子记录和站点初值的断言，并合并多记录栏目刷新，避免重复启动页面耗用额度。应用代码和 SQL 合同均沿用原候选版。TypeScript、ESLint、构建、33 项定向回归及 Chrome/原生 Safari 合成预演通过。独立 Codex CLI 审查仍沿用此前的账户模型不可用记录，集中交付时保留 GitHub 官方审查。工作台概览仍显示 Version 15 的「站点服务尚未接入」与线上保存、发布提示，编辑器中的本机保存已分别验证。

## 数据库与回执

Chrome 以 Alice 提交 15 条真实保存，原生 Safari 以 Bob 提交 1 条。16 条原始保存响应均为 HTTP 200 并返回已保存状态。两次独立 PostgreSQL 读取从数据库侧核对了两位 Owner、16 个原键、摘要、revision、内容、历史及可用审计证据。Alice 操作结束时 Bob 的修订数为 0。Safari 保存后 Bob 仅有其自身 Profile 第 1 版，Alice 的 15 条证据全部仍匹配。发布和 Outbox 均为 0。

| 示例 | revision | request_id | 回执摘要前缀 |
| --- | --- | --- | --- |
| Alice Introduction | 1 | `a78b0e0f-1e70-4126-86f3-36a940e107c4` | `3c423a0aa4acdd79` |
| Alice Skills 编辑、删除与排序 | 2 | `87400191-95d9-44ac-90be-73c8262924fc` | `f1b6947f2f46b3e1` |
| Bob Safari Profile | 1 | `b850b497-ef7a-4aac-ad3a-66609b21d55d` | `8d87b1d8a035bc7b` |

实跑绑定提交 `f022f6ec0fde78cf2a8bcf32e6c7009d9a4eac66`。PostgreSQL 17.12、GoTrue 2.198.0、PostgREST 16.6 与构建产物的身份均记录于运行清单。M1–M7、S3.6 01 与 S4.7 01–03 摘要与 C2 r02 相符。两位 Owner 在开表时至少还有 1,799 秒的 Session、JWT 与 Grant 有效时间。实际业务开窗为 10.856 秒，上限为 20 分钟。开窗前在关闭状态验证了 PostgREST schema cache 与 RPC 授权。

## 预算和安全退场

| 项目 | 实际／上限 |
| --- | --- |
| 真实本机环境 | 1／1 |
| 文本 HTTP，含 Worker 和原生两跳 | 291／360 |
| 用户显式保存 | 16／30 |
| 原生保存入口 | 16，合计两层入口 32 |
| 原键查询类 RPC | 4／12，来自闭态／缓存探测，验收期间无待核对原键 |
| 独立只读 SQL 观察 | 17／24 |
| 密码登录／短时 Grant／短代次 | 4／4，4／4，1／1 |
| 新增云费用 | US$0 |

独立连接确认业务门、文本写入、公开读取及 Outbox 均已关闭。活动 Grant、代次、Session、刷新令牌、额外数据库连接、临时可登录角色和 RPC 执行授权均为 0。业务和文本闭态约束已验证，测试钩子不存在。独占数据库目录、Unix socket、GoTrue、Users Worker、Chrome 验收实例、Safari 自动化会话及 WebDriver 已关闭和清理。保留 19 张脱敏截图和运行证据。

- [截图索引](../../../example-cv-users/.runtime/s4-7/s47-user-acceptance-r01/SCREENSHOTS.md)
- [脱敏回执](../../../example-cv-users/.runtime/s4-7/s47-user-acceptance-r01/receipt.json)，SHA-256 `9bc9ed57df073ee0c98baf814149faef4e83c9bcde1e6cd0785add39029fbf68`
- [运行清单](../../../example-cv-users/.runtime/s4-7/s47-user-acceptance-r01/manifest.json)，SHA-256 `fbd3a1d6c8a6b79586befea6f420fb99ce5e2a06be8ed623737fde02c6cb91f4`

## 集中 GitHub 交付

本次 GitHub 写入为 0。远端 main 只读核验为 `c0a9588254fab69e379d66e501b4e434d392e41c`，生产 Version 15 流量为 100%。生产、B07、现有 Docker、旧 CMS 和 Public 环境保持现状。新的交付授权后，将当前候选分支集中 Push，创建单个 PR 提交完整 S4.7 本地证据摘要，等待 GitHub CI 和官方 Code Review。Merge、线上验收和生产部署使用各自的批准流程。
