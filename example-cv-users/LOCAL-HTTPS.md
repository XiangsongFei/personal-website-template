# 本地 HTTPS 工具入口

当前工具已整理至包内`scripts/https/`，不再依赖历史探针。完整启动、精确leaf信任范围、只读预检、独立撤销、UNKNOWN与停止说明统一维护在[docs/TESTING.md](docs/TESTING.md)。配置名称与固定公开pin说明见[docs/CONFIGURATION.md](docs/CONFIGURATION.md)。

此入口不安装证书或自动增加信任；本轮仅工具整理，无认证、发信、改密或Keychain写入。历史Safari/Chrome结果及旧工具异常仍保留于本机原记录，不改写为本轮通过。
