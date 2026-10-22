<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

/**
 * 右下角悬浮球：环形进度展示**正文**阅读进度，点击平滑回到顶部。
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

/* ==================== 进度边界：正文而非整页 ==================== */

/**
 * 正文容器：文章页取 VPDoc 里 Content 组件的根节点，wide 布局页取
 * .wiki-article-content（两者都带 vp-doc 类）。
 *
 * 选择器必须卡到「.main 的直接子级」：评论区（TwikooComments）和文件历史
 * （GitHistory）各自也包了一层 .vp-doc 借默认样式，正文流里还嵌着
 * ArticleMeta 的 .article-meta.vp-doc，直接 querySelector('.vp-doc')
 * 虽说文档序上先命中正文根节点，但那只是巧合，不是保证。
 *
 * 找不到正文容器的页面（首页、layout: page 的地图页、404）退回整页进度。
 */
function findArticle(): HTMLElement | null {
	return document.querySelector<HTMLElement>('.VPDoc .main > .vp-doc, .wiki-article-content')
}

/**
 * 进度的两个边界（文档绝对坐标，与当前滚动位置无关）：
 * - articleTop：进度 0 的位置 —— 正文顶部贴住视口顶部
 * - 进度 1 的位置：正文底部贴住视口底部，故滚动区间 = 正文高度 - 一屏高度
 *   （每帧用实时 innerHeight 现算，见 computeProgress）
 *
 * 原来按 documentElement.scrollHeight 算整页进度，页脚导航、评论区、
 * 文件历史这些正文之外的长度全进了分母：一篇 6000px 的正文配上 3000px
 * 的评论，读完正文时环才走到 2/3，「读完了」这件事在球上没有感知。
 * 换成以正文为界后，起点与终点都只由正文自己决定，评论区再长也不稀释进度。
 */
let pageMax = 0
let articleTop = 0
let articleHeight = 0
let hasArticle = false

/** 只在尺寸真的变化时调用；这里读布局是安全的，它已不在滚动路径上 */
function measure() {
	const viewH = window.innerHeight
	pageMax = Math.max(0, document.documentElement.scrollHeight - viewH)
	const article = findArticle()
	const rect = article?.getBoundingClientRect()
	// 高度为 0（正文还没渲染出来）时按「没有正文」处理：否则区间为负、
	// 进度恒 1，转场期间会看到一环假满进度
	if (article && rect && rect.height > 0) {
		hasArticle = true
		// rect.top 相对视口，加 scrollY 换成文档绝对坐标。跨页转场只有
		// 4px 位移，测量瞬时的偏差对数千像素的区间没有可感知影响
		articleTop = rect.top + window.scrollY
		articleHeight = rect.height
	}
	else {
		hasArticle = false
	}
	// 边界换了，当前滚动位置对应的进度也得跟着换（见 update 的说明）
	update(false)
}

function clamp01(v: number): number {
	return v < 0 ? 0 : v > 1 ? 1 : v
}

/**
 * 给定滚动位置算进度（0~1）：
 * - 有正文：正文顶部贴住视口顶部为 0，正文底部贴住视口底部为 1。
 *   正文不足一屏时区间 ≤ 0，改按「正文露出视口的比例」计（刚露头 0、
 *   整篇可见 1），读完保持 1
 * - 无正文（首页/地图页/404）：退回整页进度
 *
 * innerHeight 每帧现读而不是缓存：安卓机上地址栏收起会改变视口高度
 * 且不一定伴随 resize 事件，缓存值会让区间短暂失真。它只是视口属性，
 * 不触发同步布局，不在「零布局读取」的约束里。
 */
function computeProgress(y: number): number {
	if (!hasArticle)
		return pageMax > 0 ? clamp01(y / pageMax) : 0
	const viewH = window.innerHeight
	const range = articleHeight - viewH
	if (range <= 0)
		return clamp01((y + viewH - articleTop) / Math.max(articleHeight, 1))
	return clamp01((y - articleTop) / range)
}

/**
 * 按当前滚动位置刷新环与显隐。
 *
 * measure 之后也必须调它：进度原先只在 scroll 事件里重算，而路由切换后
 * VitePress 把页面停在上方、视口拉高后页面可能再也滚不动——这两种情况
 * 一个 scroll 事件都不会来，环会停在初值 0（短正文页整篇摆在眼前却显示
 * 0%，就是踩的这个坑）。
 *
 * withFeedback 只在真滚动时给：它会让环心亮 900ms 百分比，resize、
 * 路由切换、图片加载完这些场合不该闪一下数字。
 */
function update(withFeedback: boolean) {
	const y = window.scrollY
	progress.value = computeProgress(y)
	// 页面不可滚动时一律不显示（对齐 plume 的 show 判定）：
	// 否则短页上也会挂一个恒定 0% 的球
	visible.value = pageMax > 0 && y > 100
	if (withFeedback && visible.value)
		markScrolling()
}

/**
 * 滚动进度的更新路径刻意做到「零布局读取」。
 *
 * 原实现在 scroll 回调里每次都读 documentElement.scrollHeight：这个读取会强制
 * 浏览器**同步**布局（flush layout），又与随后的 progress 写入交替出现，
 * 等于滚动期间每一帧都强制重排一次——这是滚动掉帧的直接原因。
 * （更早的实现还在这里读环的 getBoundingClientRect 算周长，已随 dasharray
 * 改走 CSS 周长常量一并去掉，见上的说明。）
 *
 * 现在把测量拆出去：正文的位置与高度只在尺寸变化时测量（见 measure），
 * scroll 里只读 window.scrollY（滚动期间由合成器线程维护，不触发布局）。
 */
/**
 * rAF 只用来把同一帧内的多次 scroll 事件合并成一次状态更新，
 * 不是用它做节流：rAF 被后台标签页节流时是「延后执行」而非丢弃，
 * 回到前台会把最后一次滚动状态补上，不会出现状态停在旧值的问题。
 */
let ticking = false
function onScroll() {
	if (ticking)
		return
	ticking = true
	requestAnimationFrame(() => {
		ticking = false
		update(true)
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

/**
 * 路由切换后重算边界。时机上必须延后一帧：VitePress 的
 * onAfterRouteChange 是在 route.component 赋值后立即回调的（见
 * vitepress router.ts 的 loadPage），新正文要等下一个微任务的渲染
 * 才进 DOM，此刻去查只能查到旧页的容器。rAF 晚于 Vue 的微任务队列，
 * 拿到的必定是新正文。
 */
function onRouteChange() {
	requestAnimationFrame(measure)
}

onMounted(() => {
	measure()
	window.addEventListener('scroll', onScroll, { passive: true })
	window.addEventListener('resize', measure, { passive: true })
	// 路由切换后正文整体替换：旧的 articleTop / articleHeight 全部作废，
	// 必须重新查询容器并测量（等新正文渲染完，见 onRouteChange）
	window.addEventListener('wiki:route-change', onRouteChange)
	// 页面高度随异步内容变化：观察根元素比在 scroll 里反复读 scrollHeight 划算得多。
	// 正文里的图片陆续加载也会走这里，测量结果随最新布局更新
	if (typeof ResizeObserver !== 'undefined') {
		resizeObserver = new ResizeObserver(measure)
		resizeObserver.observe(document.documentElement)
	}
})

onBeforeUnmount(() => {
	window.removeEventListener('scroll', onScroll)
	window.removeEventListener('resize', measure)
	window.removeEventListener('wiki:route-change', onRouteChange)
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
