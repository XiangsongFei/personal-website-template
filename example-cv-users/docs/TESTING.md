# 测试与本地 HTTPS

> **2026-11-07 证据入口：** 本文继续维护本地工具方法；末尾“最新候选”链接保留历史用途。当前各版本结果统一见[分版本测试与验收矩阵](S2-PRODUCTION-CLOSEOUT-2026-11-07.md#3-分版本测试与验收矩阵)。
>
> 原Mac、发布复现沙箱、GitHub平台跳过及Version 9用户报告分别记录；沙箱FAIL、历史UNKNOWN及NOT TESTED不被后续PASS覆盖，本次未重跑认证或构建。

## 默认隔离测试

使用锁定 Node 24.22.1，在本包中运行 `npm run build`、`npm run typecheck`、`npm test`。测试默认真实 workerd、本机 SQLite DO、合成上游，禁止远程资源与真实认证回退。部分超时测试等待18秒或30秒；不要因等待时间而重试写操作。

- routes/account/session/parity：根入口、所有页面/API/静态资源、字段、双语错误、Cookie/刷新/退出、来源与缓存。
- durability/failure：SQLite文件落盘；销毁并重建workerd；并发只消费一次；领取后中断、过期、丢失回执及UNKNOWN不重放。
- controlled-real与三个mini测试：真实目标配置判断被覆盖，但最终网络边界被本机接收端/合成替身接管；前置额度、身份和操作限制、响应Cookie/传输故障；不是托管真实请求。
- local-https/tls-tools：精确来源、分离Set-Cookie、固定指纹/SAN/用途/期限、密钥角色和文件保护、Node真实PID及二进制摘要；Python只离线提取策略/命令函数，不读取钥匙串。
- local-stop-invocation：无认证健康进程；正常、重复、超时及仅绑定PID定向收尾，不能把进程退出冒充会话退出。

## 可选可信 HTTPS（需独立授权）

不需要证书即可构建、类型检查和运行隔离测试。没有本地材料时HTTPS预检必须拒绝；这不是要求把历史证书/私钥复制入Git。

未来经单独授权准备匹配policy的材料后，目录`.runtime/tls`需本用户所有、0700；server.key为0600、单硬链接、无符号链接路径，且必须与leaf匹配。工具不读取CA私钥。历史leaf有效期记录为2026-11-07北京时间11:55:54；执行时检查真实当前时间。换证书或Node二进制要单独批准、更新公开pin与工具版本，不能沿用旧授权或忽略过期。

选择已核实的Node后，用其完整实际路径启动，不用个人路径写入公共配置：

```sh
# node必须为已经核实且匹配pin的24.22.1可执行文件。
node scripts/https/preflight.mjs --certificate-only
node scripts/https/preflight.mjs
```

第二项使用系统默认SSL/127.0.0.1校验；不传额外可信根，不修改信任。系统不信任时停止，不点浏览器绕过。

### 限定信任与独立撤销

本轮没有执行以下操作。未来每次需要明确批准，系统确认只在本机完成，不索取Mac密码。公开工具不含任何已授权批次或自动安装入口。

使用新的本机RUN_ID，设置 `S2_VERIFIED_NODE` 为同一经核实执行文件。工具先核验该文件完整摘要再调用证书预检：

```sh
python3 scripts/https/leaf-trust-control.py snapshot RUN_ID
python3 scripts/https/read-leaf-effective.py RUN_ID --baseline
python3 scripts/https/leaf-trust-control.py plan RUN_ID
```

RUN_ID必须8–80位字母数字/连字符。snapshot只读取指定leaf的三域显式设置及当前用户公共证书存在情况，写本地`.runtime/https-trust/RUN_ID/before.json`（schema 2）及公开`server.pem`、`server.der`快照和完整指纹；不复制私钥，不修改Keychain。当前实现仅支持三域均无显式记录且指定leaf原公共项为0的已验证基线。已有设置、记录读取失败（包括权限错误）、证书已存在或无法解释的有效结果，都停止；不覆盖或删除既有项。

在新增信任之前，保存下面不依赖运行服务的撤销步骤以及首次有效SSL评估到本地记录，核对相同证书/链/主机/用途/日期条件。经批准才可以执行 `install RUN_ID`：仅当前用户、精确非CA服务器证书、SSL用途，无PolicyString、无CA信任、无admin/system写入。信任不按端口或标签页限制，也不会因关闭浏览器自动消失。

独立撤销步骤：

```sh
python3 scripts/https/leaf-trust-control.py restore RUN_ID
python3 scripts/https/leaf-trust-control.py verify-restored RUN_ID
python3 scripts/https/read-leaf-effective.py RUN_ID --compare
```

snapshot、plan、install仍要求原有严格Node、当前证书有效期和私钥文件安全预检。restore及verify-restored只读本批公开证书快照，核对完整指纹、文件属主/权限、原状态、当前UID和绑定安装账本；即使原证书过期、原材料或私钥丢失，也可精确撤销。旧schema 1批次不能由新工具自动迁移或重放。

restore先核对当前记录确属本次唯一SSL leaf信任，再remove-trusted-cert；只可删除本批新加且原数量0、当前数量1的公共证书项，不操作既有证书或私钥。重复成功撤销只读确认，不重复系统写入。read-leaf-effective也使用公开leaf快照而不依赖私钥，但有效SSL比较仍拒绝把到期/尚未生效当作恢复；到期时显式撤销可以完成，有效状态应保留未确认。显式恢复与相同条件有效SSL恢复要分别确认；不能仅删文件或用到期失败代替撤销证明。每条系统写命令先建立排他attempt记录，超时保留UNKNOWN且不重试；之后只读回查，不用另一个RUN_ID重复删除。出现差异或权限读取受阻，保留未确认并交用户处理，不清空信任缓存、不重启系统服务。

### 启动与停止

合成HTTPS诊断：`node scripts/local-https.mjs <当前完整构建清单>`。仅合成登录/刷新/退出；不能注册或改密。源码和产物需逐文件匹配，保持终端stdin可用，不使用读完stdin后exec的heredoc包装。

受控真实入口`controlled-https.mjs`要求另行批准的短期批次、当前业务/产物/工具完整绑定及专用执行器。历史批次已用尽或过期，不可重用。本轮工具变更后的新摘要不继承旧批次执行权。

结束顺序：浏览器主动POST定向退出并确认→关闭本轮标签页→原终端stop→清理回执→进程退出与端口释放→独立撤销信任→显式及有效结果回基线。30秒清理超时必须保留UNKNOWN；仅在核实本批PID、父子关系、实际可执行文件及脚本后才可定向终止，不按名称批量杀Node，不影响其他开发服务。

## 证据范围

脱敏真实摘要见[S2结项](S2-CLOSEOUT.md)。实际主动刷新通过不等于已真实等一小时；本地SQLite并发/重建不等于云端攻击或多地域测试。真实密码、验证码、Cookie、Token、邮箱和UID不进入公开日志/摘要；合成fixture明确使用example.invalid，不是用户凭据。

本轮 S2 专用 Node 并存于 `$HOME/.nvm/s2-users/versions/node/v24.22.1/bin/node`，不改变 nvm 动态默认别名 `24` 的原解析。启动本包命令时仅在当前 shell 设置 `export PATH="$HOME/.nvm/s2-users/versions/node/v24.22.1/bin:$PATH"`，并先核对实际可执行文件与公开 pin。历史 24.13.0 及旧验收记录保留；不要用旧构建真实 PASS 代替新候选结果。

最新安全修复候选及后续双浏览器 HTTPS 证据见[交付状态](FINAL-DELIVERY-CANDIDATE.md)；历史构建与真实验收结论保持各自版本绑定。
