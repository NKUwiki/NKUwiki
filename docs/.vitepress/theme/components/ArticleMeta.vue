<script setup lang="ts">
import bookIcon from '@iconify-icons/ri/book-open-line'
import calendarIcon from '@iconify-icons/ri/calendar-line'
import penIcon from '@iconify-icons/ri/quill-pen-line'
import refreshIcon from '@iconify-icons/ri/refresh-line'
import { Icon } from '@iconify/vue'
import { useData, withBase } from 'vitepress'
import { computed } from 'vue'
import { tagChips } from '../chips'
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
const lastUpdated = computed(() => formatDate(fm.value.lastUpdated))
// 表格卡片页（群汇总、友情链接这类 layout: wide 页面）写 hideStats: true 隐藏字数与阅读时间，日期保留
const hideStats = computed(() => fm.value.hideStats === true)
// 标题锚点：标题改由本组件渲染，模仿 markdown-it 生成的 id（小写、空格转连字符）
const anchorId = computed(() => (fm.value.title || '').trim().toLowerCase().replace(/\s+/g, '-').replace(/[/?#&]/g, ''))
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
		<span v-if="wordCount && !hideStats" class="article-info-item">
			<Icon :icon="penIcon" aria-hidden="true" />字数：{{ wordCount }}
		</span>
		<span v-if="readingMinutes && !hideStats" class="article-info-item">
			<Icon :icon="bookIcon" aria-hidden="true" />阅读时间：{{ readingMinutes }} 分钟
		</span>
	</div>
	<p v-if="fm.empty" class="empty-state">
		这篇条目正在等待补充，欢迎<a :href="withBase('/pages/BasicContribution/')">参与共建</a>。
	</p>
</div>
</template>
