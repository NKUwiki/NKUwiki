<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { announcement } from '../../lib/data/announcement'

/**
 * 全站公告横条：固定在视口最顶部，内容与配色来自编译期注入的公告配置
 * （站点侧 docs/.vitepress/data/announcement.ts），message 为空字符串时不渲染。
 *
 * 下方区域通过 VitePress 内置的 --vp-layout-top-height 约定让位
 * （VPNav / VPSidebar / VPLocalNav / 首页 Hero 均消费该变量）：
 * CSS 先给 40px 兜底值保证首屏不遮挡，挂载后实测高度修正换行时的偏差。
 */
const el = ref<HTMLElement>()
let observer: ResizeObserver | undefined

function syncHeight() {
	const height = el.value?.offsetHeight
	if (height)
		document.documentElement.style.setProperty('--vp-layout-top-height', `${height}px`)
}

onMounted(() => {
	if (!el.value)
		return
	syncHeight()
	observer = new ResizeObserver(syncHeight)
	observer.observe(el.value)
})
onBeforeUnmount(() => {
	observer?.disconnect()
	document.documentElement.style.removeProperty('--vp-layout-top-height')
})
</script>

<template>
<div
	v-if="announcement?.message"
	ref="el"
	class="wiki-announcement"
	role="note"
	:style="{
		backgroundColor: announcement.background || 'var(--vp-c-brand-3)',
		color: announcement.color || '#fff',
	}"
>
	<p>{{ announcement.message }}</p>
</div>
</template>
