import { ref } from 'vue'
import { markSpotlightOutside } from './spotlightGuard'

/**
 * 左侧目录的收放状态。
 *
 * 状态存在 localStorage 里：读文章时收起来一次，之后翻页都保持收起。
 * 是否收起由 <html data-wiki-sidebar="collapsed"> 决定，样式在 cards.css；
 * 侧栏顶部的按钮和收起后浮在左边缘的按钮共用这里的 sidebarCollapsed。
 */
export const SIDEBAR_COLLAPSED_KEY = 'nku-wiki:sidebar-collapsed'

/** 侧边栏是否收起（两个按钮共用） */
export const sidebarCollapsed = ref(false)

function readSidebarCollapsed(): boolean {
	try {
		return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1'
	}
	catch {
		// 隐私模式等场景下读不到 localStorage，当作没收起
		return false
	}
}

export function applySidebarCollapsed(collapsed: boolean) {
	sidebarCollapsed.value = collapsed
	document.documentElement.dataset.wikiSidebar = collapsed ? 'collapsed' : 'expanded'
	// 侧栏收放会让正文整体位移，而聚光灯高亮块不会自己跟着重算（见 spotlightGuard）。
	// 先隐藏它——此刻要么鼠标正点在按钮上（本就不该有高亮），
	// 要么是启动时套用上次状态、还没有可信的位置；
	// 鼠标一移动，守卫就会按实际位置校正显隐。
	markSpotlightOutside()
}

export function toggleSidebarCollapsed() {
	const collapsed = !sidebarCollapsed.value
	applySidebarCollapsed(collapsed)
	try {
		localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0')
	}
	catch {
		// 隐私模式等场景下无法持久化，不影响本次切换
	}
}

/** 进页面时尽早套用上次的选择，避免侧边栏先闪一下再收起。 */
export function syncSidebarCollapsed() {
	if (typeof window === 'undefined' || typeof document === 'undefined')
		return
	applySidebarCollapsed(readSidebarCollapsed())
}
