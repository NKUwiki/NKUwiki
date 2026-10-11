<script setup lang="ts">
import { useData } from 'vitepress'
import { computed } from 'vue'

/**
 * 全局水印：视口固定的斜向平铺站名文字，pointer-events 穿透不影响任何交互
 * （交互参考南理工手册站的同款效果）。SVG data-URI 平铺生成，亮暗各一张，
 * 随主题切换；frontmatter 设 watermark: false 可对单页关闭。
 */
const { site, frontmatter } = useData()

// 站点标题形如「NKUwiki · 南开大学校园知识库」，水印只取主名
const text = computed(() => (site.value.title || 'NKUwiki').split('·')[0].trim())

/** 一块 280×200 平铺 tile 内错位放两个 -30° 文字，形成砖砌交错排布 */
function tileUrl(color: string) {
	const font = 'font-family="system-ui, sans-serif" font-size="14"'
	const item = (x: number, y: number) =>
		`<text x="${x}" y="${y}" transform="rotate(-30 ${x} ${y})" text-anchor="middle" ${font} fill="${color}">${text.value}</text>`
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="280" height="200">${item(70, 60)}${item(210, 160)}</svg>`
	return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

const style = computed(() => ({
	'--wiki-watermark-light': tileUrl('rgba(100, 100, 110, 0.08)'),
	'--wiki-watermark-dark': tileUrl('rgba(170, 170, 180, 0.08)'),
}))
</script>

<template>
<div v-if="frontmatter.watermark !== false" class="wiki-watermark" :style="style" aria-hidden="true" />
</template>

<style>
.wiki-watermark {
	position: fixed;
	inset: 0;
	background-image: var(--wiki-watermark-light);
	pointer-events: none;
	user-select: none;
	z-index: 80;
}

.dark .wiki-watermark {
	background-image: var(--wiki-watermark-dark);
}

/* 打印不印水印：费墨且正文已带版权声明 */
@media print {
	.wiki-watermark {
		display: none;
	}
}
</style>
