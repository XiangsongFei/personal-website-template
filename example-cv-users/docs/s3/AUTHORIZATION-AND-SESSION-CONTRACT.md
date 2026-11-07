# Authorization、Session与数据库权限

状态：INFERRED规范性设计；新实现/SQL/RLS/GRANT/Storage测试全部NOT TESTED。
不得假定Users当前默认ACL、函数、Data API曝光配置已安全。

## 普通身份与业务资格

Worker复用Users的getClaims/getUser验证和HttpOnly account Cookie；独立业务适配层使用真实用户JWT。
现有Auth transport白名单不能直接拿来查询业务REST/Storage；不开放浏览器Token来迁就旧CMS Repository。
请求ID、email、任意set_config/GUC和user_metadata不可作为数据库权威身份；数据库auth.uid/session claim必须来自被验证的JWT。

business_session_grants绑定UID+session_id+security_epoch+purpose+时效+撤销状态。
它是业务资格，不替代站点成员检查；有效谓词还须用户可用、非hold、站点允许、Owner/成员有效、资源同站。

## 可信签发与防重放

1. 仅服务端实际观察普通密码登录成功，再完成Claims/User及正常用途验证后签发。
2. 普通account Cookie或任意有效UID不能独立换取资格；既有会话无grant时重新普通登录。
3. 签名证明绑定project/action/UID/session_id/epoch/proof_id/issued_at/expires_at/payload_digest/key_id。
4. 专用服务端签名器持密钥，数据库最小校验器核验签名、JWT调用者、session、项目、时间及一次性proof消费。
5. proof消费与grant写入同事务；重放不重复签发，同proof异载荷拒绝。
6. 不存密码、Token/完整身份响应；Secret配置和S2最小集成点另批，不借旧CMS HMAC密钥。
7. 普通角色不能写/延长grant或security_epoch；不可因SECURITY DEFINER而无条件相信actor参数。

## 刷新与撤销

建议参数30分钟滑动/12小时绝对期限：待最终确认，不是生产值。
JWT刷新不自动签发新资格；同UID/session、未撤销、epoch一致、未过绝对期限才可可信续期。
过期/撤销记录不能原地复活；session_id变更先拒绝，不按UID转移。并发续期/撤销必须锁定和比较epoch。
定向退出先撤销业务grant，再上游退出；上游UNKNOWN不恢复grant。
改密/恢复改密在可信身份已确定且外部改密前提交epoch递增及必要hold；撤销失败不继续声称已安全。
敏感数据库/Storage检查通过最小内部辅助接口确认上游session仍存在且UID匹配，不向用户暴露auth.sessions。
外部直接Auth变更/管理员操作、会话清理时效及故障联动仍需专项验证；不承诺单靠短TTL即时撤销。
Recovery不签发business grant；恢复成功后重新普通登录。移动Cookie名、直接Recovery JWT、替换session_id都须拒绝业务。

## 数据库执行角色（候选）

| 角色 | 设计权限 |
|---|---|
| authenticated | 用户JWT；必要只读权限；白名单RPC EXECUTE；无私有表直接DML |
| command_writer | NOLOGIN、非BYPASSRLS；只供已审查命令函数；最小表写权且继续RLS |
| authz_reader | 最小必要成员/grant/session读取，布尔资格函数；不返回任意用户数据 |
| grant_issuer | 仅签发/撤销状态写权；可信证明校验后执行；无内容发布权 |
| maintenance/migration | 独立运维边界，不进入普通请求链 |

角色继承/SET ROLE/函数所有者/EXECUTE必须专项审查，普通角色不得成为这些内部角色成员。
固定search_path、限定对象名、无动态SQL。必要definer辅助函数放未曝光schema，只返回当前调用者最小判断。
FORCE RLS不能替代角色权限审查，也不约束所有高权限角色。

## 对象授权、GRANT/RLS与Data API清单

| 对象 | 普通用户 | 数据库/业务规则 | 曝露面 |
|---|---|---|---|
| sites | 本站读；create/state RPC | 有效资格+Owner；owner不可普通写 | 最小视图 |
| members | 本站必要成员读；无直接写 | sites权威Owner；镜像检查 | 成员视图 |
| domains/settings/locales | 本站读、受控命令写 | 同站/保留词；verified状态可信流程写 | 视图+RPC |
| 内容/翻译/方法/导航/链接 | 本站读、聚合命令写 | 同站FK、不可转归属、版本CAS | invoker视图+RPC |
| assets/documents | 本站元数据读、受控文件操作 | site/actor/purpose/引用状态 | 视图+RPC |
| revisions/snapshots历史 | Owner受控读；无直接写 | 同站、schema与附件重授权 | 历史RPC |
| audit | 本站安全展示；不可修改 | 执行者可信、脱敏、只追加 | 分页RPC |
| operation_requests | 本人本站指定操作必要状态 | 不枚举他人结果 | 状态RPC |
| security/grants/proofs | 无直接读写 | 内部签发/布尔辅助判断 | 不曝露表 |
| upload/cleanup/outbox | 无直接读写 | 目的、租约、引用/版本 | 必要状态RPC |
| publication pointer | 无直接写 | Owner独立动作/expected revision | 发布RPC |
| 当前公开投影 | 任意访客只读 | 当前合法site/domain/published pointer | 独立公开RPC |
| Storage objects | 按本站操作规则 | 与数据库同一业务资格+asset/intent归属 | Storage策略 |

site_data/site_private不直接Data API曝光，site_api对象显式批准；invoker视图需要的底层SELECT/USAGE逐项授予且有RLS。
撤销默认PUBLIC EXECUTE；逐函数授予。无TRUNCATE、成员DML、审计DML或万能函数。
SELECT/INSERT/UPDATE USING+WITH CHECK/DELETE各定义，UPDATE所需SELECT一并核对；归属不可变还需列权限/触发规则。
不把单个PostgREST pre-request检查当Storage/Realtime通用门禁。
公开读API不能顺便返回private draft/history，函数不因“RPC”名称天然受RLS保护。

## 需获证据才能实施

当前已曝光schema、默认ACL、GRANT、RLS政策、函数/视图所有者与执行权限完整清单仍UNKNOWN。
业务grant证明/签发权限、Owner递归策略、内部角色继承和Recovery直接API必须先在隔离环境通过。
高权限fixture准备与普通JWT证明分开，不把service_role成功当安全验收。
