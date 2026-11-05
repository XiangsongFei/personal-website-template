# S2 最后两项依赖安全修复（Round 3）

日期：2026-11-05，Asia/Shanghai。分支 `codex/s2-users-remediation-20261105`，HEAD 仍为 `5136030888dda7d095efa84e779e5c513a1f3107`，基础 main `a0a82f30b3e5129f7a68d9e6dfe2693fb7eaa8a2`。没有新 Commit、Push、PR、部署或云端写入。

## 结论

**包级安全门禁 PASS：完整 npm audit 的 Critical/High/Moderate 均为 0；生产依赖审计为 0。** fflate 与 Node 内建 undici 两项已完成实际修复，新 Node 下本地 85/85、门禁 28/28 通过。

**全部要求的验证尚未完成**：实际 Safari/Chrome 系统可信 HTTPS 合成复测 NOT TESTED。当前 worktree 无验收绑定的证书/私钥材料，历史临时信任已撤销，本轮明确禁止 Keychain 写入；不能把隔离进程显式信任的握手、HTTP 浏览器或自动化 Chromium当作系统可信双浏览器通过。因此不使用“全部检查通过”的结论，也不自动进入真实验收。最小剩余动作见末节。

## 1. fflate 的实际升级路径

安装前 Satori **0.33.5** 精确依赖 `fflate: 0.7.3`。继续升级 Satori 会扩大已批准父包范围；本次不改 Satori/Vinext/React，使用官方修复同分支 **0.7.5**，只在 `satori@0.33.5` 子树应用：

```json
"overrides": { "satori@0.33.5": { "fflate": "0.7.5" } }
```

`npm ls`、`npm explain fflate` 和锁文件均确认只有 **fflate 0.7.5**，无 0.7.3/0.8.x：

- `example-cv-users → vinext 1.0.0 → @vercel/og 1.0.3 → satori 0.33.5 → fflate 0.7.5`。
- Satori 下 `@shuding/opentype.js 1.4.0-beta.0 → fflate` 同样在该 scoped 子树解析到 0.7.5；没有全树 overrides。

[GHSA-px8p-9vwx-vf98](https://github.com/advisories/GHSA-px8p-9vwx-vf98) 的 0.7.x 分支修于 0.7.5。原四个 Moderate 聚合节点（fflate/satori/OG/Vinext）已不再报告该公告；未删除依赖、关闭审计或加入忽略名单。

## 2. 字体、SVG 和 ZIP64 兼容性

`tests/fflate-satori.test.mjs` 四项实际测试：普通压缩/解压和 ZIP roundtrip；小文件有效 ZIP64（含 ZIP64 EOCD、locator、尺寸/位置 extra）；缺少必需 extra 的畸形 ZIP64 在 2 秒硬上限的子进程内明确拒绝；Satori 真实 TTF 与生成的 WOFF1 压缩表字体渲染。WOFF 包含实际 zlib 压缩表，不是把 TTF 改扩展名。

字体来自已安装 @vercel/og 的 Geist-Regular.ttf，不复制字体进仓库；Satori 的 TTF/WOFF 输出 SVG 逐字节一致。升级前保存的相同 TTF/文本渲染基准与升级后也逐字节一致，SVG SHA-256 `70d610a86d777b9884dd3368eaaddd06d3072ead567c397f7fca38854b5bc040`。未更新基准迎合新实现。

测试开发时的 ZIP64 构造最初缺失完整 ZIP64 end records 和 offset，导致测试失败；已修正合成输入后通过，没有改动 fflate 实现或减弱异常断言。

## 3. Node 安装与官方真实性校验

- 官方包：`https://nodejs.org/dist/v24.22.1/node-v24.22.1-darwin-arm64.tar.xz`；真实主机 arm64。
- 下载同发布目录 SHASUMS256.txt 与 detached .sig；使用 [nodejs/release-keys 官方 keyring](https://github.com/nodejs/release-keys) 的公开签名密钥，通过本地 gpgv 验证，未导入用户/系统钥匙串。
- GPG `GOODSIG` / `VALIDSIG` 发布者完整指纹：`5BE8A3F6C8A5C01D106C0AD820B1A390B168D356`；与官方公开 releaser 清单一致。
- 压缩包 SHA-256：`654ba79de6155647e22321932b45f2a1ccb705976cc337c9b8e278beb085a628`，与经签名官方清单逐字节匹配后才解包执行。
- 新执行文件：`$HOME/.nvm/s2-users/versions/node/v24.22.1/bin/node`。
- 二进制 SHA-256：`6f32069480ec14d52b6d7b1f3c7124cfbbc46203abf5ddf5c65b127435f3f329`；属主 UID 501、0755，非 group/world writable；实际 process.execPath、PID、版本及文件摘要核对通过。

当前 nvm 默认 alias 文件是 `24`。为避免标准目录下新安装使动态别名默认解析改变，新版本放在 `.nvm/s2-users/versions/node/v24.22.1` 专用并存目录，明确绝对路径使用。没有修改默认 alias 或系统 PATH；独立只读 `nvm version default` 仍返回 **v24.13.0**。旧版原位置保留，二进制 SHA 与历史 pin 一致。最初标准目录的本轮新安装已迁至专用目录；没有移动/替换旧版本。

旧 Node 不可通过新包身份检查（existing_node_required），新 Node 对当前实际进程的精确摘要检查 PASS。没有改 process.title/argv0，没有用另一个临时进程结果替代目标 PID。

## 4. Node 内建 undici 与绑定

实际新 Node `24.22.1`，`process.versions.undici` 为 **7.30.1**，与[官方发布说明](https://nodejs.org/en/blog/release/v24.22.1)一致。npm undici 也保持第二轮修复后的 7.30.1；两者不是同一副本。Cloudflare workerd 平台 fetch 不由 Node 内建版本推断。

更新：package engines/锁根声明、scripts/run.mjs、scripts/https/policy.json 的 Node 版本及二进制摘要、TLS 身份测试、README/TESTING、GitHub Users Job 固定版本和对应 gate 合约断言。`node-identity.mjs` 原本从 policy 取版本与摘要，无需重复硬编码，保持严格实现不变；Python 安装侧预检也继续使用 policy。历史报告与历史构建/工具 pin 不覆盖。

## 5. HTTPS 完整工具范围与真实缺口

| 检查 | 结果 / 实际范围 |
|---|---|
| 新 Node 精确身份与旧/错误二进制拒绝 | PASS，当前 PID/execPath/摘要/属主/权限，错误摘要定向测试 |
| 指纹、非 CA、单 IP SAN、EKU、有效期与私钥权限 | PASS，既有负例与新的真实临时 leaf 预检 |
| HTTPS 真启动与握手 | PASS，真实 loopback health-only TLS，默认拒绝自签证书；仅一个 Node 测试客户端显式提供 fixture ca 后成功，不写系统信任 |
| 安装前 certificate-only 严格预检 | PASS，复制真实工具代码至隔离目录，使用该目录独立公开 pin；不是放宽正式 pin |
| 精确安装/撤销、过期/私钥缺失、其他用户/CA/系统域拒绝 | PASS，12 项 CLI 调度离线案例，native 边界拦截，Keychain 0 写入 |
| stop/PID/重复/超时 UNKNOWN 保护 | PASS，完整套件内隔离子进程及端口释放 |
| Safari/Chrome 系统可信 HTTPS | **NOT TESTED**，无绑定材料与当前有效系统信任；没有跳过警告/忽略证书错误 |

新真实 TLS 测试还发现启动工具既有缺陷：`identity.mjs` 使用 createPrivateKey 却未导入。仅补上 `node:crypto` 导入和泛化版本注释，保持全部证书/私钥/PID 校验。未修改认证或服务业务。该缺陷在先前仅元数据/策略测试未被执行；不倒写历史真实验收。新增 `tests/node-tls-upgrade.test.mjs` 通过实际生成临时非 CA leaf、独立 fixture policy、真实 preflight/loader/HTTPS 握手覆盖；使用 macOS 自带 /usr/bin/openssl（无 Homebrew 依赖）；其生成密钥默认权限曾被严格检查拒绝，fixture 为本次自建临时 key 显式设为 0600 后通过，并未放宽 loader。临时私钥与目录在 finally 删除，无 Keychain 操作。

此测试客户端提供 fixture ca 是隔离 TLS 单元测试的局部信任，不是系统默认信任，更不是 Safari/Chrome 系统信任证据。Mac 专属测试在 Linux 显式 skip，GitHub Linux 不会因此获得 Mac 本机信任通过结论。

## 6. 最终验证

| 项目 | 结果 |
|---|---|
| npm ci | PASS；最终 197 个安装包，0 vulnerabilities |
| npm ls --all / npm explain | PASS，无 invalid/missing；Satori 子树精确 fflate 0.7.5 |
| 完整 npm audit --json | **0 Critical、0 High、0 Moderate、0 Low、0 Info**，exit 0 |
| npm audit --omit=dev | 0，exit 0 |
| RSC/Vinext/Vite/Cloudflare 完整构建 | PASS，npm test 先执行完整构建 |
| typecheck | PASS |
| 完整本地 Node/workerd/SQLite DO | **85/85 PASS，0 fail，0 skip**；含持久化重建、并发消费、过期、身份混用、UNKNOWN 不重试 |
| HTTPS/fflate 定向集 | 10/10 PASS，与完整套件重叠；CLI fixture 内另有 12 场景 |
| CI 分类器/Required Gate | 28/28 PASS，新 Node 24.22.1 Users job 接线断言通过 |
| 新 Node 合成页面 | Playwright 浏览器 HTTP localhost 的 login/register/forgot 实际加载 PASS；未重复整套视觉验收 |
| 系统可信双浏览器 HTTPS / Ubuntu CI / 托管环境 | NOT TESTED / NOT RUN，不能替代为 PASS |

安装过程保留了 npm 清理生成依赖目录 ENOTEMPTY、随后缺包造成的定向测试失败。只清理本 worktree 可再生成 node_modules，最终 npm ci、ls、完整构建与套件通过。npm 对未显式批准 install scripts 的提示保留，没有全局批准脚本来压制提示。字体兼容结果来自最终安装，而非缺包的失败运行。

## 7. 变更和第二轮保护

本轮修改列表（相对第二轮工作状态）：

- package.json / package-lock.json：保持第二轮六项依赖升级，新增 scoped override 与 Node engines。
- scripts/run.mjs、scripts/https/policy.json：新版本与二进制 pin。
- scripts/https/identity.mjs：必要 missing import 修复；不改边界。
- tests/tls-tools.test.mjs：新版本断言；新增 tests/fflate-satori.test.mjs 和 tests/node-tls-upgrade.test.mjs。
- README.md、docs/TESTING.md：Node 专用路径与精确启动说明。
- .github/workflows/pr-validation.yml：仅 Users Node 版本；.github/scripts/pr-validation-gate.test.mjs：对应精确断言，分类器实现未改。
- 新增本报告及 docs/evidence/security-round3-20261105/{build-manifest,verification}.json。第二轮所有报告与原始证据保持原样；源码/布局/CSS/文案/认证/DO 没有改动。

相对 Commit 5136030 的 package diff 同时包含未提交的第二轮依赖升级，不能把整个累计 diff 都算为本轮。第二轮输入哈希已记录在 .runtime/security-round3/before.json，第二轮业务 manifest、报告文件原样保留。原工作区 3621 文件与 172 历史文件逐一比对零差异，原 tracked diff 不变。

## 8. 新指纹与验收边界

- 新业务：`65c3afe790ece8f5616e873fd8870803d4bef0e89cdeeec528c5439a054e37fd`
- 新工具：`ca13d8df89daa6a8da4bcac0b10396c6384a2a2885763ae9884d6799d3630b74`
- 锁文件：`c8cc8a0b96c76e8eec73b7c0eb17621b1580dc8488d93f09523f859073779057`
- 最终构建产物：`c1651d696bb5dc9ec3cbceb456b6ab0c0a34f3c609bc67db54a4f277c035ce48`

manifest 使用既有脚本，包含全部业务配置/锁文件、工具和测试；未通过排除变更维持旧值。CI/文档不是该算法的业务输入，具体文件仍由 Git diff 审阅。原五项真实 PASS 只绑定历史业务 `676c5c7c…`，本轮新构建真实集成 NOT TESTED；历史 UNKNOWN 不改写。

## 9. 门禁与下一步

**依赖安全门禁已达到目标**：fflate 与内建 undici 修复，npm 全树 0 漏洞，新 Node 的严格身份/本地工具检查通过。可以审阅新的本地 GitHub 候选，但不把未执行的可信双浏览器检查写成已通过；暂不按“所有检查全部通过”申请替代 PR。

最小剩余：单独安排可信 HTTPS Safari/Chrome 合成检查。执行前核对原绑定 leaf 的有效期/指纹与材料；若已失效，先单独批准更新材料和公开 pin，不能忽略过期。若系统当前没有该 leaf 的有效限定信任，需要单独批准临时用户 SSL 信任及撤销后再执行；本轮无此写权限。只需登录/身份/续期/退出定向合成复核，不重做视觉、不发真实邮件。

随后再单独批准统一 Git 交付/新 Draft PR，GitHub CI 实际跑后核对。真实回归另批：由于 Node/RSC/workerd 相比原真实基线已有变化，建议必要的双浏览器登录/主动续期/退出及单浏览器恢复关键写链路；普通改密是否补一次独立列批准，不自动重注册或追加真实请求。真实等待一小时自动续期仍未验证。

收尾：本轮 Playwright 会话关闭、仅启动的合成本地服务按 stop 确认退出，8795 端口复核释放。TLS 测试临时 key/cert 已清理，下载包和公开签名材料仅留忽略目录；无 Keychain、真实认证/发信/改密、云端或 Git 写入。原 main/S2 分支/PR #31/旧 CMS 与公站未操作。
