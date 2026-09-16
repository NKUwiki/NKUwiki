## 欢迎访问 NKUwiki



## 反馈与共建

更新计划：

如果你发现内容需要补充、修正，欢迎通过以下方式参与共建：

- 加入交流 QQ 群 1108024910
- 或发邮件至 `1352862815@qq.com`

## 本地开发与构建

使用 Node.js 22.19+、24.11+ 或 26+，以及 packageManager 固定的 pnpm 11.24.0。无需 Corepack，尚未安装 pnpm 时先执行下面的 npm 安装命令：

```bash
npm install --global pnpm@11.24.0
pnpm install --frozen-lockfile
pnpm dev
```

```bash
pnpm check       # TypeScript、ESLint（含 CSS） 和内容索引测试
pnpm build    # 生产构建，检查 Markdown 内部链接
pnpm preview  # 预览生产产物
```

### 推荐工作流

1. 写作与排版：`pnpm dev`，浏览器打开 `http://localhost:5173/NKUwiki/`，保存即热更新。
2. 发布前验证：`pnpm build && pnpm preview`，打开 `http://localhost:4173/NKUwiki/` 查看与线上一致的生产产物。水印重复、图片 404 这类只在构建产物中暴露的问题，务必在这里确认后再推送。
3. 确认无误后提交推送，GitHub Actions 自动构建并发布到 GitHub Pages；发往 `main` 的 PR 上 CI 也会自动运行 `pnpm check` 和 `pnpm build` 兜底。

需要在手机或局域网内其他设备上预览时，执行 `pnpm preview --host`（开发模式同理为 `pnpm dev --host`），然后用该设备访问 `http://<电脑局域网IP>:4173/NKUwiki/`。只有需要把未合并的内容分享给无法访问你电脑的其他人时，才需要额外的线上预览站点。

产物位于 `docs/.vitepress/dist/`。GitHub Actions 使用锁文件安装依赖，构建后发布到 GitHub Pages；域名由 `docs/public/CNAME` 保留。

依赖版本直接维护在 `package.json`；`pnpm-workspace.yaml` 只保留安装脚本白名单等 pnpm 设置。提交 `pnpm-lock.yaml` 保证 CI 安装一致。样式检查参考 [homepage-v5](https://github.com/L33Z22L11/homepage-v5)，由 `@zinkawaii/eslint-config-css` 接入 ESLint 统一处理。`pnpm lint:fix` 可自动修复格式问题。TypeScript 严格检查主题和索引代码；历史 Markdown 示例不参与 ESLint，由生产构建校验。

CSS 按 tokens、base、home、article 分层组织，使用原生自定义属性、逻辑属性和 `color-mix()`；键盘焦点及减少动画偏好在通用样式中统一处理。`.editorconfig` 和 `.gitattributes` 统一 UTF-8 / LF，代码使用 Tab，Markdown / JSON / YAML 使用空格缩进。

## 内容结构与迁移约定

- `docs/.vitepress/config.mts`：中文导航、本地全文搜索、数学公式、blame 查看链接、站点地图。
- `docs/.vitepress/catalog.ts`：扫描编号目录，生成专题侧栏、分类、标签和归档数据。
- `docs/.vitepress/theme/`：首页、文章索引和 Vue 3 组件。
- `docs/public/`：图片等静态资源，继续使用 `/img/...` 引用；思维导图直接维护在文章中。
- `docs/01.新生入学/` 等编号目录：保留原有文章层级，目录展示时去掉数字前缀。

新文章放入对应编号目录，建议使用以下 frontmatter：

```yaml
---
title: 文章标题
date: 2026-09-07
permalink: /pages/unique-article/
categories:
  - 学习专题
tags:
  - 课程资料
author: 作者名
---
```

已有 `permalink` 原样映射到输出地址，不要随意修改，避免旧链接失效。未设置 permalink 时使用源文件路径。目录层级自动加入分类，原有 categories 和 tags 保留并去重；无需手工维护侧栏。新增文件或修改 permalink 后，重启开发服务器以刷新路由配置。最近更新使用 frontmatter 的 `updated`，未填写时回退到 `date`，不使用 Git 批量提交时间；空条目显示待补充提示。

首页保留专题入口、最近更新、活动与反馈共建。导航和首页的“全部目录”打开可搜索的目录弹窗，`/categories/?category=...`、`/tags/?tag=...` 保留原来的筛选链接，`/archives/` 按更新月份汇总文章。分类和标签可叠加关键词筛选并通过 URL 分享，支持紧凑卡片和列表视图。专题入口使用 `/topics/` 路径及显式 `activeMatch`，避免查询参数导致导航同时高亮。

纯二维码使用 `<QrCode src="目标链接" label="二维码说明" :size="120" />`，由 uqr 渲染 SVG；群邀请图片解码后以文字保留群号与限时邀请说明，无法解码或有额外活动内容的海报保留原图。站点图标使用离线导入的 Iconify Remix Icon 图标，颜色跟随主题。

基础设置、TypeScript、pnpm、ESLint、主题变量与 Git 属性规范参考 [xupt-wiki](https://github.com/xupt-wiki/xupt-wiki) 和 [blog-v3](https://github.com/L33Z22L11/blog-v3)；目录扫描、文章元数据和标签索引的组织方式参考 [Seraphonogram](https://github.com/aixcyi/Seraphonogram)。当前采用 VitePress 2.0.0-alpha.20 和 Vue 3。

列表、群汇总、美食与友链使用 `layout: wide`，保留侧边留白，大屏使用 80% 宽度且不设最大宽度。群卡片与友链参考 [xupt-wiki](https://github.com/xupt-wiki/xupt-wiki) 的 BlurCard：圆形头像、模糊背景、标签与加入方式；群头像来自 QQ，加载失败时使用本地图标。

表格可以包裹在 `::: cardlist` 容器内，在构建时转为卡片。表头作为字段名，空字段不显示，正文仍为 Markdown 并可被搜索索引。二维码/联系图片使用 vue-tippy 悬浮展示，支持键盘聚焦和触屏点击；微信二维码不提供普通网页跳转。群号后可加 `<CopyContact value="群号" />`。维护表格时请保证各行列数相同。

`DownloadPageImage` 使用按需加载的 modern-screenshot，提供页面长图、分享卡片、预览、PNG 下载和浏览器打印。导出在独立容器中等待字体/图片完成，附上站点标题、分享语、正式网址和 uqr 页面二维码；全文导出会将悬浮二维码还原为内联二维码。远程头像不能嵌入时回退本地图标；iframe 用原文入口代替，跨域资源和超长页面可用分享卡片或打印。favicon 提供深浅 SVG，支持系统及站内主题。

### 思维导图

使用 `@vitepress-plugin/markmap`，在文章中以 `:::markmap` 和 `:::` 包裹 Markdown 导图内容，可在容器开头通过 YAML frontmatter 配置 `markmap` 选项。评优、学分和电气就业导图直接维护在对应文章中，无需导出 HTML 或嵌入 iframe。

## 贡献者

感谢所有[贡献者](https://github.com/Cure2004/NKUwiki/graphs/contributors)参与维护。

[![贡献者](https://contrib.rocks/image?repo=Cure2004/NKUwiki)](https://github.com/Cure2004/NKUwiki/graphs/contributors)

