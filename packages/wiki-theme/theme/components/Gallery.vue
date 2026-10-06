<script setup lang="ts">
import type { VNode } from 'vue'
import type { GalleryImage } from '../../lib/content/gallery'
import { withBase } from 'vitepress'
import { computed, onBeforeUnmount, onMounted, ref, useSlots } from 'vue'
import { layoutGallery } from '../../lib/content/gallery'

/**
 * Gallery 图片画廊：容器内写 Markdown 图片（每张一行，前后留空行），
 * 组件在客户端测出各图原始宽高比后，把它们排成等高行、逐行铺满容器宽度（杂志式网格）。
 * 图片加载完成前先按原始尺寸平铺展示（也是无 JS 时的降级形态），全部就绪后再切换成行布局。
 */
const props = withDefaults(defineProps<{
	/** 每行的目标高度（px），行内图片按各自宽高比缩放到统一行高 */
	rowHeight?: number
	/** 图片间距（px），行内与行间共用 */
	gap?: number
}>(), {
	rowHeight: 220,
	gap: 8,
})

interface SlotImage {
	src: string
	alt?: string
}

/** Markdown 图片在 slot 里是 <img> 元素（常包在 <p> 中），递归收集其 src 与 alt */
function collectSlotImages(vnodes: VNode[], acc: SlotImage[] = []): SlotImage[] {
	for (const vnode of vnodes ?? []) {
		if (vnode.type === 'img') {
			const src = vnode.props?.src
			if (typeof src === 'string' && src)
				acc.push({ src, alt: typeof vnode.props?.alt === 'string' ? vnode.props.alt : undefined })
		}
		else if (Array.isArray(vnode.children)) {
			collectSlotImages(vnode.children as VNode[], acc)
		}
	}
	return acc
}

const images = collectSlotImages(useSlots().default?.() ?? [])
	.map(image => ({ ...image, src: image.src.startsWith('/') ? withBase(image.src) : image.src }))

/** 各图的原始宽高比，0 表示尚未测得 */
const aspects = ref<number[]>(images.map(() => 0))
const settledCount = ref(0)

/** 全部图片测得尺寸（加载完成或失败回退 4:3）后才计算布局，避免中途重排 */
function settle(index: number, aspect: number) {
	if (aspects.value[index])
		return
	aspects.value[index] = aspect
	settledCount.value++
}

const FALLBACK_ASPECT = 4 / 3
function onImageLoad(index: number, event: Event) {
	const img = event.target as HTMLImageElement
	settle(index, img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : FALLBACK_ASPECT)
}
const onImageError = (index: number) => settle(index, FALLBACK_ASPECT)

const container = ref<HTMLElement>()
const containerWidth = ref(0)
let observer: ResizeObserver | undefined

onMounted(() => {
	containerWidth.value = container.value?.clientWidth ?? 0
	// 已缓存的图片不会再触发 load 事件，挂载后补查一遍
	container.value?.querySelectorAll<HTMLImageElement>('img[data-gallery-index]').forEach((img) => {
		const index = Number(img.dataset.galleryIndex)
		if (Number.isInteger(index) && img.complete)
			onImageLoad(index, { target: img } as unknown as Event)
	})
	observer = new ResizeObserver(([entry]) => {
		if (entry)
			containerWidth.value = entry.contentRect.width
	})
	if (container.value)
		observer.observe(container.value)
})
onBeforeUnmount(() => observer?.disconnect())

const allSettled = computed(() => images.length > 0 && settledCount.value >= images.length)
const rows = computed(() => {
	if (!allSettled.value || !containerWidth.value)
		return []
	const items: GalleryImage[] = images.map((image, index) => ({ ...image, aspect: aspects.value[index] }))
	return layoutGallery(items, containerWidth.value, props.rowHeight, props.gap)
})
</script>

<template>
<div
	ref="container"
	class="wiki-gallery"
	:class="rows.length ? 'wiki-gallery--rows' : 'wiki-gallery--raw'"
	:style="{ '--gallery-gap': `${gap}px` }"
>
	<template v-if="rows.length">
		<div v-for="(row, rowIndex) in rows" :key="rowIndex" class="wiki-gallery-row">
			<img
				v-for="(placement, index) in row.images"
				:key="index"
				:src="placement.image.src"
				:alt="placement.image.alt ?? ''"
				:style="{ width: `${placement.width}px`, height: `${placement.height}px` }"
				loading="lazy"
				decoding="async"
			>
		</div>
	</template>
	<template v-else>
		<img
			v-for="(image, index) in images"
			:key="image.src"
			:src="image.src"
			:alt="image.alt ?? ''"
			:data-gallery-index="index"
			@load="onImageLoad(index, $event)"
			@error="onImageError(index)"
		>
	</template>
</div>
</template>
