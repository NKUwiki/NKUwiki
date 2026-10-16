/**
 * 分类药丸横向滚动的两种增强：鼠标按住拖动、滚轮转横向滚动。
 *
 * 抽成独立模块是为了能测：边界放行、Firefox 的行单位换算、拖动阈值、
 * 拖动之后那次 click 的抑制——这些写错了都不会报错，只是手感不对，
 * 靠肉眼 review 很难发现。
 *
 * 参数刻意做成鸭子类型：el 只需 scrollLeft / scrollWidth / clientWidth /
 * classList / addEventListener，win 只需 addEventListener / removeEventListener，
 * 测试里传假对象即可，不必引入 jsdom 之类的 DOM 实现。
 */

/** 拖动判定阈值（px）：位移小于它视为点击，不进入拖动状态 */
export const DRAG_THRESHOLD = 4

/**
 * 算出滚轮应该滚多少像素；返回 0 表示「不接管」，交给页面自己滚。
 * 三种不接管的情形：行内本就没有溢出、已在该方向的尽头、本次无位移。
 */
export function wheelScrollDelta({ deltaX, deltaY, deltaMode, scrollLeft, maxScroll, viewportWidth }) {
	if (maxScroll <= 0)
		return 0
	// Firefox 等以「行」为单位派发滚轮（deltaMode=1），按页（2）同理，都要换算成像素
	const scale = deltaMode === 1 ? 16 : deltaMode === 2 ? Math.max(1, viewportWidth || 0) : 1
	const delta = (Math.abs(deltaY) > Math.abs(deltaX) ? deltaY : deltaX) * scale
	if (!delta)
		return 0
	if ((delta < 0 && scrollLeft <= 0) || (delta > 0 && scrollLeft >= maxScroll))
		return 0
	return delta
}

/**
 * 把两种交互绑到 el 上。只接管鼠标：触摸与触控笔交回浏览器，
 * 保留移动端原生的惯性滚动。
 */
export function createChipsScroll(el, win) {
	if (!el || !win)
		return { bind() {}, unbind() {} }

	let drag = null
	/** 刚结束的这次拖动是否真的移动过——用来吞掉随后补发的那次 click */
	let draggedMoved = false

	const maxScroll = () => el.scrollWidth - el.clientWidth

	function onWheel(event) {
		const delta = wheelScrollDelta({
			deltaX: event.deltaX,
			deltaY: event.deltaY,
			deltaMode: event.deltaMode,
			scrollLeft: el.scrollLeft,
			maxScroll: maxScroll(),
			viewportWidth: el.clientWidth,
		})
		if (!delta)
			return
		el.scrollLeft += delta
		event.preventDefault()
	}

	function onPointerMove(event) {
		if (!drag)
			return
		const dx = event.clientX - drag.startX
		if (!drag.moved) {
			if (Math.abs(dx) < DRAG_THRESHOLD)
				return
			drag.moved = true
			el.classList.add('is-dragging')
		}
		el.scrollLeft = drag.startScroll - dx
	}

	function onPointerUp() {
		if (!drag)
			return
		win.removeEventListener('pointermove', onPointerMove)
		win.removeEventListener('pointerup', onPointerUp)
		win.removeEventListener('pointercancel', onPointerUp)
		// 拖动之后浏览器仍会补发一次 click：留标记，交给捕获阶段的 onClickCapture 吞掉
		draggedMoved = drag.moved
		drag = null
		el.classList.remove('is-dragging')
	}

	function onPointerDown(event) {
		if (event.pointerType !== 'mouse' || event.button !== 0)
			return
		if (maxScroll() <= 0)
			return
		drag = { startX: event.clientX, startScroll: el.scrollLeft, moved: false }
		// 监听挂 win 而不是用 setPointerCapture：捕获会把 pointerup 的目标改成捕获元素，
		// 浏览器据此把 click 派发给容器，药丸反而点不动了
		win.addEventListener('pointermove', onPointerMove)
		win.addEventListener('pointerup', onPointerUp)
		win.addEventListener('pointercancel', onPointerUp)
	}

	function onClickCapture(event) {
		if (!draggedMoved)
			return
		draggedMoved = false
		event.preventDefault()
		event.stopPropagation()
	}

	return {
		bind() {
			// wheel 必须显式 passive: false，否则里面那次 preventDefault 无效
			el.addEventListener('wheel', onWheel, { passive: false })
			el.addEventListener('pointerdown', onPointerDown)
			el.addEventListener('click', onClickCapture, true)
		},
		unbind() {
			onPointerUp()
			el.removeEventListener('wheel', onWheel)
			el.removeEventListener('pointerdown', onPointerDown)
			el.removeEventListener('click', onClickCapture, true)
		},
	}
}
