# Personal Website Template

[English](README.md) | 简体中文

一个简洁、响应式、支持中英文切换的个人网站模板，适合用于搭建个人作品集、在线简历和职业主页。

该模板易于自定义和部署，提供教育背景、实习经历、项目经历、技能、奖项、联系方式和简历链接等可复用模块，无需从零开始搭建个人作品集网站。

> **在线演示：** [example-cv.com](https://example-cv.com)

## ✨ 功能特性

- 🌐 中英文双语界面
- 🌍 根据访问者所在地区自动选择初始语言
- 🔄 在当前浏览器会话中保留用户手动选择的语言偏好
- 📱 支持桌面端、平板端和移动端的响应式设计
- 👤 个人资料与自我介绍模块
- 🎓 教育背景与经历模块
- 🚀 项目展示
- 🛠️ 技能与奖项模块
- 📄 支持独立的中文和英文简历 PDF
- 🔗 支持 Email、LinkedIn 和 GitHub 链接
- ☁️ 支持部署至 Cloudflare Workers
- ⚡ 轻量、快速的前端体验
- 🎨 内容和样式易于自定义

## 🛠️ 技术栈

- **框架：** Next.js / vinext
- **前端：** React + TypeScript
- **样式：** CSS
- **部署：** Cloudflare Workers
- **可选缓存：** Cloudflare KV
- **包管理器：** npm

## 📂 项目结构

```text
personal-website-template/
├── app/
│   ├── globals.css        # 全局样式和响应式布局
│   ├── layout.tsx         # 根布局和元数据
│   └── page.tsx           # 网站主要内容、双语逻辑和交互
│
├── public/
│   ├── resume_en.pdf      # 英文简历
│   └── resume_zh.pdf      # 中文简历
│
├── worker/
│   └── index.ts           # Cloudflare Worker 入口和地区语言 API
│
├── wrangler.jsonc         # Cloudflare Workers 配置
├── package.json
└── README.md
```

## 🚀 开始使用

### 1. 克隆仓库

```bash
git clone https://github.com/XiangsongFei/personal-website-template.git
```

进入项目目录：

```bash
cd personal-website-template
```

### 2. 安装依赖

```bash
npm install
```

### 3. 启动开发服务器

```bash
npm run dev
```

打开终端中显示的本地地址，即可预览网站。

## ✏️ 自定义

网站的大部分内容都可以直接在以下文件中修改：

```text
app/page.tsx
```

你可以将示例内容替换为自己的信息：

- 姓名和个人介绍
- 教育背景
- 经历
- 项目
- 技能
- 奖项
- Email
- LinkedIn
- GitHub
- 简历链接
- 联系信息

模板同时包含中文和英文内容。自定义网站时，请记得在适用的地方同时更新两个语言版本。

### 样式

全局样式和响应式布局主要位于：

```text
app/globals.css
```

你可以自定义：

- 字体排版
- 间距
- 模块布局
- 边框与分隔线
- 导航
- 响应式行为
- 桌面端布局
- 平板端布局
- 移动端布局
- 其他视觉细节

## 📄 简历 PDF

模板支持独立的中文和英文简历文件。

替换：

```text
public/resume_zh.pdf
public/resume_en.pdf
```

为你自己的 PDF 文件，并保持文件名不变。

网站中对应的简历按钮会自动打开相应语言版本的 PDF。

> **注意：** 本仓库中包含的简历均为虚构的演示文件。在将该模板用于个人网站之前，请替换为你自己的简历文件。

## 🔗 联系方式与社交链接

在以下文件中更新示例联系方式：

```text
app/page.tsx
```

将占位内容替换为你自己的：

- Email
- LinkedIn
- GitHub
- 简历链接
- 其他需要的个人主页链接

请确保同时更新页面上显示的文本以及对应的 URL。

## 🌐 双语内容

网站主要内容同时提供中文和英文版本。

添加或修改模块时，请确保对应内容在两个语言版本中同步更新，以保持语言切换后内容一致。

双语内容以及前端语言切换逻辑主要位于：

```text
app/page.tsx
```

## 🌍 自动地区语言检测

网站支持根据访问者所在地区自动选择初始显示语言。

如果当前浏览器会话中尚未保存用户手动选择的语言偏好，前端会请求：

```text
/api/locale
```

该地区语言接口由以下文件中的 Cloudflare Worker 处理：

```text
worker/index.ts
```

Worker 使用 Cloudflare 提供的请求元数据判断访问者所在的国家或地区。

默认行为如下：

- 检测到来自中国（`CN`）的访问者时显示中文版本。
- 来自其他地区的访问者默认显示英文版本。
- 如果无法获取地区信息，则可以使用浏览器语言作为备用判断依据。

这样可以在无需访问者手动选择语言的情况下，为公开网站提供更加合适的初始语言。

## 🔄 语言偏好

访问者可以随时手动切换中文和英文。

当访问者手动选择语言后，其偏好会通过浏览器的：

```text
sessionStorage
```

进行保存。

该语言偏好会在当前浏览器会话期间保留。

这意味着刷新页面或在网站内部导航时，不会立即使用自动地区检测覆盖访问者手动选择的语言。

由于语言偏好采用会话级存储而不是永久存储，因此新的浏览器会话仍可以重新执行自动地区语言检测。

## 🧭 导航与响应式行为

模板为主要的个人作品集内容提供基于模块的导航。

模块可以包括：

- 关于
- 经历
- 项目
- 技能
- 奖项
- 联系方式

布局和导航行为会针对以下设备进行适配：

- 桌面端
- 平板端
- 移动端

响应式样式主要定义在：

```text
app/globals.css
```

导航、模块交互、语言切换以及相关前端逻辑主要由以下文件处理：

```text
app/page.tsx
```

如果你对模块高度、间距、导航布局或响应式断点进行了较大调整，也建议同时检查相关的导航和滚动行为。

## ☁️ 部署至 Cloudflare Workers

本项目支持通过 vinext 部署至 Cloudflare Workers。

### 1. 登录 Cloudflare

```bash
npx wrangler login
```

### 2. 配置 Cloudflare

在以下文件中配置 Worker 和所需的 Cloudflare 资源：

```text
wrangler.jsonc
```

部署前，请将 Cloudflare 资源 ID 和账户相关配置替换为你自己的信息。

如果你的配置使用 Cloudflare KV，请创建自己的 KV namespace，并在 Cloudflare 配置中填写对应的 namespace ID。

除非你的部署配置明确要求使用 Cloudflare KV，否则对于网站的基础功能而言，Cloudflare KV 是可选的。

Worker 同时提供用于自动地区语言检测的接口：

```text
/api/locale
```

### 3. 构建项目

部署前，请先确认项目可以成功构建：

```bash
npm run build
```

成功构建意味着当前源代码可以正常编译并用于部署。

根据 vinext 的配置，如果没有配置 KV namespace，你可能会看到与可选 `VINEXT_KV_CACHE` binding 有关的警告。

例如：

```text
The KV data cache adapter requires a VINEXT_KV_CACHE KV namespace binding.
```

如果构建仍然成功完成，并且应用能够回退到默认缓存处理方式，则该警告并不一定会阻止部署。

### 4. 部署

运行：

```bash
npx @vinext/cloudflare deploy
```

项目将被构建并部署至 Cloudflare Workers。

部署完成后，Wrangler 会提供一个 `workers.dev` 地址，你可以通过该地址检查部署结果。

### 5. 添加自定义域名

确认 `workers.dev` 部署正常后，可以在 Cloudflare 控制台中连接自己的域名。

进入你的 Worker，然后打开：

```text
Settings → Domains & Routes
```

之后添加你的自定义域名。

## 🔄 更新部署

修改网站后，首先确认项目仍然能够正常构建：

```bash
npm run build
```

然后重新部署最新版本：

```bash
npx @vinext/cloudflare deploy
```

Cloudflare 会使用最新构建更新现有的 Worker 部署。

如果你直接通过 GitHub 网页修改文件，请将更改提交到对应的分支。

> **注意：** 更新 GitHub 仓库并不会自动更新线上 Cloudflare Worker，除非你另外配置了自动部署工作流。

如果没有配置自动部署，请在本地拉取或同步 GitHub 仓库中的最新修改，然后重新部署项目。

## 🔒 隐私

在线演示和公共仓库中的内容仅用于演示目的。

演示中包含的姓名、机构、日期、简历、项目、链接、联系方式以及其他个人信息均应视为虚构内容或占位内容。

在发布自己的版本之前，请仔细检查仓库，并避免提交：

- API key 或 token
- 密码或登录凭据
- 包含敏感信息的 `.env` 文件
- 你不希望公开的私人联系方式
- 不应公开访问的个人文件
- Cloudflare 身份验证凭据
- 私有 API 凭据
- 账户相关的私密信息
- 其他敏感信息或个人身份信息

公开的个人作品集网站和 GitHub 公共仓库均可以被其他人访问，也可能被搜索引擎收录，因此请在部署前仔细检查所有内容。

## 🤝 贡献

欢迎提交贡献、建议和改进。

参与贡献：

1. Fork 本仓库
2. 创建新的分支
3. 进行修改
4. Commit 你的修改
5. 将分支 Push 到你的 Fork
6. 提交 Pull Request

## 📜 许可证

本项目采用 MIT License。

详细信息请参阅 [LICENSE](LICENSE) 文件。

## ⭐ 支持

如果你觉得这个模板有用，可以考虑给仓库点一个 Star。

欢迎 Fork 本项目，并根据自己的需要将其自定义为个人作品集、在线简历或个人网站。
