import type { Theme } from 'vitepress'
import type { Component } from 'vue'
import DefaultTheme from 'vitepress/theme'
import { defineAsyncComponent } from 'vue'
import ArticleMeta from './components/ArticleMeta.vue'
import CopyContact from './components/CopyContact.vue'
import DownloadPageImage from './components/DownloadPageImage.vue'
import GroupAvatar from './components/GroupAvatar.vue'
import QrCode from './components/QrCode.vue'
import WidePage from './components/WidePage.vue'
import WikiLayout from './components/WikiLayout.vue'
import { highlightHashTarget, installHeadingHighlight } from './composables/headingHighlight'
import { syncSidebarCollapsed } from './composables/sidebar'
import '@vitepress-plugin/markmap/style.css'
import './styles/index.css'

// 必须在模块顶层注册：要比 VitePress createRouter 的 window 捕获监听更早，
// 才能在 preventDefault 后拦下 VitePress 默认的瞬时锚点跳转（详见 headingHighlight.ts 文件头）
installHeadingHighlight()

/**
 * 分类页的「新生入学」等导航入口都用 /categories/?category=xxx 表示，
 * 而 VitePress 判断导航高亮时会忽略查询串，几个入口会同时亮起；
 * 这里按查询串再校正一次，只有和当前地址一致的入口算高亮。
 */
function syncNavActive() {
	if (typeof window === 'undefined' || typeof document === 'undefined')
		return
	const path = window.location.pathname.replace(/index\.html$/, '')
	const search = window.location.search
	for (const link of document.querySelectorAll<HTMLAnchorElement>('.VPNavBarMenuLink')) {
		const href = link.getAttribute('href')
		if (!href)
			continue
		const target = new URL(href, window.location.origin)
		// 只校正指向分类页的入口（新生入学、浅谈学习、全部分类……），其余导航项留给 VitePress
		if (target.pathname !== '/categories/')
			continue
		const active = target.pathname === path && target.search === search
		link.classList.toggle('active', active)
		// aria-current="" 按 ARIA 规范等价于“非当前”，必须用显式 'true' 或整个移除
		if (active)
			link.setAttribute('aria-current', 'true')
		else
			link.removeAttribute('aria-current')
	}
}

export default {
	extends: DefaultTheme,
	Layout: WikiLayout,
	enhanceApp({ app, router }) {
		// 进页面时尽早套用上次的侧边栏收放状态，避免先闪一下再收起
		syncSidebarCollapsed()
		if (typeof document !== 'undefined') {
			const syncNav = () => window.requestAnimationFrame(syncNavActive)
			window.addEventListener('wiki:route-change', syncNav)
			syncNav()
		}
		// VitePress 2 no longer exposes the plugin's automatic registration marker.
		app.component('markmap', defineAsyncComponent(async () => (await import('@vitepress-plugin/markmap/markmap')).default as unknown as Component))
		// 仅个别页面使用的重组件走异步注册：HoverMedia（卡片页，拖 tippy 运行时），
		// 避免它被打进每个页面都下载的主题入口包。
		// WikiHome/ArticleIndex/WikiSearch 依赖站点数据（*.data.ts），由站点侧薄壳
		// docs/.vitepress/theme/index.ts 注册为全局组件，这里不感知。
		app.component('wide', WidePage)
		app.component('GroupAvatar', GroupAvatar)
		app.component('HoverMedia', defineAsyncComponent(() => import('./components/HoverMedia.vue')))
		app.component('FriendLinks', defineAsyncComponent(() => import('./components/FriendLinks.vue')))
		app.component('CopyContact', CopyContact)
		app.component('QrCode', QrCode)
		// 文章元信息（面包屑/作者/标签）在构建期随标题一起注入 Markdown 正文流（见 config.mts 的 article-title 规则）
		app.component('ArticleMeta', ArticleMeta)
		app.component('DownloadPageImage', DownloadPageImage)
		// Nolebase 增强可读性：桌面端聚光灯默认开启。
		// 仅在用户从未改动过该设置（localStorage 无记录）时写入默认值，之后完全尊重用户选择；
		// 触屏设备上插件自身会禁用聚光灯，不受此默认值影响。SSR 阶段无 localStorage，自动跳过。
		if (typeof localStorage !== 'undefined' && localStorage.getItem('vitepress-nolebase-enhanced-readabilities-spotlight-mode') === null)
			localStorage.setItem('vitepress-nolebase-enhanced-readabilities-spotlight-mode', 'true')
		router.onAfterRouteChange = () => {
			if (typeof window !== 'undefined')
				window.dispatchEvent(new Event('wiki:route-change'))
			// 跨页带 #hash 进来时，标题已经滚到位，这里补一次高亮
			highlightHashTarget()
		}
	},
} satisfies Theme
