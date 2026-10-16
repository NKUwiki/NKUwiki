<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { createModalFocus } from '../composables/modalA11y'

/**
 * 图片预览（lightbox）：点击正文图片全屏放大查看。
 * 交互参考 QUT-WiKi 的 MyLayout.vue 图片查看器——
 * 同页多图时左右按钮/方向键轮播，滚轮缩放（以鼠标为中心）、拖拽平移、
 * 双击在 1x/2.5x 间切换，Esc 关闭，显示 alt 题注与「当前/总数」计数。
 * 全站唯一实例，随 WikiLayout 挂载；文档级 click 委托负责唤起。
 */
const visible = ref(false)
const src = ref('')
const alt = ref('')
const sources = ref<HTMLImageElement[]>([])
const index = ref(0)
const scale = ref(1)
const tx = ref(0)
const ty = ref(0)
const dragging = ref(false)
const lastX = ref(0)
const lastY = ref(0)
const anchorX = ref(0)
const anchorY = ref(0)

const hasGallery = computed(() => sources.value.length > 1)

/** 弹层的焦点管理：打开时移入、Tab 循环、关闭时还原到触发图片 */
const modalFocus = createModalFocus()
const rootEl = ref<HTMLElement>()
watch(visible, (open) => {
	if (open)
		modalFocus.onOpen(rootEl.value)
	else
		modalFocus.onClose()
})

/** 可预览的正文图片范围与排除项（头像/卡片图标/行内绘图等非内容图不参与） */
const SCOPE = '.vp-doc'
const EXCLUDE = 'a, .article-author-avatar, .wiki-repo-card-avatar, .wiki-annotation, .VPLocalSearchBox, .twikoo'

function updateBodyOverflow() {
	document.body.style.overflow = visible.value ? 'hidden' : ''
}

function resetTransform() {
	scale.value = 1
	tx.value = 0
	ty.value = 0
}

function open(element: HTMLImageElement) {
	const scope = element.closest(SCOPE) ?? document
	const nodes = Array.from(scope.querySelectorAll<HTMLImageElement>(`${SCOPE} img`))
		.filter(img => !img.closest(EXCLUDE))
	sources.value = nodes
	const at = nodes.indexOf(element)
	index.value = at >= 0 ? at : 0
	apply(at >= 0 ? element : nodes[0])
	visible.value = true
	updateBodyOverflow()
}

function apply(element: HTMLImageElement | undefined) {
	if (!element)
		return
	src.value = element.currentSrc || element.src
	alt.value = element.alt || ''
	resetTransform()
}

function go(step: 1 | -1) {
	if (!hasGallery.value)
		return
	const len = sources.value.length
	index.value = (index.value + step + len) % len
	apply(sources.value[index.value])
}

function close() {
	visible.value = false
	// 解锁滚动交给离场动画结束（Transition 的 after-leave）：
	// 这里提前恢复的话，滚动条会立刻出现、页面宽度随之变化，
	// 内容横向抖动正好落在遮罩还在淡出的那一小段时间里。
}

function onWheel(e: WheelEvent) {
	e.preventDefault()
	// 以鼠标位置为缩放中心：先按比例放大位移向量，再补上指针相对中心的偏移
	const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
	const ox = e.clientX - rect.left - rect.width / 2
	const oy = e.clientY - rect.top - rect.height / 2
	const delta = e.deltaY < 0 ? 0.15 : -0.15
	const next = Math.min(Math.max(scale.value + delta, 0.3), 6)
	const ratio = next / scale.value
	tx.value = tx.value * ratio - ox * (ratio - 1)
	ty.value = ty.value * ratio - oy * (ratio - 1)
	scale.value = next
}

function onDblClick(e: MouseEvent) {
	e.preventDefault()
	if (scale.value > 1) {
		resetTransform()
	}
	else {
		scale.value = 2.5
	}
}

function onPointerDown(e: PointerEvent) {
	if (e.button !== 0)
		return
	dragging.value = true
	lastX.value = e.clientX
	lastY.value = e.clientY
	anchorX.value = tx.value
	anchorY.value = ty.value
	;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
}

function onPointerMove(e: PointerEvent) {
	if (!dragging.value)
		return
	tx.value = anchorX.value + (e.clientX - lastX.value)
	ty.value = anchorY.value + (e.clientY - lastY.value)
}

function onPointerUp(e: PointerEvent) {
	const dx = Math.abs(e.clientX - lastX.value)
	const dy = Math.abs(e.clientY - lastY.value)
	// 未缩放时轻点（几乎没拖动）即关闭
	if (scale.value <= 1 && dx < 3 && dy < 3)
		close()
	dragging.value = false
}

function onKeydown(e: KeyboardEvent) {
	if (!visible.value)
		return
	if (e.key === 'Escape')
		close()
	else if (e.key === 'Tab')
		modalFocus.trap(e, rootEl.value)
	else if (e.key === 'ArrowLeft')
		go(-1)
	else if (e.key === 'ArrowRight')
		go(1)
}

function onDocumentClick(e: MouseEvent) {
	const target = e.target
	if (target instanceof HTMLImageElement && target.closest(SCOPE) && !target.closest(EXCLUDE))
		open(target)
}

onMounted(() => {
	document.addEventListener('click', onDocumentClick)
	document.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
	document.removeEventListener('click', onDocumentClick)
	document.removeEventListener('keydown', onKeydown)
	document.body.style.overflow = ''
	modalFocus.restoreIfOpen()
})
</script>

<template>
<Teleport to="body">
	<!-- Transition 负责开合动画：遮罩淡入淡出，舞台整体从 0.94 放大到位。
	缩放放在 .wiki-imgviewer-stage 上而不是 img 上——
	img 的 transform 被拖拽/缩放逻辑用 inline style 接管着，动它会打架。 -->
	<Transition name="wiki-imgviewer" @after-leave="updateBodyOverflow">
		<div v-if="visible" ref="rootEl" class="wiki-imgviewer" role="dialog" aria-modal="true" aria-label="图片预览" @click="close">
			<button class="wiki-imgviewer-close" aria-label="关闭预览" @click="close">
				&times;
			</button>
			<button
				v-if="hasGallery"
				class="wiki-imgviewer-nav wiki-imgviewer-prev"
				type="button"
				aria-label="上一张"
				@click.stop="go(-1)"
			>
				&#10094;
			</button>
			<button
				v-if="hasGallery"
				class="wiki-imgviewer-nav wiki-imgviewer-next"
				type="button"
				aria-label="下一张"
				@click.stop="go(1)"
			>
				&#10095;
			</button>
			<div
				class="wiki-imgviewer-stage"
				@click.stop
				@wheel="onWheel"
				@dblclick="onDblClick"
				@pointerdown="onPointerDown"
				@pointermove="onPointerMove"
				@pointerup="onPointerUp"
			>
				<img
					:src="src"
					class="wiki-imgviewer-img"
					:style="{
						transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
						cursor: scale > 1 ? (dragging ? 'grabbing' : 'grab') : 'zoom-in',
					}"
					draggable="false"
				>
			</div>
			<p v-if="alt" class="wiki-imgviewer-caption">
				{{ alt }}
			</p>
			<span v-if="hasGallery" class="wiki-imgviewer-counter">{{ index + 1 }} / {{ sources.length }}</span>
		</div>
	</Transition>
</Teleport>
</template>

<style>
/* 正文内容图提示可点击（排除头像等非内容图） */
.vp-doc img {
	cursor: zoom-in;
}

.vp-doc :is(.article-author-avatar, .wiki-repo-card-avatar) img {
	cursor: auto;
}

.wiki-imgviewer {
	display: flex;
	align-items: center;
	justify-content: center;
	position: fixed;
	inset: 0;
	background: rgb(0 0 0 / 85%);
	z-index: 999;
}

.wiki-imgviewer-close {
	display: flex;
	align-items: center;
	justify-content: center;
	position: absolute;
	top: 16px;
	right: 20px;
	width: 40px;
	height: 40px;
	border: none;
	border-radius: 50%;
	background: rgb(255 255 255 / 15%);
	font-size: 24px;
	line-height: 1;
	color: #FFF;
	cursor: pointer;
	z-index: 2;
}

.wiki-imgviewer-close:hover {
	background: rgb(255 255 255 / 30%);
}

.wiki-imgviewer-nav {
	display: flex;
	align-items: center;
	justify-content: center;
	position: absolute;
	top: 50%;
	width: 48px;
	height: 48px;
	border: 1px solid var(--vp-c-brand-1);
	border-radius: 50%;
	box-shadow: 0 2px 8px rgb(0 0 0 / 25%);
	background: rgb(255 255 255 / 88%);
	font-size: 20px;
	line-height: 1;
	color: var(--vp-c-brand-1);
	transform: translateY(-50%);
	transition: background var(--wiki-duration) var(--wiki-ease-out), color var(--wiki-duration) var(--wiki-ease-out);
	cursor: pointer;
	z-index: 2;
}

.wiki-imgviewer-nav:hover {
	background: var(--vp-c-brand-1);
	color: #FFF;
}

.wiki-imgviewer-prev {
	left: 20px;
}

.wiki-imgviewer-next {
	right: 20px;
}

.wiki-imgviewer-counter {
	position: absolute;
	top: 28px;
	left: 50%;
	font-size: 13px;
	color: rgb(255 255 255 / 60%);
	transform: translateX(-50%);
	pointer-events: none;
}

.wiki-imgviewer-stage {
	display: flex;
	align-items: center;
	justify-content: center;
	overflow: hidden;
	width: 100%;
	height: 100%;
}

.wiki-imgviewer-img {
	max-width: 90vw;
	max-height: 90vh;
	transition: transform 0.1s ease-out;
	object-fit: contain;
	user-select: none;
	-webkit-user-drag: none;
}

.wiki-imgviewer-caption {
	position: absolute;
	bottom: 24px;
	left: 50%;
	max-width: 80vw;
	margin: 0;
	font-size: 13px;
	text-align: center;
	color: rgb(255 255 255 / 60%);
	transform: translateX(-50%);
	pointer-events: none;
}

/* 开合动画（Vue Transition 的类）：遮罩淡入淡出，舞台从略小放大到位（关闭时反向收回）。
   时长与曲线走令牌，reduced-motion 下为 0s 即时完成。 */
.wiki-imgviewer-enter-active,
.wiki-imgviewer-leave-active {
	transition: opacity var(--wiki-duration) var(--wiki-ease-out);
}

.wiki-imgviewer-enter-active .wiki-imgviewer-stage,
.wiki-imgviewer-leave-active .wiki-imgviewer-stage {
	transition: transform var(--wiki-duration) var(--wiki-ease-out);
}

.wiki-imgviewer-enter-from,
.wiki-imgviewer-leave-to {
	opacity: 0;
}

.wiki-imgviewer-enter-from .wiki-imgviewer-stage,
.wiki-imgviewer-leave-to .wiki-imgviewer-stage {
	transform: scale(0.94);
}

@media (prefers-reduced-motion: reduce) {
	.wiki-imgviewer-img {
		transition: none;
	}
}
</style>
