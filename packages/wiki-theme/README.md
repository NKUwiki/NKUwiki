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
│   ├── components/     # 28 个 Vue 组件（地图组件已拆分至 packages/wiki-map）
│   ├── composables/    # 14 个无 UI 的客户端逻辑
│   └── styles/         # 11 个分层样式文件
└── lib/                # 构建期执行、双端共享的业务库
    ├── types.ts        # 全局共享类型
    ├── content/        # 文章目录与内容块：catalog / category / cardlist / gallery / flink
    ├── data/           # 站点数据：members / authors / activity / site / announcement
    ├── markdown/       # markdown-it 内容增强规则：annotation / plot / mark / code-title / image-size / steps / timeline / container-end
    ├── search/         # 站内搜索：search 索引 / searchCore 纯函数
    └── vite/           # 构建期插件：replace-assets（资源外链替换）
```

## theme/ — 浏览器端

### 入口 `index.ts`

以 `extends: DefaultTheme` 扩展 VitePress 默认主题，`Layout` 挂载 `WikiLayout.vue` 全站布局。全局组件分三种注册方式：

| 方式 | 组件 | 说明 |
| --- | --- | --- |
| 同步注册 | `ArticleMeta`、`AppCards`、`CopyContact`、`DownloadPageImage`、`Gallery`、`GroupAvatar`、`QrCode`、`wide`（WidePage） | 体积小或多数页面使用，进主题入口包 |
| 异步注册 | `HoverMedia`（拖 tippy 运行时）、`FriendLinks`、`markmap` | 仅个别页面使用，拆成独立懒加载 chunk |
| **不由本包注册** | `WikiHome`、`ArticleIndex`、`WikiSearch` | 依赖站点数据（`*.data.ts`），由站点侧薄壳 `docs/.vitepress/theme/index.ts` 注册，本包不感知 |

入口还负责：侧栏收放状态尽早同步（避免闪烁）、导航高亮、`wiki:route-change` 事件派发、标题锚点跳转高亮、Nolebase 聚光灯默认值写入、隐秘文本 `{.click}` 的点击开合（`installPlotToggle`）、打印前临时切回浅色主题（暗色页面打印费墨，打印结束恢复）。

### components/ — 28 个组件

| 组件 | 职责 | 注册方式 |
| --- | --- | --- |
| `WikiLayout.vue` | 全站布局：包住默认布局，挂载公告横条、作者区等全局区块 | `Layout` 挂载 |
| `AnnouncementBar.vue` | 全站公告横条：固定视口顶部，经 `--vp-layout-top-height` 约定让下方区域让位；配置编译期注入，支持 `id`/`lifetime` 关闭记忆（同 id 不再弹出，换 id 重新展示） | 内部引用 |
| `BackTop.vue` | 右下角悬浮球：SVG 环形**正文**阅读进度（以正文容器 `.vp-doc` 为界，读完正文即 100%，评论区/页脚长度不计入；首页等无正文页面退回整页），滚动中环心显示百分比，静止淡回箭头，点击平滑回顶（滚动超过 100px 出现） | 内部引用 |
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
| `Gallery.vue` | 图片画廊：容器内写 Markdown 图片，客户端测宽高比后排成等高行（布局纯函数在 `lib/content/gallery.ts`） | 同步全局 |
| `AppCards.vue` | 「图标 + 名称 + 简介 + 跳转」的紧凑应用卡片网格（`links` 数组 prop） | 同步全局 |
| `RepoCard.vue` | GitHub 仓库卡片（星标/Fork k 格式化/主语言色点/License/可见性徽章/fullname 组织识别，localStorage 缓存 24h 防限流），markdown 写 `<RepoCard repo="owner/name" />`，接口失败降级为链接卡片 | 异步全局 |
| `WikiSwiper.vue` | 轻量轮播：纯 CSS scroll-snap，容器内写图片/任意块横滑翻页 | 异步全局 |
| `ImagePreview.vue` | 图片预览（lightbox）：点击正文图片全屏放大，多图轮播、滚轮缩放、拖拽平移（随 WikiLayout 挂载） | 内部引用 |
| `WaterMark.vue` | 全局水印：斜向平铺站名（SVG 平铺、亮暗两套），打印时不印（随 WikiLayout 挂载） | 内部引用 |
| `PrintButton.vue` | 「打印本页」按钮：挂在右侧目录面板顶部，唤起浏览器打印（打印排版见 base.css） | 内部引用（aside-top 插槽） |
| `OnlineEdit.vue` | 「在线编辑本页」入口：深链到 webObsidian 的当前页编辑器，读者改完可在平台内直接提 PR；`VITE_EDITOR_URL` 未注入时整体不渲染，`edit: false` 可单篇关闭 | 内部引用 |
| `TwikooComments.vue` | Twikoo 评论区：挂在 doc-after，正文之后、页面历史之前；`VITE_TWIKOO_ENV_ID` 未注入 / `comments: false` / 非文章布局三重门控，任一不满足即整体不渲染（零开销） | 内部引用 |

### composables/ — 无 UI 的客户端逻辑

| 文件 | 职责 |
| --- | --- |
| `sidebar.ts` | 左侧目录折叠状态（跨组件共享，localStorage 持久化） |
| `chips.ts` | 标签/分类 chips 的数据组装 |
| `headingHighlight.ts` | 点击标题/大纲跳转的平滑滚动与目标高亮 |
| `plot.ts` | 隐秘文本 `!!...!!{.click}` 的点击开合（文档级事件委托） |
| `searchState.ts` | 搜索弹窗开关、加载状态与全局快捷键（模块级单例，只注册一次） |
| `share-image.ts` | 页面分享图的绘制（modern-screenshot + 二维码；拉图必须 `cache: 'reload'` 绕开浏览器的不透明缓存，否则 CORS 校验失败、长图静默缺图） |
| `imageFade.ts` | 正文图片加载淡入，配合构建期注入的宽高，图未到也不会抖布局（三层降级：无 JS 直接显示） |
| `reveal.ts` | 滚动进入渐显：`data-reveal` 元素首次进入视口时淡入上移（同样三层降级） |
| `pageTransition.ts` | 跨页转场：监听 `wiki:route-change`，只给内容容器加 class，不包 `<Transition>`，避免与 VitePress 渲染管线打架 |
| `themeTransition.ts` | 深浅色切换的整页交叉淡入（View Transitions API，用 UA 默认动画，不自定义 `::view-transition-*`） |
| `modalA11y.ts` | 弹层无障碍：打开记录触发元素并把焦点移入、Tab 在弹层内循环、关闭还原焦点（支持两级嵌套），同时锁背景滚动 |
| `spotlightGuard.ts` | 聚光灯高亮显隐守卫：修 Nolebase 只在鼠标移动时重算、移出后高亮「钉」在原处的问题 |
| `spotlightAnchor.ts` | 聚光灯高亮横向锚定：把正文栏左/宽写进 CSS 变量，覆盖组件「贴着元素算」的 left/width，高亮块不再随列表、引用块的缩进左右跳动 |
| `twikoo.ts` | 评论区实例销毁：twikoo 2.x 无公开销毁 API，仅清 DOM 会漏掉 document 捕获阶段的全局监听 |

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
| `enhance.css` | 内容增强 DOM 的样式：行内注释气泡、隐秘文本黑幕、马克笔高亮、代码块标题栏、步骤条、时间线 |
| `nolebase.css` | Nolebase 阅读增强插件的主题适配 |

## lib/ — 构建期业务库（双端共享）

| 文件 | 职责 |
| --- | --- |
| `types.ts` | 全局共享类型：Article、Catalog、CategoryCount、Author 等 |
| `content/catalog.ts` | 核心：扫描 `docs/` 编号目录，生成侧栏树、分类、标签、归档与字数统计；校验 permalink 重复；内含 `docsRoot` 站点目录定位 |
| `content/category.ts` | 分类层级路径的解析、统计与排序（分类页与筛选栏共用） |
| `content/cardlist.ts` | `::: cardlist` 短码：把 Markdown 表格渲染成卡片网格 |
| `content/gallery.ts` | 图片画廊的布局纯函数：按宽高比贪心分行、等高铺满（单元测试在 `tests/gallery.test.ts`） |
| `content/flink.ts` | `<flink>` 友链数据块：把 md 里的列表解析成 FriendLinks 组件的 props，数据与卡片样式分离 |
| `data/members.example.ts` | 成员表**格式示例**（虚拟数据）。站点真实成员表在站点侧 `docs/.vitepress/data/members.ts`，经 `AuthorLookup` 注入 `collectAuthors` |
| `data/authors.ts` | 作者解析纯函数：frontmatter + 注入的成员表 → 完整作者对象，头像首字兜底；不感知站点数据 |
| `data/activity.ts` | 活动页数据：扫描 `docs/activity/` 生成活动列表 |
| `data/site.ts` | 站点常量**注入点**：真实值由站点侧 `docs/.vitepress/data/site.ts` 经 `vite.define` 编译期注入（`__SITE_URL__` / `__REPO_URL__`），导出名不变 |
| `data/announcement.ts` | 公告横条配置**注入点**：真实值由站点侧 `announcement.ts` 经 `vite.define` 注入（`__ANNOUNCEMENT__`）；未注入或解析失败返回 null，横条不渲染 |
| `markdown/annotation.ts` | 行内注释规则：`{^注释内容}` → 可悬停/聚焦的 ※ 气泡（^ 后紧跟数字时不生效，避免误伤数学上标） |
| `markdown/plot.ts` | 隐秘文本规则：`!!内容!!`（可带 `{.click}`/`{.blur}` 属性）→ 黑幕/模糊 span，交互参考 plume plugin-md-power |
| `markdown/mark.ts` | 马克笔规则：`==内容==`（可带 `{.tip}` 等配色）→ 描线动画高亮 `<mark>`，等价于 @mdit/plugin-mark + attrs（手写零依赖） |
| `markdown/code-title.ts` | 代码块标题规则：fence 信息串 `语言 title="文件名"` → 顶栏标题（CSS `::before` 画） |
| `markdown/image-size.ts` | 本地图片构建期读宽高写入 `<img>`，防布局跳动（CLS）；远程图与已标尺寸的跳过 |
| `markdown/steps.ts` | 步骤条容器 `::: steps`：容器内有序/无序列表 → 圆点编号+竖向连线的步骤条（CSS counter 编号，视觉参考 plume plugin-md-power） |
| `markdown/timeline.ts` | 时间线容器 `::: timeline`：无序列表 → 时间轴（条目属性 time/type/color/line/card/placement，渲染为纯 HTML + CSS，不依赖 plume 的 Vue 组件与 iconify，icon 属性暂不支持） |
| `markdown/container-end.ts` | 块级容器（`::: xxx`）闭合行的扫描，steps / timeline / cardlist 共用；识别嵌套容器，避免外层被内层闭合行截断 |
| `search/search.ts` | 构建期索引：扫描全部条目生成 SearchDoc（标题/章节/正文纯文本） |
| `search/searchCore.ts` | 搜索纯函数：中文分词、变体展开、正文摘要与高亮（构建端与客户端共用） |
| `vite/replace-assets.ts` | 构建期资源外链替换：把产物 HTML / CSS / JS 里的站内绝对资源路径改成图床地址（`apply: 'build'`，dev 不生效；`skip` 排除带哈希的 `/assets/`；配置见 `docs/.vitepress/config.mts`） |

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
- **组件不内置站点数据**：依赖站点数据的组件通过 props 接收注入，点位、成员、密钥等站点资产一律留在站点侧，不随包分发；
- **MapView 校园地图**已拆分为独立包 `packages/wiki-map`（`@nkuwiki/wiki-map`），便于跨项目复用；其源文件不参与 ESLint（保持上游原样便于同步），站点数据 `docs/.vitepress/data/map-data.js` 同样不参与；
- **新增文件的归置**：构建期或双端共享 → `lib/`（处理内容进 `content/`、站点事实数据进 `data/`、独立子系统进 `search/`）；进浏览器 bundle → `theme/`；依赖 data loader 或站点目录结构的 → 站点装配层，不放这里。

## 复用到其他站点

主题包已具备被外部项目安装的形态：

1. 发布 npm（去掉 `private`）或直接以 git 依赖引入；
2. 对方站点 `pnpm add @nkuwiki/theme`（或 git URL），在 `.vitepress/theme/index.ts` 写薄壳：`import Theme from '@nkuwiki/theme'; export default Theme`，再按需注册站点专属组件；
3. 提供自己的 data loader（可复用本包 `lib/` 的扫描与索引函数，通过 `WIKI_DOCS_ROOT` 指向对方的 docs 目录）。
