# .vitepress 目录说明

本目录是**站点装配层**：站点配置、data loader 与依赖站点数据的组件。主题主体（通用组件、布局、样式、业务库）已抽离为 workspace 包 **`packages/wiki-theme`（`@nkuwiki/theme`）**，通过 `docs/.vitepress/theme/index.ts` 薄壳接入。

## config.mts

站点配置入口：导航与侧栏、rewrites（permalink → 输出路径）、markdown 扩展（markmap、mathjax、cardlist 短码）、`transformPageData`（向页面下发字数、作者、按页提交历史与 SEO 元数据）。业务库引用统一走 `@nkuwiki/theme/lib/*`；`vite.ssr.noExternal` 需包含主题包（SSR 不能外置 `.ts` 源码依赖）。

## data/ — data loader（构建期执行）

VitePress 只扫描 `srcDir` 下的 `*.data.ts`，因此它们必须留在站点侧：

| 文件 | 职责 |
| --- | --- |
| `catalog.data.ts` | 把 `@nkuwiki/theme/lib/content/catalog` 的目录数据序列化给客户端 |
| `activity.data.ts` | 活动页数据（构建期 Markdown 渲染） |
| `search.data.ts` | 懒加载搜索索引数据 |
| `map-data.js` | 校园地图的点位、分类、校区配置与高德密钥（站点资产，不随主题包分发；MapView 组件通过 `data` prop 注入，格式示例见包内 `map-data.example.js`；不参与 ESLint） |
| `members.ts` | 站点成员表（含联系方式）：`config.mts` 经 `AuthorLookup` 注入主题包的 `collectAuthors`；`fallbackAuthor` 为无 author 页面的兜底账号。格式示例见包内 `members.example.ts` |
| `site.ts` | 站点常量（正式网址、仓库地址）：`config.mts` 直接 import，并经 `vite.define` 以 `__SITE_URL__` / `__REPO_URL__` 注入主题包组件 |

## theme/ — 站点装配

| 文件/目录 | 职责 |
| --- | --- |
| `index.ts` | 薄壳主题入口：`extends @nkuwiki/theme`，异步注册站点专属组件（WikiHome/ArticleIndex/WikiSearch）与站点图标 |
| `searchDocs.ts` | 搜索索引的懒加载与查询（动态 import `../data/search.data.ts`） |
| `site-components/WikiHome.vue` | 首页：站点介绍、分类导航与最近更新（消费 catalog/activity 数据） |
| `site-components/ArticleIndex.vue` | 专题页：按分类/标签浏览全部文章（消费 catalog 数据） |
| `site-components/WikiSearch.vue` | 站内搜索弹窗（MiniSearch + 自建分词） |

这三个组件留在站点侧的原因：它们直接消费 data loader，而 data loader 只能被 `srcDir` 扫描——组件与数据绑定，一起留在装配层。

## scripts/ — 构建辅助

| 文件 | 职责 |
| --- | --- |
| `gen-history.mjs` | 从 Git 提交历史计算每篇页面的最近更新时间，写 `history.json`（dev/build 前自动执行，带缓存） |
| `contributors-mapping.json` | 贡献者邮箱/姓名 → GitHub 用户名映射（gen-history 专用数据） |

## packages/wiki-theme — 主题包

主题主体（通用组件、布局、composables、styles、构建期业务库 `lib/`）全部在 **`@nkuwiki/theme`** 包内，组件清单、注册方式、包边界约定与复用方法详见 **[packages/wiki-theme/README.md](../../packages/wiki-theme/README.md)**。要点：

- `theme/`：WikiLayout 布局、通用组件（ArticleMeta、GitHistory、MapView 等 19 个）、composables（sidebar、chips、searchState 等）、styles 分层样式
- `lib/`：构建期业务库——`content/`（catalog、category、order、cardlist）、`data/`（members、authors、activity、site）、`search/`（search、searchCore）与 `types.ts`

## 分类标准

新增文件按三个问题找位置：

1. **框架约定优先**：`config.mts`、`theme/index.ts`、`data/*.data.ts` 的位置由 VitePress 约定，不可移动。
2. **属于站点还是主题**：依赖 data loader / 站点目录结构 → 本目录装配层；通用、可跨站复用 → `packages/wiki-theme`。
3. **跑在哪**（包内）：构建期或双端共享 → `lib/`；进浏览器 bundle → `theme/`。

## 注意事项

- 包内代码**不得反向引用站点侧**（config、data loader、site-components）——包边界就是解耦边界。
- data loader 必须以 `*.data.ts` 命名且放在本目录；对它的动态 import 必须带 `.ts` 后缀（插件按正则识别）。
- `lib/content/catalog.ts` 的 `docsRoot` 三级定位：`WIKI_DOCS_ROOT` 环境变量 → 从包位置向上探测 `.vitepress` → cwd 兜底；包被安装到 monorepo 之外时设环境变量指定站点 docs 目录。
- `MapView.vue` 与 `map-data.js` 从上游整体移植，不参与 ESLint（保持原样便于同步）；地图品牌色跟随站点 token。
- 全站品牌色定义在 `packages/wiki-theme/theme/styles/tokens.css`（南开青莲紫），改主色只动那里。
