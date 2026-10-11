<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { announcement } from '../../lib/data/announcement'

/**
 * 全站公告横条：固定在视口最顶部，内容与配色来自编译期注入的公告配置
 * （站点侧 docs/.vitepress/data/announcement.ts），message 为空字符串时不渲染。
 *
 * 关闭记忆（id + lifetime）：用户关闭后把公告 id 记入 storage，
 * 同 id 不再弹出；发布新公告换一个 id 即可重新展示（message 变化时缺省 id 随之变化）。
 * lifetime: 'session' 本次会话内不再显示；'once' 永久不再显示；不填则不记忆。
 *
 * 下方区域通过 VitePress 内置的 --vp-layout-top-height 约定让位
 * （VPNav / VPSidebar / VPLocalNav / 首页 Hero 均消费该变量）：
 * CSS 先给 40px 兜底值保证首屏不遮挡，挂载后实测高度修正换行时的偏差。
 */
const el = ref<HTMLElement>()
let observer: ResizeObserver | undefined

const STORAGE_KEY = 'wiki:announcement-dismissed'
/** dismissed 的公告 id 列表：session 会话级、once 持久级 */
const dismissed = ref<Set<string>>(new Set())

const config = announcement
const fingerprint = config?.id || config?.message || ''
const visible = ref(false)

function readDismissed(storage: Storage): string[] {
	try {
		const parsed: unknown = JSON.parse(storage.getItem(STORAGE_KEY) ?? '[]')
		return Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string') : []
	}
	catch {
		return []
	}
}

function dismiss() {
	visible.value = false
	if (!fingerprint || !config?.lifetime)
		return
	const dismissedIds = [...dismissed.value, fingerprint]
	dismissed.value = new Set(dismissedIds)
	try {
		;(config.lifetime === 'once' ? localStorage : sessionStorage).setItem(STORAGE_KEY, JSON.stringify(dismissedIds))
	}
	catch {}
}

function syncHeight() {
	const height = el.value?.offsetHeight
	if (height)
		document.documentElement.style.setProperty('--vp-layout-top-height', `${height}px`)
	else
		document.documentElement.style.removeProperty('--vp-layout-top-height')
}

onMounted(() => {
	// 关闭记忆判定：命中已关闭记录则不渲染（高度让位也要同步清掉）
	if (fingerprint && config?.lifetime) {
		try {
			dismissed.value = new Set(readDismissed(config.lifetime === 'once' ? localStorage : sessionStorage))
		}
		catch {}
	}
	visible.value = !!config?.message && !(fingerprint && dismissed.value.has(fingerprint))
	if (!visible.value)
		return
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
	v-if="visible && announcement?.message"
	ref="el"
	class="wiki-announcement"
	role="note"
	:style="{
		backgroundColor: announcement.background || 'var(--vp-c-brand-3)',
		color: announcement.color || '#fff',
	}"
>
	<p>{{ announcement.message }}</p>
	<button v-if="announcement.lifetime" class="wiki-announcement-close" aria-label="关闭公告" @click="dismiss()">
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
			<path d="M18 6L6 18" />
			<path d="M6 6l12 12" />
		</svg>
	</button>
</div>
</template>
