## 欢迎访问 NKUwiki

NKUwiki 是由南开大学学生共同维护的**非官方校园知识库**。站点基于 VitePress 构建，内容以 Markdown 为主，欢迎师生共同补充与完善。

- 正式站点：<https://freshnkuer.wiki/>
- 参与共建：[贡献指南](CONTRIBUTING.md) · [社区行为准则](CODE_OF_CONDUCT.md)
- 项目组：[关于我们](https://freshnkuer.wiki/pages/AboutUs) · [友情链接](https://freshnkuer.wiki/pages/FriendshipLinks/)

## 反馈与共建

如果你发现内容需要补充或修正，欢迎加入交流 QQ 群 `1108024910`、发邮件至 `1352862815@qq.com`，或提交 [Issue](https://github.com/NKUwiki/NKUwiki/issues) / Pull Request。

参与贡献前请阅读[贡献指南](CONTRIBUTING.md)与[社区行为准则](CODE_OF_CONDUCT.md)。

## 项目结构

```text
NKUwiki/
├── .github/workflows/static.yml     # GitHub Actions：构建并发布到 GitHub Pages
├── pnpm-workspace.yaml              # workspace 定义：docs + packages/*
├── docs/                            # VitePress 文档根目录（站点装配层）
│   ├── index.md                     # 首页
│   ├── map.md                       # 校园地图页
│   ├── .vitepress/                  # 站点配置与装配（详见其内 README）
│   │   ├── config.mts               # 站点配置：导航、markdown 扩展、SEO 注入
│   │   ├── data/                    # data loader：目录/活动/搜索索引（VitePress 约定位置）
│   │   ├── theme/                   # 装配层：index.ts 薄壳入口、searchDocs.ts、
│   │   │                            #   site-components/（WikiHome/ArticleIndex/WikiSearch）
│   │   └── scripts/                 # 构建辅助：从 Git 历史生成页面更新时间
│   ├── public/                      # 静态资源：文章图片（img/）、站点图标、CNAME
│   ├── 01.新生入学/ 02.浅谈学习/ 03.群汇总/ 04.校园生活/ 05.计算机知识/
│   ├── 10.贡献与其他/               # 协作说明、关于我们、友情链接
│   └── categories/ tags/ archives/ activity/    # 专题页与归档
├── packages/wiki-theme/             # @nkuwiki/theme 主题包（pnpm workspace，源码直引）
│   ├── package.json                 # exports 直接指向 .ts/.vue 源码，无构建步骤
│   ├── theme/                       # 浏览器端：WikiLayout 布局、通用组件 components/、
│   │                                #   composables/ 逻辑、styles/ 分层样式
│   └── lib/                         # 构建期业务库：content 文章目录 / data 站点数据 /
│                                    #   search 站内搜索 / types.ts 共享类型
├── tests/                           # 数据层单元测试
├── eslint.config.mjs                # ESLint（含 CSS）配置
├── tsconfig.json                    # TypeScript 配置
└── package.json                     # 依赖与脚本
```

内容目录以「编号.名称」组织，展示时自动去掉数字前缀。代码分三层，依赖只允许自上而下：**内容**（`docs/` 的 Markdown 与 data loader）→ **站点装配**（`docs/.vitepress` 的薄壳主题入口与依赖站点数据的组件）→ **主题包**（`packages/wiki-theme`，`lib` 按内容、数据、搜索三域分类，不反向引用站点侧）。编写约定与协作流程详见[贡献指南](CONTRIBUTING.md)。

## 本地开发与构建

```bash
npm install --global pnpm@11.24.0
pnpm install
pnpm dev         # 本地开发，http://localhost:5173/
pnpm check       # 页面历史生成、TypeScript、ESLint（含 CSS）与数据层测试
pnpm build       # 生产构建，校验 Markdown 内部链接
pnpm preview     # 预览生产产物，http://localhost:4173/
pnpm images:optimize   # 压缩 docs/public 下的大图（维护用）
```

推送 `main` 后由 GitHub Actions 自动构建并发布到 GitHub Pages；发往 `main` 的 PR 上 CI 会自动运行 `pnpm check` 与 `pnpm build`。完整协作流程详见[贡献指南](CONTRIBUTING.md)。

## 许可证

本项目采用**双协议许可**：

- **源代码**：[MIT License](./LICENSE)
- **文档内容**：[CC BY-NC-SA 4.0](./LICENSE-CONTENT.md)

## 贡献者

感谢所有[贡献者](https://github.com/NKUwiki/NKUwiki/graphs/contributors)参与维护。

[![贡献者](https://contrib.rocks/image?repo=NKUwiki/NKUwiki)](https://github.com/NKUwiki/NKUwiki/graphs/contributors)
