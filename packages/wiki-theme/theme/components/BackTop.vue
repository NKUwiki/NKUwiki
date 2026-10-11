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

// 滚动处理只读几个布局值，开销极小，直接同步执行——
// 不走 requestAnimationFrame：后台标签页会节流 rAF，导致状态停在旧值
function update() {
	const max = document.documentElement.scrollHeight - window.innerHeight
	progress.value = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0
	visible.value = window.scrollY > 100
	// 环直径随断点 36/48px 变化，实测一次供 dasharray 计算使用
	ringSize.value = ringEl.value?.getBoundingClientRect().width ?? 0
	if (visible.value)
		markScrolling()
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

onMounted(() => {
	update()
	window.addEventListener('scroll', update, { passive: true })
	window.addEventListener('resize', update, { passive: true })
})

onBeforeUnmount(() => {
	window.removeEventListener('scroll', update)
	window.removeEventListener('resize', update)
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
