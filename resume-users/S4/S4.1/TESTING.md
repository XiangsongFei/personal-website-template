# S4.1 本地测试报告

环境：macOS arm64，项目要求的现有Node 24.22.1、npm 11.19.1，锁定依赖使用npm ci安装到本轮worktree；未升级/修改锁文件。所有Auth运行均为`tests/auth-fixture.mjs`合成身份，外部业务网络拒绝，无真实Auth、邮件、Supabase、数据库或Storage操作。

## 项目检查

| 检查 | 结果 |
| --- | --- |
| npm ci --no-audit --no-fund | PASS；197包；保留既有安装脚本提示，无依赖修复 |
| npm run build | PASS；Vinext真实构建；工具对部分既有页面静态分类UNKNOWN的提示不是验收结论 |
| npm run typecheck | PASS |
| npm test | PASS；Users 135/135，S3 Node 767/767，Python110/110；既有SQL源码/ACL检查完成，无真实写入 |
| 最后定向Dashboard回归 | PASS，7/7；包含有效RSC的规范化307和后续200 |
| npm audit --json | **FAIL，11 high**；既有picomatch公告GHSA-fc5q-39xc-vjpf及依赖链；没有audit fix或降低门槛 |
| Git diff --check/文件白名单 | 提交前执行；无空白错误，仅S4.1源码/测试和本目录记录 |

七项新增集成用例实际运行构建后的workerd，使用真实SDK解析合成Auth响应，不是只测试一个布尔路由函数：匿名及子路径/编码/重复斜线/HEAD/RSC；有效登录及S2账户入口；撤销/退出后的旧Cookie；身份网络故障；身份限流；并行A/B/匿名隔离；业务API404、Host421、POST405且无业务出口。

初次类型检查发现重复翻译键，已移除。加强RSC测试时，首次把Vinext规范化307误期待为200；核对实际Location后改为验证307私有响应及后续受保护200，没有放宽认证。浏览器退出/Back脚本首次在历史恢复重载未结束时继续goto产生导航中断；等待页面稳定后复核通过。原测试日志保留，不把这些早期尝试记成最终PASS。

## 浏览器验证

使用Playwright CLI控制真实本机Chromium，以合成`.invalid`账号登录隔离本地Worker；没有修改正式Host或生产认证。42项布局/语言/导航/生命周期断言通过：

- 中文/English及各自标题、document.lang；UI偏好跨账户页保留，S2表单外壳仍正常。
- 两种语言各检查1440、900、768、390、320px，无横向溢出，桌面侧栏与移动披露按钮按断点切换。
- Space打开移动导航，Tab进入，Escape关闭，焦点返回；另验证跳至主内容链接实际移动焦点。
- 人工检查桌面、移动中英文和展开导航截图，内容、换行、层次及按钮可见。
- 模拟pagehide/persisted pageshow证明旧工作区隐藏并重新请求；另执行真实退出与浏览器Back，并确认稳定后仍在登录页、fresh Dashboard请求被拒绝。没有声称该真实Back一定命中了浏览器BFCache。
- 浏览器error级console记录为0。未做Safari/Firefox、真实手机或生产浏览器验收。

截图及CLI快照、检查脚本完整保留在本轮worktree忽略目录 `example-cv-users/.runtime/s4.1-browser-qa/`，不上传含合成会话操作的原始日志。截图没有真实用户内容。以下摘要可核对本地实际图片；工作记录以本报告及已提交集成测试为可移植证据。

| 本地截图 | SHA-256 |
| --- | --- |
| `s41-desktop-en.png` | `b4dc776e219686d2392db07f673bee2132d362cd13230a7253c4cb53ec6a3ded` |
| `s41-desktop-zh.png` | `be0bcfb5b15c17598d61423796db6d5b5d612fbc5f012fa90da4238e3ff282b5` |
| `s41-mobile-en.png` | `fffac11c83770f918865a7b0981ad1d69d57f6f11cb7532b85d61659923901b6` |
| `s41-mobile-menu-en.png` | `7cbf9c9d5273c3c67412ccc77b2f009387292cd402547a5a1f36f993d0499df3` |
| `s41-mobile-zh.png` | `ed42db86f6290d9c1a502dbf0b5762fa0e87725b84f336ebe0b0eae539b5792c` |

最终完整测试日志 SHA-256：`5d5c4389ff916e28c038f793ddcce8e13dd785a19336c62843ec2a621d34563c`；本地审计 JSON SHA-256：`cac1f5c787084869abc9a48058393cdfa448855cd34720e61f831d971e28b5e7`。原文件保留本机临时证据，不上传原始会话日志。
