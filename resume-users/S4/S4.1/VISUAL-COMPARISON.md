# S4.1 UI Design V1 — 视觉对比与验证

日期：2026-11-19（Asia/Shanghai）。之前为Commit `0dd20f7e42316af4504b1cae67e5103488658d7c`；之后为本轮UI Design V1补充候选。最终Commit/CI以PR42实际新HEAD回执为准。

## 前后变化

| 区域 | 之前S4.1 | UI Design V1 |
| --- | --- | --- |
| 页面定位 | 六项未来功能及状态，偏项目进度报告 | 我的工作台、我的网站、内容管理、账户安全 |
| 导航 | 242px单层；Not available挤占英文宽度 | 220px四组可折叠；统一范围说明，不再每项加标签；英文单行 |
| 容器 | 两张大边框卡片加六条状态列表 | 中性网站提示、七个细线内容分区、独立账户区域 |
| 颜色 | 暖灰#F7F6F3和米白卡片 | 白底、#FAFAFA浅灰、小面积鼠尾草绿；深绿真实主按钮 |
| 排版 | 长英文标题，辅助文字部分10–11px | 我的工作台/My workspace；标题32/30px、正文14–15px、辅助12–13px |
| 手机 | 单列六项状态，内容较长 | 两列短内容分区、单列账户；导航可滚动/折叠，保持触控/键盘操作 |
| 编辑区 | 未实施 | 仍未实施，仅形成后续55/45和手机单栏规范 |
| 业务安全 | S2认证与业务关闭 | 原实现保留，不新增API、保存、上传、发布或AI调用 |

网站提示与统一能力说明是准确未开放状态，不是虚构的网站数据。七个内容栏目没有href、事件或操作箭头；真正的主操作只进入原S2账户页。

## 本轮修改范围

修改dashboard.tsx、dashboard.css和dashboard.test.mjs，新增本目录四份V1设计文档并在README追加索引。原S4.1 IMPLEMENTATION/TESTING/REVIEW作为历史结果保留。最后一次局部Token整理后，构建、类型、8项Dashboard及118项浏览器回归再次通过；完整S2/S3结果来自本轮先前的同功能候选，不把局部样式重验写成新的真实业务验收。未修改S2认证/账户API、Worker、Context、LocaleProvider、包/锁、配置、SQL、S3、旧CMS或其他工作区。

## 本地验证

| 项目 | 结果 |
| --- | --- |
| 环境 | 现有锁定Node24.22.1、npm11.19.1及依赖；无新UI库 |
| 类型/构建 | npm run typecheck、npm run build通过 |
| Dashboard集成 | 8/8；认证/撤销/临时错误/隔离/闭态API回归保留，新增精确导航目标负例 |
| 完整npm test | Users136/136、S3 Node767/767、Python110/110及SQL源码/ACL离线检查通过；无真实写入 |
| 浏览器 | 真实本机Chromium、合成身份、隔离workerd；无生产Secret或真实账户 |
| 布局/键盘 | 118项断言通过；中文/English各1440/900/768/390/320px；页面和导航无横向溢出，英文菜单无异常换行；原生分组Enter/Space，菜单Space/Escape/焦点返回，skip link |
| S2样式隔离 | /account、/login、/register、/forgot-password、/reset-password实际检查：原380px内容宽、30px桌面标题、白底及48px输入框合同保持；相关源码逐字节保留 |
| 对比度 | 次要文字白底4.74:1、浅灰底4.54:1；主按钮6.55:1；选中导航5.82:1；主色4.04:1不用于小字号文本/白字按钮 |
| 代码复核 | 实现后本地专项自审无本轮未处理功能缺陷；不是第三方独立或官方批准 |
| 阻断 | picomatch审计和官方额度限制继续按新HEAD实际结果记账，不降门槛、不自动Merge |

新增导航测试最初以宽泛正则误把CSS文件名或#dashboard-main中的ai当业务链接，后改为精确检查实际a标签允许目标，不改业务边界。浏览器脚本最初把S2原width误断言为max-width，核对原CSS/实际样式后修正并重跑；未为通过检查修改S2页面。匿名重置密码页的既有recovery-session 401不算UI回归，也未删除其保护。

未做Safari/Firefox、真实手机或生产身份验收。390/320为Chromium窄屏。离线/合成PASS不替代S3真实业务验收。

## 截图与预览

真实浏览器截图已保留，原图未覆盖：

- 之前：`example-cv-users/.runtime/s4.1-browser-qa/output/playwright/`。
- V1：`example-cv-users/.runtime/output/playwright/`。
- 重点：`ui-design-v1-zh-1440.png`、`ui-design-v1-en-1440.png`、`ui-design-v1-zh-390.png`、`ui-design-v1-en-390.png`、`ui-design-v1-menu-en.png`。
- 两语五种宽度均有截图，另有中英文展开导航；测试脚本与118项结果也在本worktree的`.runtime`忽略目录，不上传原始合成会话操作日志。

本地 `http://localhost:8795/login`，使用现有合成账号`user-a@example.invalid`及固定哑密码`SYNTHETIC_REAL_ADAPTER_PASSWORD`，登录后从/account进入/dashboard。这不是生产凭据。使用既有Node24.22.1在example-cv-users中执行`node scripts/local.mjs`可启动已构建候选；需重建时先`npm run build`。重启后旧合成会话失效，应重新登录；不要改Host为127.0.0.1来绕过固定Origin。

截图是本地可检查证据，未上传为仓库二进制；以下摘要用于核对。源码、设计文档及集成测试由本轮补充Commit交付。

### 之前截图

| 文件 | 像素 | SHA-256 |
| --- | --- | --- |
| `s41-desktop-zh.png` | 1440×1263 | `be0bcfb5b15c17598d61423796db6d5b5d612fbc5f012fa90da4238e3ff282b5` |
| `s41-desktop-en.png` | 1440×1268 | `b4dc776e219686d2392db07f673bee2132d362cd13230a7253c4cb53ec6a3ded` |
| `s41-mobile-zh.png` | 390×1452 | `ed42db86f6290d9c1a502dbf0b5762fa0e87725b84f336ebe0b0eae539b5792c` |
| `s41-mobile-en.png` | 390×1602 | `fffac11c83770f918865a7b0981ad1d69d57f6f11cb7532b85d61659923901b6` |
| `s41-mobile-menu-en.png` | 390×2078 | `7cbf9c9d5273c3c67412ccc77b2f009387292cd402547a5a1f36f993d0499df3` |

### V1截图

| 文件 | 像素 | SHA-256 |
| --- | --- | --- |
| `ui-design-v1-en-1440.png` | 1440×1000 | `275ed67782ebb895891f5571aecb589703ea04f7b515b5e255beda091eeb2190` |
| `ui-design-v1-en-320.png` | 320×1311 | `3559203d92879bbd102d1c5ebe7ad2c7d5b7a6a222ad111d47a667283689f64a` |
| `ui-design-v1-en-390.png` | 390×1205 | `38ad88170e236b651889b3e342b1f8086a44946b14d38b47bb81521b562c7142` |
| `ui-design-v1-en-768.png` | 768×1050 | `77dc63b442c2000351d7faa35b1b6b6e8108a3505baea415f23d11acc5b10718` |
| `ui-design-v1-en-900.png` | 900×1072 | `664a8bc3936f2b974da686e280ec04a6fe76a779e2ad73018d531927ede897cc` |
| `ui-design-v1-menu-en.png` | 390×2136 | `d6e125d1d21fe8944d05414e8cef2dfa20a37949abdc4eefb2392a82861108db` |
| `ui-design-v1-menu-zh.png` | 390×2024 | `322666851ba9e4297b3900be504cb83d52ffd8678abbc798935bfcb7a2f40b75` |
| `ui-design-v1-zh-1440.png` | 1440×1000 | `54a8948767453d56a5d686779c7f53dc2efaf59285ef90964c4e1cc644cdc3bf` |
| `ui-design-v1-zh-320.png` | 320×1115 | `1285d13c99d64a9e91b99cd4fd0a1c715b0d0f487459cb7b5edf2dbe04179f84` |
| `ui-design-v1-zh-390.png` | 390×1093 | `76b50361a5be3ee223223fb95df271b0d5053ea867a62ca1f3b57747b5297fa8` |
| `ui-design-v1-zh-768.png` | 768×1050 | `f1629c4a7545a6809bfd03f570f414770f3458257f9ead4b965e303cbba97ac0` |
| `ui-design-v1-zh-900.png` | 900×1050 | `7428b8ea3199fef691b58754bb3a0aa7d4e59303680e19c84883a362b9367d4d` |

118项结果JSON SHA-256：`21b23edcc34695fb01c27ea1bbaa0c104d1028f2419b130d424e6c800b37475f`。完整测试日志SHA-256：`80e79b8aae4521cdc162b02daccc1e5c1f573970b21343ce7b291f8d4d7e2d3e`。
