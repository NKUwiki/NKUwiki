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
├── docs/                            # VitePress 文档根目录
│   ├── index.md                     # 首页
│   ├── .vitepress/                  # 站点配置与业务模块
│   │   ├── config.mts               # 站点配置：导航、markdown 扩展、主题
│   │   ├── lib/                     # 业务模块（构建期与双端共享）
│   │   │   ├── content/             # 文章目录扫描、分类、排序、cardlist 渲染
│   │   │   ├── data/                # 站点数据：成员、作者、活动、站点常量
│   │   │   ├── search/              # 构建期搜索索引与搜索纯函数
│   │   │   └── types.ts             # 全局共享类型
│   │   ├── scripts/                 # 构建辅助脚本（页面历史生成）
│   │   └── theme/                   # 自定义主题：组件、样式与 composables
│   ├── public/                      # 静态资源：文章图片（img/）、站点图标、CNAME
│   ├── 01.新生入学/ 02.浅谈学习/ 03.群汇总/ 04.校园生活/ 05.计算机知识/
│   ├── 10.贡献与其他/               # 协作说明、关于我们、友情链接
│   └── map.md categories/ tags/ archives/ activity/    # 地图页与自动生成的索引、活动页
├── tests/                           # 目录索引与卡片的数据测试
├── eslint.config.mjs                # ESLint（含 CSS）配置
├── tsconfig.json                    # TypeScript 配置
└── package.json                     # 依赖与脚本
```

内容目录以「编号.名称」组织，展示时自动去掉数字前缀；编写约定与协作流程详见[贡献指南](CONTRIBUTING.md)。

## 本地开发与构建

```bash
npm install --global pnpm@11.24.0
pnpm install --frozen-lockfile
pnpm dev         # 本地开发，http://localhost:5173/
pnpm check       # TypeScript、ESLint（含 CSS）与内容索引测试
pnpm build       # 生产构建，校验 Markdown 内部链接
pnpm preview     # 预览生产产物，http://localhost:4173/
```

推送 `main` 后由 GitHub Actions 自动构建并发布到 GitHub Pages；发往 `main` 的 PR 上 CI 会自动运行 `pnpm check` 与 `pnpm build`。完整协作流程详见[贡献指南](CONTRIBUTING.md)。

## 许可证

本项目采用**双协议许可**：

- **源代码**：[MIT License](./LICENSE)
- **文档内容**：[CC BY-NC-SA 4.0](./LICENSE-CONTENT.md)

## 贡献者

感谢所有[贡献者](https://github.com/NKUwiki/NKUwiki/graphs/contributors)参与维护。

[![贡献者](https://contrib.rocks/image?repo=NKUwiki/NKUwiki)](https://github.com/NKUwiki/NKUwiki/graphs/contributors)
