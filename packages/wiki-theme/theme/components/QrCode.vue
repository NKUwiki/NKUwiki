<script setup lang="ts">
import { renderSVG } from 'uqr'
import { onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'

const props = withDefaults(defineProps<{ src: string, label?: string, size?: number }>(), { label: '二维码', size: 180 })

/**
 * 二维码 SVG 懒生成：uqr 的 renderSVG 是同步 CPU 计算，兴趣群页一页 22 个、
 * 社团页 14 个，若在组件挂载时全部立即生成，水合期会在主线程阻塞数十毫秒。
 * 用 IntersectionObserver 延迟到元素首次进入视口（或折叠的 <details> 被展开）
 * 才生成，生成一次后不再重复计算。无 IO 的环境（极端老旧浏览器）直接同步生成。
 */
const svg = shallowRef('')
const root = ref<HTMLElement>()

let observer: IntersectionObserver | undefined

function generate() {
	svg.value = renderSVG(props.src, { border: 4, pixelSize: 4 })
}

onMounted(() => {
	if (typeof IntersectionObserver === 'undefined') {
		generate()
		return
	}
	observer = new IntersectionObserver((entries) => {
		if (entries.some(entry => entry.isIntersecting)) {
			generate()
			observer?.disconnect()
			observer = undefined
		}
	})
	observer.observe(root.value!)
})

onBeforeUnmount(() => {
	observer?.disconnect()
	observer = undefined
})
</script>

<template>
<span ref="root" class="wiki-qr" :aria-label="label" :style="{ width: `${size}px` }">
	<span v-if="svg" role="img" :aria-label="label" v-html="svg" />
	<span v-else class="wiki-qr-placeholder" aria-hidden="true" />
</span>
</template>
