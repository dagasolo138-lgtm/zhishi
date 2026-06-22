# zhishi 项目说明

## 1. 项目简介

zhishi 是一个纯静态 GitHub Pages 应用，无后端服务。

应用调用 DeepSeek API（`deepseek-v4-flash`）持续生成结构化事实，将事实存入浏览器 IndexedDB，并支持搜索、筛选与导出。

## 2. 文件结构说明

核心文件职责如下：

- `index.html`：应用入口页面与 import map 配置。
- `css/style.css`：全局样式与组件样式。
- `data/categories.json`：内置分类配置。
- `data/facts_seed.json`：内置种子事实。
- `js/settings-store.js`：`localStorage` 读写。
- `js/settings-ui.js`：设置面板 UI。
- `js/settings.js`：设置模块对外入口。
- `js/generator.js`：生成调度，含轮数控制、分类过滤。
- `js/storage.js`：IndexedDB 封装。
- `js/prompt.js`：prompt 模板。
- `js/validator.js`：模型输出校验。
- `js/ui.js`：主界面入口转发、初始化、搜索、筛选、导出绑定与运行时事件编排。
- `js/ui-cards.js`：卡片创建、瀑布流渲染。
- `js/ui-stats.js`：统计面板、状态指示器。
- `js/ui-tabs.js`：Tab 切换、子类筛选栏、loadCategories 共享函数。
- `js/ui-graph.js`：D3.js 知识图谱可视化。
- `js/exporter.js`：导出功能。
- `js/api.js`：DeepSeek SSE 调用。
- `js/app.js`：应用启动、初始化与模块编排。

## 3. 开发规定

- 禁止新增文件（除非明确说明）。
- 修改前先读取文件当前内容。
- 每次改完执行：`git add . && git commit && git push`。
- 每次功能更新后同步更新本文件的“当前已实现功能”或相关说明。
- JS 使用 ES Module 规范。
- `index.html` 的 import map 版本号每次部署后记得递增。

## 4. 当前已实现功能

- 加权随机分类生成，3 秒间隔循环。
- 分类隔离去重（按当前分类取最近 20 条事实提取关键词，压缩后作为 prompt 去重参考）。
- 生成轮数控制（0 = 无限）。
- 分类开关（复选框）。
- 自定义分类。
- IndexedDB 持久化。
- 搜索、Tab 分类筛选、子类筛选、导出 JSON/Markdown。
- Tab 导航 + 子类筛选。
- 三级分类树（分类 → 子类 → 细分类）。
- fact 支持 `leaf` 细分类字段与 `quality_score` 质量评分字段。
- validator 过滤低质量评分、短事实和含模糊词的模型输出。
- 事实卡片支持点击展开/收起详情，展示来源、细分类、质量评分、生成时间和短条目 ID。
- 卡片点击展开详情。
- 知识图谱可视化（D3.js 力导向图）。
- 生成状态指示器（顶部圆点）。
- 顶部 Tab 导航支持“全部”、动态分类和“图谱”视图，生成状态显示在顶部品牌区。

## 5. 注意事项

- API Key 存 `localStorage`，key 名：`zhishi_deepseek_api_key`。
- model 固定用 `deepseek-v4-flash`。
- thinking 模式必须显式禁用：`{ type: "disabled" }`。
