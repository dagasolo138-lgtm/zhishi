# zhishi

一个部署在 GitHub Pages 的纯静态、本地优先知识库。

zhishi 调用用户自行提供的 DeepSeek API，持续生成结构化客观事实；事实保存在浏览器 IndexedDB 中，可按分类和关键词检索，并导出为 JSON 或 Markdown。

## 特性

- 纯 HTML、CSS、原生 JavaScript，无框架、无构建工具、无后端。
- DeepSeek Chat Completions SSE 流式输出。
- 加权轮换生成 9 个知识分类的客观事实。
- 对返回结果进行 JSON、必填字段、事实长度和模糊词校验。
- 使用 IndexedDB 持久化本地事实库。
- 支持关键词搜索、分类筛选、分类统计。
- 支持导出 `zhishi_export.json` 与 `zhishi_export.md`。
- GitHub Actions 自动将 `main` 根目录发布至 `gh-pages` 分支。

## 分类

- 地理
- 物理
- 化学
- 生物
- 历史
- 技术原理
- 天文
- 数学
- 语言学

## 本地运行

浏览器需要通过 HTTP 服务访问本项目，直接双击 `index.html` 会影响 ES Module 与 `fetch()` 对本地 JSON 文件的读取。

```bash
python3 -m http.server 8080
```

在浏览器打开：

```text
http://localhost:8080
```

首次打开时，应用会向 IndexedDB 写入内置种子事实。之后在右上角“设置”中填写 DeepSeek API Key，并开启“自动生成”。

## API Key 与安全边界

- API Key 仅保存在当前浏览器的 `localStorage`，不会写入仓库，也不会上传到 GitHub Actions。
- 本项目是纯静态前端，浏览器会直接向 DeepSeek API 发出请求；任何能使用该浏览器配置文件的人都可能读取该 Key。
- 使用单独创建、额度受控的 API Key，不要使用高权限或无额度限制的密钥。
- 清除浏览器站点数据、清除 localStorage 或在设置中保存空 API Key，都会移除本地保存的 Key。

## GitHub Pages 部署

仓库已包含 `.github/workflows/deploy.yml`：每次推送到 `main`，GitHub Actions 会将仓库根目录同步到 `gh-pages` 分支。

首次启用时，在 GitHub 仓库中完成：

1. 进入 **Settings → Pages**。
2. 在 **Build and deployment** 中选择 **Deploy from a branch**。
3. 选择分支 `gh-pages` 与目录 `/ (root)`。
4. 保存设置。

若部署工作流无法推送 `gh-pages`，检查仓库 **Settings → Actions → General → Workflow permissions**，确保 `GITHUB_TOKEN` 具有读写仓库内容的权限。

## 导出

页面顶部提供两个导出按钮：

- **导出 JSON**：完整保留每条事实的 `id`、分类、来源提示和时间戳。
- **导出 Markdown**：按知识分类整理为可阅读的文本列表。

导出的文件只包含当前浏览器 IndexedDB 中的事实，不包含 API Key 或其他设置。

## 项目结构

```text
.
├── data/
│   ├── categories.json       # 分类、权重、子分类、关键词
│   └── facts_seed.json       # 首次初始化的种子事实
├── js/
│   ├── api.js                # DeepSeek SSE 客户端
│   ├── app.js                # 应用启动与种子初始化
│   ├── exporter.js           # JSON / Markdown 导出
│   ├── generator.js          # 加权生成循环、重试、入库
│   ├── prompt.js             # 结构化事实提示词
│   ├── settings.js           # API Key、生成开关、清库
│   ├── storage.js            # IndexedDB 数据层
│   ├── ui.js                 # 搜索、统计、卡片流、状态展示
│   └── validator.js          # 生成结果校验
├── css/
│   └── style.css             # 深色界面样式
├── .github/workflows/
│   ├── deploy.yml            # main → gh-pages 发布
│   └── backup.yml            # 手动备份占位工作流
└── index.html
```

## 备份工作流

`.github/workflows/backup.yml` 目前是手动触发的占位工作流，只记录触发信息，不会上传事实库数据。

这是刻意设计：知识库实际数据位于用户浏览器 IndexedDB，静态网站无法在不额外接入认证、存储服务和数据同步逻辑的情况下自动备份浏览器本地数据。实际备份可先使用页面的 JSON 导出功能。

## 当前默认模型

`js/api.js` 当前使用 `deepseek-v4-flash`，并关闭 thinking 模式以减少 JSON 输出被额外推理文本污染的概率。需要调整模型时，修改该文件中的 `MODEL` 常量即可。
