/**
 * 深浅色切换的整页交叉淡入（View Transitions API）。
 *
 * 效果取自 uscwiki（Fumadocs 站）：点切换按钮时浏览器对整页前后各拍一张快照，
 * 用 UA 默认的 250ms 交叉淡入把新旧两张融在一起，明暗是「化」过去的而不是「跳」过去的。
 * 我们没有自定义任何 ::view-transition-* 规则——那条默认动画就够，多写反而容易翻车。
 *
 * 为什么要自己接管点击，而不是照抄 uscwiki 那行
 * `document.startViewTransition(() => flushSync(() => setTheme(next)))`：
 * 那行能成立是因为 React 的 flushSync 能把 DOM 更新压在回调里同步完成。
 * VitePress 的 isDark 是 Vue computed，赋值之后 DOM 更新排在微任务里，
 * 而 View Transition 的「旧状态快照」要等到下一帧才拍——微任务跑在下一帧之前，
 * 旧快照拍到的就已经是暗色了，新旧两张一模一样，动画等于空放。
 * 所以这里必须在捕获阶段拦下 VitePress 自己的处理，把切换挪进回调里做。
 *
 * 为什么放弃原来的整页颜色过渡（wiki-theme-fade）：
 * VitePress 的 isDark 来自 VueUse useDark → useColorMode，而后者默认
 * disableTransition: true，翻 .dark 时会往 <head> 注入
 * `*,*::before,*::after{transition:none!important}` 并强制一次样式重算，
 * 所有 CSS transition 当场失效。View Transition 走的是 ::view-transition-*
 * 伪元素上的 animation，既不归 * 选择器管，也不受 transition 影响，能绕开这条。
 *
 * 降级：不支持 View Transitions（如 Firefox 旧版）或用户开了
 * prefers-reduced-motion 时直接放行，交给 VitePress 原本的瞬时切换，行为不变。
 */
/** 切换按钮：导航栏与移动端全屏菜单里是同一个组件 */
const SWITCH_SELECTOR = '.VPSwitchAppearance'
/**
 * 等 .dark 真正落到 <html> 上的兜底超时。
 * 正常路径是微任务里就翻转、MutationObserver 立刻回调；超时只在主题被
 * 强制锁定（appearance: 'force-dark' 之类）时才会走到，那时也不能把交互卡住。
 */
const FLIP_TIMEOUT = 300

function canAnimate(): boolean {
	if (typeof document.startViewTransition !== 'function')
		return false
	return !window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * 等主题真的翻过去。
 *
 * 不用 nextTick：那要求调用方拿到 Vue 实例、且依赖 Vue 调度器的内部时序。
 * 直接盯 <html> 的 class 属性更贴近「我们真正在等的事」，也与框架无关。
 */
function waitForThemeFlip(previousDark: boolean): Promise<void> {
	const root = document.documentElement
	const flipped = () => root.classList.contains('dark') !== previousDark
	if (flipped())
		return Promise.resolve()

	return new Promise<void>((resolve) => {
		let timer: ReturnType<typeof setTimeout> | undefined
		const observer = new MutationObserver(() => {
			if (!flipped())
				return
			observer.disconnect()
			if (timer)
				clearTimeout(timer)
			resolve()
		})
		observer.observe(root, { attributes: true, attributeFilter: ['class'] })
		timer = setTimeout(() => {
			observer.disconnect()
			resolve()
		}, FLIP_TIMEOUT)
	})
}

/**
 * @param toggleAppearance 真正执行切换的回调，等价于 VitePress 的默认实现
 *   （`() => { isDark.value = !isDark.value }`），由调用方从 useData() 里取。
 * @returns 拆除监听的函数
 */
export function installThemeTransition(toggleAppearance: () => void): () => void {
	if (typeof window === 'undefined' || typeof document === 'undefined')
		return () => {}

	function onClick(event: MouseEvent) {
		const target = event.target
		if (!(target instanceof Element) || !target.closest(SWITCH_SELECTOR))
			return
		if (!canAnimate())
			return

		// 捕获阶段拦下：不让 VitePress 的 @click 在微任务里提前把 .dark 改掉
		event.stopPropagation()
		const previousDark = document.documentElement.classList.contains('dark')
		const transition = document.startViewTransition(async () => {
			toggleAppearance()
			await waitForThemeFlip(previousDark)
		})
		transition.ready.catch(() => {
			// 连点或转场期间切页会让这次转场被浏览器跳过，ready 随之 reject，
			// 接住它，免得控制台留一条未处理的 AbortError
		})
	}

	// 捕获阶段：必须早于按钮上的 Vue 监听器
	document.addEventListener('click', onClick, true)
	return () => document.removeEventListener('click', onClick, true)
}
