<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

/**
 * 右下角悬浮球：环形进度展示整页阅读进度，点击平滑回到顶部。
 * 形态对齐 plume 主题的 VPBackToTop：移动端 36px / 桌面端 48px，
 * 进度环画在球内（r = 50% - 2px，随尺寸自适应），
 * 滚动中环心显示「百分比%」，静止后淡回箭头图标。
 */
const progress = ref(0)
const visible = ref(false)

// 进度环 dasharray：环半径是 calc(50% - 2px)（见 base.css），
// 周长 = π*直径 - 4πpx。按实测直径算像素值而不是用百分比公式——
// 百分比公式在进度低于 4/直径 时会算出负 dasharray（浏览器视为非法值，
// 退化成整环显示，低进度时环会突跳），像素值可以钳到最小 0
const ringEl = ref<SVGSVGElement>()
const ringSize = ref(0)

/**
 * 滚动进度的更新路径刻意做到「零布局读取」。
 *
 * 原实现在 scroll 回调里每次都读 documentElement.scrollHeight 和
 * ringEl.getBoundingClientRect().width：这两个读取都会强制浏览器**同步**布局
 * （flush layout），而它们又与随后的 progress 写入交替出现，
 * 等于滚动期间每一帧都强制重排一次——这是滚动掉帧的直接原因。
 *
 * 现在把两者拆出去：可滚动高度与环直径只在尺寸变化时测量（见 measure），
 * scroll 里只读 window.scrollY（滚动期间由合成器线程维护，不触发布局）。
 */
let cachedMax = 0

/** 只在尺寸真的变化时调用；这里读布局是安全的，它已不在滚动路径上 */
function measure() {
	cachedMax = Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
	// 环直径随断点 36/48px 变化，实测一次供 dasharray 计算使用
	ringSize.value = ringEl.value?.getBoundingClientRect().width ?? 0
}

/**
 * rAF 只用来把同一帧内的多次 scroll 事件合并成一次状态更新，
 * 不是用它做节流：rAF 被后台标签页节流时是「延后执行」而非丢弃，
 * 回到前台会把最后一次滚动状态补上，不会出现状态停在旧值的问题
 * （原注释担心的正是这一点）。
 */
let ticking = false
function onScroll() {
	if (ticking)
		return
	ticking = true
	requestAnimationFrame(() => {
		ticking = false
		const y = window.scrollY
		progress.value = cachedMax > 0 ? Math.min(1, Math.max(0, y / cachedMax)) : 0
		visible.value = y > 100
		if (visible.value)
			markScrolling()
	})
}

const percent = computed(() => `${Math.round(progress.value * 100)}%`)

const stroke = computed(() => {
	const circ = Math.PI * ringSize.value - 4 * Math.PI
	if (!(circ > 0))
		return undefined
	return `${Math.max(circ * progress.value, 0.001)} ${circ}`
})

// 滚动中显示百分比数字、静止后换回箭头（交叉淡入），对齐 plume 的交互
const scrolling = ref(false)
let scrollTimer: ReturnType<typeof setTimeout> | undefined

function markScrolling() {
	scrolling.value = true
	clearTimeout(scrollTimer)
	scrollTimer = setTimeout(() => {
		scrolling.value = false
	}, 900)
}

function scrollToTop() {
	const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
	window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' })
}

/** 内容高度变化（图片加载完、评论展开、路由切换）时重算可滚动高度 */
let resizeObserver: ResizeObserver | undefined

onMounted(() => {
	measure()
	window.addEventListener('scroll', onScroll, { passive: true })
	window.addEventListener('resize', measure, { passive: true })
	// 路由切换后正文整体替换，此时内容高度与环尺寸都可能变
	window.addEventListener('wiki:route-change', measure)
	// 页面高度随异步内容变化：观察根元素比在 scroll 里反复读 scrollHeight 划算得多
	if (typeof ResizeObserver !== 'undefined') {
		resizeObserver = new ResizeObserver(measure)
		resizeObserver.observe(document.documentElement)
	}
})

onBeforeUnmount(() => {
	window.removeEventListener('scroll', onScroll)
	window.removeEventListener('resize', measure)
	window.removeEventListener('wiki:route-change', measure)
	resizeObserver?.disconnect()
	clearTimeout(scrollTimer)
})
</script>

<template>
<button
	type="button"
	class="wiki-backtop"
	:class="{ 'wiki-backtop--hidden': !visible, 'wiki-backtop--scrolling': scrolling }"
	aria-label="回到顶部"
	@click="scrollToTop"
>
	<span class="wiki-backtop-percent" :aria-hidden="!scrolling">{{ percent }}</span>
	<svg class="wiki-backtop-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
		<path d="M12 19V5" />
		<path d="M5 12l7-7 7 7" />
	</svg>
	<svg ref="ringEl" class="wiki-backtop-ring" role="progressbar" aria-label="阅读进度" :aria-valuenow="Math.round(progress * 100)" aria-valuemin="0" aria-valuemax="100">
		<circle cx="50%" cy="50%" fill="none" :style="{ strokeDasharray: stroke }" />
	</svg>
</button>
</template>
