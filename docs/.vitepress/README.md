# .vitepress 目录说明

本目录存放站点配置、业务模块与自定义主题。`lib/` 是构建期业务逻辑，`theme/` 是浏览器端主题，两者以 data loader（`*.data.ts`）衔接。

## config.mts

站点配置入口：导航与侧栏、rewrites（permalink → 输出路径）、markdown 扩展（markmap、mathjax、cardlist 短码）、主题注册与 `transformPageData`（向页面下发字数、作者等数据）。

## lib/ — 业务模块（构建期执行，双端共享）

| 文件 | 职责 |
| --- | --- |
| `types.ts` | 全局共享类型：Article、Catalog、CategoryCount、Author 等 |
| `content/catalog.ts` | 核心：扫描 `docs/` 编号目录，生成侧栏树、分类、标签、归档与字数统计；校验 permalink 重复 |
| `content/category.ts` | 分类层级路径的解析、统计与排序（分类页与筛选栏共用） |
| `content/order.ts` | frontmatter `order` 排序纯函数（侧栏与专题页共用） |
| `content/cardlist.ts` | `::: cardlist` 短码：把 Markdown 表格渲染成卡片网格 |
| `data/members.ts` | 站点成员信息，文章 `author` 只写名字、其余在这里查 |
| `data/authors.ts` | 作者解析：frontmatter → 完整作者对象，头像首字兜底 |
| `data/activity.ts` | 活动页数据：扫描 `docs/activity/` 生成活动列表 |
| `data/site.ts` | 站点常量：正式网址 `freshnkuer.wiki`、仓库地址 |
| `search/search.ts` | 构建期索引：扫描全部条目生成 SearchDoc（标题/章节/正文纯文本） |
| `search/searchCore.ts` | 搜索纯函数：中文分词、变体展开、正文摘要与高亮（构建端与客户端共用） |

## scripts/ — 构建辅助

| 文件 | 职责 |
| --- | --- |
| `gen-history.mjs` | 从 Git 提交历史计算每篇页面的最近更新时间，写 `history.json`（dev/build 前自动执行） |
| `contributors-mapping.json` | 贡献者邮箱/姓名 → GitHub 用户名映射（gen-history 专用数据） |

## theme/ — 自定义主题（浏览器端）

### 入口与 data loader

| 文件 | 职责 |
| --- | --- |
| `index.ts` | 主题入口：扩展默认主题、注册全局组件与插件、安装标题高亮、顶层注册路由拦截 |
| `catalog.data.ts` | data loader：把 `lib/content/catalog` 的目录数据序列化给客户端 |
| `activity.data.ts` | data loader：活动页数据（构建期 Markdown 渲染） |
| `search.data.ts` | data loader：懒加载搜索索引数据 |

### components/ — 21 个 Vue 组件

| 组件 | 职责 |
| --- | --- |
| `WikiLayout.vue` | 全站布局：包住 VitePress 默认布局，挂载作者区等全局区块 |
| `WikiHome.vue` | 首页：站点介绍、分类导航与最近更新 |
| `WikiSearch.vue` | 站内搜索弹窗（MiniSearch + 自建分词） |
| `ArticleIndex.vue` | 专题页：按分类/标签浏览全部文章，支持筛选与搜索 |
| `ArticleMeta.vue` | 文章页顶部元信息条：日期、分类 chips、字数与阅读时间 |
| `ArticleByline.vue` | 文章与卡片上的日期·分类信息行 |
| `ArticleAuthors.vue` | 页尾「本文作者」列表 |
| `ArticleAuthorPill.vue` | 单个作者胶囊（作者区的组成单元） |
| `AuthorAvatar.vue` | 作者头像：无头像时按姓名生成首字兜底头像 |
| `GroupAvatar.vue` | 群头像展示（群汇总卡片用） |
| `GitHistory.vue` | 页面历史：自建的编辑历史查看组件（替代 Nolebase GitChangelog） |
| `WikiChips.vue` | 标签/分类 chips 展示条 |
| `SidebarToggle.vue` | 左侧目录收起/展开按钮 |
| `SiteIcon.vue` | 站点 logo 图标 |
| `WidePage.vue` | 宽屏布局容器（供需要横向空间的页面使用） |
| `MapView.vue` | 校园地图（NKU Maps）：QUT-WiKi 移植，高德 JS API，双校区 76 点位 |
| `map-data.js` | 地图数据：南开两校区点位、分类配置（与 MapView 配套，不参与 ESLint） |
| `FriendLinks.vue` | 友情链接页 |
| `CopyContact.vue` | 一键复制联系方式（QQ/邮箱） |
| `QrCode.vue` | 二维码渲染 |
| `HoverMedia.vue` | 悬停显示媒体（二维码/图片预览） |
| `DownloadPageImage.vue` | 生成并下载页面分享图 |

### composables/ — 无 UI 的客户端逻辑

| 文件 | 职责 |
| --- | --- |
| `chips.ts` | 标签/分类 chips 的数据组装 |
| `sidebar.ts` | 左侧目录折叠状态（跨组件共享） |
| `headingHighlight.ts` | 点击标题/大纲跳转的平滑滚动与目标高亮 |
| `searchDocs.ts` | 搜索索引的懒加载与查询（动态 import data loader） |
| `searchState.ts` | 搜索弹窗开关与加载状态 |
| `share-image.ts` | 页面分享图的绘制（modern-screenshot + 二维码） |

### styles/ — 分层样式

| 文件 | 职责 |
| --- | --- |
| `index.css` | 样式总入口，按序 @import 其余文件 |
| `tokens.css` | 设计 token：南开青莲紫品牌色、圆角、动效时长（改主色只动这里） |
| `base.css` | 通用基础元素（chips 等跨页面共用） |
| `article.css` | 文章页排版：标题、正文、引用、表格、代码块 |
| `home.css` | 首页布局 |
| `cards.css` | 卡片网格与侧栏顶部（「全部分类」+ 收起按钮） |
| `sidebar.css` | 左侧目录树与右侧大纲的交互样式 |
| `search.css` | 搜索入口、弹窗与结果摘要的视觉 |
| `share.css` | 分享操作区样式 |
| `nolebase.css` | Nolebase 阅读增强插件的主题适配 |

## 分类标准

新增文件按三个问题找位置：

1. **框架约定优先**：`config.mts`、`theme/index.ts`、`*.data.ts` 的位置由 VitePress 约定，不可移动。
2. **跑在哪**：构建期（依赖 node:fs 等）或双端共享 → `lib/`；进浏览器 bundle → `theme/`。
3. **管什么**（lib 内部）：处理文章内容 → `content/`；站点事实数据 → `data/`；独立子系统 → `search/`。

## 注意事项

- `lib/content/catalog.ts` 的 `docsRoot` 用 `import.meta.url` 相对定位到 `docs/`，移动该文件时必须同步上溯层数。
- data loader 必须以 `*.data.ts` 命名；对它的动态 import 必须带 `.ts` 后缀（插件按正则识别）。
- `MapView.vue` 与 `map-data.js` 从上游整体移植，不参与 ESLint（保持原样便于同步）；地图品牌色跟随站点 token。
- 全站品牌色定义在 `theme/styles/tokens.css`（南开青莲紫），改主色只动那里。
