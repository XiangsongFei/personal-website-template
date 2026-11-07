# GitHub 交付前整理结果

> **2026-11-07 日期说明：** 本文是历史GitHub交付前整理快照，保留原构建、文件清单、测试数量及“后续批准边界”。
>
> 后续合并、发布关联链与生产验收范围见[生产上线结项记录](S2-PRODUCTION-CLOSEOUT-2026-11-07.md)；旧清单不冒充当前交付范围，本次文档准备也不包含Commit、Push或PR授权。

本轮完成HTTPS工具依赖整理与脱敏文档，不执行Git暂存/提交/上传、云端操作或真实认证。S2本地完成结论保留，统一GitHub提交仍需用户批准。

## 工具来源与迁移映射

|整理前|交付位置|方式/范围|
|---|---|---|
|历史探针 scripts/https-mock/config.mjs|scripts/https/identity.mjs|仅抽取checked、readPublicCertificate、validateCertificate、loadServerIdentity；更换包根及固定材料位置，保留文件所有者/权限/无符号链接/单硬链接、同步TLS消费与密钥缓冲清零|
|历史config中的公开固定指纹|scripts/https/policy.json|公开leaf/issuer指纹、精确来源、现有Node版本和二进制摘要；没有证书、私钥、账户或信任状态|
|两HTTPS入口中的个人Node绝对路径|scripts/https/node-identity.mjs|当前进程PID、process.execPath实际文件、所有者/不可组写及相同版本/完整二进制摘要；不按node名称或argv0放行|
|本机B批 leaf-trust-control.py|scripts/https/leaf-trust-control.py|复制适配必要代码，用户/钥匙串路径运行时推导，本地快照放固定忽略区；仍只管理当前用户精确leaf的SSL用途，无主机PolicyString，不写admin/system|
|本机B批 read-leaf-effective.py|scripts/https/read-leaf-effective.py|只读同leaf+issuer链、127.0.0.1 SSL用途，无额外anchor、exception或网络取链；有效期/用途先预检，显式与有效恢复分开|
|证书/Node/系统信任预检|scripts/https/preflight.mjs|只读、无监听、无认证、无Keychain写入；缺少材料或系统不信任则拒绝|
|local-https/controlled-https导入|原scripts文件|改为包内模块；来源、传输、Cookie及停止函数保持原样|
|执行器个人邮箱字面量及相关纯配置测试|scripts/controlled-real.mjs、4个mini/受控测试|等价SHA-256比较，原UID摘要和额度/阶段不变；公开测试仅合成邮箱，纯审批状态与账户pin分别验证|
|旧fingerprint工具|scripts/fingerprint.mjs|工具清单扩展包含新增Python/JSON，不排除变更以保留旧工具哈希；业务覆盖范围不变|

没有迁入历史探针的后端、网关、应用页面、Mock运行框架、历史构建、沙箱策略或凭据。原目录与历史记录未移动、未删除、未覆盖。其他项目仍可使用其原工具。

受控工具的邮箱摘要属于脱敏固定绑定，不是放宽到账户可任意指定；本轮用原批准配置及变体作60组纯离线比较，脱敏前后判断一致，无执行器或上游被启动。临时重构出的原模块完整文件哈希与本轮开始记录匹配，比较后已删除该临时副本；原始历史文件不变。

信任工具仍排他记录每条系统写命令，UNKNOWN不重试。新增检查要求安装前存在同条件不受信任有效基线，收尾可用--compare核对；已有记录/公共项不满足支持的无记录基线就停止，不覆盖原信任。代码已交付，**本轮没有实际Keychain读写或再次进行证书兼容性试验**。未来原生系统操作仍需独立批准。

## 版本与验证

业务源码/config/锁文件 SHA-256保持：
`676c5c7c083f63be14c71be12dd79ccab67ec504bd7d89887bcb05ed8e29a1df`。

原真实产物仍为：
`b268ae32fc9b494136911ee7d1bf3a36e49c138a3dca219bd31bee0204568cc2`。

整理后工具 SHA-256：
`22dc75d57b994a5e0b82b30639f1d86a77708999c31399365001a7251b98b0bf`。

没有重建/覆盖原已验收dist或历史清单。为完成构建验证，在仓库外新建仅含交付候选的临时独立包，没有历史探针、运行记录或TLS材料；复用现有锁定node_modules的显式链接，没有联网安装、升级或远程绑定。该验证是源码/工具独立性检查，不是完全重新安装依赖的干净系统实验。

- 独立包构建退出0，类型检查退出0。
- 使用独立新产物运行79/79项隔离回归，失败/跳过/取消0；涵盖正常业务、受控传输、DO重建/原子消费/UNKNOWN及停止保护。
- 后续只修改SSL基线文件检查，对受影响TLS工具再复核4/4；不将重叠数量相加为83个独立用例。
- Node正确进程与完整摘要通过；错误摘要拒绝；证书指纹/CA/SAN/EKU/日期、文件所有者/权限/符号链接/硬链接的负向检查通过。
- 独立环境没有TLS材料，HTTPS预检因ENOENT在系统信任/监听/认证之前拒绝，符合预期。未为测试复制证书或私钥。
- 新路径测试首次3/4，夹具使用macOS的/var符号链接路径而被安全检查拒绝；仅改测试夹具为真实路径，最终4/4。没有为通过而放宽检查。

独立构建业务输入与原构建逐字节一致，但生成产物为
`757ea81bc1ee7e9732aed4a2f034c27ef565ea240681d4f1664b5ff6b70771e1`。
观察到新BUILD_ID、chunk/manifest标识和共享node_modules解析路径不同；不声称可逐字节复现原产物，也不给这个新产物赋予真实验收PASS。原真实证据仍绑定原b268…产物。dist本来不属于GitHub源码交付。

三个证书/TLS函数的函数体与原实现逐字一致，路径检查仅更换错误标签；两启动器除导入与Node检查外，完整源码可还原为原文件哈希，停止/传输函数没有改动。

详细脱敏验证输出见[evidence/delivery-verification.json](evidence/delivery-verification.json)。完整日志、独立路径和保护清单保留本机忽略区，不公开个人路径或原始运行材料。

## 文档与建议提交范围

当前说明仅保留一份职责来源：README负责启动；ARCHITECTURE负责架构/复用；CONFIGURATION负责变量/策略；TESTING负责测试/HTTPS/撤销；S2-CLOSEOUT负责结项及UNKNOWN；RELEASE-CHECKLIST负责未来发布；本文件负责本轮整理和提交范围。LOCAL-HTTPS改为短指引，避免复制过期整套说明。

建议仅纳入以下分组，并以[最终逐文件清单](evidence/github-files.json)为准；清单不是git add指令。

1. app/、lib/、worker/、package.json、package-lock.json、next/vite/tsconfig/wrangler及生成类型声明：现有独立应用和配置，业务未改，生产disabled。
2. scripts/及tests/：包内TLS工具、现有受控执行器与合成测试、锁定Node/证书公开pins；不含可执行批准批次、真实凭据或材料。
3. README.md、LOCAL-HTTPS.md、RELEASE-CHECKLIST.md、docs/和.gitignore：脱敏说明、最小验收摘要、完整源码/工具/产物哈希清单及本轮验证摘要。

必须排除：.runtime/、evidence/旧原始材料、LOCAL-RESULT.md历史快照、dist/、node_modules/、.wrangler/.vite/.vinext/.next、output/、.playwright-cli、.env/.dev.vars、TLS证书/私钥、信任导出、SQLite/WAL、HAR、真实Token/Cookie、浏览器profile、原始日志。原文件继续本地保留，未删除或篡改；.gitignore新增公开证书/私钥扩展名等保护，避免将来材料换位置后误收。

本轮对3537个原有包外文件和131个真实批次历史文件逐字节复核，均与开始时一致；旧CMS已跟踪差异摘要、HEAD和空暂存区也未改变。旧resume-admin/、公站及根目录其他任务的既有修改不纳入本轮；不得整仓暂存、清理或覆盖。历史记录保留在原处，最终脱敏摘要只记录账户代号、结果、计数和原文件哈希，省略个人邮箱和UID。

## 后续批准边界

本轮完成后具备申请统一GitHub提交的条件；未执行git add、commit、push、PR、merge、rebase或部署。新工具版本仅有隔离验证，旧批次不能续跑，新真实操作须重新批准。

未来正式主机、旧CMS独立入口、Users Worker/DO云端资源、精确回调/Access/HTTPS和数字码邮件配套切换等，继续按发布清单单独批准。尚未真实等待一小时验证自然到期刷新，不以主动刷新替代。

## 实际修改文件

修改12个既有文件：

- `.gitignore`、`README.md`、`LOCAL-HTTPS.md`、`RELEASE-CHECKLIST.md`。
- `scripts/local-https.mjs`、`scripts/controlled-https.mjs`、`scripts/controlled-real.mjs`、`scripts/fingerprint.mjs`。
- `tests/controlled-real.test.mjs`、`tests/registration-mini.test.mjs`、`tests/session-mini.test.mjs`、`tests/mutation-mini.test.mjs`。

新增工具/测试8个：`scripts/https/identity.mjs`、`node-identity.mjs`、`preflight.mjs`、`policy.json`、`leaf-trust-control.py`、`read-leaf-effective.py`（均在scripts/https下），以及`tests/tls-tools.test.mjs`、`tests/fixtures/tls-policy-offline.py`。

新增文档为`docs/ARCHITECTURE.md`、`CONFIGURATION.md`、`TESTING.md`、`S2-CLOSEOUT.md`、`DELIVERY.md`；新增脱敏资料为`docs/evidence/real-acceptance-summary.json`、`build-manifest.json`、`delivery-verification.json`及`github-files.json`。其余新增运行日志和保护哈希清单仅在本机`.runtime/github-handoff-20261105`，不纳入交付。

`app/`、`lib/`、`worker/`、依赖锁文件及业务构建输入均未修改。没有新建或嵌套Git仓库。独立临时包及其合成状态已定向移除，依赖链接只被解除，原node_modules未删除。8787/8795无监听；没有终止其他开发服务。
