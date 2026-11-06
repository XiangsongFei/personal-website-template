# S2 剩余依赖漏洞分析与最小修复计划

日期：2026-11-05（Asia/Shanghai）。本轮仅审计、读取和报告；没有安装依赖、构建重生成、业务/CI/锁文件修改、Commit、Push、真实认证或云端操作。

## 1. 固定版本与结论

- 分支 `codex/s2-users-remediation-20261105`；HEAD `5136030888dda7d095efa84e779e5c513a1f3107`；基础 main `a0a82f30b3e5129f7a68d9e6dfe2693fb7eaa8a2`。
- 业务 `439bbc1e421461e893a10e45bebdfbc71304c410351340b0a900217888f4d6b6`；工具 `d2231ed3f373c897e9ed47657968856c2b2e70d081b5678ce8538f91eabb149a`；锁文件 `1aa8075cc646c8ee2d57c478d58de697b2e0e393039b09eb25954f1e150b9a07`。
- 新鲜完整 npm audit：8 High、2 Moderate、0 Critical；`--omit=dev`：0。`npm ls --all --json` 成功。十项是依赖节点，不是十个独立漏洞；实际关联 **30 个不同 GHSA**。
- **未确认当前公开 Workers 存在上述 High 的可达漏洞路径**；这不是“证明生产无 High”。Vinext 虽是 devDependency，其运行时代码确实打包。生产审计为零不能替代产物检查。
- **有外部输入可触发的漏洞类别**：Vite 开发服务的跨源脚本/editor/文件路径，undici 的恶意上游响应/WS/SSE，sharp/image-size 的恶意图片。当前公开账户页面未找到这些输入→漏洞实现的通路；本地开发、CI/PR、模拟器环境仍有条件风险。
- 推荐分三组定向升级：Vite 8.1.6；Vinext 1.0.0 + RSC 插件 0.5.34；Cloudflare 插件 1.66.0 + Wrangler 4.154.0 + Miniflare 5.20261023.1-beta。Node 24.13.0 的 package engines 可匹配，实际安装/构建/运行兼容尚未验证。
- 可申请下一轮最小依赖修复，**不是可部署或审计已清零**。本轮没有任何新真实 PASS。

## 2. 证据与方法

本轮原始只读输出存于忽略目录 `.runtime/remediation/`：`security-review-audit.json`、`security-review-production.json`、`security-review-tree.json`、`security-paths.json`、`security-advisory-html.json`、`security-registry-metadata.json`、`security-packuments.json`。它们不是待提交的运行文件。报告自包含关键结果与官方链接。

GitHub 公共 advisory API 返回 403，未创建令牌或提取凭据；改为读取 GitHub Advisory Database HTML 全部 30 页，状态均 200，并核对发行者安全公告链接。Python 默认 HTTPS 读取曾因本机证书链失败而停止，未忽略 TLS；随后 Node 正常 TLS fetch 完成公开元数据读取。不存在把查询失败当作无漏洞的情况。

官方 patched version 与 npm `fixAvailable` 不同：前者是某个漏洞在某包的修复版本，后者往往建议升级顶层父包甚至破坏性降级，不直接采用。父包聚合 range 是 npm 元漏洞计算，不当作独立公告。

分类：A 精确升级；B 调整父级；C 工具链配套；D 无兼容版本；E 当前未确认正式漏洞路径但仍有开发/供应链风险。以下 E 不表示忽略或风险豁免。

## 3. 十个受影响依赖节点

| 节点 | 当前版本 | audit 严重性 | 引入类型 | lock 属性 | 运行影响 |
|---|---|---|---|---|---|
| @cloudflare/vite-plugin | 1.53.0 | high | 直接 devDependency | dev=true | 构建/本地/CI；未发现漏洞实现入包 |
| @vercel/og | 0.8.6 | moderate | 传递依赖 | dev=true | 构建/本地/CI；未发现漏洞实现入包 |
| image-size | 2.0.2 | high | 传递依赖 | dev=true | 构建/本地/CI；未发现漏洞实现入包 |
| miniflare | 5.20260815.0-alpha | high | 直接 devDependency | dev=true | 构建/本地/CI；未发现漏洞实现入包 |
| satori | 0.16.0 | moderate | 传递依赖 | dev=true | 构建/本地/CI；未发现漏洞实现入包 |
| sharp | 0.35.2 | high | 传递依赖 | dev=true | 构建/本地/CI；未发现漏洞实现入包 |
| undici | 7.29.0 | high | 传递依赖 | dev=true | 构建/本地/CI；未发现漏洞实现入包 |
| vinext | 1.0.0-beta.2 | high | 直接 devDependency | dev=true, peer=true | SSR/RSC 框架入包，子漏洞未确认可达 |
| vite | 8.0.13 | high | 直接 devDependency | dev=true, peer=true | 构建/本地/CI；未发现漏洞实现入包 |
| wrangler | 4.124.0 | high | 直接 devDependency | dev=true | 构建/本地/CI；未发现漏洞实现入包 |

十项在锁中均 `dev:true`、非 optional；Vinext/Vite 另有 `peer:true`（可同时是直接 dev 与 peer）。sharp 本体不是 optional，其平台二进制包是 optional；不能因为某平台 optional 未安装就宣布所有环境安全。完整生产安装仅含 Supabase、React 等，本 Workers 必须在完整构建后发布，不能由 omit-dev 结果推断 RSC 运行依赖不存在。

### @cloudflare/vite-plugin 1.53.0 — high

- npm 聚合受影响范围：`<=0.0.0-7ae5dd357 || 1.2.3 - 1.54.6`。
- 当前引入路径（npm ls 去重引用按实际已解析父级展开；均可指向同一物理安装）：
  - `example-cv-users → @cloudflare/vite-plugin@1.53.0`
- 正式产物判断：未发现该漏洞实现进入当前 Workers 产物；本地/构建/CI 风险，见下文证据及限制。
- 最小建议：C/E：1.66.0，与 Wrangler 4.154.0、Miniflare 5.20261023.1-beta 配套。1.54.7 虽超出父包聚合审计范围，却仍固定受影响 Miniflare，不能作为彻底修复。
- 此节点无独立 GHSA；继承 `miniflare`、`wrangler`，公告、修复版本及利用前提见对应底层节点，不能另造一个 Cloudflare/Vinext 公告。

### @vercel/og 0.8.6 — moderate

- npm 聚合受影响范围：`0.0.12-beta.0 - 1.0.2`。
- 当前引入路径（npm ls 去重引用按实际已解析父级展开；均可指向同一物理安装）：
  - `example-cv-users → @vinext/cloudflare@1.0.0-beta.2 → vinext@1.0.0-beta.2 → @vercel/og@0.8.6`
  - `example-cv-users → vinext@1.0.0-beta.2 → @vercel/og@0.8.6`
- 正式产物判断：未发现该漏洞实现进入当前 Workers 产物；本地/构建/CI 风险，见下文证据及限制。
- 最小建议：B/E：父级 Vinext 1.0.0 固定 1.0.3，后者固定修复的 satori 0.33.5；0.8.6 → 1.0.3 是上游破坏性版本边界，不能假设直接顶层覆盖兼容。
- 此节点无独立 GHSA；继承 `satori`，公告、修复版本及利用前提见对应底层节点，不能另造一个 Cloudflare/Vinext 公告。

### image-size 2.0.2 — high

- npm 聚合受影响范围：`0.6.3 - 2.0.2`。
- 当前引入路径（npm ls 去重引用按实际已解析父级展开；均可指向同一物理安装）：
  - `example-cv-users → @vinext/cloudflare@1.0.0-beta.2 → vinext@1.0.0-beta.2 → image-size@2.0.2`
  - `example-cv-users → vinext@1.0.0-beta.2 → image-size@2.0.2`
- 正式产物判断：未发现该漏洞实现进入当前 Workers 产物；本地/构建/CI 风险，见下文证据及限制。
- 最小建议：B/E：解析器修于 2.0.3；原 Vinext 固定 2.0.2，添加顶层包不会替换。推荐升级 Vinext 1.0.0，其发布元数据不再引入 image-size；这是上游实现更替，不是为绕过审计删除功能。

| GHSA / 名称 | 公告严重性 | 当前分支受影响范围 | 官方修复版本（本分支） | 利用前提与本项目判断 |
|---|---|---|---|---|
| [GHSA-5p2g-fcmc-qvqq](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq)（GitHub Reviewed；上游修复链接见公告）：image-size: JXL and HEIF parsers allow denial of service through infinite loops | high | `>=1.2.0 <=2.0.2` | 2.0.3 | 不可信 JXL/HEIF 图片交给 image-size，零长度 box 导致循环不前进。当前调用来源是构建期元数据文件，仓库/PR 贡献者可控制文件；未找到请求体→此解析器路径。 |
| [GHSA-w3rx-r6r6-pgpr](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr)（GitHub Reviewed；上游修复链接见公告）：image-size: ICNS parser allows denial of service through an infinite loop | high | `>=0.6.3 <=2.0.2` | 2.0.3 | 不可信 ICNS buffer 的零长度 entry 可阻塞事件循环；当前为元数据构建输入风险，不是已证明的公开上传接口。 |

### miniflare 5.20260815.0-alpha — high

- npm 聚合受影响范围：`<=0.0.0-fec45ed61 || 4.20250508.3 - 5.20260926.0-alpha`。
- 当前引入路径（npm ls 去重引用按实际已解析父级展开；均可指向同一物理安装）：
  - `example-cv-users → @cloudflare/vite-plugin@1.53.0 → miniflare@5.20260815.0-alpha`
  - `example-cv-users → @cloudflare/vite-plugin@1.53.0 → wrangler@4.124.0 → miniflare@5.20260815.0-alpha`
  - `example-cv-users → miniflare@5.20260815.0-alpha`
  - `example-cv-users → wrangler@4.124.0 → miniflare@5.20260815.0-alpha`
- 正式产物判断：未发现该漏洞实现进入当前 Workers 产物；本地/构建/CI 风险，见下文证据及限制。
- 最小建议：C/E：5.20261023.1-beta，固定 sharp 0.35.5、undici 7.30.1；该配套还更新 workerd，须验证 convertV4MiniflareOptions 与 SQLite 测试。
- 此节点无独立 GHSA；继承 `sharp`、`undici`，公告、修复版本及利用前提见对应底层节点，不能另造一个 Cloudflare/Vinext 公告。

### satori 0.16.0 — moderate

- npm 聚合受影响范围：`0.0.27 - 0.33.4`。
- 当前引入路径（npm ls 去重引用按实际已解析父级展开；均可指向同一物理安装）：
  - `example-cv-users → @vinext/cloudflare@1.0.0-beta.2 → vinext@1.0.0-beta.2 → @vercel/og@0.8.6 → satori@0.16.0`
  - `example-cv-users → vinext@1.0.0-beta.2 → @vercel/og@0.8.6 → satori@0.16.0`
- 正式产物判断：未发现该漏洞实现进入当前 Workers 产物；本地/构建/CI 风险，见下文证据及限制。
- 最小建议：B/E：0.33.5 修复；通过 @vercel/og 1.0.3 与 Vinext 1.0.0 配套，避免强覆写 0.16→0.33 内部 API。

| GHSA / 名称 | 公告严重性 | 当前分支受影响范围 | 官方修复版本（本分支） | 利用前提与本项目判断 |
|---|---|---|---|---|
| [GHSA-wx4j-mvgx-mqwp](https://github.com/advisories/GHSA-wx4j-mvgx-mqwp) / [发行者](https://github.com/vercel/satori/security/advisories/GHSA-wx4j-mvgx-mqwp)：Satori-generated SVG has improper escaping | moderate | `>=0.0.27 <0.33.5` | 0.33.5 | 攻击者控制 SVG 生成参数，且输出被作为可执行 SVG/HTML 使用时可能注入；当前没有 ImageResponse/OG 生成路由，未发现该实现进入产物。 |

### sharp 0.35.2 — high

- npm 聚合受影响范围：`<=0.35.5-rc.1`。
- 当前引入路径（npm ls 去重引用按实际已解析父级展开；均可指向同一物理安装）：
  - `example-cv-users → @cloudflare/vite-plugin@1.53.0 → miniflare@5.20260815.0-alpha → sharp@0.35.2`
  - `example-cv-users → @cloudflare/vite-plugin@1.53.0 → wrangler@4.124.0 → miniflare@5.20260815.0-alpha → sharp@0.35.2`
  - `example-cv-users → miniflare@5.20260815.0-alpha → sharp@0.35.2`
  - `example-cv-users → wrangler@4.124.0 → miniflare@5.20260815.0-alpha → sharp@0.35.2`
- 正式产物判断：未发现该漏洞实现进入当前 Workers 产物；本地/构建/CI 风险，见下文证据及限制。
- 最小建议：B/E：底层两公告分别修于 0.35.4、0.35.5，合并最低 0.35.5；通过 Miniflare 父级配套，不直接强覆写。

| GHSA / 名称 | 公告严重性 | 当前分支受影响范围 | 官方修复版本（本分支） | 利用前提与本项目判断 |
|---|---|---|---|---|
| [GHSA-rgj7-g3m4-5g8c](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c) / [发行者](https://github.com/lovell/sharp/security/advisories/GHSA-rgj7-g3m4-5g8c)：sharp: Vulnerabilities in libheif: GHSA-g89c-p67h-r497 and GHSA-2jg2-4ch7-h545 | high | `<0.35.4` | 0.35.4 | sharp 解码恶意 HEIF/AVIF；libheif 内存问题在特定 glibc Linux 条件下可能 RCE。Mac 不满足该特定 Linux RCE 条件，但 Linux CI 仍需考虑；当前未配置 Images binding/上传处理。 |
| [GHSA-wq5f-xc86-pv6w](https://github.com/advisories/GHSA-wq5f-xc86-pv6w) / [发行者](https://github.com/lovell/sharp/security/advisories/GHSA-wq5f-xc86-pv6w)：sharp : Vulnerability in librsvg dependency CVE-2026-96889 | high | `<0.35.5` | 0.35.5 | sharp 解码恶意 SVG；librsvg 内存漏洞在特定 glibc Linux/可执行文件硬化条件下可能 RCE。未证明本机或 CI 存在可达的攻击图片处理请求。 |

### undici 7.29.0 — high

- npm 聚合受影响范围：`7.0.0 - 7.30.0`。
- 当前引入路径（npm ls 去重引用按实际已解析父级展开；均可指向同一物理安装）：
  - `example-cv-users → @cloudflare/vite-plugin@1.53.0 → miniflare@5.20260815.0-alpha → undici@7.29.0`
  - `example-cv-users → @cloudflare/vite-plugin@1.53.0 → wrangler@4.124.0 → miniflare@5.20260815.0-alpha → undici@7.29.0`
  - `example-cv-users → miniflare@5.20260815.0-alpha → undici@7.29.0`
  - `example-cv-users → wrangler@4.124.0 → miniflare@5.20260815.0-alpha → undici@7.29.0`
- 正式产物判断：未发现该漏洞实现进入当前 Workers 产物；本地/构建/CI 风险，见下文证据及限制。
- 最小建议：B/E：本批 18 个公告合并最低 7.30.1；通过 Miniflare 配套升级，覆盖全部父链。

| GHSA / 名称 | 公告严重性 | 当前分支受影响范围 | 官方修复版本（本分支） | 利用前提与本项目判断 |
|---|---|---|---|---|
| [GHSA-3wwx-pv8p-q78v](https://github.com/advisories/GHSA-3wwx-pv8p-q78v) / [发行者](https://github.com/nodejs/undici/security/advisories/GHSA-3wwx-pv8p-q78v)：undici vulnerable to Denial of Service via unhandled error in WebSocket permessage-deflate decompression | moderate | `>=7.28.0 <7.29.1` | 7.29.1 | 连接恶意 WebSocket 服务端并启用压缩，超限后畸形压缩数据触发未处理异常；只影响相应客户端路径。 |
| [GHSA-pmjh-fq2x-6v4x](https://github.com/advisories/GHSA-pmjh-fq2x-6v4x) / [发行者](https://github.com/nodejs/undici/security/advisories/GHSA-pmjh-fq2x-6v4x)：undici vulnerable to Denial of Service via orphaned RetryHandler response body | moderate | `>=7.11.0 <7.29.1` | 7.29.1 | 使用 RetryHandler，服务端先截断再返回不可重试响应，悬挂 body；需该重试路径，不代表所有 fetch 自动重试。 |
| [GHSA-r53p-7pc4-xj5r](https://github.com/advisories/GHSA-r53p-7pc4-xj5r) / [发行者](https://github.com/nodejs/undici/security/advisories/GHSA-r53p-7pc4-xj5r)：undici vulnerable to downstream response splitting via retry interceptor | low | `>=7.0.0 <7.29.1` | 7.29.1 | 启用 retry interceptor，转发原 Content-Length 与续传拼接 body，可导致下游响应拆分；需代理/续传组合。 |
| [GHSA-rfgv-xxqx-mfg5](https://github.com/advisories/GHSA-rfgv-xxqx-mfg5) / [发行者](https://github.com/nodejs/undici/security/advisories/GHSA-rfgv-xxqx-mfg5)：undici vulnerable to Denial of Service via unrequested WebSocket subprotocol | high | `>=7.0.0 <7.29.1` | 7.29.1 | 客户端连接恶意 WebSocket 服务端，握手收到未请求的子协议，可能进程崩溃。 |
| [GHSA-3xpg-4rpp-hhhm](https://github.com/advisories/GHSA-3xpg-4rpp-hhhm) / [发行者](https://github.com/nodejs/undici/security/advisories/GHSA-3xpg-4rpp-hhhm)：undici vulnerable to Denial of Service via unbounded decompression of compressed responses | moderate | `>=7.15.0 <7.29.1` | 7.29.1 | 显式使用 decompress interceptor 读取不可信上游；压缩炸弹导致内存耗尽。 |
| [GHSA-2jfj-6hjv-fm6j](https://github.com/advisories/GHSA-2jfj-6hjv-fm6j) / [发行者](https://github.com/nodejs/undici/security/advisories/GHSA-2jfj-6hjv-fm6j)：undici vulnerable to cross-user cookie disclosure via Set-Cookie caching in shared caches | moderate | `>=7.0.0 <7.29.1` | 7.29.1 | 启用共享 cache interceptor，上游缓存响应含 Set-Cookie，后续调用者可能收到其他用户 Cookie；当前应用 no-store 不能代替修复工具库。 |
| [GHSA-2gqq-gqf2-x968](https://github.com/advisories/GHSA-2gqq-gqf2-x968) / [发行者](https://github.com/nodejs/undici/security/advisories/GHSA-2gqq-gqf2-x968)：undici vulnerable to response truncation via oversized chunked responses in the dump interceptor | low | `>=7.1.0 <7.29.1` | 7.29.1 | 使用 dump interceptor，分块响应超过 maxSize，出现误导的截断成功响应/断连。 |
| [GHSA-w293-vg96-wgc3](https://github.com/advisories/GHSA-w293-vg96-wgc3) / [发行者](https://github.com/nodejs/undici/security/advisories/GHSA-w293-vg96-wgc3)：undici vulnerable to TLS certificate validation bypass via dropped connect options in BalancedPool | high | `>=7.24.1 <7.29.1` | 7.29.1 | BalancedPool 使用带函数的 connect/tls 自定义校验；克隆丢失回调。默认系统证书校验并非全部关闭。 |
| [GHSA-8436-99hf-9mmv](https://github.com/advisories/GHSA-8436-99hf-9mmv) / [发行者](https://github.com/nodejs/undici/security/advisories/GHSA-8436-99hf-9mmv)：undici vulnerable to caching and replay of unsafe HTTP method responses | low | `>=7.0.0 <7.29.1` | 7.29.1 | cache interceptor 将不安全方法的可缓存响应保存/重放；需启用该缓存，不是单凭安装就发生。 |
| [GHSA-rx4f-c7p8-82vq](https://github.com/advisories/GHSA-rx4f-c7p8-82vq) / [发行者](https://github.com/nodejs/undici/security/advisories/GHSA-rx4f-c7p8-82vq)：undici vulnerable to Denial of Service via WebSocketStream unclean close | moderate | `>=7.0.0 <7.29.1` | 7.29.1 | 使用 WebSocketStream 且持有 writer，恶意对端异常断开导致未处理拒绝。 |
| [GHSA-4qv8-2p9j-2685](https://github.com/advisories/GHSA-4qv8-2p9j-2685) / [发行者](https://github.com/nodejs/undici/security/advisories/GHSA-4qv8-2p9j-2685)：undici vulnerable to Denial of Service via unbounded memory in the EventSource parser | moderate | `>=7.0.0 <7.30.1` | 7.30.1 | EventSource 连接恶意 SSE 对端，巨量字段或分块行造成解析状态内存耗尽。 |
| [GHSA-f72v-6w45-q472](https://github.com/advisories/GHSA-f72v-6w45-q472) / [发行者](https://github.com/nodejs/undici/security/advisories/GHSA-f72v-6w45-q472)：undici vulnerable to Subresource Integrity bypass via non-lowercase algorithm tokens | moderate | `>=7.15.0 <7.30.1` | 7.30.1 | fetch 配置大小写混合 SRI 算法，上游控制 body，完整性可能被跳过；需实际使用 integrity。 |
| [GHSA-xjj6-f33q-929c](https://github.com/advisories/GHSA-xjj6-f33q-929c) / [发行者](https://github.com/nodejs/undici/security/advisories/GHSA-xjj6-f33q-929c)：undici vulnerable to Denial of Service via unhandled error on excessive content-encodings | high | `>=7.18.0 <7.30.1` | 7.30.1 | fetch 遇恶意上游超过五层 Content-Encoding 并提前关闭，可触发未处理内部流错误；不要求额外 interceptor。 |
| [GHSA-4w7w-5xrc-9h26](https://github.com/advisories/GHSA-4w7w-5xrc-9h26) / [发行者](https://github.com/nodejs/undici/security/advisories/GHSA-4w7w-5xrc-9h26)：undici vulnerable to cache poisoning and cross-user disclosure via cross-origin redirects | high | `>=7.0.0 <7.30.1` | 7.30.1 | originless Agent 组合 redirect/cache 并共享缓存，跨源重定向可能导致污染及跨用户数据披露。 |
| [GHSA-2m5v-pch6-74hx](https://github.com/advisories/GHSA-2m5v-pch6-74hx) / [发行者](https://github.com/nodejs/undici/security/advisories/GHSA-2m5v-pch6-74hx)：undici vulnerable to TLS certificate validation bypass via dropped tls options in Agent | high | `>=7.0.0 <7.30.1` | 7.30.1 | Agent/EnvHttpProxyAgent 的 tls 选项含函数校验时被克隆丢失；需要自定义 tls callback，不能写成默认 TLS 全面失效。 |
| [GHSA-qrxm-fqhp-jwvm](https://github.com/advisories/GHSA-qrxm-fqhp-jwvm) / [发行者](https://github.com/nodejs/undici/security/advisories/GHSA-qrxm-fqhp-jwvm)：undici vulnerable to Denial of Service via TLS 1.2 certificate-changing renegotiation | high | `>=7.0.0 <7.30.1` | 7.30.1 | 客户端访问恶意 HTTPS 上游，TLS 1.2 重协商替换不匹配主机的证书，引发断言崩溃；TLS 1.3 不满足前提。 |
| [GHSA-9fm3-97px-rjf6](https://github.com/advisories/GHSA-9fm3-97px-rjf6) / [发行者](https://github.com/nodejs/undici/security/advisories/GHSA-9fm3-97px-rjf6)：undici WebSocket client vulnerable to Denial of Service via unbounded automatic PONG buffering | moderate | `>=7.0.0 <7.30.1` | 7.30.1 | 连接恶意 WebSocket 对端，PING 触发自动 PONG 队列无背压增长，耗尽内存。 |
| [GHSA-55wc-3pg8-jfw6](https://github.com/advisories/GHSA-55wc-3pg8-jfw6) / [发行者](https://github.com/nodejs/undici/security/advisories/GHSA-55wc-3pg8-jfw6)：undici vulnerable to Denial of Service via unhandled exception in the decompress interceptor | moderate | `>=7.15.0 <7.30.1` | 7.30.1 | 组合 decompress 与会抛错的下游 handler（如 dump），恶意压缩响应使异步异常逃逸。 |

### vinext 1.0.0-beta.2 — high

- npm 聚合受影响范围：`0.0.1 - 1.0.0-beta.13`。
- 当前引入路径（npm ls 去重引用按实际已解析父级展开；均可指向同一物理安装）：
  - `example-cv-users → @vinext/cloudflare@1.0.0-beta.2 → vinext@1.0.0-beta.2`
  - `example-cv-users → vinext@1.0.0-beta.2`
- 正式产物判断：框架的 SSR/RSC 代码确实进入 Workers；其 audit High 来自 image-size 等子包，未确认这些漏洞实现进入本产物。不能把父包在运行等同子漏洞可达。
- 最小建议：C/E：1.0.0（稳定版），配 @vitejs/plugin-rsc 0.5.34，保留 React 三包 19.2.9；1.4.3 要求 ^19.3.1，非最小方案。
- 此节点无独立 GHSA；继承 `@vercel/og`、`image-size`，公告、修复版本及利用前提见对应底层节点，不能另造一个 Cloudflare/Vinext 公告。

### vite 8.0.13 — high

- npm 聚合受影响范围：`8.0.0 - 8.1.5`。
- 当前引入路径（npm ls 去重引用按实际已解析父级展开；均可指向同一物理安装）：
  - `example-cv-users → @cloudflare/vite-plugin@1.53.0 → vite@8.0.13`
  - `example-cv-users → @vitejs/plugin-react@6.0.2 → vite@8.0.13`
  - `example-cv-users → @vitejs/plugin-rsc@0.5.26 → vite@8.0.13`
  - `example-cv-users → @vitejs/plugin-rsc@0.5.26 → vitefu@1.1.3 → vite@8.0.13`
  - `example-cv-users → vinext@1.0.0-beta.2 → vite@8.0.13`
  - `example-cv-users → vite@8.0.13`
- 正式产物判断：未发现该漏洞实现进入当前 Workers 产物；本地/构建/CI 风险，见下文证据及限制。
- 最小建议：A/E：8.1.6 覆盖当前全部 7 个公告；8.0.16 只覆盖早期两项，不足。所有当前 peer 声明允许 ^8.0.0。

| GHSA / 名称 | 公告严重性 | 当前分支受影响范围 | 官方修复版本（本分支） | 利用前提与本项目判断 |
|---|---|---|---|---|
| [GHSA-v6wh-96g9-6wx3](https://github.com/advisories/GHSA-v6wh-96g9-6wx3) / [发行者](https://github.com/vitejs/launch-editor/security/advisories/GHSA-v6wh-96g9-6wx3)：launch-editor: NTLMv2 hash disclosure via UNC path handling on Windows | moderate | `>=8.0.0 <=8.0.15` | 8.0.16（早期项） | Windows、NTLM 启用、可达 editor middleware，访问攻击站点触发 UNC 路径，可能泄漏 NTLMv2；当前 Mac/Linux 不满足 Windows 前提。 |
| [GHSA-698v-4r3x-3vcv](https://github.com/advisories/GHSA-698v-4r3x-3vcv) / [发行者](https://github.com/vitejs/launch-editor/security/advisories/GHSA-698v-4r3x-3vcv)：launch-editor: escapeCmdArgs() omits % escaping on Windows | moderate | `>=8.0.0 <=8.1.5` | 8.1.6（其余 Vite 8 分支另见公告） | Windows cmd、恶意文件名/环境变量或 ADS，经 editor 路径可命令注入；当前 Mac 不满足 Windows 条件。 |
| [GHSA-r825-w8mm-5pxw](https://github.com/advisories/GHSA-r825-w8mm-5pxw) / [发行者](https://github.com/vitejs/launch-editor/security/advisories/GHSA-r825-w8mm-5pxw)：launch-editor: Editor CLI flag misinterpretation causing arbitrary command execution for some editors | moderate | `>=8.0.0 <=8.1.5` | 8.1.6（其余 Vite 8 分支另见公告） | 可控 editor file 参数及特定 Vim/MacVim/Emacs 等编辑器，CLI flag 被解释为命令；非 Windows 也需考虑，不只 Windows 风险。 |
| [GHSA-587h-7wmj-h5pm](https://github.com/advisories/GHSA-587h-7wmj-h5pm) / [发行者](https://github.com/vitejs/launch-editor/security/advisories/GHSA-587h-7wmj-h5pm)：launch-editor: `fs.existsSync()` existence check can be bypassed on Windows | high | `>=8.0.0 <=8.1.5` | 8.1.6（其余 Vite 8 分支另见公告） | Windows 特殊路径可绕过 existsSync 检查，并与命令注入问题组合；当前 Mac 不满足条件。 |
| [GHSA-9jrq-w75r-8gcw](https://github.com/advisories/GHSA-9jrq-w75r-8gcw) / [发行者](https://github.com/vitejs/vite/security/advisories/GHSA-9jrq-w75r-8gcw)：Vite: Cross origin script execution through Vite custom middleware | low | `>=8.0.0 <=8.1.5` | 8.1.6（其余 Vite 8 分支另见公告） | 运行 custom/middleware Vite dev server、请求 URL 原样传给 transformIndexHtml、含 inline module，访问恶意站点可同源脚本执行。Vinext dev-server.js 确有该调用；未执行攻击复现。 |
| [GHSA-rq7h-c2jc-7f22](https://github.com/advisories/GHSA-rq7h-c2jc-7f22) / [发行者](https://github.com/vitejs/vite/security/advisories/GHSA-rq7h-c2jc-7f22)：Vite: Files outside `server.fs.allow` could be served when project paths match system paths on non-Windows machine | moderate | `>=8.0.0 <=8.1.5` | 8.1.6（其余 Vite 8 分支另见公告） | 开发服务可访问且存在根相对导入与宿主绝对路径碰撞，可能读取 allow 外文件；当前没有发现匹配导入，未做利用验证。 |
| [GHSA-fx2h-pf6j-xcff](https://github.com/advisories/GHSA-fx2h-pf6j-xcff) / [发行者](https://github.com/vitejs/vite/security/advisories/GHSA-fx2h-pf6j-xcff)：vite: `server.fs.deny` bypass on Windows alternate paths | moderate | `>=8.0.0 <=8.0.15` | 8.0.16（早期项） | Windows/NTFS 或短文件名、网络可达 dev server、敏感文件位于 allow 目录，可绕过 deny；当前 Mac/Linux 不满足 Windows 文件系统前提。 |

### wrangler 4.124.0 — high

- npm 聚合受影响范围：`<=0.0.0-7ae5dd357 || 4.16.0 - 4.130.0`。
- 当前引入路径（npm ls 去重引用按实际已解析父级展开；均可指向同一物理安装）：
  - `example-cv-users → @cloudflare/vite-plugin@1.53.0 → wrangler@4.124.0`
  - `example-cv-users → wrangler@4.124.0`
- 正式产物判断：未发现该漏洞实现进入当前 Workers 产物；本地/构建/CI 风险，见下文证据及限制。
- 最小建议：C/E：4.154.0，与插件 1.66.0 对齐其精确子依赖，避免另一份旧 Miniflare。
- 此节点无独立 GHSA；继承 `miniflare`，公告、修复版本及利用前提见对应底层节点，不能另造一个 Cloudflare/Vinext 公告。

## 4. 产物、Workers 与外部输入边界

当前 `npm run dev` 经 scripts/run.mjs 先 Vite build 再运行 scripts/local.mjs 的 Miniflare，不是直接启动 Vite dev server。因此 Vite dev-server 漏洞不能算作本次既有验收服务已触发；直接使用 Vite 开发入口或插件中间件时仍需修补。CI 构建也不必然启动这些中间件。

本轮没有重建；对照上一轮 `docs/evidence/remediation-20261105/build-manifest.json` 检查现存 dist/server、dist/client 的 89 个产物文件 SHA-256，适用同一候选构建。读取入口 `worker/index.ts`、`vite.config.ts`、`wrangler.jsonc` 与安装源码；并检查所有产物文件的包名、解析器特征、外部导入、native/wasm 资源。

| 组件 | 实际源码和产物证据 | 外部输入与判断 |
|---|---|---|
| image-size | Vinext `dist/server/metadata-route-build-data.js:5,10–12,29–31` 读取 metadata 文件并解析尺寸；由构建 manifest 入口引入。产物未发现 image-size/JXL/ICNS 解析实现；`imageSizes` 命中只是图片配置字段。 | 可控仓库/PR 图片可能阻塞构建；本包无图片上传/API→解析器，未证实公开触发。 |
| satori / @vercel/og | Vinext `dist/shims/og.js` 在 ImageResponse 使用时动态导入 OG。应用未导入 ImageResponse/next/og，产物无 satori/OG 实现特征。 | 未来加入带可控参数的 OG/SVG 时须重新评估；当前没有该入口。 |
| sharp | Miniflare `dist/src/index.js:107299`、107552 的 Images 模拟处理动态加载 sharp；当前无 Images binding，dist 无 native `.node` 资源和 sharp/libheif 特征。 | 本地 Images/未来测试喂入不可信图片才建立通路；Linux CI 原生内存风险不能由 Mac 通过替代。 |
| npm undici | Miniflare `dist/src/index.js:41505` require undici，并用于模拟器出站/请求适配；正式 dist 未见其实现或导入。 | 外部恶意上游可影响本地工具；不是公开 Worker fetch 使用 npm undici 的证据。Workers fetch 为平台运行时，不能用 Node 包版本推断其实现。 |
| Vite / Cloudflare 插件 / Wrangler | Vite 和部署/模拟服务未作为正式 Worker dev server 发布；框架 RSC/SSR 已打包。产物包含图片路由通用处理，但没有据此找到上述漏洞解析器。 | Vite server 绑定 127.0.0.1 不等于抵御浏览器访问恶意站点的 localhost 攻击；执行器 Origin/CSRF 也不替代 Vite 本身漏洞修复。 |

产物没有 source map/完整可复现包来源图，因此上述是“源码链路 + 当前产物静态证据”的结论，不是形式化可达性证明。本轮没有攻击载荷复现，没有启动公网服务；不将没发现标记等同保证不存在。新依赖构建后需重新检查产物。

源码 `scripts/controlled-https.mjs:33` 与正式 Worker 出站不是同一个运行时：本地执行器的 `send` 使用 Node 全局 fetch，正式 Worker 使用 workerd 平台 fetch；不把 npm undici、Node 内建副本和平台实现混为一谈。

另有独立于 npm lock 的运行环境边界：实际 Node 24.13.0 的 `process.versions.undici` 为 **7.18.2**。它与 npm 的 7.29.0 是两个副本。当前 `scripts/controlled-https.mjs:33` 使用 Node 全局 fetch，升级 npm undici 不会修补 Node 内建副本。多份公告明确覆盖内建 fetch/WebSocket 的相应实现；7.18.2 落入其中一些受影响区间，但不能把 18 项全部套用（例如 >=7.28 的条件不满足）。没有恶意上游/WS 连接或特定 interceptor 配置的证据，亦未核对 Node 所有 backport；固定 Node 的真实工具风险尚不能宣称消失。此项不计入 8+2，不擅自升级 Node；下一轮包修复可继续，真实验收前需另行决定/核对安全 Node 补丁基线及其既有二进制 pin 更新授权。

## 5. 最小配套方案（仅计划，未安装）

| 依赖 | 当前 | 推荐精确候选 | 原因 / 兼容边界 |
|---|---|---|---|
| vite | 8.0.13 | 8.1.6 | 当前七份公告的最低共同 Vite 8 修复线；Node ^20.19 或 >=22.12，24.13 满足；现有插件 peer 允许。 |
| vinext | 1.0.0-beta.2 | 1.0.0 | 官方 npm 元数据不再引入 image-size，固定 @vercel/og 1.0.3；React/DOM/RSC ^19.2.6 允许现有 19.2.9；保留 app-router-entry 导出。 |
| @vitejs/plugin-rsc | 0.5.26 | 0.5.34 | 满足 Vinext 1.0.0 新最低 peer；React 三包不升级。需检查 RSC 流/SSR/client manifest 兼容。 |
| @cloudflare/vite-plugin | 1.53.0 | 1.66.0 | 最早已核对的 1.x 配套组，固定 Wrangler 4.154.0 和 Miniflare 5.20261023.1-beta；仍支持 Vite ^8。 |
| wrangler | 4.124.0 | 4.154.0 | 与插件精确子依赖一致，Node >=22；workerd 1.20261023.1。 |
| miniflare | 5.20260815.0-alpha | 5.20261023.1-beta | 与上述两个父包一致，固定 sharp 0.35.5/undici 7.30.1；Node >=22。 |
| React/DOM/RSC | 19.2.9 | 保持 | GHSA-xqc2-xf4c-x3h3 修复仍在，当前锁仅一个 RSC webpack 包，无 parcel/turbopack 副本。 |
| @vinext/cloudflare | 1.0.0-beta.2 | 先保持 | peer ^1.0.0-beta.2 可包含稳定 1.0.0；声明兼容不等于运行 API 已验证。 |

直接升级 image-size/satori/sharp/undici 的顶层副本不能覆盖固定的子依赖。针对父包的 npm overrides 可能缩小文件数，但 satori 跨 0.x API、Miniflare 原生图片行为与父包测试支持未确认，不作为首选。若希望完全避免 Vinext 升级，可单独评估 scoped overrides，但本轮不把它写为已兼容方案。

为何不直接采用 npm fixAvailable：1.4.3 Vinext 要求 React/RSC ^19.3.1 和插件 ^0.5.37，扩大范围；Cloudflare 插件 1.54.7 虽不在当前聚合 High 区间，仍固定 5.20260910.0-alpha 并不能证明其 sharp/undici 全修复；旧版 Miniflare 4.20250508.2 是破坏性降级建议，不适用 SQLite/Workers 测试方案。

以上候选来自 [npm 官方 registry](https://registry.npmjs.org/) 发布元数据（精确版本链接：[vinext 1.0.0](https://registry.npmjs.org/vinext/1.0.0), [vite 8.1.6](https://registry.npmjs.org/vite/8.1.6), [@cloudflare/vite-plugin 1.66.0](https://registry.npmjs.org/@cloudflare%2fvite-plugin/1.66.0), [wrangler 4.154.0](https://registry.npmjs.org/wrangler/4.154.0), [miniflare 5.20261023.1-beta](https://registry.npmjs.org/miniflare/5.20261023.1-beta)）。不存在已证明“D：没有任何兼容修复”的包；这里的兼容仅指 engines/peer/固定子包声明，运行时适配仍待实验。预计移除当前十个受影响节点的已知公告，但不承诺新解析树总 audit 为 0；必须新鲜 audit 验证新的传递依赖及重复副本。

## 6. 修复顺序及测试门槛

1. **先单独 Vite 8.1.6**：最小直接版本变化；npm ci/ls/audit、完整 RSC build/typecheck、现有路由/API与 Origin/CSRF 回归。确认全部 Vite 引用去重，不只升级直接节点。
2. **Vinext 1.0.0 + RSC 插件 0.5.34**：保留 React 19.2.9，核对 route/static/callback、SSR 私有缓存、密码表单客户端交互、RSC 刷新/导航。确认 image-size 消失来自官方父包实现变化，OG/Satori 更新没有残留旧副本。
3. **Cloudflare 三件套配套**：插件 1.66.0 / Wrangler 4.154.0 / Miniflare 5.20261023.1-beta；核对 workerd 更新、convertV4MiniflareOptions 导出、assets 路由、SQLite 初始化/持久化/重建/并发原子授权、超时/取消/UNKNOWN 不重试、真实执行器最后网络边界（只隔离替身）和 Cookie 写回。保留当前 compatibility_date，不能把升级工具自动解释为修改部署策略。
4. **汇总审计和安全回归**：完整 npm audit 与 omit-dev 对照，npm ls 检查所有副本；Users CI 四命令、分类/Required Gate、HTTPS 12 场景与停止保护；Mac 与 Ubuntu（含 sharp 对应平台可选二进制）分别确认，不能以 Mac 结果冒充 Linux CI。
5. **产物与验收版本**：新建完整业务/工具/锁/产物哈希，核对不含测试配置/密钥；一次合成浏览器注册验证、登录、主动续期、普通改密、恢复刷新/DO消费、退出与错误文案回归。已认可布局无需重设计。

后续真实回归需单独批准：由于拟升级 RSC 与 workerd，不仅仅是本地 lint 工具，建议两个小范围：① Chrome/Safari 各一次必要登录、身份、主动续期、退出；② 单浏览器一次恢复申请/验码/DO授权/改密及独立身份核对，含模板/证书收尾。普通改密是否再做一次，依据最后打包与合成 Cookie/身份结果单列批准；不自动重复注册/发信/改密。真实自动等待一小时到期续期仍是独立未验证项，不以主动刷新替代。

## 7. 最终判断与未解决边界

| 问题 | 判断 |
|---|---|
| 存在生产运行时 High 吗？ | 未确认这些公告的漏洞代码在当前公开 Worker 可达；Vinext 运行时代码入包属实，不能将 dev 标签视为豁免。 |
| 外部请求能触发吗？ | 公告中存在网络可触发类别，本地 Vite/模拟器或不可信图片处理在特定条件下受影响；当前账户公开请求没有已证明的可达链。 |
| 哪些可精确升级？ | Vite 8.1.6 可直接定向；底层 image-size 2.0.3、sharp 0.35.5、undici 7.30.1、satori 0.33.5 有修复，但当前父级固定/内部 API 要通过配套组落实。 |
| 需要 Vinext/Vite 升级吗？ | 推荐两者定向升级；无需上到 Vinext 1.4.3 或 React 19.3。 |
| 可开始下一轮修复吗？ | 可以申请上述六个直接依赖精确版本变更及必要锁文件/隔离回归；尚未执行，不代表可 Push/部署/真实验收。 |
| 未解决事项 | 候选安装/测试相容性；新树是否引入其他公告；Node 内建 undici 的独立安全基线；新候选真实回归。 |

原五项真实 PASS 仍只绑定 `676c5c7c083f63be14c71be12dd79ccab67ec504bd7d89887bcb05ed8e29a1df`。当前 `439bbc1e…` 仅有已记录本地测试结果，本轮不追加真实结果。历史 UNKNOWN/原始回执/PR #31 保留不变。报告之外只生成忽略目录内的只读审计材料；源码、锁文件、CI、Commit、main 与其他工作区均未修改。
