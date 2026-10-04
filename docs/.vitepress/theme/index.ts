import type { Theme } from 'vitepress'
import { defineAsyncComponent } from 'vue'
import WikiTheme from '@nkuwiki/theme'

/**
 * 站点装配薄壳：通用主题在 @nkuwiki/theme（packages/wiki-theme），
 * 这里只注册依赖站点数据的组件（首页/索引/搜索）。
 * 原因：*.data.ts 数据加载器只会被 srcDir 下的文件扫描改写，
 * 主题包（packages/）无法消费，所以消费数据的组件必须留在 docs 侧。
 */
export default {
	extends: WikiTheme,
	enhanceApp({ app }) {
		app.component('WikiHome', defineAsyncComponent(() => import('./site-components/WikiHome.vue')))
		app.component('ArticleIndex', defineAsyncComponent(() => import('./site-components/ArticleIndex.vue')))
		// WikiLayout（主题包内）通过全局组件解析 <WikiSearch/>，不直接 import
		app.component('WikiSearch', defineAsyncComponent(() => import('./site-components/WikiSearch.vue')))
	},
} satisfies Theme
