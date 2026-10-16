/**
 * 滚动进入渐显（reveal）：带 data-reveal 属性的元素首次进入视口时淡入并上移。
 *
 * 降级链路（三层，缺一层都不白屏）：
 * 1. CSS 默认就是可见态——隐藏只在 <html class="wiki-reveal-ready"> 下生效，
 *    而这个 class 由本模块在客户端执行时添加：禁用 JS 的爬虫、
 *    hydrate 之前的 SSR 输出，内容都直接显示；
 * 2. 不支持 IntersectionObserver 的旧环境直接返回，class 不加，同样保持可见；
 * 3. reduced-motion 下 --wiki-duration-slow 为 0s，元素即时到位。
 *
 * 接入方式：任何元素的属性里写 data-reveal 即可（markdown 容器规则与
 * Vue 模板都能加）。SPA 路由切换后新渲染的节点由 wiki:route-change 触发补扫，
 * 已观察过的元素记在 WeakSet 里，不会重复观察。
 */
const REVEAL_ATTR = 'data-reveal'
const REVEAL_IN_CLASS = 'wiki-reveal-in'
const READY_CLASS = 'wiki-reveal-ready'

export function installReveal() {
	if (typeof window === 'undefined' || typeof document === 'undefined')
		return
	if (!('IntersectionObserver' in window))
		return

	const observed = new WeakSet<Element>()
	const observer = new IntersectionObserver((entries) => {
		for (const entry of entries) {
			if (!entry.isIntersecting)
				continue
			entry.target.classList.add(REVEAL_IN_CLASS)
			// 只表演一次：反复滚上滚下不再重播，避免干扰回读
			observer.unobserve(entry.target)
		}
		// 阈值带上 0 兜底：单用 0.15 时，高度超过视口约 7 倍的元素（长 timeline、
		// 完整提交历史列表）在任何滚动位置下可见比例都到不了 15%，回调永不上门，
		// 而 CSS 已经把它设成 opacity: 0——这段内容就永久消失了。
		// 0 让它一相交就触发，触发线仍由下面的 rootMargin 控制。
	}, { threshold: [0, 0.15], rootMargin: '0px 0px -8% 0px' })

	function scan() {
		// 限定在内容区扫描：属性选择器无法走索引，全文档遍历在大页面上是白费；
		// 主题的 [data-reveal] 只会出现在正文里（导航栏、侧栏都没有）
		const scope = document.querySelector('.VPContent') ?? document
		scope.querySelectorAll(`[${REVEAL_ATTR}]`).forEach((element) => {
			if (observed.has(element))
				return
			observed.add(element)
			// 首屏内已可见的直接到位，不与转场动画叠加
			const rect = element.getBoundingClientRect()
			if (rect.top < window.innerHeight && rect.bottom > 0) {
				element.classList.add(REVEAL_IN_CLASS)
				observer.unobserve(element)
				return
			}
			observer.observe(element)
		})
	}

	// class 一加，未进入视口的 data-reveal 元素开始隐藏并等待动画
	document.documentElement.classList.add(READY_CLASS)
	scan()

	// 路由切换后内容整体替换，需要重新扫描新节点
	window.addEventListener('wiki:route-change', () => {
		requestAnimationFrame(scan)
	})
}
