<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

/**
 * 右下角悬浮球：环形进度展示整页阅读进度，点击平滑回到顶部。
 * 形态对齐 VitePress 新版内置的 vp-back-to-top-button（本项目锁定的
 * alpha.20 尚无该功能，故自研）：滚动超过一屏后才出现，避免页首冗余。
 */
const RING = 2 * Math.PI * 24

const progress = ref(0)
const visible = ref(false)

// 滚动处理只读三个布局值，开销极小，直接同步执行——
// 不走 requestAnimationFrame：后台标签页会节流 rAF，导致状态停在旧值
function update() {
	const max = document.documentElement.scrollHeight - window.innerHeight
	progress.value = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0
	visible.value = window.scrollY > 100
}

const percent = computed(() => Math.round(progress.value * 100))
const dashOffset = computed(() => RING * (1 - progress.value))

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
})
</script>

<template>
<button
	type="button"
	class="wiki-backtop"
	:class="{ 'wiki-backtop--hidden': !visible }"
	aria-label="回到顶部"
	@click="scrollToTop"
>
	<span
		class="wiki-backtop-ring"
		role="progressbar"
		aria-label="阅读进度"
		:aria-valuenow="percent"
		aria-valuemin="0"
		aria-valuemax="100"
	>
		<svg viewBox="0 0 52 52" aria-hidden="true">
			<circle
				cx="26"
				cy="26"
				r="24"
				fill="none"
				stroke="currentColor"
				stroke-width="4"
				stroke-linecap="round"
				:stroke-dasharray="RING"
				:stroke-dashoffset="dashOffset"
			/>
		</svg>
	</span>
	<svg class="wiki-backtop-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
		<path d="M12 19V5" />
		<path d="M5 12l7-7 7 7" />
	</svg>
</button>
</template>
