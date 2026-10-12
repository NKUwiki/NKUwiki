/**
 * 聚光灯高亮块的显隐守卫。
 *
 * Nolebase 的 SpotlightHoverBlock 只在鼠标移动时重算高亮块位置，
 * 且鼠标移出正文时既不隐藏、也不清理自己的样式——最后一次的高亮会「钉」在原处。
 * 平时不易察觉，但侧栏收起/展开会让正文整体位移，那条停在旧位置的高亮
 * （侧边模式下是一条 4px 竖线）就会明显跑到正文之外。
 *
 * 这里按「鼠标是否落在正文区域内」维护一个 html 上的类，CSS 据此隐藏高亮块；
 * 不碰组件自己写的 inline style，也不侵入它的响应式状态，
 * 鼠标回到正文时高亮块由组件自行重算位置、自然恢复显示。
 */
const OUTSIDE_CLASS = 'wiki-spotlight-outside'
/** 与组件内部一致的选择器：SpotlightHoverBlock 用 .VPDoc main .vp-doc 定位正文根 */
const DOC_SELECTOR = '.VPDoc main .vp-doc'

/** 强制隐藏高亮块（侧栏收放时调用；鼠标再次进入正文后由守卫生效恢复） */
export function markSpotlightOutside() {
	if (typeof document !== 'undefined')
		document.documentElement.classList.add(OUTSIDE_CLASS)
}

export function installSpotlightGuard() {
	if (typeof document === 'undefined')
		return
	// null 表示尚未判定过，保证第一次移动一定会写一次 class
	let lastInside: boolean | null = null
	// 正文元素的缓存。mousemove 是最高频的事件之一，每次重新查询 DOM 是纯浪费；
	// 路径变化或元素被卸载时缓存自然失效（isConnected 兜底路由切换的场景）。
	let cachedDoc: HTMLElement | null = null
	let cachedPath = ''

	document.addEventListener('mousemove', (event) => {
		if (cachedPath !== location.pathname || !cachedDoc?.isConnected) {
			cachedDoc = document.querySelector<HTMLElement>(DOC_SELECTOR)
			cachedPath = location.pathname
		}
		const root = document.documentElement
		const doc = cachedDoc
		if (!doc) {
			root.classList.add(OUTSIDE_CLASS)
			return
		}
		const rect = doc.getBoundingClientRect()
		const inside = event.clientX >= rect.left && event.clientX <= rect.right
			&& event.clientY >= rect.top && event.clientY <= rect.bottom
		// 只在状态翻转时改 DOM：鼠标移动是高频事件，不能每次写 class
		if (inside === lastInside)
			return
		lastInside = inside
		root.classList.toggle(OUTSIDE_CLASS, !inside)
	}, { passive: true })
}
