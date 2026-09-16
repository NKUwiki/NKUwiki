## 欢迎访问 NKUwiki

NKUwiki 是由南开大学学生共同维护的**非官方校园知识库**，内容覆盖新生入学、浅谈学习、校园生活、群汇总等主题。站点基于 VitePress 构建，全部内容以 Markdown 维护，欢迎师生共同补充与完善。

- 正式站点：<https://freshnkuer.wiki/>
- 参与共建：[基础贡献](https://freshnkuer.wiki/pages/BasicContribution/)（写作与投稿）· [进阶贡献](https://freshnkuer.wiki/pages/AdvanceContribution/)（目录结构与 GitHub 协作）
- 项目组：[关于我们](https://freshnkuer.wiki/pages/AboutUs) · [友情链接](https://freshnkuer.wiki/pages/FriendshipLinks/)

## 反馈与共建

如果你发现内容需要补充或修正，欢迎通过以下方式参与共建：

- 加入交流 QQ 群 `1108024910`
- 发邮件至 `1352862815@qq.com`
- 在 GitHub 提交 [Issue](https://github.com/NKUwiki/NKUwiki/issues) 或 Pull Request

文章的 Frontmatter 字段、Markdown 语法与组件用法详见[基础贡献](https://freshnkuer.wiki/pages/BasicContribution/)；目录结构、GitHub Fork / Pull Request 协作流程详见[进阶贡献](https://freshnkuer.wiki/pages/AdvanceContribution/)。

## 项目结构

```text
NKUwiki/
├── .github/
│   └── workflows/
│       └── static.yml          # GitHub Actions：构建并发布到 GitHub Pages
├── .editorconfig               # 统一缩进与换行风格
├── .gitattributes              # 统一 UTF-8 / LF 换行
├── .gitignore
├── docs/                       # VitePress 文档根目录
│   ├── index.md                # 首页
│   ├── .vitepress/             # VitePress 配置、目录索引与主题
│   │   ├── config.mts          # 站点配置：导航、本地搜索、数学公式、主题
│   │   ├── catalog.ts          # 扫描编号目录，生成侧栏、分类、标签与归档
│   │   ├── cardlist.ts         # ::: cardlist 表格转卡片
│   │   ├── activity.ts         # 活动数据
│   │   ├── site.ts             # 站点网址与仓库地址常量
│   │   ├── types.ts            # 共享类型
│   │   └── theme/              # 自定义主题
│   │       ├── index.ts        # 主题入口
│   │       ├── catalog.data.ts # 目录索引数据
│   │       ├── activity.data.ts# 活动数据
│   │       ├── chips.ts        # 首页标签
│   │       ├── share-image.ts  # 分享图生成
│   │       ├── components/     # Vue 组件：首页、文章索引、二维码、群卡片、长图导出等
│   │       └── styles/         # 分层样式：tokens / base / home / article / cards …
│   ├── public/                 # 静态资源
│   │   ├── img/                # 文章图片，按「目录编号/文章编号」组织
│   │   ├── css/                # KaTeX 等第三方样式
│   │   ├── favicon-*.svg       # 深浅色站点图标
│   │   ├── robots.txt
│   │   └── CNAME               # 自定义域名 freshnkuer.wiki
│   ├── 01.新生入学/            # 面向新生的内容
│   ├── 02.浅谈学习/            # 学习专题
│   ├── 03.群汇总/              # 群聊、社团与组织
│   ├── 04.校园生活/            # 校园生活指南
│   ├── 10.贡献与其他/          # 协作说明、关于我们、友情链接
│   ├── topics/                 # 专题入口页（新生 / 学习 / 生活 / 群组 …）
│   ├── categories/             # 文章分类页
│   ├── tags/                   # 标签页
│   ├── archives/               # 按月份归档
│   └── activity/               # 活动页（_template.md 为模板）
├── tests/                      # 目录索引与卡片的数据测试
├── eslint.config.mjs           # ESLint（含 CSS）配置
├── tsconfig.json               # TypeScript 配置
├── package.json                # 依赖与脚本
├── pnpm-lock.yaml              # 锁定依赖版本
├── pnpm-workspace.yaml         # pnpm 安装脚本白名单
├── LICENSE                     # MIT 许可证
└── README.MD                   # 本文件
```

目录展示时会自动去掉数字前缀；新增文章放入对应编号目录即可，侧栏、分类与标签会自动生成，无需手工维护。

## 本地开发与构建

需要 Node.js 22.19+、24.11+ 或 26+，以及 `packageManager` 固定的 pnpm 11.24.0，无需 Corepack：

```bash
npm install --global pnpm@11.24.0
pnpm install --frozen-lockfile
pnpm dev         # 本地开发，http://localhost:5173/
pnpm check       # TypeScript、ESLint（含 CSS）与内容索引测试
pnpm build       # 生产构建，校验 Markdown 内部链接
pnpm preview     # 预览生产产物，http://localhost:4173/
```

推送后由 GitHub Actions 自动构建并发布到 GitHub Pages（自定义域名由 `docs/public/CNAME` 保留）；发往 `main` 的 PR 上 CI 会自动运行 `pnpm check` 与 `pnpm build`。主题、组件与构建配置的具体实现见 `docs/.vitepress/` 源码。

## 贡献者

感谢所有[贡献者](https://github.com/NKUwiki/NKUwiki/graphs/contributors)参与维护。

[![贡献者](https://contrib.rocks/image?repo=NKUwiki/NKUwiki)](https://github.com/NKUwiki/NKUwiki/graphs/contributors)

## 许可证

本项目以 [MIT 许可证](LICENSE) 开源。
