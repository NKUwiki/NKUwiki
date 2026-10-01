# 贡献指南

感谢参与 NKUwiki 共建！本文是贡献入口，完整的写作规范与协作流程见站内文档。

## 参与方式

如果你发现内容需要补充或修正，欢迎通过以下方式参与共建：

- 加入交流 QQ 群 `1108024910`
- 发邮件至 `1352862815@qq.com`
- 在 GitHub 提交 [Issue](https://github.com/NKUwiki/NKUwiki/issues) 或 Pull Request

## 写作与投稿

- [基础贡献](https://freshnkuer.wiki/pages/BasicContribution/)：文章的 Frontmatter 字段、Markdown 语法与组件用法
- [进阶贡献](https://freshnkuer.wiki/pages/AdvanceContribution/)：目录结构与 GitHub Fork / Pull Request 协作流程

目录展示时会自动去掉数字前缀；新增文章放入对应编号目录即可，侧栏、分类与标签会自动生成，无需手工维护。

## 文档怎么归类

正文都放在 `docs/` 下**带编号**的目录里，编号决定它在侧栏中的顺序。下面按内容类型给出建议位置，内容交叉时挑最接近的那一类即可，不必严格区分：

| 内容类型 | 建议放到 |
| --- | --- |
| 入学手续、报到、户籍与档案、军训、交通、反诈防骗 | `docs/01.新生入学/` |
| 学分绩点、选课、考试、教材、学籍与转专业、推免保研、竞赛与证书 | `docs/02.浅谈学习/` |
| 兴趣群、老乡群、实验室等零散群组信息 | `docs/03.群汇总/` |
| 单个社团 / 学生组织的详细介绍页 | `docs/03.群汇总/05.组织详情/` |
| 快递外卖、美食推荐、周边去处、常用 APP、校园趣闻等日常 | `docs/04.校园生活/` |
| Markdown、排版规范、Git、编程、AI 学习等工具类内容 | `docs/05.计算机知识/` |
| 本站的协作说明、关于我们、友情链接 | `docs/10.贡献与其他/` |
| 首页「活动」栏的短期活动信息 | `docs/activity/`（不生成独立页面，见[该目录说明](docs/activity/README.md)） |
| 图片等静态资源 | `docs/public/img/目录编号/文章编号/` |

几个约定：

- **不要随便新建顶层编号目录**。想加一个大类，先在 QQ 群或 Issue 里提一句；多数内容都能并入现有分类。
- 目录内的文件编号只是习惯：`00.` 通常放概览，`01.`–`09.` 放主题文章，`10.` 以后放 Q&A、附录、索引等收尾内容，不用强行对齐。
- 一篇文章横跨多个类别时，放进它主要服务的那一类，再用 `categories` / `tags` 补充说明。
- `archives/`、`categories/`、`tags/` 这些没有编号的目录是站点功能页，不要往里面写文章。

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

推送后由 GitHub Actions 自动构建并发布到 GitHub Pages；发往 `main` 的 PR 上 CI 会自动运行 `pnpm check` 与 `pnpm build`。

## 提交 PR 前的检查

- 本地 `pnpm check` 与 `pnpm build` 均通过
- 新增图片放入 `docs/public/img/` 对应的「目录编号/文章编号」目录
- 涉及站点配置、主题或构建脚本的改动，请在 PR 中说明动机与影响范围

## 行为准则

参与本项目即视为同意遵守[社区行为准则](CODE_OF_CONDUCT.md)。

## 许可

提交文章、代码或其他素材，即表示你同意按上述双协议授权发布，详见[README 的许可证说明](README.md#许可证)。
