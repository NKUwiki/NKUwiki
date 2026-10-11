<script setup lang="ts">
import { ref } from 'vue'

/**
 * 轻量轮播：纯 CSS scroll-snap + 原生滚动，无第三方依赖。
 * markdown 里把若干图片（或任意块）包进 <WikiSwiper> ... </WikiSwiper> 即成横滑轮播，
 * 左右按钮按容器宽度翻页，移动端手势滑动天然可用。
 */
const trackEl = ref<HTMLElement>()

function scrollByPage(direction: 1 | -1) {
	const track = trackEl.value
	if (!track)
		return
	track.scrollBy({ left: direction * track.clientWidth, behavior: 'smooth' })
}
</script>

<template>
<div class="wiki-swiper">
	<div ref="trackEl" class="wiki-swiper-track">
		<slot />
	</div>
	<button class="wiki-swiper-btn prev" type="button" aria-label="上一张" @click="scrollByPage(-1)">
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
	</button>
	<button class="wiki-swiper-btn next" type="button" aria-label="下一张" @click="scrollByPage(1)">
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6" /></svg>
	</button>
</div>
</template>

<style scoped>
.wiki-swiper {
	position: relative;
	margin: 1rem 0;
}

.wiki-swiper-track {
	display: flex;
	overflow-x: auto;
	border-radius: 10px;
	scroll-snap-type: x mandatory;
	scrollbar-width: none;
}

.wiki-swiper-track::-webkit-scrollbar {
	display: none;
}

.wiki-swiper-track :slotted(*) {
	flex: none;
	overflow: hidden;
	width: 100%;
	margin: 0;
	scroll-snap-align: center;
}

.wiki-swiper-track :slotted(img) {
	width: 100%;
	height: auto;
	object-fit: contain;
}

.wiki-swiper-btn {
	display: flex;
	align-items: center;
	justify-content: center;
	position: absolute;
	opacity: 0;
	top: 50%;
	width: 36px;
	height: 36px;
	padding: 0;
	border: none;
	border-radius: 50%;
	box-shadow: var(--vp-shadow-1);
	background: color-mix(in srgb, var(--vp-c-bg) 72%, transparent);
	backdrop-filter: blur(4px);
	color: var(--vp-c-text-1);
	transform: translateY(-50%);
	transition: opacity 0.2s;
	cursor: pointer;
}

.wiki-swiper:hover .wiki-swiper-btn,
.wiki-swiper-btn:focus-visible {
	opacity: 1;
}

.wiki-swiper-btn.prev {
	left: 0.5rem;
}

.wiki-swiper-btn.next {
	right: 0.5rem;
}

.wiki-swiper-btn svg {
	width: 18px;
	height: 18px;
}

@media (hover: none) {
	.wiki-swiper-btn {
		opacity: 1;
	}
}
</style>
