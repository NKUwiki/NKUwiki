<script setup lang="ts">
// 原版从 '../constants' 引入；该子路径不在包 exports 里，由 lib/vite/spotlight-patch.ts
// 重定向到真实的 dist/client/constants.mjs——必须与插件是同一个模块，InjectionKey 才能
// 对上 app.provide 注入的选项
import { InjectionKey, SpotlightStyle, SpotlightStylesStorageKey } from '@nolebase/vitepress-plugin-enhanced-readabilities/client/constants'
/**
 * Nolebase 增强可读性 SpotlightHoverBlock 的仓库内修补副本。
 *
 * 来源：@nolebase/vitepress-plugin-enhanced-readabilities@2.21.1
 *       dist/client/components/SpotlightHoverBlock.vue
 * 接入：lib/vite/spotlight-patch.ts 在 Vite 解析期把插件内部的相对引用重定向到本文件，
 *       插件源码与 node_modules 均不改。
 *
 * 与原版的差异（只有两处，其余逐行保持原样）：
 * 1. 目标选择（findElementToBeHighlighted → composables/spotlightTarget.ts 的
 *    resolveSpotlightTarget）：目标恒为正文根的直接子块，列表下探到直接 <li>，
 *    块间空白就近取块。修「一项 ↔ 整块列表」的高度跳变与空白处框冻住。
 * 2. 删除 tagName === 'P' 的逐行特判：原版对段落按鼠标所在行切一块 lineHeight
 *    高的框（逐行跟随鼠标），现在段落取整段 rect，鼠标在段内移动框不动。
 *
 * 刻意不改的：computeBoxStyles 的 `transition: all 0.2s ease`（它是滚动时
 * 框对文字延迟的「遮丑」，裸关会把手感变卡——2026-11-03 已实测踩过）、
 * fixed 定位、useElementByPoint/scroll 的跟随链路。升级该依赖时请 diff 一次。
 */
import {
	useElementBounding,
	useElementByPoint,
	useElementVisibility,
	useEventListener,
	useMouse,
	useMouseInElement,
	useStorage,
} from '@vueuse/core'
import { useRoute } from 'vitepress'

import { inject, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { resolveSpotlightTarget } from '../composables/spotlightTarget'

const props = defineProps<{ enabled: boolean }>()

const options = inject(InjectionKey, {})

const shouldRecalculate = ref(false)
const boxStyles = ref<Record<string, string | number>>({ display: 'none' })
const vpDocElement = ref<HTMLDivElement>()
const highlightedElement = ref<HTMLElement>()

const route = useRoute()
const spotlightStyle = useStorage<SpotlightStyle>(SpotlightStylesStorageKey, options.spotlight?.defaultStyle || SpotlightStyle.Aside)

const { x, y } = useMouse({ type: 'client' })
const { isOutside } = useMouseInElement(vpDocElement)
const { element } = useElementByPoint({ x, y })
const bounding = reactive(useElementBounding(element))
const elementVisibility = useElementVisibility(highlightedElement)

useEventListener('scroll', bounding.update, true)

function computeBoxStyles(bounding: {
	height: number
	left: number
	top: number
	width: number
}) {
	return {
		display: 'block',
		width: `${bounding.width + 8}px`,
		height: `${bounding.height + 8}px`,
		left: `${bounding.left - 4}px`,
		top: `${bounding.top - 4}px`,
		transition: 'all 0.2s ease',
		borderRadius: '8px',
	}
}

function watchHandler() {
	if (!(element.value && !isOutside.value))
		return

	const rootContainer = document.querySelector<HTMLElement>('.VPDoc main .vp-doc > div')
	const el = resolveSpotlightTarget(element.value, rootContainer, y.value) as HTMLElement | null
	highlightedElement.value = el || undefined

	if (highlightedElement.value) {
		const rect = highlightedElement.value.getBoundingClientRect()

		boxStyles.value = computeBoxStyles({
			top: rect.top,
			left: rect.left,
			width: rect.width,
			height: rect.height,
		})
	}
}

onMounted(() => {
	if (!document)
		return
	if (!document.body)
		return

	document.body.style.setProperty('--vp-nolebase-enhanced-readabilities-spotlight-under-bg-color', options?.spotlight?.hoverBlockColor || `rgb(240 197 52 / 10%)`)

	vpDocElement.value = document.querySelector('.VPDoc main .vp-doc') as HTMLDivElement
})

watch(route, async () => {
	// Wait for the next tick to ensure the DOM is updated since the route change
	// may trigger a page reload.
	await nextTick()

	vpDocElement.value = document.querySelector('.VPDoc main .vp-doc') as HTMLDivElement

	shouldRecalculate.value = true
	boxStyles.value = { display: 'none' }

	bounding.update()

	watchHandler()
	shouldRecalculate.value = false
})

watch([x, y], () => {
	if (props.enabled)
		watchHandler()
})

watch(bounding, (val) => {
	if (!props.enabled)
		return

	if (val.width === 0 && val.height === 0)
		boxStyles.value = { display: 'none' }
	else watchHandler()
})

watch(elementVisibility, (val) => {
	if (props.enabled && !val)
		boxStyles.value = { display: 'none' }
})

watch(() => props.enabled, (val) => {
	if (!val)
		boxStyles.value = { display: 'none' }
})
</script>

<template>
<Teleport to="body">
	<div
		v-if="props.enabled && !shouldRecalculate"
		:style="boxStyles"
		aria-hidden="true"
		focusable="false"
		pointer-events-none fixed
		class="VPNolebaseEnhancedReadabilitiesSpotlightHoverBlock"
		:class="[
			spotlightStyle === SpotlightStyle.Under ? 'VPNolebaseEnhancedReadabilitiesSpotlightHoverBlockUnder' : '',
			spotlightStyle === SpotlightStyle.Aside ? 'VPNolebaseEnhancedReadabilitiesSpotlightHoverBlockAside' : '',
		]"
	/>
</Teleport>
</template>

<style less scoped>
:root {
	--vp-nolebase-enhanced-readabilities-spotlight-under-bg-color: var(--nolebase-enhanced-readabilities-spotlight-under-bg-color, rgb(240 197 52 / 10%));
}

.VPNolebaseEnhancedReadabilitiesSpotlightHoverBlock.VPNolebaseEnhancedReadabilitiesSpotlightHoverBlockUnder {
	background-color: var(--vp-nolebase-enhanced-readabilities-spotlight-under-bg-color);
}

.VPNolebaseEnhancedReadabilitiesSpotlightHoverBlock.VPNolebaseEnhancedReadabilitiesSpotlightHoverBlockAside::before {
	content: "";
	display: block;
	position: absolute;
	left: -24px;
	width: 4px;
	height: 100%;
	border-radius: 4px;
	background-color: var(--nolebase-enhanced-readabilities-spotlight-aside-bg-color, var(--vp-c-brand));
}
</style>
