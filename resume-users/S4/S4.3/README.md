# S4.3 统一编辑器与完整网站实时预览

2026-11-19（Asia/Shanghai）。Editor Design V1.3 在 `/dashboard/editor#profile` 与 `/dashboard/editor#introduction` 共用一个受保护的工作区。Profile 和 Introduction 都使用页面内存。刷新或离开页面后，从空表单重新开始。

- [实施与字段映射](EDITOR-V1.3.md)
- [完整网站预览合同](PREVIEW-CONTRACT.md)
- [验证、截图与视觉比较](TESTING.md)
- [GitHub 交付及真实业务依赖](DELIVERY.md)
- [浏览器证据](evidence/)

可在隔离环境中使用项目规定的 Node 24.22.1，在应用目录执行 `npm run dev`。使用现有 `.invalid` 合成账号登录，从 Dashboard 左侧进入个人资料或个人介绍。截图中的姓名及文案通过表单手工输入，属于合成验收数据。应用工作区默认使用空白内容。
