# S2 第二轮定向依赖安全修复与兼容性验证

日期：2026-11-05（Asia/Shanghai）。当前仅为本地候选工作区，未新建 Commit、未 Push/PR/部署。

## 1. 结论

**获批六项直接依赖已经精确更新，原 30 个 GHSA 的 npm 依赖路径已处理；最终完整审计为 0 Critical、0 High、4 Moderate，生产依赖审计为 0。** 全部 4 Moderate 来自新 Satori 路径的同一个 fflate GHSA。Node 24.13.0 内建 undici 的安全风险另行确认，未被包升级修复。因此不宣称整体安全验收 PASS、CI 全绿或可部署。

当前分支 `codex/s2-users-remediation-20261105`；HEAD 仍为 `5136030888dda7d095efa84e779e5c513a1f3107`，基础 main `a0a82f30b3e5129f7a68d9e6dfe2693fb7eaa8a2`。上一轮未提交的 SECURITY-DEPENDENCY-REVIEW.md 原样保留。原 PR #31、本地/远程 main、原 S2 分支均未操作。

## 2. 精确升级与相容性

| 包 | 升级前 | 最终 | 约束检查 |
|---|---|---|---|
| vite | 8.0.13 | 8.1.6 | 官方 registry 存在；Node/相互 peer 检查通过；实际 npm ls 无错误 |
| vinext | 1.0.0-beta.2 | 1.0.0 | 官方 registry 存在；Node/相互 peer 检查通过；实际 npm ls 无错误 |
| @vitejs/plugin-rsc | 0.5.26 | 0.5.34 | 官方 registry 存在；Node/相互 peer 检查通过；实际 npm ls 无错误 |
| @cloudflare/vite-plugin | 1.53.0 | 1.66.0 | 官方 registry 存在；Node/相互 peer 检查通过；实际 npm ls 无错误 |
| wrangler | 4.124.0 | 4.154.0 | 官方 registry 存在；Node/相互 peer 检查通过；实际 npm ls 无错误 |
| miniflare | 5.20260815.0-alpha | 5.20261023.1-beta | 官方 registry 存在；Node/相互 peer 检查通过；实际 npm ls 无错误 |
| react | 19.2.9 | 19.2.9 | 官方 registry 存在；Node/相互 peer 检查通过；实际 npm ls 无错误 |
| react-dom | 19.2.9 | 19.2.9 | 官方 registry 存在；Node/相互 peer 检查通过；实际 npm ls 无错误 |
| react-server-dom-webpack | 19.2.9 | 19.2.9 | 官方 registry 存在；Node/相互 peer 检查通过；实际 npm ls 无错误 |

Vinext 1.0.0 要求 React 三包 ^19.2.6、Vite ^8、RSC 插件 ^0.5.34，当前均满足。Cloudflare 插件固定 Wrangler 4.154.0 和 Miniflare 5.20261023.1-beta，Wrangler 也固定同一 Miniflare。实际锁树各只有一个版本；workerd 随工具组变为 **1.20261023.1**，sharp **0.35.5**，npm undici **7.30.1**，@vercel/og **1.0.3**，satori **0.33.5**。无旧 RSC、Miniflare、sharp、undici 副本；image-size 由 Vinext 官方依赖变化移出，不是本地删除业务功能。

保留 Node 24.13.0、@vinext/cloudflare 1.0.0-beta.2、@vitejs/plugin-react 6.0.2、Supabase 两包、TypeScript 与 types；未更新无关直接依赖。锁中的间接变更主要是上述父包所需的 esbuild/rolldown、workerd 原生平台包、libvips、OG/Satori 等配套。恢复保留原 semver 7.8.5，未顺手升级到新解析的 7.8.6。完整逐节点版本变化、增加和移除见 verification.json 的 lockDelta。

官方元数据：[Vinext 1.0.0](https://registry.npmjs.org/vinext/1.0.0)、[Vite 8.1.6](https://registry.npmjs.org/vite/8.1.6)、[RSC 插件 0.5.34](https://registry.npmjs.org/@vitejs%2fplugin-rsc/0.5.34)、[Cloudflare 插件 1.66.0](https://registry.npmjs.org/@cloudflare%2fvite-plugin/1.66.0)、[Wrangler 4.154.0](https://registry.npmjs.org/wrangler/4.154.0)、[Miniflare 5.20261023.1-beta](https://registry.npmjs.org/miniflare/5.20261023.1-beta)。本轮重新读取，未仅依赖旧报告。

## 3. 每项原 GHSA 的结果

| GHSA（官方公告） | 原受影响包 | 当前结果 |
|---|---|---|
| [GHSA-5p2g-fcmc-qvqq](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq) | image-size 2.0.2 | 上游已移除该解析器依赖；本地未删除功能 |
| [GHSA-w3rx-r6r6-pgpr](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr) | image-size 2.0.2 | 上游已移除该解析器依赖；本地未删除功能 |
| [GHSA-wx4j-mvgx-mqwp](https://github.com/advisories/GHSA-wx4j-mvgx-mqwp) | satori 0.16.0 | 更新至 0.33.5，不在该公告当前受影响范围 |
| [GHSA-rgj7-g3m4-5g8c](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c) | sharp 0.35.2 | 更新至 0.35.5，不在该公告当前受影响范围 |
| [GHSA-wq5f-xc86-pv6w](https://github.com/advisories/GHSA-wq5f-xc86-pv6w) | sharp 0.35.2 | 更新至 0.35.5，不在该公告当前受影响范围 |
| [GHSA-3wwx-pv8p-q78v](https://github.com/advisories/GHSA-3wwx-pv8p-q78v) | undici 7.29.0 | 更新至 7.30.1，不在该公告当前受影响范围 |
| [GHSA-pmjh-fq2x-6v4x](https://github.com/advisories/GHSA-pmjh-fq2x-6v4x) | undici 7.29.0 | 更新至 7.30.1，不在该公告当前受影响范围 |
| [GHSA-r53p-7pc4-xj5r](https://github.com/advisories/GHSA-r53p-7pc4-xj5r) | undici 7.29.0 | 更新至 7.30.1，不在该公告当前受影响范围 |
| [GHSA-rfgv-xxqx-mfg5](https://github.com/advisories/GHSA-rfgv-xxqx-mfg5) | undici 7.29.0 | 更新至 7.30.1，不在该公告当前受影响范围 |
| [GHSA-3xpg-4rpp-hhhm](https://github.com/advisories/GHSA-3xpg-4rpp-hhhm) | undici 7.29.0 | 更新至 7.30.1，不在该公告当前受影响范围 |
| [GHSA-2jfj-6hjv-fm6j](https://github.com/advisories/GHSA-2jfj-6hjv-fm6j) | undici 7.29.0 | 更新至 7.30.1，不在该公告当前受影响范围 |
| [GHSA-2gqq-gqf2-x968](https://github.com/advisories/GHSA-2gqq-gqf2-x968) | undici 7.29.0 | 更新至 7.30.1，不在该公告当前受影响范围 |
| [GHSA-w293-vg96-wgc3](https://github.com/advisories/GHSA-w293-vg96-wgc3) | undici 7.29.0 | 更新至 7.30.1，不在该公告当前受影响范围 |
| [GHSA-8436-99hf-9mmv](https://github.com/advisories/GHSA-8436-99hf-9mmv) | undici 7.29.0 | 更新至 7.30.1，不在该公告当前受影响范围 |
| [GHSA-rx4f-c7p8-82vq](https://github.com/advisories/GHSA-rx4f-c7p8-82vq) | undici 7.29.0 | 更新至 7.30.1，不在该公告当前受影响范围 |
| [GHSA-4qv8-2p9j-2685](https://github.com/advisories/GHSA-4qv8-2p9j-2685) | undici 7.29.0 | 更新至 7.30.1，不在该公告当前受影响范围 |
| [GHSA-f72v-6w45-q472](https://github.com/advisories/GHSA-f72v-6w45-q472) | undici 7.29.0 | 更新至 7.30.1，不在该公告当前受影响范围 |
| [GHSA-xjj6-f33q-929c](https://github.com/advisories/GHSA-xjj6-f33q-929c) | undici 7.29.0 | 更新至 7.30.1，不在该公告当前受影响范围 |
| [GHSA-4w7w-5xrc-9h26](https://github.com/advisories/GHSA-4w7w-5xrc-9h26) | undici 7.29.0 | 更新至 7.30.1，不在该公告当前受影响范围 |
| [GHSA-2m5v-pch6-74hx](https://github.com/advisories/GHSA-2m5v-pch6-74hx) | undici 7.29.0 | 更新至 7.30.1，不在该公告当前受影响范围 |
| [GHSA-qrxm-fqhp-jwvm](https://github.com/advisories/GHSA-qrxm-fqhp-jwvm) | undici 7.29.0 | 更新至 7.30.1，不在该公告当前受影响范围 |
| [GHSA-9fm3-97px-rjf6](https://github.com/advisories/GHSA-9fm3-97px-rjf6) | undici 7.29.0 | 更新至 7.30.1，不在该公告当前受影响范围 |
| [GHSA-55wc-3pg8-jfw6](https://github.com/advisories/GHSA-55wc-3pg8-jfw6) | undici 7.29.0 | 更新至 7.30.1，不在该公告当前受影响范围 |
| [GHSA-v6wh-96g9-6wx3](https://github.com/advisories/GHSA-v6wh-96g9-6wx3) | vite 8.0.13 | 更新至 8.1.6，不在该公告当前受影响范围 |
| [GHSA-698v-4r3x-3vcv](https://github.com/advisories/GHSA-698v-4r3x-3vcv) | vite 8.0.13 | 更新至 8.1.6，不在该公告当前受影响范围 |
| [GHSA-r825-w8mm-5pxw](https://github.com/advisories/GHSA-r825-w8mm-5pxw) | vite 8.0.13 | 更新至 8.1.6，不在该公告当前受影响范围 |
| [GHSA-587h-7wmj-h5pm](https://github.com/advisories/GHSA-587h-7wmj-h5pm) | vite 8.0.13 | 更新至 8.1.6，不在该公告当前受影响范围 |
| [GHSA-9jrq-w75r-8gcw](https://github.com/advisories/GHSA-9jrq-w75r-8gcw) | vite 8.0.13 | 更新至 8.1.6，不在该公告当前受影响范围 |
| [GHSA-rq7h-c2jc-7f22](https://github.com/advisories/GHSA-rq7h-c2jc-7f22) | vite 8.0.13 | 更新至 8.1.6，不在该公告当前受影响范围 |
| [GHSA-fx2h-pf6j-xcff](https://github.com/advisories/GHSA-fx2h-pf6j-xcff) | vite 8.0.13 | 更新至 8.1.6，不在该公告当前受影响范围 |

原父节点 Cloudflare 插件/Wrangler/Miniflare/Vinext/@vercel/og 的 High/Moderate 聚合不是另一个独立 GHSA。本轮 npm audit 已不再以旧公告报告它们。React RSC 的 GHSA-xqc2-xf4c-x3h3 由此前 19.2.9 修复，本轮保持，不虚构第二次修复。以上是当前锁版本和新鲜审计的结论，不是已在真实项目重测全部攻击。

## 4. 最终 npm audit 和剩余 Moderate

| 审计 | Critical | High | Moderate | 结果 |
|---|---:|---:|---:|---|
| 完整依赖（此前） | 0 | 8 | 2 | 原基线 |
| 完整依赖（最终） | 0 | 0 | 4 | npm audit 仍 exit 1 |
| --omit=dev（最终） | 0 | 0 | 0 | exit 0 |

剩余唯一底层公告：[GHSA-px8p-9vwx-vf98 / CVE-2026-45820](https://github.com/advisories/GHSA-px8p-9vwx-vf98)，Moderate，畸形 ZIP64 的 unzipSync 无界循环。影响 0.7.0–0.7.4，0.7 分支修于 **0.7.5**（0.8 分支修于 0.8.3）。

实际路径：`example-cv-users → vinext 1.0.0 → @vercel/og 1.0.3 → satori 0.33.5 → fflate 0.7.3`；Satori 精确固定 0.7.3，@shuding/opentype.js 另要求 ^0.7.3。四个节点为 fflate、satori、@vercel/og、vinext，不能写成四个不同漏洞，也不能将 Moderate 从 2→4 简单解释成原漏洞未修复。

当前业务未使用 OG/Satori 生成路由或解压任意 ZIP，未发现公开请求到 unzipSync 的实现路径；仍有构建/字体/后续 OG 使用风险，不忽略、不屏蔽审计。官方有修复包，不属于“无修复版本”；当前获批父版本的精确约束却不会自然选中它。未强覆写约束、未采用 audit 建议将 Vinext 降至 0.2.1。

**最小下一步建议**：单独批准评估仅针对 Satori 路径的 fflate **0.7.5** scoped override（含字体/ZIP/OG 的定向验证），或选择已改用修复版的父包。此项本轮未擅自实施。Users CI 保留 npm audit，当前会因这 4 Moderate 失败，Required Gate 不能记作全绿。

## 5. Node 内建 undici：单独结论

实际执行文件仍是已核实的 Node 24.13.0；`process.versions.undici=7.18.2`。官方 [v24.13.0 内建清单](https://github.com/nodejs/node/blob/v24.13.0/deps/undici/src/package.json) 与本机一致。按上轮 18 个 undici 公告逐项对照，**16 个版本范围命中，2 个不命中**（GHSA-3wwx-pv8p-q78v 从 7.28 起、GHSA-w293-vg96-wgc3 从 7.24.1 起）。具体表见下方；版本命中不等于工具调用了所有 WebSocket/interceptor API。

| GHSA | 官方 7.x 受影响范围 | 本机 7.18.2 |
|---|---|---|
| [GHSA-3wwx-pv8p-q78v](https://github.com/advisories/GHSA-3wwx-pv8p-q78v) | `>=7.28.0 <7.29.1` | 不命中该公告引入范围 |
| [GHSA-pmjh-fq2x-6v4x](https://github.com/advisories/GHSA-pmjh-fq2x-6v4x) | `>=7.11.0 <7.29.1` | 命中，利用条件仍依具体 API |
| [GHSA-r53p-7pc4-xj5r](https://github.com/advisories/GHSA-r53p-7pc4-xj5r) | `>=7.0.0 <7.29.1` | 命中，利用条件仍依具体 API |
| [GHSA-rfgv-xxqx-mfg5](https://github.com/advisories/GHSA-rfgv-xxqx-mfg5) | `>=7.0.0 <7.29.1` | 命中，利用条件仍依具体 API |
| [GHSA-3xpg-4rpp-hhhm](https://github.com/advisories/GHSA-3xpg-4rpp-hhhm) | `>=7.15.0 <7.29.1` | 命中，利用条件仍依具体 API |
| [GHSA-2jfj-6hjv-fm6j](https://github.com/advisories/GHSA-2jfj-6hjv-fm6j) | `>=7.0.0 <7.29.1` | 命中，利用条件仍依具体 API |
| [GHSA-2gqq-gqf2-x968](https://github.com/advisories/GHSA-2gqq-gqf2-x968) | `>=7.1.0 <7.29.1` | 命中，利用条件仍依具体 API |
| [GHSA-w293-vg96-wgc3](https://github.com/advisories/GHSA-w293-vg96-wgc3) | `>=7.24.1 <7.29.1` | 不命中该公告引入范围 |
| [GHSA-8436-99hf-9mmv](https://github.com/advisories/GHSA-8436-99hf-9mmv) | `>=7.0.0 <7.29.1` | 命中，利用条件仍依具体 API |
| [GHSA-rx4f-c7p8-82vq](https://github.com/advisories/GHSA-rx4f-c7p8-82vq) | `>=7.0.0 <7.29.1` | 命中，利用条件仍依具体 API |
| [GHSA-4qv8-2p9j-2685](https://github.com/advisories/GHSA-4qv8-2p9j-2685) | `>=7.0.0 <7.30.1` | 命中，利用条件仍依具体 API |
| [GHSA-f72v-6w45-q472](https://github.com/advisories/GHSA-f72v-6w45-q472) | `>=7.15.0 <7.30.1` | 命中，利用条件仍依具体 API |
| [GHSA-xjj6-f33q-929c](https://github.com/advisories/GHSA-xjj6-f33q-929c) | `>=7.18.0 <7.30.1` | 命中，利用条件仍依具体 API |
| [GHSA-4w7w-5xrc-9h26](https://github.com/advisories/GHSA-4w7w-5xrc-9h26) | `>=7.0.0 <7.30.1` | 命中，利用条件仍依具体 API |
| [GHSA-2m5v-pch6-74hx](https://github.com/advisories/GHSA-2m5v-pch6-74hx) | `>=7.0.0 <7.30.1` | 命中，利用条件仍依具体 API |
| [GHSA-qrxm-fqhp-jwvm](https://github.com/advisories/GHSA-qrxm-fqhp-jwvm) | `>=7.0.0 <7.30.1` | 命中，利用条件仍依具体 API |
| [GHSA-9fm3-97px-rjf6](https://github.com/advisories/GHSA-9fm3-97px-rjf6) | `>=7.0.0 <7.30.1` | 命中，利用条件仍依具体 API |
| [GHSA-55wc-3pg8-jfw6](https://github.com/advisories/GHSA-55wc-3pg8-jfw6) | `>=7.15.0 <7.30.1` | 命中，利用条件仍依具体 API |

明确可用的同 Node 24 修复基线是 **24.22.1**：官方 [发布说明](https://nodejs.org/en/blog/release/v24.22.1) 与 [内建依赖清单](https://github.com/nodejs/node/blob/v24.22.1/deps/undici/src/package.json) 均确认 undici 7.30.1；[Undici 7.30.1 公告](https://github.com/nodejs/undici/releases/tag/v7.30.1) 包含相应修复。不是仅凭 Node 版本号猜测 backport。

### 哪些工具使用内建 fetch、输入如何到达

- `scripts/controlled-https.mjs:33`：真实受控执行器的 send 使用 `fetch(request,{redirect:"manual"})`，是 Node 全局 fetch。本轮未启用真实模式。`scripts/controlled-real.mjs` 在调用前校验精确 AUTH 来源、批准路由、账户、阶段、额度，禁止 Cookie 上游透传，URL 不能由浏览器任意指定。输入密码/验证码/邮箱是 JSON 业务数据，不是任意上游 URL。
- `scripts/local-https.mjs:47` 和 `scripts/local.mjs:6` 调用的是合成 authority.fetch 方法；不是 Node 内建 fetch 的远程出站。测试中可能用 Node fetch 访问本地隔离接收端，但不连接真实 Auth。
- `scripts/run.mjs` 只启动构建/本地进程，本身无 fetch；被调用的 npm/Vite/工具可能另有网络用途，不能据此宣布整条供应链安全。
- 正式 `lib/auth/session.ts` 在 workerd 内使用平台 fetch；不能将 Node 内建 undici 版本当作 Workers fetch 版本。升级 workerd 也不修复本机 Node 内建实现。

可利用性：原受控工具使用固定 HTTPS 上游和 redirect:manual，未发现攻击者可提交任意 URL、cache/retry/decompress interceptor、自定义 tls callback、SRI、WebSocket 或 EventSource 配置的入口，因此对应条件不能一概视为可达。但 plain fetch 仍涉及恶意/被攻陷上游的 Content-Encoding、响应截断和 TLS 1.2 重协商等数据；默认捕获 fetch 拒绝不足以补上内部未处理错误。故 Node 24.13.0 是有官方依据的旧漏洞基线，不能报告为安全，仅因本轮权限明确不升级而保留。未执行攻击载荷或连真实上游验证。

### 最小升级方案与影响（待批准）

单独批准现有 Node 24.13.0 → 官方 Node 24.22.1，同 LTS 主版本，不改变业务框架；重新核验下载来源、发行校验值、macOS 可执行文件属主/权限和实际 PID 身份。保留原二进制供历史证据核对，不替换/伪造原 pin。需明确更新 package engines、scripts/run.mjs、scripts/https/policy.json 的版本和二进制 SHA、相应测试，以及 Users CI 的 Node 固定版本；叶证书快照安装预检使用新 pin，旧批次工具和回执仍归旧版本。

必要回归：新 Node 下 npm ci/build/typecheck/80 项、执行器本地传输/AbortSignal/响应 Cookie/UNKNOWN、TLS 身份与 12 场景离线撤销、停止进程 PID 和端口保护、合成浏览器会话。未批准前不改上述固定值，不为了通过检查跳过精确身份。此前真实 PASS 不继承给新 Node/新包。

## 6. 兼容性与验证结果

| 检查 | 最终结果 / 适用范围 |
|---|---|
| npm ci | PASS；最终干净安装 200 包。首次 lock-only 出现 optional peer 遗漏，按官方元数据补全；未用 legacy-peer-deps/force。 |
| npm ls --all --json | PASS；无 missing/extraneous/invalid；获批核心包均单版本。 |
| 独立 npm run build | PASS；Vinext RSC + Cloudflare 插件构建，保留 rsc/ssr 环境。 |
| npm run typecheck | PASS。 |
| npm test（最终完整重建） | 80/80 PASS，0 fail、0 skip；包括新 workerd 和 SQLite DO。 |
| DO / UNKNOWN | 实际落盘并销毁重建 workerd、并发单次授权、过期/身份混用/重复提交、超时/晚响应 UNKNOWN 不重试均覆盖，非内存 Mock。 |
| HTTPS / 停止工具 | 完整套件内通过；12 个精确撤销离线场景，正常/重复/超时停止及端口释放；无 Keychain 操作。 |
| CI classifier / Required Gate | 28/28 PASS；本轮未修改 CI；GitHub Job 实际 NOT RUN。 |
| Cloudflare Worker 相容性 | 新 workerd 1.20261023.1 的路由/API/静态资源、请求隔离、SQLite DO 实际本地运行 PASS；未执行远程绑定、上传或部署。 |
| 浏览器合成注册 | 注册→验证页；首次码过期正确拒绝，合成重发后验码→账户→退出 PASS。 |
| 浏览器合成登录 | 新注册合成账户密码登录、账户 reload PASS；全部只用 .invalid。 |
| 浏览器合成恢复 | 申请→刷新保留验证码步骤（邮箱需重填）、过期拒绝→合成重新申请→验码→重置→新密码登录 PASS；未改变 OTP 期限。 |
| 浏览器退出保护 | 合成会话定向退出、再次访问 /account 返回 /login PASS；浏览器已关闭。 |
| Ubuntu / 托管资源 / 新候选真实认证 | NOT RUN / NOT TESTED，不以 Mac workerd 测试冒充 GitHub 或托管部署验收。 |

上述网页由当前 Workers、SQLite DO 和隔离 Auth fixture 提供，没有真实 Supabase 回退。浏览器中的过期验证码错误是实际观察到的预期拒绝；另外一次空邮箱点击由前端 required 阻止，没有宣称首次恢复验码就成功。期间测试合成重发不等于真实发信。浏览器 RSC 导航/水合/表单提交可操作，未只凭 build 宣布运行通过。

保留失败尝试：初次 lock-only 缺少 @emnapi optional/peer 节点导致 npm ci EUSAGE；后续补全并通过。后续一次重装遇到 ENOTEMPTY，随后 tsc 因半安装目录缺失，均非业务断言失败。仅清理本 worktree 新包自身可再生成 node_modules，最终顺序重装、npm ls、typecheck、完整测试重新通过。失败日志保留 `.runtime/security-round2/`，没有删除或覆盖历史真实 UNKNOWN。

## 7. 变更范围、指纹与历史验收

- 本轮执行输入只改 `package.json`、`package-lock.json`，无需配置适配。app/lib/worker/DO、布局/CSS/文案/交互、测试/脚本、CI、Node pin、compatibility_date 均未变。
- npm 锁解析的 optional peer 节点缺失按 registry 的 tarball/integrity/dependency 元数据补全，未新增顶层依赖或改变 peer 约束；最终 npm ci 和 npm ls 双重通过。
- 新增本报告 `docs/SECURITY-REMEDIATION-ROUND2.md` 与 `docs/evidence/security-round2-20261105/{build-manifest,verification}.json`；上一轮 `docs/SECURITY-DEPENDENCY-REVIEW.md` 仍为此前已有未提交文档，不覆盖。

- 新业务 SHA-256：`11b0aa03dd61d4805d8ef42a4d2b13f4e7b6309a2c1bae12df6ce36488379183`
- 工具 SHA-256：`d2231ed3f373c897e9ed47657968856c2b2e70d081b5678ce8538f91eabb149a`（未修改，保持原值不是排除变更文件）
- 锁文件 SHA-256：`cf79133f1074f54fa7b565bd95a1a94b8606534f9c07dbccfd95e5e4cb77c520`
- 最终重建产物 SHA-256：`6a8777cb156bfa8bc61837942f3af4f5036e38b0eec7508778de778674b86341`

构建 manifest 使用原有算法覆盖 app/lib/worker、构建配置、package/lock 与工具/测试；未修改算法维持旧值。重复构建产物 chunk ID 可变化，以上绑定最终重建；浏览器回归运行于同一源码/依赖候选的此前重建，不宣称逐字节相同的产物。

原五项真实 PASS 仅绑定 `676c5c7c083f63be14c71be12dd79ccab67ec504bd7d89887bcb05ed8e29a1df`；上一轮 `439bbc1e…` 与本轮新候选只有各自本地结果。新候选真实集成 **NOT TESTED**。原 PASS/UNKNOWN/真实请求/模板回填超时及 Safari/Chrome 记录不变。

本轮无新 Commit；相对 5136030 的 tracked diff 只有两个包文件，另有上述三份新报告/证据及上一轮报告，共 6 个候选文件。完整依赖变更与审计 JSON（不含凭据）纳入 verification.json，原 runtime 日志仍忽略，不计划提交。

## 8. 是否可准备替代 Draft PR / 后续最小动作

可以审阅此本地依赖修复候选，但**尚不具备声明安全阻断全部解除或 CI 全绿后推送替代 PR 的条件**：

1. 当前仍有 fflate Moderate，Users CI 现有 npm audit 将 exit 1；需单独批准 0.7.5 scoped 修复/父级更新及针对性验证，或明确的风险处置（本轮无豁免）。
2. Node 24.13.0 内建安全基线仍旧；需单独批准 Node 24.22.1 与精确 pin/CI 配套修复，不可因 npm High=0 隐藏它。
3. 新依赖的 GitHub/Ubuntu CI 尚未运行，真实集成尚未执行；不把这些列为已经通过。

以上完成后再批准推送/新 Draft PR，不修改原 #31。当前依赖组已证明本地可运行，后续不需重设计认证。待最终候选冻结后，最小真实回归建议：①两浏览器必要登录/身份/主动续期/退出；②单浏览器一次恢复验码/DO授权/改密/独立登录（含原模板和证书收尾）；普通改密是否再做一次按最终运行时差异单列审批，不自动重复注册。真实等待一小时自动到期续期仍是独立未验证项。

收尾：本轮已知合成会话均退出，浏览器关闭，所属本地服务确认停止、8795 无监听；未清理其他浏览器/服务。原工作区 3,621 个受保护文件、172 个历史文件哈希无差异，原 tracked diff 未变。真实注册/登录/验码/续期/发信/改密/恢复、云端与 Keychain 写入均 0；无 Commit、Push、PR、merge 或部署。
