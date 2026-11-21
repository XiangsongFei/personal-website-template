# S3.6-A2 隔离 PostgreSQL 闭态验收候选

**PREPARATION_ONLY / EXECUTION_BLOCKED / REAL_NOT_RUN**。基线 main 为 `e6b4e33441adbbcab8b0f30734bcc4b4c9750e12`，tree 为 `42f10fd187799f256aff736beeed10830c098e6f`。真实动作预算为 0，两个运行的 SID 均为 `NOT_YET_OBSERVED`，A07/A50 参考摘要留空。S3.5 仍为 HOLD。

## 隔离和硬上限

Mac 只读检查观察到 Docker Desktop 29.8.1、Linux ARM64、containerd overlayfs、cgroup v2 和 80 个普通 `local` 卷。当前 Desktop 上没有已验证的单卷 4 GiB 硬配额。容器可写层的容量限制覆盖可写层，命名卷有独立生命周期。Desktop 的 Docker.raw 总上限约束整台共享 VM。宿主剩余约 62 GiB 是容量观测。用量阈值和 `df` 是监测。保留真实证据要求持久卷。 [Docker 卷](https://docs.docker.com/reference/cli/docker/volume/create/) · [容器选项](https://docs.docker.com/reference/cli/docker/container/run/) · [Desktop 设置](https://docs.docker.com/desktop/settings-and-maintenance/settings/)

为 reference 与 candidate 顺序使用两个全新 ARM64 Linux VM 生命周期。Mac 的虚拟化支持已观察到，VM、Engine、虚拟磁盘和实际配额均未设置。每个 VM 只承载本次 Engine 和一个 PostgreSQL 17.11 容器，PG 镜像固定为 `manifest.json` 中的 ARM64 digest。准备一个 **4,294,967,296 字节固定容量块设备**，同时承载 Docker data-root、containerd root、命名卷、容器可写层及日志。用单独固定容量的 OS 盘与本地有界日志/证据目录。虚拟盘固定尺寸并禁止在线扩容，宿主预留实际容量；禁止共享目录、宿主 bind mount、特权容器和远程 Engine。限制 guest 内存/CPU 与工作负载日志，包括 stdout/stderr、Docker 日志、stage scratch、审计日志和 OS 外写。规划的 VM 外层上限为 2 vCPU、3 GiB RAM、12 GiB 固定 OS 盘、64 MiB 每次运行的独立证据配额。一次只允许一个 VM 活跃，两套证据/磁盘保留时预留至少 40 GiB 宿主可用空间，启动前复核。宿主固定虚拟盘的实际分配及容量按选定平台重新取证。 [QEMU 磁盘格式](https://www.qemu.org/docs/master/tools/qemu-img.html)

预先绑定经审查的 VM 配置、Engine Unix socket、离线镜像、执行适配器和外部 watchdog 摘要。R0 前在同一空闲块设备上用独立的、只用于配额检验的文件验证到达边界出现 ENOSPC。记录设备字节数、文件系统和 Engine/volume mount 的设备映射、镜像架构、磁盘与日志隔离、cgroup 执行值。将取证文件及 VM、Engine 标识写入签署输入。该检验仅在单独获准的空白卷之前执行。PostgreSQL 运行时禁止填充 PGDATA。设备、限额、挂载或隔离有差异立即 STOP。启动数据库后再核对 PGDATA 的实际映射。断线、磁盘写满、超时或无法识别进程时保留证据。不扩大磁盘、重新派发或删除资源。

容器固定 1 CPU、1 GiB RAM、128 PIDs、零宿主端口、零特权、restart=no，只接本次 internal network，数据库仅经容器内 Unix socket。Engine 与 VM 均无外部业务路由。HBA 文件和生效规则须独立核准其摘要，限定容器内本地专用角色和认证方法。R0 须证明镜像 entrypoint/hooks、环境白名单、readiness 方式、磁盘映射、进程和网络状态。查出所有同名/同标签冲突并拒绝复用。再将完整容器/Network ID、Volume 实际路径身份、三种资源 Run 标签、镜像、HBA、宿主只读控制文件 SID、OID 10 SQL SID 和 backend lease 绑定。R1/R2 带签署后的 SID 和目标摘要。真实目标从未创建。

## 控制器和预算

`executor.mjs` 实现 R0、R1、REF 或 R2、一次可选 A50、一次 CLOSE。每次 phase 消费前验证批准、目标和固定 SQL 字节。所有被派发的 SQL 用冻结 PG-only 的 lexer/framing 逐条发送。首次用同连接检查 PG17.11、Unix socket、实际/会话角色、PID、启动时间、SID 和超时参数。成功终态需显式 COMMIT/ROLLBACK 与新的只读 OID 10 会话确认原 PID+启动时间消失。名称、角色、SID 和 SQL pin 漂移不自动修复。私有目录内 Engine 和 Run 的排他锁、BEGIN/END 回执写入后 fsync，锁和账本保留。所有执行必须通过唯一受信 supervisor 及其同一个 journal root。

适配器只接受指定的 `observe`、`hostAction` 和 `openSession`。每个操作收到绝对单调 deadline 和 AbortSignal。适配器必须以目标完整 ID 执行固定命令，校验每个 R0 创建后的新资源与前一步回执，不可依赖名称执行 stop。观测必须独立获取设备/限额及数据库控制文件证据，核对运行的进程、角色和网络附属关系。只读观察使用无启动脚本、固定本地 socket、禁重连的 psql 会话。运行和停止均核对同一容器的网络配置关系。运行时唯一活动 endpoint 必须是当前容器，停止后活动 endpoint 必须为零。进入 ACL/Auth/Catalog 的会话启动参数设置 `ecv_s36_a1.expected_system_identifier`。退出证明使用单条固定只读 SQL；检查角色、SID、backend PID 和开始时间、独立客户端退出。只写入必要的摘要和最小脱敏状态。

代码没有默认宿主适配器、可连接的入口或批准密钥。只有经独立审查的适配器与签署 verifier 能交给它真实传输。签署范围包含精确 Git SHA、profile 摘要、阶段预算摘要、命令序列和输入 pin、有效期、适配器/watchdog 摘要。R0 之后加入 SID 和目标摘要，R2/A50 再绑定独立参考摘要。签署检查由 supervisor 提供，当前目录只带未授权的 manifest。控制器的 JS 超时会切断后续派发和中止信号，外部 fence 必须实际限制子进程、数据库内部工作和超时后的写入窗口。

| 阶段 | 工作 SQL / 累计显式连接 / Docker CLI 上限 / Native | 保留 SQL / 连接 / Docker CLI 上限 | 工作 / 保留 |
| --- | --- | --- | --- |
| R0 | 9 / 2 / 34 / 0 | 0 / 0 / 13 | 150 s / 60 s |
| R1 | 455 / 20 / 79 / 1 | 2 / 1 / 14 | 480 s / 60 s |
| REF | 211 / 12 / 40 / 0 | 2 / 1 / 14 | 190 s / 60 s |
| R2 | 394 / 18 / 58 / 0 | 12 / 4 / 25 | 270 s / 60 s |

预算包括每个 SQL 阶段自己的连接和身份语句，加一条独立退出观察语句与连接。Docker CLI 数含目标/Engine 观察（每组最多四次）、固定动作、psql 启动和观察。R0+R1 合计工作上限 464 条显式 SQL、22 次显式连接、113 次 Docker CLI、1 次原生调用和 630 s。选择阶段预留只用于一次止损，CLOSE 后即结束。R2 预留含一次明确的错误回滚、原事务退出证明、一次 A50（七条投影语句及两条身份/退出语句）和当前资源停止确认。固定 SQL 单步 24 s，语句 5 s，锁 1 s，事务 12 s，空闲事务 8 s。Auth migrate 子进程 150 s，一次启动。R0 四个宿主动作每个 10 s，固定观察每组 6 s，停止最多 18 s。全生命周期按 R0 首次派发计时，reference 最长 880 s，candidate 最长 960 s，含审批等待与最终预留。外部 watchdog 必须独立执行全生命周期和每个最长子进程窗口，超时后收紧写入范围并保存证据。

R0 仅限镜像 entrypoint/bootstrap、无重复启动、readiness 和初始只读账本。要在审批输入中固定 OCI config、实际 entrypoint/hooks、命令与 readiness 上限，确认全部是该隔离设备上的固定路径。R1 一次 stage + 官方 GoTrue v2.197.0 `auth migrate`，静态二进制的 pin 为 `8f1b2078529333c0e5b57d31e0d4fece8aa24e2669e5c9c9f49e0e950825a82e`，仅 `supabase_auth_admin`、本地 socket、`auth` namespace，固定私有路径，最小环境，无公网与 Auth 服务。之后以 OID 10 运行 A1 ACL 事务和独立 readback，再以 postgres 运行 M1–M7 七个事务，OID 10 读回 M7 基线。只读检查空 Users/Session、七个初始版本、82 个最终版本、owner/RLS、业务闭态及 Auth 有效权限，拒绝宽权限或额外继承路径。M8–M11 只作历史来源。

75 个 Auth up 文件和 225 条词法 SQL、ACL 内 16 条 RESTRICT 撤销，以及 PostgreSQL 镜像内部 init hooks 和原生 ledger/驱动语句属于内部工作。原生迁移的累计连接/语句数未测，`max_connections=10` 仅限制同时连接。审批须接受这些内部计数未知的风险，并独立证明固定镜像与二进制、一次 invocation、无外部路由或其他 client、只允许写当前私有实例、外部截止时间、CPU/内存/PID/磁盘硬上限和有限日志。缺少独立的硬约束证据时保持 BLOCKED。原生迁移可能部分提交，失败回读账本后保留状态，不重跑。

## 两份独立参考

历史 R2 顺序为 A00 → A01 故障 `22012` 后明确 ROLLBACK → A02 → A03 提交 01 → A04 故障 `22012` 后明确 ROLLBACK → A05 → A06 提交 02 → A07 → A09。历史 A07 `control/read/30-final-catalog.sql` 15 条，以 postgres 运行。历史 A50 `control/read/50-unknown-reconcile.sql` 16 条，以 OID 10 运行。A2 两者均改用 A1 OID 10、只读 repeatable read 投影，各 7 条，SHA-256 `a4bd3f0a112adc02ff69cf750913bc37262c853085080427be46b2ccd4278eae`。A00/A02/A05 保留固定历史 SQL 和 postgres 身份，使用只读会话。A09 原样保留并独立验证根门与三个文本门。Driver 与所有原始 SQL 摘要在 `manifest.json`。此前原件留在 Mac 历史包。01/02 带原有前向约束变更，真实执行先审批其精确原件。无 Migration 历史修改。

REF 在独立 VM/Engine/SID 上走 R0、R1、A00、A03、REF_01、A06、REF_02、A09 和 CLOSE。两个检查点使用独立会话与回执。REF_01 固定 **A50 的 M7+01**，要求无 02 对象、角色或权限边。REF_02 固定 **A07 的 M7+01+02**。用 A1 源码目录合同核对完整 role/ACL、RLS、constraints、indexes、triggers、function body 等投影。两份完整只读投影随各自原始回执写入私有 journal，并导出可审批 canonical digest。参考包需要已观察到的不同 SID、Engine、VM、目标、两个观察回执、A09 和已核验的停止回执。由独立审查者核对后锁定整包摘要。待测目标只与已批准参考比对。真实参考及候选均为 NOT_RUN。

A50 仅在 A03 已明确 COMMIT、A04/A06 失败、原 lease 已识别时允许一次只读对账。必须证明原 PID+启动时间退出，再读同一目标的 M7+01 投影。只有原失败为明确 ROLLBACK、原退出独立可证、独立 A50 匹配才分类 `PARTIAL_CLOSED`。丢失原 COMMIT/ROLLBACK 回执或退出证明保持 UNKNOWN。无自动重试或其他写入。身份可证、无活跃事务或 worker，且有 CLOSE 授权时只停止当前 ID，独立复核 ended/PID 0。资源和回执均保留。未知身份走外部隔离与只读对账，人工决定后续。禁止对其他资源发送停止或清理命令。

## 供后续签署的最小窗口

以下为签署文本，需先填实际资料与摘要。所有真实动作仍未授权。符号 `<id>`、`<sha>`、`<sid>` 等必须以取证值替换。

- **独立 reference** · Run `7183381d-7806-4298-9e48-5659471c6521`，全新 VM `s36-a2-ref`。可合并预授权 R0 → 仅在 SID 与目标读回成功且授权器签发绑定后 R1 → M7 通过后 REF → CLOSE。签署文字为“批准 reference run <id> 在隔离 profile <sha>、候选提交 <sha> 下按表中 R0、R1、REF 与 CLOSE 操作；用 <fence/adapter sha> 限制执行；仅在各检查点通过后连续，发生 STOP/UNKNOWN 禁止继续写；保留两份目录和停止证据”。空设备配额探针与 VM 证据需在 R0 激活前获准并完成。结束后独立审查两份目录并签署参考整包摘要。
- **R0** · Run `e0ea00ca-70cc-4452-a726-e68790298fcd`，另一个全新 VM `s36-a2-target`。在两次运行严格顺序且 reference 已停止的前提下签署“批准 candidate <id> 在 profile <sha> 下按 R0 预算建立一个容器、一个专用命名卷和一个内部网络；仅初始化 PG、进行只读身份/初始账本观察及后续同批次安全停止；不运行 Auth 或业务迁移”。资源名均为 `s36-a2-<id>` 加可选 `-data`/`-internal`。实际运行路径绑定私有 VM/Engine socket 与受信 journal root。先备妥上述空设备取证、历史 SID 排除、冲突清单、镜像/启动和 HBA pin。
- **R1** · 同一 candidate Run，填已核验 SID 和目标摘要。签署“批准候选 <id>、SID <sid>、目标 <sha> 按 R1 预算 staging、一次固定的 GoTrue migrate、A1 ACL/readback、M1–M7 及独立基线检查，保留一次有界关闭”。可与 R0 一次条件批准，前提是 verifier 在 R0 检查点按签署规则绑定实际 SID，并且先接受原生内部动作的硬约束。
- **R2** · 同一 candidate、SID、目标；先通过 R1 且参考真实完成并批准。签署“批准 <id>、SID <sid>、目标 <sha>、独立参考整包 <sha> 按 R2 预算执行固定 A00–A09；只批准符合条件的一次 A50、失败只读对账以及只停止当前资源”。逐字 pin、比较器和两个不同摘要属于批准输入；缺任何一项保持 BLOCKED。整个窗口无业务 HTTP、外部投递、Auth serve 或 Gate 打开。

目前最少需要三组证据：有固定容量和独立 watchdog 的实机隔离及审核过的适配器；独立 reference 的两个已封存目录和停止证据；候选 R0/R1 实际 SID、Auth/ACL/M7 独立回执。本 PR 的测试和审查只能提供离线证据。因此 **未达到 `S3_6_A_REAL_EXECUTION_APPROVAL_READY`**。

## 离线复现

在 Users 目录运行 `node --test tests/s3/s36-a2.test.mjs`。若持有原始 PG-only 包，可在同一命令设置 `ECV_A2_ARCHIVE` 指向其根目录，通过字节 pin 验证原始 SQL 并完整运行 mock reference、候选、已回滚与 UNKNOWN 分支。测试用临时 journal、合成 SID 和 mock 传输，四个需要私有历史 SQL 的用例在公开 CI 没有输入时跳过。两种测试均无需 Docker 或 PostgreSQL。
