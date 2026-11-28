# S4.7 Batch C2 定向本机真实验收

## 结论

获批唯一运行 `s47-all-text-acceptance-followup-r01` 以 `STOPPED_AND_CLEANED` 结束。G-READ 保持 `LOCAL_PASS`，G-SAVE 保持 `LOCAL_CORE_PASS`。本轮增加了原生保存 RPC 同键重复 POST，以及六个自定义栏目中文和英文界面联动的真实 PASS。Skills 排序操作与断言不一致使运行安全停止，当前未达到 `S4_7_USER_ACCEPTANCE_READY`。

此前 r01 的 UNKNOWN、Introduction r02 的 PASS、Batch C 的 STOPPED_AND_CLEANED 原样保留。[Batch C 报告](BATCH-C-LOCAL-ACCEPTANCE.md)

## 运行绑定和证据

| 项 | 值 |
| --- | --- |
| 实际代码 | `d27642c3295ea9807db080dcddba2da75ce317fd` |
| 执行前 GitHub main 与 origin/main | `c0a9588254fab69e379d66e501b4e434d392e41c` |
| 生产只读核对 | Deployment `9af7cb4e-3e42-4a7a-bbf3-c6e2f4fafadd`，Version 15 `08768067-69e7-4e7c-8813-12cf7b8ccc0e`，流量 100% |
| 隔离服务 | PostgreSQL 17.12 和 PostgREST 16.6 独立 Unix socket，GoTrue 2.198.0 和 Users Worker 仅回环 |
| 执行角色 | PostgREST 连接为 `ecv_s3_internal_api_login`，正常用户请求为 `authenticated` |
| 清单 SHA-256 | `fdbb1afb1d5f4ddaa330cf1be98a4d844152343e895595817ef5fbc0207ec7a5` |
| shutdown 原始回执 SHA-256 | `7ecb0902f89f9e3320ef895682c268253ab166e22d4c578b99793d583b85fbc0` |

闭态核对并安装了 M1–M7、S3.6 01、S4.7 01–03。已核对 schema cache 刷新及实际闭态探测，随后开闸。完整 SQL、二进制、目标和驱动摘要在 `example-cv-users/.runtime/s4-7/s47-all-text-acceptance-followup-r01/manifest.json`。C2.1 的两条原生保存请求、脱敏 UUID、摘要和清理证据在同目录的 `receipt.json`。

## 逐项结果

| 用例 | 结果 | 真实证据或缺口 |
| --- | --- | --- |
| C2.1 原生重复 POST | **PASS** | 首条 Chrome 保存经 Worker 进入 `save_text_draft`，第二条 POST 以原 Session、同一规范请求体直达隔离 PostgREST 的同名保存 RPC。两条原生记录都是 200，request ID 相同。回放返回原 revision 1、changed 和请求键，规范摘要相同。独立 PostgreSQL 前后对账均为 Alice revision 1、Bob revision 0、历史共 3、审计 1、操作 3、有效写入记录 1，Outbox 0。两个建站操作和两个基线历史包含在全局计数内。 |
| C2.2 退出重登 | **NOT_RUN** | 真实 GoTrue 首次登录和 Chrome 双语保存通过。退出、新 Session 回读、旧 Session 失效及其前后对账尚未执行。 |
| C2.3 自定义栏目标题 | **PASS** | 网站文字的五个标题与 Contact 标题共六个写入真库。Chrome 在直达及栏目切换后验证中英文侧栏、编辑器标题、面包屑、预览。分别验证中英文未保存栏目名，记录标题改动不改变栏目名。 |
| C2.4 重叠与双标签页 | **PASS 子项，余项 NOT_RUN** | Chrome 两标签页重叠发出 Profile 和 Skills 保存。原生保存均返回 200，两条不同 request ID 各自的 Worker 规范正文比较通过。断言停止时尚未做原键回执恢复、陈旧 revision、dirty 持续、刷新不重发及旧 Session 元数据检查。浏览器层两项仍在未决，目标库退场，后续再跑需建立新 Session 和新原键。 |
| C2.5 Skills 预设 | **首存 PASS，修订排序检查 FAIL，刷新 NOT_RUN** | 真库初始 Skills revision 0 的正文为空，Chrome 明确采用三个预设后保存，原生 HTTP 200，Worker 返回三个预期标题及 revision 1。编辑、删除和排序的第二个保存返回原生 HTTP 200，Worker 返回内容与提交相符。驱动只把第三条上移一位，删除该时处于第三位的记录后，顺序是第一、第三。断言将顺序写成了第三、第一，导致真实验收停止。未获取修正动作后的真实回读。 |
| C2.6 授权和 Session 过期 | **NOT_RUN** | 开闸后的合法读写真正到达了原生 RPC。定向撤权、过期后对同一 RPC 的拒绝和独立无副作用检查尚未执行。安全收尾的撤权归零属于退场证据。 |
| C2.7 浏览器 | **Chrome 已执行，Firefox、WebKit、原生 Safari 真实 NOT_RUN** | Chrome 的双语写入及标题联动见上述。Bob 的 Firefox／Playwright WebKit 真实 HTTP 回读与原生 Safari 真实读尚未执行。历史合成浏览器记录保留。Edge 未安装。 |

目前定位到的是验收驱动的排序操作与预期不一致。修正将第三条按记录身份上移两次，再按记录身份删除第二条，随后修改首条。真实 Worker 回执检查也前置到排序断言之前，记录原键和摘要。Chrome 合成补测使用同一修正后的操作代码，验证初始采用、稳定 UUID、修改、删除、排序、revision 2 和刷新回读通过。此补测只支持驱动修正。31 项定向测试、TypeScript、构建及改动 ESLint 通过，未变更生产业务代码和 SQL。

Codex CLI 独立审查再次因当前账户不支持所选模型未完成。已复核改动限定于验收驱动及报告。GitHub 官方 Review 保留到集中交付。

## 安全退场

文本 HTTP 76／180。保存入口 11／16，其中 Worker 4，原生 7。原键查询 4／12。SQL 观察 14／24。登录 3／4，Grant 3／4，代次 1／1。云端新增费用 US$0。

独立关闭核对确认业务与 S4.7 物理闩有效，文本写入、公开读取、Outbox 关闭。活动 Grant、代次、Session、刷新令牌、临时角色、数据库连接、RPC 授权均为 0。专用数据目录、socket、进程、回环监听及运行工具副本均清理。生产、B07、Docker 既有资源及 GitHub 写入均为 0。

## 剩余工作与手动验收方案

真实补验须单独授权新运行 `s47-all-text-acceptance-followup-r02`。建议沿用同样的本机边界与上限，只跑 C2.2、C2.4、C2.5、C2.6 和未执行的 C2.7。复用 C2.1 和 C2.3 的真实证据。新运行使用独立数据目录。

已准备 `--follow-up-r02`。该入口保留旧运行的一次性保护，核对并在新清单绑定旧回执与清单的 SHA-256。新站只保留复测需要的初始写入与剩余用例，省去已真实通过的同键回放和标题矩阵。Firefox 或 WebKit 的读回缺口会单独登记，余下授权复查仍继续执行，最终结果保留未通过状态。运行前须重查生产版本和新目标运行边界。新入口尚未真实启动。

使用构建后的 Users Worker、本机合成 Auth 与内存 Repository 直接演练了新入口的剩余场景。Chrome 通过两条重叠保存的原键独立恢复、继续编辑和跨栏目 dirty 保留、Skills 稳定 UUID 及 revision 2 回读、退出重登后回读、旧 Session 拒绝。Firefox 和 Playwright WebKit 均收到 Bob 的实际 Worker HTTP 200 与 revision 0。撤权和过期用例通过模型演练，其独立 SQL 合同仍待真库验证。GoTrue 的真实退出需观察旧 Session 行和刷新令牌状态。[Supabase 会话文档](https://supabase.com/docs/guides/auth/sessions)

达到手动准入后，另行批准启动。拟使用本机专用 `https://localhost:19147`。启动预检须确认该端口空闲，在新目录建立本机 PostgreSQL、GoTrue、PostgREST 及当前 Dashboard。两套一次性合成 Owner，各自建站，密码只在当次本机交付，报告只留脱敏证据。建议每个会话与 Grant 各 15 分钟，操作窗口 20 分钟，支持一次正常重新登录。建议上限 240 次文本 HTTP，含内部请求，以及 30 次用户显式保存，实际阈值随批准固化。

手动路径为 Chrome 或原生 Safari 登录，读写全部文本栏目，检查双语及时回读及标题，执行多记录新增、修改、删除和排序，再刷新、退出、重新登录及换另一账号。遇到待核对先按原键和当前 Session 查回执。操作窗口终止后先关闸、撤权、清零 Session 和代次，独立观察确认后停止浏览器、Worker、GoTrue 与 PostgREST，再停止数据库并移除数据目录和 socket。保留脱敏报告及预算清单。当前未启动用户手动验收环境。
