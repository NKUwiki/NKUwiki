/**
 * 分类药丸横向滚动增强的回归测试（拖动手感 / 滚轮转横向）。
 *
 * 这些逻辑写错了不会报错，只是手感不对（到边了页面滚不动、拖一下把分类点掉、
 * Firefox 上滚轮几乎不动），所以用假 DOM 把边界情形钉住。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createChipsScroll, DRAG_THRESHOLD, wheelScrollDelta } from '../packages/wiki-map/chips-scroll.js'

function fakeElement({ clientWidth = 300, scrollWidth = 900, scrollLeft = 0 } = {}) {
	const classes = new Set<string>()
	const listeners = new Map<string, ((event: any) => void)[]>()
	return {
		clientWidth,
		scrollWidth,
		scrollLeft,
		classList: {
			add: (name: string) => classes.add(name),
			remove: (name: string) => classes.delete(name),
			contains: (name: string) => classes.has(name),
		},
		addEventListener(type: string, fn: (event: any) => void) {
			listeners.set(type, [...(listeners.get(type) ?? []), fn])
		},
		removeEventListener(type: string, fn: (event: any) => void) {
			listeners.set(type, (listeners.get(type) ?? []).filter(x => x !== fn))
		},
		fire(type: string, event: any = {}) {
			for (const fn of listeners.get(type) ?? [])
				fn({ preventDefault() {}, stopPropagation() {}, ...event })
		},
		listenerCount: (type: string) => (listeners.get(type) ?? []).length,
	}
}

function fakeWindow() {
	const listeners = new Map<string, ((event: any) => void)[]>()
	return {
		addEventListener(type: string, fn: (event: any) => void) {
			listeners.set(type, [...(listeners.get(type) ?? []), fn])
		},
		removeEventListener(type: string, fn: (event: any) => void) {
			listeners.set(type, (listeners.get(type) ?? []).filter(x => x !== fn))
		},
		fire(type: string, event: any = {}) {
			for (const fn of listeners.get(type) ?? [])
				fn(event)
		},
		total: () => [...listeners.values()].reduce((n, list) => n + list.length, 0),
	}
}

/**
 * 派发一次事件并回报它是否被拦下（preventDefault / stopPropagation）。
 * 写成方法简写 + 多行是为了满足 lint 的「单行最多一条语句」。
 */
function fireWithFlags(el: ReturnType<typeof fakeElement>, type: string, event: any = {}) {
	const flags = { prevented: false, stopped: false }
	el.fire(type, {
		...event,
		preventDefault() {
			flags.prevented = true
		},
		stopPropagation() {
			flags.stopped = true
		},
	})
	return flags
}

const base = { deltaMode: 0, scrollLeft: 100, maxScroll: 600, viewportWidth: 300 }

test('滚轮换算：纵向滚轮转横向位移', () => {
	assert.equal(wheelScrollDelta({ deltaX: 0, deltaY: 120, ...base }), 120)
	// 横向滚轮（触控板横滑）优先用 deltaX
	assert.equal(wheelScrollDelta({ deltaX: -80, deltaY: 10, ...base }), -80)
})

test('滚轮换算：末行无溢出 / 已到两端 / 无位移都不接管', () => {
	// 行内没溢出：交给页面
	assert.equal(wheelScrollDelta({ deltaX: 0, deltaY: 120, ...base, maxScroll: 0 }), 0)
	// 已经在最右还继续向右滚：不能拦，否则鼠标停在卡片上页面就滚不动了
	assert.equal(wheelScrollDelta({ deltaX: 0, deltaY: 120, ...base, scrollLeft: 600 }), 0)
	// 已经在最左还继续向左滚
	assert.equal(wheelScrollDelta({ deltaX: 0, deltaY: -120, ...base, scrollLeft: 0 }), 0)
	// 中间位置两个方向都该接管
	assert.equal(wheelScrollDelta({ deltaX: 0, deltaY: -120, ...base, scrollLeft: 300 }), -120)
	// 零位移
	assert.equal(wheelScrollDelta({ deltaX: 0, deltaY: 0, ...base }), 0)
})

test('滚轮换算：Firefox 的「行」单位与「页」单位都要换算成像素', () => {
	// deltaMode=1（行）按 16px 一行
	assert.equal(wheelScrollDelta({ deltaX: 0, deltaY: 3, ...base, deltaMode: 1 }), 48)
	// deltaMode=2（页）按一屏宽
	assert.equal(wheelScrollDelta({ deltaX: 0, deltaY: 1, ...base, deltaMode: 2 }), 300)
})

test('滚轮绑定后：中段滚动会推动 scrollLeft 并拦下事件', () => {
	const el = fakeElement({ scrollLeft: 100 })
	const win = fakeWindow()
	createChipsScroll(el, win).bind()

	const first = fireWithFlags(el, 'wheel', { deltaX: 0, deltaY: 120, deltaMode: 0 })
	assert.equal(el.scrollLeft, 220, 'scrollLeft 应前移 120')
	assert.equal(first.prevented, true, '应拦下默认行为（否则页面同时纵向滚动）')

	// 到最右后放手
	el.scrollLeft = 600
	const atEdge = fireWithFlags(el, 'wheel', { deltaX: 0, deltaY: 120, deltaMode: 0 })
	assert.equal(atEdge.prevented, false, '到端后不应再拦截')
})

test('拖动：位移小于阈值时既不平移也不吞点击', () => {
	const el = fakeElement({ scrollLeft: 50 })
	const win = fakeWindow()
	createChipsScroll(el, win).bind()

	el.fire('pointerdown', { pointerType: 'mouse', button: 0, clientX: 200 })
	win.fire('pointermove', { clientX: 200 + DRAG_THRESHOLD - 1 })
	assert.equal(el.scrollLeft, 50, '未过阈值不应平移')
	assert.equal(el.classList.contains('is-dragging'), false, '未过阈值不应进入拖动态')

	win.fire('pointerup', {})
	const click = fireWithFlags(el, 'click')
	assert.equal(click.stopped, false, '轻点不应吞掉点击（否则分类点不动）')
})

test('拖动：过阈值后按位移平移，并吞掉随后那次 click', () => {
	const el = fakeElement({ scrollLeft: 100 })
	const win = fakeWindow()
	createChipsScroll(el, win).bind()

	el.fire('pointerdown', { pointerType: 'mouse', button: 0, clientX: 200 })
	win.fire('pointermove', { clientX: 140 }) // 往左拖 60px
	assert.equal(el.scrollLeft, 160, '往左拖应把内容向左移（scrollLeft 增加）')
	assert.equal(el.classList.contains('is-dragging'), true)
	assert.equal(win.total(), 3, '拖动期间应挂上 pointermove/pointerup/pointercancel')

	win.fire('pointerup', {})
	assert.equal(el.classList.contains('is-dragging'), false, '松手应退出拖动态')
	assert.equal(win.total(), 0, '松手后 window 上的监听必须清干净')

	const afterDrag = fireWithFlags(el, 'click')
	assert.equal(afterDrag.stopped, true, '拖动后补发的那次 click 要被吞掉')
	// 只吞一次：下一次点击应正常放行
	const nextClick = fireWithFlags(el, 'click')
	assert.equal(nextClick.stopped, false)
})

test('拖动标记及时复位：漏收 click 不会吞掉下一次正常点击', () => {
	const el = fakeElement({ scrollLeft: 100 })
	const win = fakeWindow()
	createChipsScroll(el, win).bind()

	// 在药丸行按下、拖出容器外松手：补发的 click 派发给最近公共祖先，
	// 不经过本容器，onClickCapture 不执行——标记会残留
	el.fire('pointerdown', { pointerType: 'mouse', button: 0, clientX: 200 })
	win.fire('pointermove', { clientX: 140 })
	win.fire('pointerup', {})

	// 下一次正常点击（按下即松开，无位移）必须放行，否则分类筛选静默失效
	el.fire('pointerdown', { pointerType: 'mouse', button: 0, clientX: 210 })
	win.fire('pointerup', {})
	const click = fireWithFlags(el, 'click')
	assert.equal(click.stopped, false, '残留的拖动标记不应吞掉下一次正常点击')
})

test('触摸与触控笔不接管，且未溢出时不启动拖动', () => {
	const el = fakeElement()
	const win = fakeWindow()
	createChipsScroll(el, win).bind()

	el.fire('pointerdown', { pointerType: 'touch', button: 0, clientX: 100 })
	el.fire('pointerdown', { pointerType: 'pen', button: 0, clientX: 100 })
	assert.equal(win.total(), 0, '触摸/触控笔应交给浏览器原生惯性滚动')

	// 未溢出（scrollWidth <= clientWidth）时拖动无意义
	const narrow = fakeElement({ clientWidth: 300, scrollWidth: 300 })
	createChipsScroll(narrow, win).bind()
	narrow.fire('pointerdown', { pointerType: 'mouse', button: 0, clientX: 100 })
	assert.equal(win.total(), 0, '无溢出时不应挂拖动监听')
})

test('拖动中途卸载：不留 window 监听', () => {
	const el = fakeElement()
	const win = fakeWindow()
	const ctl = createChipsScroll(el, win)
	ctl.bind()

	el.fire('pointerdown', { pointerType: 'mouse', button: 0, clientX: 200 })
	win.fire('pointermove', { clientX: 100 })
	assert.equal(win.total(), 3)

	ctl.unbind()
	assert.equal(win.total(), 0, 'unbind 应把拖动中的监听一并收掉')
	assert.equal(el.classList.contains('is-dragging'), false)
	assert.equal(el.listenerCount('wheel'), 0)
})
