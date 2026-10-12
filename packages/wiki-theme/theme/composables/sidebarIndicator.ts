/**
 * 侧栏当前项的滑动色块。
 *
 * 默认主题给「当前文章」那一行直接铺背景色：翻页时旧行底色消失、新行底色出现，
 * 观感是「原地闪了一下」。这里改为在侧栏里放一块共享的指示条，
 * 路由变化时把 transform / height 移到新的当前项上，读者能看到选中态滑过去。
 *
 * 定位方式：指示条绝对定位于 #VPSidebarNav（默认主题已给它 position: relative），
 * 用当前项相对侧栏的 offsetTop 与 offsetHeight 计算目标位置；
 * 不自己算导航栏高度之类的全局坐标，只用元素间的相对偏移，滚动侧栏时依然准确。
 *
 * 降级：侧栏整体收起（data-wiki-sidebar="collapsed"）或找不到当前项时隐藏指示条；
 * reduced-motion 下 --wiki-duration-slow 为 0s，位移即时完成。
 */
const INDICATOR_CLASS = 'wiki-sidebar-indicator'

/** 当前项的选择器：默认主题的 is-active 标记 */
const ACTIVE_SELECTOR = '#VPSidebarNav .VPSidebarItem.is-active > .item'

export function installSidebarIndicator() {
	if (typeof window === 'undefined' || typeof document === 'undefined')
		return

	let indicator: HTMLElement | null = null

	function ensureIndicator(nav: HTMLElement): HTMLElement {
		if (indicator?.isConnected)
			return indicator
		indicator = document.createElement('div')
		indicator.className = INDICATOR_CLASS
		indicator.setAttribute('aria-hidden', 'true')
		nav.appendChild(indicator)
		return indicator
	}

	function sync() {
		const nav = document.querySelector<HTMLElement>('#VPSidebarNav')
		if (!nav)
			return
		const bar = ensureIndicator(nav)
		const active = document.querySelector<HTMLElement>(ACTIVE_SELECTOR)
		// 侧栏整体收起时没有可指示的行，直接隐藏
		if (!active || document.documentElement.dataset.wikiSidebar === 'collapsed') {
			bar.removeAttribute('data-visible')
			return
		}
		const navRect = nav.getBoundingClientRect()
		const rect = active.getBoundingClientRect()
		// 行本身向外溢出 0.5rem（见 sidebar.css 的负边距），指示条取齐行内盒：
		// 宽度用行的 offsetWidth（含溢出后的实际宽度），横向位置按行左缘对齐
		bar.style.width = `${active.offsetWidth}px`
		bar.style.height = `${rect.height}px`
		bar.style.transform = `translate(${rect.left - navRect.left + nav.scrollLeft}px, ${rect.top - navRect.top + nav.scrollTop}px)`
		bar.setAttribute('data-visible', '')
	}

	// 路由切换后当前项会变；transitionend 前的连续变化由 CSS 过渡自然衔接
	window.addEventListener('wiki:route-change', () => requestAnimationFrame(sync))
	// 首次进入也要定位一次（首页没有侧栏当前项，此时会走隐藏分支）
	requestAnimationFrame(sync)
}
