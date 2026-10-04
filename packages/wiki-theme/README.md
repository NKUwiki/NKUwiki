# @nkuwiki/theme

NKUwiki 的 VitePress 主题包：全站布局、通用组件、客户端逻辑、分层样式与构建期业务库都在这里，以 **pnpm workspace 包**的形式从站点仓库中独立出来，可整体复用到其他校园 Wiki。

**包特性**：

- **源码直引，无构建步骤**——`exports` 直接指向 `.ts` / `.vue` 源文件，由消费方站点现成的 Vite 工具链编译；
- **`private: true`**——当前仅在仓库内通过 workspace 协议引用（`workspace:*`），尚未发布 npm；
- **不反向依赖站点**——包内代码不 import 站点侧的任何文件，包边界即解耦边界。

## 目录结构

```text
packages/wiki-theme/
├── package.json        # exports 指向源码；peerDependencies: vue
├── theme/              # 浏览器端
│   ├── index.ts        # 主题入口：extends 默认主题、注册全局组件
│   ├── components/     # 18 个 Vue 组件 + 地图数据
│   ├── composables/    # 5 个无 UI 的客户端逻辑
│   └── styles/         # 10 个分层样式文件
└── lib/                # 构建期执行、双端共享的业务库
    ├── types.ts        # 全局共享类型
    ├── content/        # 文章目录：catalog / category / order / cardlist
    ├── data/           # 站点数据：members / authors / activity / site
    └── search/         # 站内搜索：search 索引 / searchCore 纯函数
```

## theme/ — 浏览器端

### 入口 `index.ts`

以 `extends: DefaultTheme` 扩展 VitePress 默认主题，`Layout` 挂载 `WikiLayout.vue` 全站布局。全局组件分三种注册方式：

| 方式 | 组件 | 说明 |
| --- | --- | --- |
| 同步注册 | `ArticleMeta`、`CopyContact`、`DownloadPageImage`、`GroupAvatar`、`QrCode`、`wide`（WidePage） | 体积小或多数页面使用，进主题入口包 |
| 异步注册 | `HoverMedia`（拖 tippy 运行时）、`FriendLinks`、`markmap` | 仅个别页面使用，拆成独立懒加载 chunk |
| **不由本包注册** | `WikiHome`、`ArticleIndex`、`WikiSearch` | 依赖站点数据（`*.data.ts`），由站点侧薄壳 `docs/.vitepress/theme/index.ts` 注册，本包不感知 |

入口还负责：侧栏收放状态尽早同步（避免闪烁）、导航高亮、`wiki:route-change` 事件派发、标题锚点跳转高亮、Nolebase 聚光灯默认值写入。

### components/ — 18 个组件

| 组件 | 职责 | 注册方式 |
| --- | --- | --- |
| `WikiLayout.vue` | 全站布局：包住默认布局，挂载作者区等全局区块 | `Layout` 挂载 |
| `ArticleMeta.vue` | 文章页顶部元信息条：日期、分类 chips、字数与阅读时间 | 同步全局 |
| `ArticleByline.vue` | 文章与卡片上的日期·分类信息行 | 内部引用 |
| `ArticleAuthors.vue` | 页尾「本文作者」列表 | 内部引用 |
| `ArticleAuthorPill.vue` | 单个作者胶囊（作者区的组成单元） | 内部引用 |
| `AuthorAvatar.vue` | 作者头像：无头像时按姓名生成首字兜底头像 | 内部引用 |
| `GitHistory.vue` | 页面历史：自建的编辑历史查看组件（读 `transformPageData` 按页注入的提交记录） | 内部引用 |
| `WikiChips.vue` | 标签/分类 chips 展示条 | 内部引用 |
| `SidebarToggle.vue` | 左侧目录收起/展开按钮 | 内部引用 |
| `SiteIcon.vue` | 站点 logo 图标 | 内部引用 |
| `WidePage.vue` | 宽屏布局容器（Markdown 中 `<wide>` 使用） | 同步全局（`wide`） |
| `GroupAvatar.vue` | 群头像展示（群汇总卡片用） | 同步全局 |
| `QrCode.vue` | 二维码渲染 | 同步全局 |
| `CopyContact.vue` | 一键复制联系方式（QQ/邮箱） | 同步全局 |
| `DownloadPageImage.vue` | 生成并下载页面分享图 | 同步全局 |
| `HoverMedia.vue` | 悬停显示媒体（二维码/图片预览） | 异步全局 |
| `FriendLinks.vue` | 友情链接页 | 异步全局 |
| `MapView.vue` | 校园地图（NKU Maps）：上游移植，高德 JS API。**不内置数据**——点位、分类、校区与高德密钥通过 `data` prop 注入 | 页面 import + 传参 |
| `map-data.example.js` | `data` prop 的**格式示例**（虚拟点位 + 完整字段注释）。站点真实数据不放这里，见站点侧 `docs/.vitepress/data/map-data.js` | — |

### composables/ — 无 UI 的客户端逻辑

| 文件 | 职责 |
| --- | --- |
| `sidebar.ts` | 左侧目录折叠状态（跨组件共享，localStorage 持久化） |
| `chips.ts` | 标签/分类 chips 的数据组装 |
| `headingHighlight.ts` | 点击标题/大纲跳转的平滑滚动与目标高亮 |
| `searchState.ts` | 搜索弹窗开关、加载状态与全局快捷键（模块级单例，只注册一次） |
| `share-image.ts` | 页面分享图的绘制（modern-screenshot + 二维码） |

### styles/ — 分层样式

| 文件 | 职责 |
| --- | --- |
| `index.css` | 样式总入口，按序 @import 其余文件 |
| `tokens.css` | 设计 token：南开青莲紫品牌色、圆角、动效时长（**改主色只动这里**） |
| `base.css` | 通用基础元素（chips 等跨页面共用） |
| `article.css` | 文章页排版：标题、正文、引用、表格、代码块 |
| `home.css` | 首页布局 |
| `cards.css` | 卡片网格与侧栏顶部（「全部分类」+ 收起按钮） |
| `sidebar.css` | 左侧目录树与右侧大纲的交互样式 |
| `search.css` | 搜索入口、弹窗与结果摘要的视觉 |
| `share.css` | 分享操作区样式 |
| `nolebase.css` | Nolebase 阅读增强插件的主题适配 |

## lib/ — 构建期业务库（双端共享）

| 文件 | 职责 |
| --- | --- |
| `types.ts` | 全局共享类型：Article、Catalog、CategoryCount、Author 等 |
| `content/catalog.ts` | 核心：扫描 `docs/` 编号目录，生成侧栏树、分类、标签、归档与字数统计；校验 permalink 重复；内含 `docsRoot` 站点目录定位 |
| `content/category.ts` | 分类层级路径的解析、统计与排序（分类页与筛选栏共用） |
| `content/order.ts` | frontmatter `order` 排序纯函数（侧栏与专题页共用） |
| `content/cardlist.ts` | `::: cardlist` 短码：把 Markdown 表格渲染成卡片网格 |
| `data/members.ts` | 站点成员信息，文章 `author` 只写名字、其余在这里查 |
| `data/authors.ts` | 作者解析：frontmatter → 完整作者对象，头像首字兜底 |
| `data/activity.ts` | 活动页数据：扫描 `docs/activity/` 生成活动列表 |
| `data/site.ts` | 站点常量：正式网址、仓库地址 |
| `search/search.ts` | 构建期索引：扫描全部条目生成 SearchDoc（标题/章节/正文纯文本） |
| `search/searchCore.ts` | 搜索纯函数：中文分词、变体展开、正文摘要与高亮（构建端与客户端共用） |

## 在站点侧使用

`package.json` 的 exports 提供三个入口，引用时**带扩展名**（TS 对 exports 通配符目标不做无扩展名补全）：

```ts
// 主题入口（薄壳 extends 用）
import WikiTheme from '@nkuwiki/theme'
// lib 子路径（构建期）
import { buildTree } from '@nkuwiki/theme/lib/content/catalog.ts'
// theme 子路径
import SearchState from '@nkuwiki/theme/theme/composables/searchState.ts'
```

消费方需注意两点：

1. **SSR 配置**：`docs/.vitepress/config.mts` 的 `vite.ssr.noExternal` 必须包含 `@nkuwiki/theme`——SSR 构建时 Vite 默认把依赖外置成 Node 模块，而 Node 加载不了 `.ts` 源码；
2. **data loader 留在站点侧**：VitePress 只扫描 `srcDir` 下的 `*.data.ts`，它们与消费数据的组件一起住在 `docs/.vitepress/`（见[装配层说明](../docs/.vitepress/README.md)）。

## 包边界与约定

- **不反向引用站点侧**：包内不得 import 站点的 config、data loader、site-components——这是抽包时切断的三条耦合（theme→lib、theme→config、theme→history.json）的制度化；
- **`docsRoot` 三级定位**：`lib/content/catalog.ts` 反查站点 `docs/` 目录，顺序为 `WIKI_DOCS_ROOT` 环境变量 → 从包位置向上探测 `.vitepress` → cwd 兜底；包被安装到 monorepo 之外时设环境变量指定；
- **组件不内置站点数据**：MapView 等依赖站点数据的组件通过 props 接收注入（格式示例见 `map-data.example.js`），点位、成员、密钥等站点资产一律留在站点侧，不随包分发；
- **MapView.vue** 自上游地图项目整体移植，不参与 ESLint（保持原样便于同步）；其数据文件 `docs/.vitepress/data/map-data.js` 同样不参与；
- **新增文件的归置**：构建期或双端共享 → `lib/`（处理内容进 `content/`、站点事实数据进 `data/`、独立子系统进 `search/`）；进浏览器 bundle → `theme/`；依赖 data loader 或站点目录结构的 → 站点装配层，不放这里。

## 复用到其他站点

主题包已具备被外部项目安装的形态：

1. 发布 npm（去掉 `private`）或直接以 git 依赖引入；
2. 对方站点 `pnpm add @nkuwiki/theme`（或 git URL），在 `.vitepress/theme/index.ts` 写薄壳：`import Theme from '@nkuwiki/theme'; export default Theme`，再按需注册站点专属组件；
3. 提供自己的 data loader（可复用本包 `lib/` 的扫描与索引函数，通过 `WIKI_DOCS_ROOT` 指向对方的 docs 目录）。
