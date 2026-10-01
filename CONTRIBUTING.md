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
