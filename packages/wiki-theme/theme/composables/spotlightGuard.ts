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

	document.addEventListener('mousemove', (event) => {
		// 用 closest 判断「鼠标当前是否悬停在正文内容上」——纯 DOM 树遍历，不读任何布局值。
		// 原实现每次移动都 doc.getBoundingClientRect() 比对坐标：getBoundingClientRect
		// 会强制浏览器同步布局（flush layout），而 mousemove 是最高频的输入事件
		// （高刷屏可达 120+/s），这是明确的掉帧源。
		// 顺带语义也更准：悬停在正文上方的浮层（如回顶球）上时，按坐标算会误判为「在正文内」，
		// 按 target 归属判断则正确算作「在正文外」。
		const target = event.target
		const inside = target instanceof Element && !!target.closest(DOC_SELECTOR)
		// 只在状态翻转时改 DOM：鼠标移动是高频事件，不能每次写 class
		if (inside === lastInside)
			return
		lastInside = inside
		document.documentElement.classList.toggle(OUTSIDE_CLASS, !inside)
	}, { passive: true })
}
