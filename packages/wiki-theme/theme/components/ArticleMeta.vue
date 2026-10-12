<script setup lang="ts">
import type { Ref } from 'vue'
import bookIcon from '@iconify-icons/ri/book-open-line'
import calendarIcon from '@iconify-icons/ri/calendar-line'
import penIcon from '@iconify-icons/ri/quill-pen-line'
import refreshIcon from '@iconify-icons/ri/refresh-line'
import { Icon } from '@iconify/vue'
import { useData, withBase } from 'vitepress'
import { computed, onMounted, ref } from 'vue'
import { tagChips } from '../composables/chips'
import WikiChips from './WikiChips.vue'

const { frontmatter: fm } = useData()
// 字数与阅读时间：构建期在 catalog.ts 里算好，随页面数据下发，避免运行时再扫一遍正文
const wordCount = computed(() => typeof fm.value.wordCount === 'number' ? fm.value.wordCount : 0)
const readingMinutes = computed(() => typeof fm.value.readingMinutes === 'number' ? fm.value.readingMinutes : 0)
/** 日期格式化：YAML 纯日期会变成 UTC 零点（SSR 后为 ISO 串），按字面日期取用；只有非零时刻才追加时间 */
function formatDate(raw: unknown) {
	const pad = (value: number) => String(value).padStart(2, '0')
	const text = raw instanceof Date && !Number.isNaN(raw.getTime())
		? `${raw.getUTCFullYear()}-${pad(raw.getUTCMonth() + 1)}-${pad(raw.getUTCDate())}`
		: (typeof raw === 'string' ? raw.trim() : '')
	const matched = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(text)
	if (!matched)
		return ''
	const [, year, month, day, hour, minute] = matched
	const date = `${+year}/${+month}/${+day}`
	return hour && (hour !== '00' || minute !== '00') ? `${date} ${hour}:${minute}` : date
}

const date = computed(() => formatDate(fm.value.date))
// frontmatter 没写 lastUpdated 时以创建日期兜底（与 catalog.ts 的扫描规则一致）
const lastUpdated = computed(() => formatDate(fm.value.lastUpdated) || formatDate(fm.value.date))
// 宽版页面（群汇总、友情链接这类 layout: wide 表格卡片页）以卡片为主体，
// 不展示字数与阅读时间；创建与更新日期保留
const hideStats = computed(() => fm.value.layout === 'wide')
// 标题锚点：标题改由本组件渲染，模仿 markdown-it 生成的 id（小写、空格转连字符）
const anchorId = computed(() => (fm.value.title || '').trim().toLowerCase().replace(/\s+/g, '-').replace(/[/?#&]/g, ''))

// ================= 字数与阅读时长的计数动画 =================
// SSR 输出真实数值（initial 即真实值，hydrate 不会 mismatch）；挂载后才从 0 计数上去，
// 让「这篇有多长」这个信息有一个被注意到的时间窗口。
// reduced-motion 下 tokens 的时长为 0s，直接落到终值（见 prefersReducedMotion）。
const COUNT_DURATION = 400
const displayWordCount = ref(wordCount.value)
const displayReadingMinutes = ref(readingMinutes.value)

function prefersReducedMotion(): boolean {
	return typeof window !== 'undefined' && (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)
}

/** rAF 计数：easeOutCubic 让数字快速接近终值，尾部自然收敛，不会一路匀速显得机械 */
function countUp(display: Ref<number>, target: number) {
	if (!target || prefersReducedMotion()) {
		display.value = target
		return
	}
	const started = performance.now()
	const step = (now: number) => {
		const progress = Math.min(1, (now - started) / COUNT_DURATION)
		const eased = 1 - (1 - progress) ** 3
		display.value = Math.round(target * eased)
		if (progress < 1)
			requestAnimationFrame(step)
	}
	requestAnimationFrame(step)
}

onMounted(() => {
	countUp(displayWordCount, wordCount.value)
	countUp(displayReadingMinutes, readingMinutes.value)
})
</script>

<template>
<div v-if="fm.title" class="article-meta vp-doc">
	<nav v-if="fm.breadcrumbs?.length" class="article-breadcrumbs" aria-label="文章所在目录">
		<ol>
			<li v-for="category in fm.breadcrumbs" :key="category">
				<a :href="withBase(`/categories/?category=${encodeURIComponent(category)}`)">{{ category }}</a>
			</li>
		</ol>
	</nav>
	<div class="article-title-row">
		<h1 :id="anchorId" tabindex="-1">
			{{ fm.title }}
			<a class="header-anchor" :href="`#${anchorId}`" :aria-label="`Permalink to &quot;${fm.title}&quot;`">&#8203;</a>
		</h1>
		<WikiChips :items="tagChips(fm.tags || [])" class="tags" label="文章标签" />
	</div>
	<div class="article-info">
		<span v-if="date" class="article-info-item">
			<Icon :icon="calendarIcon" aria-hidden="true" />创建日期：{{ date }}
		</span>
		<span v-if="lastUpdated" class="article-info-item">
			<Icon :icon="refreshIcon" aria-hidden="true" />最后更新：{{ lastUpdated }}
		</span>
		<span v-if="displayWordCount && !hideStats" class="article-info-item">
			<Icon :icon="penIcon" aria-hidden="true" />字数：{{ displayWordCount }}
		</span>
		<span v-if="displayReadingMinutes && !hideStats" class="article-info-item">
			<Icon :icon="bookIcon" aria-hidden="true" />阅读时间：{{ displayReadingMinutes }} 分钟
		</span>
	</div>
	<p v-if="fm.empty" class="empty-state">
		这篇条目正在等待补充，欢迎<a :href="withBase('/pages/Contributing/')">参与共建</a>。
	</p>
</div>
</template>
