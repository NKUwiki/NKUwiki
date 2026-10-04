// 站点级常量：正式网址与仓库地址（站点数据，不随主题包分发）。
// 组件与构建配置通过两条路消费这里的值：
// - config.mts（Node 侧）：直接 import 本文件；
// - 主题包组件：经 config.mts 的 vite.define 以全局常量注入（见包内 lib/data/site.ts）。
// 集中在此避免散落的硬编码（尤其是改名的旧仓库 NKU_Wiki）。
export const siteUrl = 'https://freshnkuer.wiki/'
export const repoUrl = 'https://github.com/NKUwiki/NKUwiki'
