// 站点级常量的**注入点**：真实值属于站点数据，不随主题包分发。
//
// 站点侧在 docs/.vitepress/data/site.ts 保存真实值，并在 config.mts 里通过
// `vite.define` 把它们以全局常量形式编译期注入（构建期与客户端双端生效）：
//
//   vite: { define: {
//     __SITE_URL__: JSON.stringify(siteUrl),
//     __REPO_URL__: JSON.stringify(repoUrl),
//   } }
//
// 因此 config.mts（Node 侧，define 不生效）应直接 import 站点侧数据文件；
// 包内组件与本模块则消费这里导出的常量。

declare const __SITE_URL__: string
declare const __REPO_URL__: string

/** 正式网址（尾带斜杠） */
export const siteUrl: string = __SITE_URL__
/** 仓库地址 */
export const repoUrl: string = __REPO_URL__
