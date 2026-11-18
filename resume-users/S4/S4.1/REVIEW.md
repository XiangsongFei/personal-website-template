# S4.1 专项代码复核与官方审查状态

## 本地专项复核

对完成后的实际diff进行单独复核，范围为十个源码/测试文件及本目录记录。复核由同一执行者在实现后另行进行，属于本地自审，**不声称第二审查人独立批准或官方Code Review通过**。

| 检查 | 结论 |
| --- | --- |
| 服务端授权 | Dashboard及子路径、编码等价路径、HEAD/RSC均先验证S2身份；服务端页面无可信上下文不能输出工作区 |
| 身份错误 | 失效/撤销会话与临时网络/限流分开；后者503/429+重试，不误判未登录/空网站 |
| 请求/缓存隔离 | AsyncLocalStorage保持request-local；不向Dashboard传用户信息；private/no-store+Cookie Vary；无私有localStorage草稿；历史恢复重新验证 |
| API及副作用 | 业务API404、旧CMS不可达；没有建站/Grant/保存/文件/发布/AI调用；交互不可造成虚假持久回执 |
| S2兼容 | 登录目的地仍/account；原认证/OTP/密码/恢复实现不改；账号页仅新增链接；现有完整回归通过 |
| 语言/可访问性 | locale切换不重挂载表单；不可用项不是链接/按钮；移动披露正确隐藏、Escape/焦点和skip link已在浏览器验证 |
| 范围 | 样式dashboard前缀；包/锁/生产配置/SQL/S3/旧CMS不变；全部worktree和原脏文件保留 |

实现期复核发现的编码路径保护和移动Escape焦点范围已修正，并通过定向集成/浏览器回归。它们是本地开发发现，不是GitHub已确认Finding。最后复核未发现尚未处理的本次功能缺陷；这不豁免依赖审计、外部审查或部署前验收。

## GitHub官方Code Review

基线PR #41 OPEN，HEAD `ef748340a01fc20b9e23229cd828c729511beeaa`，Required CI SUCCESS。官方评论明确为“usage limits for code reviews”，reviews列表为空。自动summary中的failed/has_any_findings标记不能替代具体Finding；当前没有已确认代码Finding的证据，也没有审查通过证据。本轮不修改其状态、不重试或发评论触发它。

S4.1新PR打开后会检查**实际最新HEAD**的检查、review及额度评论；结果由PR和最终报告记录。不能将本地自审或CI视为官方人工批准。独立第二审查者批准仍未取得；若官方继续额度阻断，保持UNAVAILABLE/INCOMPLETE，不伪装PASS，也不自动Merge。

## CI与发布

CI由既有workflow按路径执行。本次Users源码与测试适用Users build/typecheck/tests/audit；不修改workflow或跳过安全审计。本地已观测11 high，若远端Required gate因此失败，保存失败run及HEAD，不重跑掩盖、不修无关依赖。

结论：可形成**本地功能候选**并交付GitHub；官方审查与安全审计是独立未关闭条件，不具备生产部署批准。S3.5 HOLD、S3.6真实未验收与#40阻断均不因本次界面测试改变。
