<script setup lang="ts">
import { useData } from 'vitepress'
import { computed } from 'vue'
import { siteUrl, watermarkSubtitle } from '../../lib/data/site'

/**
 * 全局水印：视口固定的斜向平铺站名文字，pointer-events 穿透不影响任何交互
 * （交互参考南理工手册站的同款效果）。SVG data-URI 平铺生成，亮暗各一张，
 * 随主题切换；frontmatter 设 watermark: false 可对单页关闭。
 */
const { site, frontmatter } = useData()

/**
 * 水印文案分三段，各有权威来源，不在这里写死：
 * - 站名取 site.title（形如「NKUwiki · 南开大学校园知识库」时只取主名）；
 * - 域名由 siteUrl 派生——换域名时不必记得改水印；
 * - 副标题来自站点常量（见 lib/data/site.ts），未配置时自动省略这一段。
 *
 * 三段不做拼接，而是在平铺格点上按周期轮流出现（见 tileUrl），
 * 让整片水印呈现「NKUwiki / freshnkuer.wiki / 南开校园知识库」交错的效果。
 */
const texts = computed(() => [
	(site.value.title || 'NKUwiki').split('·')[0]!.trim(),
	siteUrl.replace(/^https?:\/\//, '').replace(/\/+$/, ''),
	watermarkSubtitle.trim(),
].filter(Boolean))

/** SVG 是 XML，& 与尖括号必须转义，否则整张图解析失败、水印直接不显示 */
function escapeXml(value: string) {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
}

/** 格点间距（px）与每块 tile 覆盖的格点数 */
const STEP_X = 260
const STEP_Y = 180
const COLS = 3
const ROWS = 3

/**
 * 平铺 tile：3×3 个格点上各放一条 -30° 水印，文字按 (列 + 行) % 3 取用——
 * 于是横看、竖看相邻格点的文字都不同，同一种文字沿斜向对角线排开，
 * 整片水印就是三种文案交错出现的砖砌效果。
 *
 * 格点间距要大于文字自身尺寸：现行字号 20px 下最长的「freshnkuer.wiki」
 * 约 150px 宽（旋转后包围盒约 140×92），取 260×180 仍留有约 120×88px 空隙。
 * 间距若小于文字宽度，相邻水印会首尾相接、被看成一条连续的斜线；
 * 想继续加大字号时（22px 尚可，24px 起建议同步放大 STEP_X / STEP_Y）。
 */
function tileUrl(color: string) {
	const font = 'font-family="system-ui, sans-serif" font-size="20"'
	const items: string[] = []
	for (let row = 0; row < ROWS; row++) {
		for (let col = 0; col < COLS; col++) {
			// 半格起排，四周留出与格距相当的边距，文字不会被 tile 边界裁掉
			const x = STEP_X / 2 + col * STEP_X
			const y = STEP_Y / 2 + row * STEP_Y
			const label = texts.value[(col + row) % texts.value.length] ?? ''
			items.push(`<text x="${x}" y="${y}" transform="rotate(-30 ${x} ${y})" text-anchor="middle" ${font} fill="${color}">${escapeXml(label)}</text>`)
		}
	}
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${STEP_X * COLS}" height="${STEP_Y * ROWS}">${items.join('')}</svg>`
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
