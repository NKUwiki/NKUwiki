import type { Theme } from 'vitepress'
import type { Component } from 'vue'
import { NolebaseGitChangelogPlugin } from '@nolebase/vitepress-plugin-git-changelog/client'
import DefaultTheme from 'vitepress/theme-without-fonts'
import { defineAsyncComponent } from 'vue'
import ArticleIndex from './components/ArticleIndex.vue'
import CopyContact from './components/CopyContact.vue'
import DownloadPageImage from './components/DownloadPageImage.vue'
import FriendLinks from './components/FriendLinks.vue'
import GroupAvatar from './components/GroupAvatar.vue'
import HoverMedia from './components/HoverMedia.vue'
import QrCode from './components/QrCode.vue'
import WidePage from './components/WidePage.vue'
import WikiHome from './components/WikiHome.vue'
import WikiLayout from './components/WikiLayout.vue'
import { syncSidebarCollapsed } from './sidebar'
import '@nolebase/vitepress-plugin-git-changelog/client/style.css'
import '@vitepress-plugin/markmap/style.css'
import './styles/index.css'

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
		link.toggleAttribute('aria-current', active)
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
		app.component('WikiHome', WikiHome)
		app.component('wide', WidePage)
		app.component('GroupAvatar', GroupAvatar)
		app.component('HoverMedia', HoverMedia)
		app.component('FriendLinks', FriendLinks)
		app.component('CopyContact', CopyContact)
		app.component('QrCode', QrCode)
		app.component('ArticleIndex', ArticleIndex)
		app.component('DownloadPageImage', DownloadPageImage)
		// Nolebase 文件历史：注册文案与日期本地化（页面底部由 WikiLayout 渲染 NolebaseGitChangelog 组件）
		app.use(NolebaseGitChangelogPlugin, {
			locales: {
				'zh-CN': {
					lastEditedDateFnsLocaleName: 'zhCN',
				},
			},
		})
		// Nolebase 增强可读性：桌面端聚光灯默认开启。
		// 仅在用户从未改动过该设置（localStorage 无记录）时写入默认值，之后完全尊重用户选择；
		// 触屏设备上插件自身会禁用聚光灯，不受此默认值影响。SSR 阶段无 localStorage，自动跳过。
		if (typeof localStorage !== 'undefined' && localStorage.getItem('vitepress-nolebase-enhanced-readabilities-spotlight-mode') === null)
			localStorage.setItem('vitepress-nolebase-enhanced-readabilities-spotlight-mode', 'true')
		router.onAfterRouteChange = () => {
			if (typeof window !== 'undefined')
				window.dispatchEvent(new Event('wiki:route-change'))
		}
	},
} satisfies Theme
