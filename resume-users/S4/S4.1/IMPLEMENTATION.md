# S4.1 实施与修改清单

## 源码/测试文件

以下路径相对仓库根，全部位于现有 `example-cv-users/` 构建范围。

| 文件 | 变更 |
| --- | --- |
| `app/dashboard/page.tsx`（新增） | 服务端页面只在 requestContext 内有可信 S2 user 时渲染 Dashboard；失败仅展示安全错误与重新载入，不取网站内容 |
| `app/_components/dashboard.tsx`（新增） | 独立工作区布局、双语文案、Overview、账户入口、六类未开放状态、移动披露导航和键盘/生命周期处理 |
| `app/dashboard.css`（新增） | 所有工作区样式限定 dashboard 前缀，桌面侧栏、800px以下导航、520px以下单列、可见焦点和溢出控制 |
| `app/layout.tsx` | 根据服务端 requestContext.dashboard 选择工作区/原账户外壳，保留同一语言Provider和原账户布局；导入限定样式 |
| `app/_components/ui-locale.tsx` | 新增可选 pageTitle，默认账户不变；Dashboard 的文档标题随UI语言更新，表单不因切换语言重挂载 |
| `app/_components/account-home.tsx` | 已登录账户增加 `/dashboard` 链接；原账户、改密、退出逻辑保留 |
| `lib/account/messages.ts` | 仅增加“进入工作区”的英文翻译 |
| `lib/context.ts` | request-local 上下文增加 dashboard 标记，不加入全局用户状态 |
| `worker/index.ts` | 将 dashboard及子路径纳入原S2身份验证；路径解码/重复斜线归一后再判断；保留非账户API404和现有私有响应头 |
| `tests/dashboard.test.mjs`（新增） | 七项真实workerd+合成Auth测试，覆盖身份保护、错误、隔离、缓存和闭态API |

未改 package.json、package-lock.json、wrangler/vite/next配置、S2认证与账户API实现、RecoveryState、SQL、S3冻结合同或旧CMS/Public。

## 页面结构

桌面是左侧工作区导航与右侧主内容，参考旧CMS的克制字重、分组导航、浅色边框和内容层次。Overview包含账户安全卡片、内容功能状态卡片，以及建站、编辑、文件、发布、活动/历史、AI六类状态。

窄屏改用页头按钮展开正常文档流中的导航，非模态抽屉，不需要虚假的焦点锁。Space/Enter可操作按钮，Escape关闭并把焦点还给按钮；关闭后导航从可访问树移除。提供跳至主内容链接。界面中不保留可点击的未开放操作。

复用现有UI语言偏好，仅localStorage中的非敏感locale允许跨页面保留。它与将来的简历内容语言分离，不同步或翻译内容，不缓存用户/站点数据。

## 服务端保护链

请求必须先匹配已配置的Origin。Worker对`/dashboard`、其子路径及解码后等价路径执行原S2 createSession/identity；可信身份仍由服务端 getClaims/getUser 一致性验证得到。浏览器隐藏导航不参与授权。

没有身份且没有临时错误：303 `/login`。临时身份服务网络故障：503；限流：429；页面显示可重试错误，不输出Dashboard，也不说“没有网站”。有效身份才写入AsyncLocalStorage，服务端页面再检查该上下文。

响应保留`Cache-Control: private, no-store`、`Vary: Cookie`、`Referrer-Policy: no-referrer`。原S2 Cookie的Secure/HttpOnly/SameSite=Lax、Host绑定和认证回调规则未改变。HEAD和RSC请求经过同一Worker；Vinext对有身份的裸RSC请求先307到`/dashboard?_rsc`，该后续响应仍受身份保护和私有缓存头约束。

Dashboard没有身份信息或草稿的模块级/浏览器持久缓存。pagehide遮蔽旧工作区，persisted pageshow触发新的服务端载入；退出后新请求、旧Cookie、其他匿名请求均不能读取私有页面。未知业务API仍404，未接入旧CMS、Supabase浏览器客户端或新Grant链。
