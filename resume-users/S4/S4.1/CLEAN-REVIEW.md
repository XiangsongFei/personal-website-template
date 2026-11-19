# S4.1 干净候选修复与验收

替代原 PR #42，基线为已核实的 `c9a202dac85f176cc2963a8d0b6a0ad50ce2282d`。原最终实现及合成证据来自 `e95e9616c0dddb25f69a46a82b123ad4edc43f48` 的文件树。干净候选没有继承旧提交。

## Finding 修复

| Finding | 修复与证据 |
| --- | --- |
| P2 公开文档 | 清理 `REPOSITORY.md` 的本机路径及工作区明细，清理其他 S4.1 文档中的私有实验定位与不必要的部署观测细节。保留汇总、业务约束和可公开的已有合成证据。原链隐私与后续处理见[迁移预检](CLEAN-MIGRATION.md) |
| P3 改密对比度 | `app/account-management.css` 在改密工作区局部提高输入框边界和占位文字对比度。真实 Chromium 从计算样式验证三个字段分别为 **4.54:1** 与 **4.74:1**。聚焦、禁用及错误边框可区分，实际拒绝反馈仍显示 |
| P3 Dashboard 临时故障 | `app/dashboard/page.tsx` 的故障分支使用 `DashboardUnavailable`。共享账户外壳提供 `main` 和界面语言控件。服务端渲染故障短文与普通网页重试链接，无脚本也可用原生折叠控件阅读英文。429/503 继续返回私有响应 |

与原 S4.1 最终树相比，应用差异只涉及上述 CSS、Dashboard 路由、新建的故障组件及其两项回归用例。会话验证、Cookie/Origin 检查、账户接口、密码处理、侧栏、Header、业务闭态、依赖及工作流均保持原实现。登录、注册、邮箱验证、忘记密码与重置密码页面的源文件保持相同。

## 新基线本地检查

| 检查 | 结果 |
| --- | --- |
| Users TypeScript、Build | PASS，使用仓库要求的 Node 24.22.1 |
| Dashboard、账户和改密定向测试 | 18 通过 |
| Users 全量 `npm test` | 142 通过，0 失败，0 跳过 |
| S3 离线回归 | Node 767、Python 110 通过，既有 SQL 源码与 ACL 检查通过 |
| Users `npm audit` | 0 vulnerabilities，依赖锁未改 |
| Public build 与测试 | 52 通过 |
| Admin 前端 lint、测试与 build | 2169 通过、27 跳过，构建使用合成占位配置 |
| 本地浏览器 | Chromium 157，320/390/800/1024/1440px；移动导航 Enter/Escape、账户往返、改密提示、Host/Origin、HEAD/RSC、匿名及登出后的拒绝均通过 |
| 429/503 和浏览器回退 | 429 无脚本可使用英文原生披露及重试链接。503 在存储被禁用时可切换两种语言并重试恢复。真实 Chromium 后退未显示退出前的 Dashboard，无实际 BFCache 命中断言 |
| 公开认证页面对照 | 把原 `e95e9616` 和干净候选各自构建。登录、注册、邮箱验证、忘记密码和重置密码共 20 个中英文及桌面/手机用例的计算样式和布局一致 |

[浏览器结果](clean-review-evidence/chromium-results.json) · [摘要清单](clean-review-evidence/SHA256SUMS.json) · [英文改密桌面](clean-review-evidence/password-en-desktop.png) · [中文改密 320px](clean-review-evidence/password-zh-320.png) · [429 无脚本](clean-review-evidence/dashboard-429-no-script-390.png) · [503 英文](clean-review-evidence/dashboard-503-en-390.png)

运行均为本地合成身份及隔离传输。生产服务和站点业务未参与。GitHub Actions 的隔离 SQL、兼容性与 Required gate 以新 PR 的实际运行回执为准。本页的执行者自检与独立审查分别记账。独立结论记录于替代 PR 描述，绑定最终 HEAD 与完整差异范围。官方 Codex Review 以 GitHub 回执单独记录。
