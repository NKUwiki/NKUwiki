# NKUwiki

NKUwiki 是由南开大学学生共同维护的**非官方校园知识库**，收录新生入学、浅谈学习、校园生活、群汇总等指南。站点基于 VitePress 构建，内容以 Markdown 为主，欢迎同学们共同补充与完善。

| 快速入口 | 链接 |
| --- | --- |
| 正式站点 | <https://freshnkuer.wiki/> |
| 协作入口 | [贡献指南](CONTRIBUTING.md)（含写作规范与站点功能说明） |
| 社区行为准则 | [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) |
| 关于我们 | <https://freshnkuer.wiki/pages/AboutUs> · [友情链接](https://freshnkuer.wiki/pages/FriendshipLinks/) |

## 参与共建

发现内容需要补充或修正，不一定要会写代码，按投入程度从低到高任选一种：

1. **说一声**：加入交流 QQ 群 `1108024910`，或发邮件至 `1352862815@qq.com`；
2. **提 Issue**：在 GitHub 提交 [Issue](https://github.com/NKUwiki/NKUwiki/issues)，反馈错误信息、过时内容或缺失主题；
3. **直接写**：按[贡献指南](CONTRIBUTING.md)新建文章，本地预览后提交 Pull Request。

参与本项目即视为同意遵守[社区行为准则](CODE_OF_CONDUCT.md)。

## 项目结构

```text
NKUwiki/
├── .github/workflows/static.yml     # GitHub Actions：构建并发布到 GitHub Pages
├── pnpm-workspace.yaml              # workspace 定义：docs + packages/*
├── docs/                            # VitePress 文档根目录（站点装配层）
│   ├── index.md                     # 首页
│   ├── map.md                       # 校园地图页
│   ├── .vitepress/                  # 站点配置与装配（详见其内 README）
│   │   ├── config.mts               # 站点配置：导航、Markdown 扩展、SEO 注入
│   │   ├── data/                    # data loader：目录/活动/搜索索引（VitePress 约定位置）
│   │   ├── theme/                   # 装配层：薄壳主题入口与依赖站点数据的组件
│   │   └── scripts/                 # 构建辅助：从 Git 历史生成页面更新时间
│   ├── public/                      # 静态资源：文章图片（img/）、站点图标、CNAME
│   ├── 01.新生入学/ 02.浅谈学习/ 03.群汇总/ 04.校园生活/ 05.计算机知识/
│   ├── 10.贡献与其他/               # 协作说明、站点功能说明、关于我们、友情链接
│   └── categories/ tags/ archives/  # 专题页与归档
├── packages/wiki-theme/             # @nkuwiki/theme 主题包（pnpm workspace，源码直引）
│   ├── theme/                       # 浏览器端：布局、通用组件、composables、分层样式
│   └── lib/                         # 构建期业务库：文章目录、站点数据、站内搜索
├── tests/                           # 数据层单元测试
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

环境要求：Node.js 22.19+ / 24.11+ / 26+，以及 `packageManager` 固定的 pnpm 11.24.0（无需 Corepack）。

```bash
npm install --global pnpm@11.24.0
pnpm install

pnpm dev               # 本地开发，http://localhost:5173/
pnpm check             # 页面历史生成 + TypeScript + ESLint（含 CSS）+ 单元测试
pnpm build             # 生产构建，校验 Markdown 内部链接
pnpm preview           # 预览生产产物，http://localhost:4173/
pnpm images:optimize   # 压缩 docs/public 下的大图（维护用）
```

Windows 下还可以运行根目录的 `./build.ps1` 一键构建并预览（自动挑选空闲端口，`-Port` 可指定）。

推送 `main` 后由 GitHub Actions 自动构建并发布到 GitHub Pages；发往 `main` 的 PR 上 CI 会自动运行 `pnpm check` 与 `pnpm build`。

## 许可证

本项目采用**双协议许可**：

- **源代码**：[MIT License](./LICENSE)
- **文档内容**：[CC BY-NC-SA 4.0](./LICENSE-CONTENT.md)

## 贡献者

感谢所有[贡献者](https://github.com/NKUwiki/NKUwiki/graphs/contributors)参与维护。

[![贡献者](https://contrib.rocks/image?repo=NKUwiki/NKUwiki)](https://github.com/NKUwiki/NKUwiki/graphs/contributors)
