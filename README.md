# NKUwiki

NKUwiki 是由南开大学学生共同维护的**非官方校园知识库**，收录新生入学、浅谈学习、校园生活、群汇总等指南。站点基于 VitePress 构建，内容以 Markdown 为主，欢迎同学们共同补充与完善。

| 快速入口 | 链接 |
| --- | --- |
| 正式站点 | <https://freshnkuer.wiki/> |
| 协作入口 | [贡献指南](CONTRIBUTING.md)（含写作规范与站点功能说明） |
| 社区行为准则 | [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) |
| 关于我们 | <https://freshnkuer.wiki/pages/AboutUs> · [友情链接](https://freshnkuer.wiki/pages/FriendshipLinks/) |

## 站点特色

NKUwiki 不是把 Markdown 直接套上默认主题——站点在 VitePress 之上做了一层面向校园内容的定制，读者拿到的是一本「能查、能翻、能带走」的手册：

- **内容自动成册**：文章目录以「编号.名称」组织，侧栏、分类、标签、归档与搜索索引全部由构建期扫描自动生成，新增文章不必手工登记；
- **站内全文搜索**：导航栏放大镜或 `Ctrl + K`（macOS `Cmd + K`）呼出，自建中文分词（MiniSearch 默认分词不识别中文），命中处高亮并标注所在章节；
- **校园地图**：[地图页](https://freshnkuer.wiki/map)覆盖八里台、津南两校区 17 类点位，支持分类筛选、详情卡与关联文章跳转；
- **为长文准备的写作语法**：行内注释、马克笔、步骤条、时间线、代码块标题、GitHub 仓库卡片、图片轮播等扩展语法，写作时按需取用；
- **认真的阅读体验**：正文图片点击放大浏览、可切换页面宽度的阅读增强与聚光灯、阅读进度悬浮球、深浅色切换、分享长图导出、全站水印与打印样式；
- **克制而统一的动效**：跨页转场、错落入场、滚动渐显等一律共用同一套时长与缓动令牌，并完整遵循系统的「减少动态效果」偏好。

功能清单、参数与接线方式见[站点功能说明](https://freshnkuer.wiki/pages/SiteFeatures/)（面向开发者）；只想投稿写文章的话，看 [Markdown 专题](https://freshnkuer.wiki/pages/MarkdownGuide/) 就够了——从[基础语法](https://freshnkuer.wiki/pages/markdown-basic/)、[常见扩展语法](https://freshnkuer.wiki/pages/markdown-extended/)、[本站特有语法](https://freshnkuer.wiki/pages/MarkdownGuide/)到[编辑软件对比](https://freshnkuer.wiki/pages/MarkdownEditors/)与[速查表](https://freshnkuer.wiki/pages/MarkdownCheatsheet/)。

## 参与共建

发现内容需要补充或修正，不一定要会写代码，按投入程度从低到高任选一种：

1. **说一声**：加入交流 QQ 群 `1108024910`，或发邮件至 `1352862815@qq.com`；
2. **提 Issue**：在 GitHub 提交 [Issue](https://github.com/NKUwiki/NKUwiki/issues)，反馈错误信息、过时内容或缺失主题；
3. **直接写**：按[贡献指南](CONTRIBUTING.md)新建文章，本地预览后提交 Pull Request。

参与本项目即视为同意遵守[社区行为准则](CODE_OF_CONDUCT.md)。

## 项目结构

```text
NKUwiki/
├── .github/workflows/static.yml     # GitHub Actions：check → 增量镜像图床 → 构建 → 验活 → 发布到 GitHub Pages
├── pnpm-workspace.yaml              # workspace 定义：docs + packages/*
├── docs/                            # VitePress 文档根目录（站点装配层）
│   ├── index.md                     # 首页
│   ├── map.md                       # 校园地图页
│   ├── .vitepress/                  # 站点配置与装配（详见其内 README）
│   │   ├── config.mts               # 站点配置：导航、Markdown 扩展、SEO 注入
│   │   ├── data/                    # data loader：目录/活动/搜索索引（VitePress 约定位置）
│   │   ├── theme/                   # 装配层：薄壳主题入口与依赖站点数据的组件
│   │   └── scripts/                 # 构建辅助：页面更新时间、大图压缩、图床地址验活
│   ├── public/                      # 静态资源：文章图片（img/）、站点图标、CNAME
│   ├── 01.新生入学/ 02.浅谈学习/ 03.群汇总/ 04.校园生活/ 05.计算机知识/
│   ├── 10.贡献与其他/               # 协作说明、站点功能说明、关于我们、友情链接
│   └── categories/ tags/ archives/  # 专题页与归档
├── packages/wiki-theme/             # @nkuwiki/theme 主题包（pnpm workspace，源码直引）
│   ├── theme/                       # 浏览器端：布局、通用组件、composables、分层样式
│   └── lib/                         # 构建期业务库：文章目录、站点数据、站内搜索、资源外链替换
├── packages/wiki-map/               # @nkuwiki/wiki-map 地图包：MapView、点位拾取面板（不参与 ESLint，便于同步上游）
├── image-uploader/                  # 图片上传器（独立部署的 Cloudflare Worker + R2 图床，见其 README）
├── tests/                           # 站点工程的单元测试（上传器的测试在其目录内）
├── eslint.config.mjs                # ESLint（含 CSS）配置
├── tsconfig.json                    # TypeScript 配置
└── package.json                     # 依赖与脚本
```

内容目录以「编号.名称」组织，展示时自动去掉数字前缀，编号决定排序。代码分三层，依赖只允许自上而下单向流动：

1. **内容**：`docs/` 下的 Markdown 正文与 data loader；
2. **站点装配**：`docs/.vitepress` 的站点配置、data loader 与依赖站点数据的组件，详见[装配层 README](docs/.vitepress/README.md)；
3. **主题包**：`packages/wiki-theme` 的布局、通用组件与构建期业务库，不反向引用站点侧，详见[主题包 README](packages/wiki-theme/README.md)。

编写约定与协作流程见[贡献指南](CONTRIBUTING.md)。

## 本地开发与构建

环境要求：Node.js 22.19+ / 24.11+ / 26+，以及 `packageManager` 固定的 pnpm 12.15.0（无需 Corepack）。

```bash
npm install --global pnpm@12.15.0
pnpm install

pnpm dev               # 本地开发，http://localhost:5173/
pnpm check             # 页面历史生成 + TypeScript + ESLint（含 CSS）+ 单元测试
pnpm build             # 生产构建，校验 Markdown 内部链接
pnpm preview           # 预览生产产物，http://localhost:4173/
pnpm check:cdn         # 逐个校验产物里的图床地址（需先带 WIKI_ASSETS_BASE 构建）
pnpm images:optimize   # 压缩 docs/public 下的大图（维护用）
```

新图优先传[图床上传器](https://upload.freshnkuer.wiki)（Cloudflare Worker + R2，网页上传、按文章编号归档、审批流），仓库 `docs/public/img/` 只留已有旧图与站点自身资源（favicon、og 图、manifest、logo）。两处的路径规则相同：`栏目编号/文章编号/`、美食封面 `food/shots/`、地图照片 `map/pic/`，正文一律写 `/img/...`。构建期由主题包的 `replace-assets` 插件把产物里的资源地址统一改写到图床，**正文写法不变**，图片存在哪里都不用改文章 —— 同一张图既可以随仓库来，也可以只存在图床；开关是 `.github/workflows/static.yml` 里的 `WIKI_ASSETS_BASE`，删掉即回退为 GitHub Pages 直出。

图片同时存在仓库与桶两处，而插件只做改写、不检查对象是否存在，所以 CI 在部署前会逐个校验产物里的图床地址（`pnpm check:cdn`）：取不到就**不部署**，避免线上出现 404。构建前还有一步可选的增量镜像——配好 `CLOUDFLARE_API_TOKEN` 与 `CLOUDFLARE_ACCOUNT_ID` 两个 repository secret 后，往仓库加图不必再手动传桶（比对 ETag 与本地 MD5，内容一致就跳过，无改动时十几秒）。同步方式、两道保险与 token 权限见 [image-uploader README](image-uploader/README.md#图片同步两道保险)。

Windows 下还可以运行根目录的 `./build.ps1` 一键构建并预览（自动挑选空闲端口，`-Port` 可指定）。

推送 `main` 后由 GitHub Actions 自动构建并发布到 GitHub Pages；发往 `main` 的 PR 上 CI 会自动运行 `pnpm check` 与 `pnpm build`。main 构建若在验活阶段发现缺图会直接失败，本次不部署、线上保持上一版。

## 许可证

本项目采用**双协议许可**：

- **源代码**：[MIT License](./LICENSE)
- **文档内容**：[CC BY-NC-SA 4.0](./LICENSE-CONTENT.md)

## 贡献者

感谢所有[贡献者](https://github.com/NKUwiki/NKUwiki/graphs/contributors)参与维护。

[![贡献者](https://contrib.rocks/image?repo=NKUwiki/NKUwiki)](https://github.com/NKUwiki/NKUwiki/graphs/contributors)
