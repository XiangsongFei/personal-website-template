# S3 真实业务依赖

- S2 会话、Host、Origin、Cookie、私有响应及身份错误处理沿用已有代码。新模块位于原 Dashboard 子路径。
- S3.2 关系合同提供 Education/Experience 字段和站点顺序设计。真实站点读取、当前资格、站点归属、读写映射、正式 ID、版本 CAS、幂等重放和 UNKNOWN 对账仍待验证。S3.6 离线写入实现仅覆盖 Introduction。
- S3.5 为 HOLD，Storage、文件和引用仍待验收。S3.6 真实保存及发布为 REAL_NOT_RUN。公开快照、发布/撤回、权限与缓存行为仍需真实验收。保存草稿按钮继续禁用。
- AI 仅保留本地禁用入口。接入前还需正式数据范围、用户采纳和服务验收。
- 生产 Supabase、旧 CMS、Worker 部署配置、锁文件和 CI 均在本次差异之外。没有生产 SQL、发布或云部署。
