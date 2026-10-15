import type { Theme } from 'vitepress'
import WikiTheme from '@nkuwiki/theme'
import { defineAsyncComponent } from 'vue'

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
		// 美食卡片墙：数据在 docs/.vitepress/data/food-data.js（站点侧维护）
		app.component('FoodCards', defineAsyncComponent(() => import('./site-components/FoodCards.vue')))
		// 美食评论挂在虚拟路径 /food/<id> 上（Twikoo 后台「详情」链接会指向它），
		// 站点没有对应的真实页面，直接点会 404——捕获阶段改跳美食页并带上
		// ?food=<id>，由 FoodCards 读参数自动展开对应弹窗。
		// 注意：Food 页 permalink 无尾斜杠（/pages/Food/ 是 404），不能多写斜杠；
		// 只处理本站链接，外站碰巧含 /food/ 路径的不碰
		if (!import.meta.env.SSR) {
			document.addEventListener('click', (event) => {
				const anchor = (event.target as HTMLElement | null)?.closest?.('a[href]')
				if (!anchor)
					return
				const resolved = new URL(anchor.getAttribute('href') || '', window.location.href)
				if (resolved.origin !== window.location.origin)
					return
				const match = resolved.pathname.match(/^\/food\/([^/?#]+)/)
				if (!match)
					return
				event.preventDefault()
				event.stopPropagation()
				window.location.assign(`/pages/Food?food=${encodeURIComponent(match[1])}`)
			}, true)
		}
	},
} satisfies Theme
