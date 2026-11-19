# Cloudflare 只读核查与未来部署检查表

核查日期：2026-11-18（Asia/Shanghai）。使用Cloudflare连接器GET读取账户现有Access应用、Users deployments/versions/subdomain、Worker domains和script settings；不读取Secret值、不修改任何资源。另匿名HEAD观察现有Access边缘，无登录/放行操作或生产Auth请求。

## 历史核查结论

2026-11-18 的历史核查确认预览关闭。保留预览的 Host、Cookie、Access 与隔离绑定要求。本次干净候选使用独立本地合成环境，生产设置及流量保持不变。

不公开Access跳转携带的metadata token、临时Cookie、策略成员信息或原始响应。Access账户成员放行仅是外围门槛，不能替代普通用户的S2会话。当前保护范围也不意味着未来公开注册对象已经确定。

## 为什么现有Preview URLs不能直接验收

Cloudflare支持以Version URL查看指定版本，并能使用Access保护，但它不自动隔离应用绑定/认证。当前预览关闭，本轮保持关闭。[官方Version URLs文档](https://developers.cloudflare.com/workers/versions-and-deployments/version-urls/)与[workers.dev访问保护](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)是方案参考。

本应用先要求请求Origin完全等于USERS_APP_ORIGIN。production配置又固定正式Origin `https://admin.example-cv.com`。故直接请求workers.dev预览Host会421；只改USERS_APP_ORIGIN还会被configuration拒绝。isolated模式只接受localhost/127.0.0.1和合成Auth域；controlled-real为历史独立受控合同，本轮不得借用。S4.1没有放宽这些检查。

`__Host-`会话Cookie为Secure/HttpOnly、Path=/且无Domain，生产Cookie不会自动发送给预览Host。改用另一个Host就需要自己的受审Origin、Cookie、登录/OTP/恢复与回调合同，不能复用生产登录状态或仅放宽CORS。当前OTP/回调及return规则仍服从S2固定配置。

仅上传零流量版本不会自动复制出独立Auth、RecoveryState/DO或其他绑定；不应把使用生产资源的版本预览称为隔离环境。也不能因预览版本不接生产流量就跳过Access/真实数据边界。

## 最小方案与结论

- **当前可行且本轮已使用**：独立worktree内的本地合成Auth+workerd；可通过既有本地HTTPS流程进一步进行设备验收，不需改生产路由/流量、Access或DNS。本轮浏览器验收使用localhost HTTP合成环境，不声称完成本地HTTPS或真实身份验收。
- **当前不可直接使用**：现有Users Worker Preview URL。尚未开放，且Host/配置与隔离绑定不兼容，不能仅启用开关。
- **未来云端候选方案**：另批审批独立的合成预览环境及固定预览Origin、独立RecoveryState资源、无生产认证/业务出口的配置和Access策略，先审核Cookie/回调、负例及预览URL范围，再生成可核查工件。若要求“零新增资源、零生产设置变更”，本地预览是当前最小方案。未创建新Worker、环境或版本。

## 后续受控预览/正式部署检查表

- [ ] 最新 HEAD 的 Required CI 和适用依赖审计通过，保留原门槛。
- [ ] 最新HEAD完成独立代码审查；额度失败不计批准，PR41历史状态不改。
- [ ] 用户批准具体目标/变更及访问人群，明确本地合成、云端隔离或真实账户的验收层级。
- [ ] 预览Origin、Cookie、OTP/登录/恢复/回调及Access范围有可审合同；生产Host和Cookie不混用。
- [ ] 独立Auth/RecoveryState等绑定、出口和数据范围可证明；不得复用生产Secret或写入正式账户。
- [ ] 预览工件与Commit/构建版本关联，零生产流量，验证匿名/失效/临时错误和no-store。
- [ ] 正式部署前另获授权，保存原Version/Deployment与回滚方案、核对工件/配置差异、Access和会话负例；不得因Git Merge自动部署。

本轮**未具备直接启用云端预览或正式部署的完整前提**。技术上可继续本地合成UI验收；未来云端方案需上述条件。本报告不是启用Preview URLs、创建Worker、上传版本、Promote或修改Access/DNS/Secret的批准。
