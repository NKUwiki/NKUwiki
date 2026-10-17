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

/**
 * 进度环 dasharray：周长由 CSS 按断点给出（--wiki-backtop-circ，与半径成对
 * 定义在 base.css，对齐 plume 的 16px/22px），这里只算「周长 × 进度」。
 *
 * 实测过的两个坑（2026-10 修复）：
 * 1. 按 getBoundingClientRect 实测直径算周长：挂载时球还处在 --hidden 的
 *    scale(0.8) 下，测得 38.4 而非 48，周长少算 20%，环永远闭不拢；性能
 *    重构把测量挪出 scroll 路径后该值不再重测，缺口成了常态。
 * 2. pathLength="100" 归一：Chromium/Edge 对基本图形（circle）不应用
 *    pathLength，dasharray 仍按真实路径长度解释，环照样闭不拢。
 *
 * 现在两边都不碰：CSS 侧半径与周长常量成对声明，JS 侧零测量、零布局读取，
 * 也没有负 dasharray（进度已钳到 ≥ 0），不存在「非法值退化成整环」的突跳。
 */
const stroke = computed(() => `calc(var(--wiki-backtop-circ, 138.23) * ${Math.max(progress.value, 0)}) var(--wiki-backtop-circ, 138.23)`)

/**
 * 滚动进度的更新路径刻意做到「零布局读取」。
 *
 * 原实现在 scroll 回调里每次都读 documentElement.scrollHeight：这个读取会强制
 * 浏览器**同步**布局（flush layout），又与随后的 progress 写入交替出现，
 * 等于滚动期间每一帧都强制重排一次——这是滚动掉帧的直接原因。
 * （更早的实现还在这里读环的 getBoundingClientRect 算周长，已随 dasharray
 * 改走 CSS 周长常量一并去掉，见上的说明。）
 *
 * 现在把测量拆出去：可滚动高度只在尺寸变化时测量（见 measure），
 * scroll 里只读 window.scrollY（滚动期间由合成器线程维护，不触发布局）。
 */
let cachedMax = 0

/** 只在尺寸真的变化时调用；这里读布局是安全的，它已不在滚动路径上 */
function measure() {
	cachedMax = Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
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
		// 页面不可滚动时一律不显示（对齐 plume 的 show 判定）：
		// 否则短页上也会挂一个恒定 0% 的球
		visible.value = cachedMax > 0 && y > 100
		if (visible.value)
			markScrolling()
	})
}

const percent = computed(() => `${Math.round(progress.value * 100)}%`)

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
	// 路由切换后正文整体替换，内容高度会变（环的 dasharray 走 pathLength 归一，与尺寸无关）
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
	<svg class="wiki-backtop-ring" role="progressbar" aria-label="阅读进度" :aria-valuenow="Math.round(progress * 100)" aria-valuemin="0" aria-valuemax="100">
		<circle cx="50%" cy="50%" fill="none" :style="{ strokeDasharray: stroke }" />
	</svg>
</button>
</template>
