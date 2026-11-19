# S4.1 账户 UI 测试与审查

日期：2026-11-19（Asia/Shanghai）；基线 `2690a82352705413aa24f9779dd9a6f7d659960c`。没有真实账户、生产 Supabase 或生产 Secret 参与。

## 自动化验证

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` | PASS（现有 TypeScript） |
| `npm run build` | PASS（现有 Vinext / Vite） |
| 账户 UI + Dashboard 专项 Node 测试 | 12/12 PASS |
| `npm test` Users | 140/140 PASS |
| `npm test` S3 Node | 767/767 PASS |
| S3 Python | 110/110 PASS（21+8+15+24+12+14+7+4+5） |
| `git diff --check` | PASS |

新增四项账户集成测试检查匿名两页 303 且无身份信息；有效登录的真实服务端合成邮箱及折叠 UID；原密码字段和路由；身份服务临时故障 503 / 限流 429 保持可重试、不冒充未登录、不泄漏身份；私有响应 `private, no-store` / `Vary: Cookie`；刷新、退出及旧 Cookie 不能重新打开账户、密码和 Dashboard。现有 S2 全套测试继续覆盖 OTP、登录、恢复、密码当前值校验、操作 ID、重放、并发、结果不明、会话失效及 Origin/Host/Cookie 安全边界。

完整日志保留在独立本地测试目录。未通过修改冻结依赖或门槛换取 PASS；没有把离线结果写成真实业务验收。

## 真实 Chromium

使用现有 Playwright CLI headed Chromium、现有合成身份及本地隔离 runtime。可复查摘要：[browser-flows.json](account-security-evidence/browser-flows.json)。

- 匿名账户跳转登录；登录后显示服务端合成邮箱；UID 默认折叠，键盘 Enter 可展开/收起。
- Dashboard → 账户 → 修改密码 → 返回账户及工作台的实际链接可用；刷新走原 API 成功。
- 两语账户页面覆盖 1440/900/768/390/320px；两语密码页面覆盖 1440/390/320px，无横向溢出。
- 密码不一致时零请求；错误当前密码返回可纠正反馈；正确合成密码修改成功；可纠正结果后操作 ID 重新生成；修改后的合成密码可登录。
- 原退出 API 成功；浏览器后退不显示前一用户身份；三个受保护页面重新访问均回到登录。
- 另外进行浏览器传输/响应故障注入，检查提交中禁用、结果不明停止危险重试、会话失效返回入口；此类 UI 注入不冒充服务端真实故障验收，服务端行为由 S2 集成测试覆盖。

截图保存在 `account-security-evidence/`：账户中文桌面、英文桌面、中文/英文手机，修改密码中文桌面/手机，登录中文桌面及手机前后对照。均为实际浏览器截图，未编辑图片；SHA256 在 [SHA256SUMS.json](account-security-evidence/SHA256SUMS.json)。合成密码成功状态另保留在本地忽略目录，不包含原始 Cookie/令牌。

## 登录及恢复页面回归

修改前保存全部 682 个已跟踪文件的摘要；修改后仅三个既有账户源码文件发生变化，其余既有应用、S2、Worker、共享样式和依赖文件字节保持不变。新增源码/测试和本轮交付材料单独检查。[source-invariants.json](account-security-evidence/source-invariants.json) 保留受保护文件摘要及三项修改清单。

对基线 Commit 在忽略目录独立导出、使用原依赖构建，先后在相同浏览器、相同 Host、本地隔离环境运行基线与候选；不覆盖源码或任何历史 worktree。五个禁止修改页面 × 中英 × 1440/390px 共 20 个对照案例。固定鼠标位置、移除焦点、等待字体和布局稳定，记录布局、颜色、字号、边框及尺寸；20/20 计算样式完全相等。

PNG 对照 14/20 文件及解码像素完全相等；其余六张各 1–18 个边缘像素有微量栅格差异（最大单通道 11/255，最多约 0.0055% 像素），没有布局或文字变化。登录中文桌面、英文桌面、中文手机各只有 1 个输入边缘像素不同；英文手机完全相同。没有把这些截图错误宣称为 20 张逐像素全等。详细案例、坐标、SHA256 见 [public-visual-comparison.json](account-security-evidence/public-visual-comparison.json)。源文件字节不变、20 组计算样式一致及图像核查共同确认没有登录/注册/恢复视觉回归。

测试过程中完整测试重建产物令旧本地进程引用旧 JS 清单，产生一次资源加载失败；确认停止旧进程并重启后再执行最终浏览器检查。这是本地验证环境问题，没有通过改应用或登录页规避。

## 专项本地代码审查

完成测试后单独逐文件复核最终 diff：服务端 ctx 分支与原表单不变；新样式作用范围不落到认证入口；API 参数、锁及异常分支保留；身份邮箱来自服务端；details 保持可访问；移动端布局及焦点可见；pagehide 隐藏与 persisted pageshow 重新验证；证据不含真实身份、令牌、Cookie、Secret；没有无关源码修改。未发现需阻断本次局部 UI 修改的已确认问题。

这是本地专项自审，未使用第二位独立审查者，也不等于 GitHub 官方 Code Review 批准。发布前核对 PR #42 最新 HEAD 的 CI 与审查，最终结果记录在 PR 正文和交付报告。记录写入时新 Commit 尚未推送，因此不预先宣称其 CI 通过。

基线 CI [44355381688](https://github.com/XiangsongFei/personal-website-template/actions/runs/44355381688) 的 build/typecheck/test 已过，既有 picomatch `GHSA-fc5q-39xc-vjpf` 依赖链 11 high 导致审计与 Required gate 失败。保留失败，不降级、不绕过、不修无关依赖。PR #42 已有官方额度限制/failed summary 绑定旧 `0dd20f7`；review 列表为空，不是新 HEAD 的已确认 Finding，也不是审查通过。PR #40/#41 不改，官方审查未完成继续是未完成状态。保持不合并、不部署。
