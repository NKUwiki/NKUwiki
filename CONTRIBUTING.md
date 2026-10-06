# 贡献指南

感谢参与 NKUwiki 共建！本页是协作入口，写作层面的详细规范见站内文档：

- [基础贡献（贡献指南）](https://freshnkuer.wiki/pages/Contributing/)：文章放在哪里、怎么命名、Frontmatter 字段、图片存放与排版规范
- [站点功能说明](https://freshnkuer.wiki/pages/SiteFeatures/)：卡片列表、应用卡片、图片画廊、地图点位关联等可直接调用的站点能力
- [进阶贡献（贡献方式）](https://freshnkuer.wiki/pages/ContributionMethods/)：QQ 群反馈、直接投稿、飞书协作与 GitHub Fork / Pull Request 完整流程

## 参与方式

发现内容需要补充或修正，可以通过以下任何一种方式参与：

- 加入交流 QQ 群 `1108024910`
- 发邮件至 `1352862815@qq.com`
- 在 GitHub 提交 [Issue](https://github.com/NKUwiki/NKUwiki/issues) 或 Pull Request

## 内容怎么归类

正文都放在 `docs/` 下**带编号**的目录里，编号决定它在侧栏中的顺序；目录下可以再建子目录形成子分类。常用归类：

| 内容类型                                 | 建议放到          |
| ---------------------------------------- | ----------------- |
| 入学手续、军训、交通、反诈防骗           | `docs/01.新生入学/`   |
| 学分绩点、选课、推免保研、竞赛证书       | `docs/02.浅谈学习/`   |
| 兴趣群、老乡群、学生组织与社团           | `docs/03.群汇总/`     |
| 美食、周边、校园建筑、常用 APP 等日常    | `docs/04.校园生活/`   |
| Markdown、Git、编程等工具类内容          | `docs/05.计算机知识/` |
| 本站的协作说明、关于我们、友情链接       | `docs/10.贡献与其他/` |

完整归类表与命名约定见[站内贡献指南](https://freshnkuer.wiki/pages/Contributing/)。几点底线：

- **不要随便新建顶层编号目录**，想加新大类先在群里或 Issue 里提一句；
- `archives/`、`categories/`、`tags/` 是站点功能页，不要往里面写文章；
- 新增图片放 `docs/public/img/目录编号/文章编号/`。

## 本地开发与构建

需要 Node.js 22.19+ / 24.11+ / 26+ 与 pnpm 11.24.0：

```bash
npm install --global pnpm@11.24.0
pnpm install --frozen-lockfile
pnpm dev         # 本地开发，http://localhost:5173/
pnpm check       # TypeScript、ESLint（含 CSS）与数据层测试
pnpm build       # 生产构建，校验 Markdown 内部链接
pnpm preview     # 预览生产产物，http://localhost:4173/
```

推送后由 GitHub Actions 自动构建并发布到 GitHub Pages；发往 `main` 的 PR 上 CI 会自动运行 `pnpm check` 与 `pnpm build`。

## 提交 PR 前的检查

- 新文章放在正确的编号目录、Frontmatter 完整（见[站内贡献指南](https://freshnkuer.wiki/pages/Contributing/)）
- 图片放入对应目录、正文引用路径正确
- 本地 `pnpm check` 与 `pnpm build` 均通过（网页端编辑可跳过，CI 会代跑）
- 涉及站点配置、主题或构建脚本的改动，请在 PR 中说明动机与影响范围（主题代码位于 `packages/wiki-theme`，结构与约定见[主题包 README](packages/wiki-theme/README.md)；装配层见 [docs/.vitepress/README.md](docs/.vitepress/README.md)）

## 行为准则与许可

参与本项目即视为同意遵守[社区行为准则](CODE_OF_CONDUCT.md)。提交文章、代码或其他素材，即表示同意按双协议（代码 MIT、内容 CC BY-NC-SA 4.0）授权发布，详见[README 的许可证说明](README.md#许可证)。
