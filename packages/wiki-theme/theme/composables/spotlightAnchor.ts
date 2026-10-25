/**
 * 聚光灯高亮块的横向锚定。
 *
 * 组件的定位逻辑是「贴着被高亮的元素」：left = 元素 left - 4、width = 元素 width + 8，
 * 于是高亮块——以及侧边模式下的那条竖线——会随内容缩进左右跳动。悬停到列表项、
 * 引用块、自定义容器里的段落时，竖线就比正文左边界右移 20px 甚至更多；同一篇文章里
 * 一会儿在左、一会儿在右，看着像定位坏了。
 *
 * 这里把正文栏的左边与宽度实测后写进 html 上的两个 CSS 变量，样式表据此覆盖组件写在
 * inline style 上的 left/width（见 styles/nolebase.css），高亮块于是恒定对齐正文栏。
 * 只接管横向：纵向仍由组件按元素 rect 逐行计算，逐行高亮、滚动跟随都不受影响。
 *
 * 变量在第一次写入成功后才挂 `wiki-spotlight-anchored` 类，样式表只在该类下覆盖——
 * 组件若先于本模块渲染，也不会因为变量为空把高亮块挤成一团。
 */

/** 与组件内部一致的选择器：SpotlightHoverBlock 用 .VPDoc main .vp-doc 定位正文根 */
const DOC_SELECTOR = '.VPDoc main .vp-doc'
const ANCHORED_CLASS = 'wiki-spotlight-anchored'
const LEFT_VAR = '--wiki-spotlight-left'
const WIDTH_VAR = '--wiki-spotlight-width'

export function installSpotlightAnchor() {
	if (typeof document === 'undefined' || typeof ResizeObserver === 'undefined')
		return

	let observed: HTMLElement | null = null
	let frame = 0
	let inside: boolean | null = null

	/** 正文换宽（侧栏收放、内容宽度滑块、窗口缩放、图片重新排版）时重写 */
	const observer = new ResizeObserver(() => schedule())

	function write(el: HTMLElement) {
		const rect = el.getBoundingClientRect()
		// 首屏布局尚未完成时 rect 可能为 0，此时的坐标没有意义，等下一帧
		if (!rect.width)
			return
		const style = document.documentElement.style
		style.setProperty(LEFT_VAR, `${rect.left}px`)
		style.setProperty(WIDTH_VAR, `${rect.width}px`)
		document.documentElement.classList.add(ANCHORED_CLASS)
	}

	function sync() {
		const el = document.querySelector<HTMLElement>(DOC_SELECTOR)
		if (!el)
			return
		// 路由切换可能换掉正文容器，换新节点时要重新 observe，旧节点上的观察随之失效
		if (el !== observed) {
			observed = el
			observer.observe(el)
		}
		write(el)
	}

	function schedule() {
		if (frame)
			return
		frame = requestAnimationFrame(() => {
			frame = 0
			sync()
		})
	}

	// 光标进入正文前先校正一次：侧栏状态是挂载后才套用的，正文会整体平移而宽度不变，
	// ResizeObserver 抓不到这种「只挪不缩」。此时重算，高亮块首次出现就落在正确位置。
	// 与 spotlightGuard 的监听刻意重叠：那边只管显隐，这边只在「进入」这一刻读一次布局，
	// 同一次 mousemove 里多一次 closest 的开销可以忽略。
	document.addEventListener('mousemove', (event) => {
		const target = event.target
		const nowInside = target instanceof Element && !!target.closest(DOC_SELECTOR)
		if (nowInside === inside)
			return
		inside = nowInside
		if (nowInside)
			schedule()
	}, { passive: true })

	window.addEventListener('resize', schedule, { passive: true })
	// 主题在 router.onAfterRouteChange 里派发；侧栏收放另有 ResizeObserver 兜住
	window.addEventListener('wiki:route-change', schedule)

	if (document.readyState === 'loading')
		document.addEventListener('DOMContentLoaded', schedule, { once: true })
	else
		schedule()
}
