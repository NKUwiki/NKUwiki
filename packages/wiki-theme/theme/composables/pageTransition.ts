/**
 * 跨页转场：站内导航后内容容器淡入并轻微上移。
 *
 * 为什么监听 wiki:route-change 而不是给内容包 <Transition>：
 * VitePress 的内容容器由内部渲染管线控制（文章页 .VPDoc、layout: page 页 .VPPage），
 * 包 Transition 容易与它的更新顺序打架；这里只给 .VPContent 加一个 class、
 * 动画结束后摘掉，对内部结构零侵入。
 *
 * 几条刻意边界：
 * - 首次进站不播：从外站点点进来、按 F5 刷新、直接输地址，都不该看一遍入场动画；
 * - 带 #hash 的跳转不播：锚点滚动（headingHighlight）才是那一刻的主角，
 *   两者同时播放会让滚动目标在动画期间发生 8px 位移；
 * - 地图页也播（产品决策）：MapView 初始化是异步的，淡入正好掩盖黑屏，
 *   位移只有 8px 且不参与布局，不会把工具条顶出视口。
 *
 * 时长与曲线取自 tokens.css 的 --wiki-duration-page / --wiki-ease-out，
 * reduced-motion 下前者为 0s，动画即时完成（视觉上等同于硬切，可接受）。
 */
const ENTER_CLASS = 'wiki-page-enter'

/** 转场目标：所有页面都有 .VPContent（文章页与 layout: page 页通用） */
function findContent(): HTMLElement | null {
	return document.querySelector<HTMLElement>('.VPContent')
}

export function installPageTransition() {
	if (typeof window === 'undefined' || typeof document === 'undefined')
		return
	let firstLoad = true

	window.addEventListener('wiki:route-change', () => {
		// 首次进入只消费掉标记，不播放
		if (firstLoad) {
			firstLoad = false
			return
		}
		// 带锚点的跨页跳转交给标题滚动，避免两个动画互相干扰
		if (window.location.hash)
			return
		const content = findContent()
		if (!content)
			return
		// 首页有自己的区块错落渐显（见 styles/home.css）：
		// 再叠一层整体淡入会把错落的编排压平，看起来只是「整页闪了一下」
		if (content.querySelector('.wiki-home'))
			return
		// 先摘再加并强制回流，保证连续跳转时动画重新起播
		content.classList.remove(ENTER_CLASS)
		void content.offsetWidth
		content.classList.add(ENTER_CLASS)
	})

	// 动画播完即摘除 class：侧栏目录页等容器会被反复进入，
	// 让 class 长期留着会在下次路由变化时多一次无谓的重排判断
	document.addEventListener('animationend', (event) => {
		if (event instanceof AnimationEvent && event.animationName === 'wiki-page-enter')
			(event.target as HTMLElement | null)?.classList.remove(ENTER_CLASS)
	})
}
