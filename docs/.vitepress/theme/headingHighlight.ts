/**
 * 标题锚点跳转：平滑滚到目标标题，并给标题亮起一块提示色块。
 *
 * 覆盖三条入口：
 *   1. 点击正文里的锚点链接或标题本身
 *   2. 点击右侧大纲（大纲链接同样是本页 #hash）
 *   3. 带 #hash 进入页面（跨页深链、浏览器前进后退触发的 hashchange）
 *
 * 为什么要在主题模块顶层注册点击监听，而不是放进 enhanceApp：
 * VitePress 在 app/index.js 里 `import RawTheme from '@theme/index'`，本模块会随之求值，
 * 之后 createApp() 才执行 createRouter() 注册它自己的 window 捕获监听。
 * 所以这里的监听一定排在 VitePress 前面，preventDefault 之后
 * VitePress 会因为 `e.defaultPrevented` 直接放行；改到 enhanceApp 里注册，
 * VitePress 会抢先做一次瞬时跳转，自定义动画就失效了。
 */

/** 高亮色块的 class，样式见 styles/article.css */
const HIGHLIGHT_CLASS = 'wiki-heading-highlight'
/** 略长于 CSS 动画（2s），保证动画播完再摘掉 class */
const HIGHLIGHT_DURATION = 2200
/** 滚动时长：长短距离都用同一条曲线，观感一致 */
const SCROLL_DURATION = 480

let highlightTimer: ReturnType<typeof setTimeout> | undefined
/** 自增代号：期间又点了别的标题时，用它让上一次动画自行退出 */
let animationGeneration = 0

function prefersReducedMotion(): boolean {
	return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

/** href 是否指向当前页面内的锚点；跨页、外部、空 hash 一律交回 VitePress 处理 */
function inPageHash(href: string | null): string | null {
	if (!href || !href.includes('#'))
		return null
	let url: URL
	try {
		url = new URL(href, window.location.href)
	}
	catch {
		return null
	}
	if (url.origin !== window.location.origin || url.pathname !== window.location.pathname)
		return null
	return url.hash.length > 1 ? url.hash : null
}

function hashId(hash: string): string {
	try {
		return decodeURIComponent(hash.slice(1))
	}
	catch {
		return hash.slice(1)
	}
}

/** 解析锚点元素：优先在正文里找，避免命中侧栏等同名 id */
function findTarget(hash: string): HTMLElement | null {
	const id = hashId(hash)
	if (!id)
		return null
	const escaped = typeof CSS !== 'undefined' ? CSS.escape(id) : id
	const inDoc = document.querySelector<HTMLElement>(`.vp-doc [id="${escaped}"]`)
	return inDoc ?? document.getElementById(id)
}

/** 绝对滚动坐标：直接沿用 VitePress 给标题设的 scroll-margin-top，刚好让出导航栏 */
function targetOffset(element: HTMLElement): number {
	const margin = Number.parseFloat(getComputedStyle(element).scrollMarginTop)
	const top = element.getBoundingClientRect().top + window.scrollY - (Number.isNaN(margin) ? 0 : margin)
	const limit = Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
	return Math.min(Math.max(top, 0), limit)
}

function smoothScrollTo(top: number): void {
	const generation = ++animationGeneration
	const from = window.scrollY
	const distance = top - from
	if (prefersReducedMotion() || Math.abs(distance) < 2) {
		window.scrollTo(0, top)
		return
	}
	const started = performance.now()
	// easeInOutCubic：起步与收尾都平缓
	const ease = (progress: number) => (progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2)
	const step = (now: number) => {
		if (generation !== animationGeneration)
			return
		const progress = Math.min(1, (now - started) / SCROLL_DURATION)
		window.scrollTo(0, from + distance * ease(progress))
		if (progress < 1)
			requestAnimationFrame(step)
	}
	requestAnimationFrame(step)
}

function flash(element: HTMLElement): void {
	clearTimeout(highlightTimer)
	for (const previous of document.querySelectorAll(`.${HIGHLIGHT_CLASS}`))
		previous.classList.remove(HIGHLIGHT_CLASS)
	// 强制重排，重复点同一个标题时动画才会重播
	void element.offsetWidth
	element.classList.add(HIGHLIGHT_CLASS)
	highlightTimer = setTimeout(() => element.classList.remove(HIGHLIGHT_CLASS), HIGHLIGHT_DURATION)
}

/** 跳到某个锚点；scroll=false 时只高亮、不接管滚动 */
function jump(hash: string, scroll = true): boolean {
	const target = findTarget(hash)
	if (!target)
		return false
	if (scroll)
		smoothScrollTo(targetOffset(target))
	if (/^H[1-6]$/.test(target.tagName))
		flash(target)
	// 地址栏同步指向该标题，刷新和分享链接仍然落在同一处；
	// 地址已经是这个 hash（重复点击、或 VitePress 刚更新过）时不重复压历史记录
	if (window.location.hash !== hash) {
		window.history.pushState(window.history.state ?? {}, '', hash)
	}
	return true
}

function linkHash(target: Element): string | null {
	const link = target.closest('a')
	if (!link || link.hasAttribute('download') || link.hasAttribute('target'))
		return null
	return inPageHash(link.getAttribute('href'))
}

/** 直接点标题本身也能跳转；标题里还有链接时不抢，选中文字时不抢 */
function headingHash(target: Element): string | null {
	if (target.closest('a'))
		return null
	const selection = window.getSelection()
	if (selection && !selection.isCollapsed && selection.toString().trim())
		return null
	const heading = target.closest<HTMLElement>('.vp-doc :is(h1, h2, h3, h4, h5, h6)')
	if (!heading?.id)
		return null
	return inPageHash(`#${heading.id}`)
}

function onClick(event: MouseEvent): void {
	if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.shiftKey || event.altKey || event.metaKey)
		return
	const origin = event.target
	if (!(origin instanceof Element))
		return
	const hash = linkHash(origin) ?? headingHash(origin)
	if (!hash)
		return
	event.preventDefault()
	jump(hash)
}

/**
 * 注册标题跳转所需的全局监听。
 * 必须在主题模块顶层调用，理由见文件头注释。
 */
export function installHeadingHighlight(): void {
	if (typeof window === 'undefined' || typeof document === 'undefined')
		return
	// 捕获阶段：先于 VitePress 的路由监听拿到事件，preventDefault 后它会直接放行
	window.addEventListener('click', onClick, true)
	// 浏览器前进/后退，或 VitePress 抢先接管了链接时，至少补上一次滚动与高亮
	window.addEventListener('hashchange', () => jump(window.location.hash))
}

/**
 * 跨页带着 #hash 跳转后补一次高亮。
 * 位置由 VitePress 自己滚好，这里只负责让标题亮起来；
 * 首屏内容在 mount 之后才存在，等一帧再找元素。
 */
export function highlightHashTarget(): void {
	if (typeof window === 'undefined' || !window.location.hash)
		return
	requestAnimationFrame(() => jump(window.location.hash, false))
}
