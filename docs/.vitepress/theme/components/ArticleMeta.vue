<script setup lang="ts">
import timeIcon from '@iconify-icons/ri/time-line'
import userIcon from '@iconify-icons/ri/user-line'
import { Icon } from '@iconify/vue'
import { useData, withBase } from 'vitepress'
import { computed } from 'vue'
import { tagChips } from '../chips'
import WikiChips from './WikiChips.vue'

const { frontmatter: fm } = useData()
const author = computed(() => typeof fm.value.author === 'string' ? fm.value.author : fm.value.author?.name)
const authorUrl = computed(() => typeof fm.value.author === 'object' ? fm.value.author?.url || fm.value.author?.link : undefined)
const date = computed(() => fm.value.date ? new Date(fm.value.date).toISOString().slice(0, 10) : '')
// 字数与预计阅读时间：构建期在 catalog.ts 里算好，随页面数据下发，避免运行时再扫一遍正文
const wordCount = computed(() => typeof fm.value.wordCount === 'number' ? fm.value.wordCount : 0)
const readingMinutes = computed(() => typeof fm.value.readingMinutes === 'number' ? fm.value.readingMinutes : 0)
</script>

<template>
<div v-if="fm.categories?.length" class="article-meta vp-doc">
	<nav v-if="fm.breadcrumbs?.length" class="article-breadcrumbs" aria-label="文章所在目录">
		<ol>
			<li v-for="category in fm.breadcrumbs" :key="category">
				<a :href="withBase(`/categories/?category=${encodeURIComponent(category)}`)">{{ category }}</a>
			</li>
		</ol>
	</nav>
	<div v-if="author || date || wordCount" class="article-byline">
		<span v-if="author" class="article-author">
			<Icon :icon="userIcon" aria-hidden="true" />
			<a v-if="authorUrl" :href="authorUrl" target="_blank" rel="noopener noreferrer">{{ author }}</a>
			<span v-else>{{ author }}</span>
		</span>
		<span v-if="date" class="article-date">
			<Icon :icon="timeIcon" aria-hidden="true" />
			<time :datetime="date">{{ date }}</time>
		</span>
		<span v-if="wordCount" class="article-length" title="字数按正文计（不含代码、公式与图片），阅读时间按每分钟 500 字估算">{{ wordCount }}字<template v-if="readingMinutes"> / 约{{ readingMinutes }}分钟</template></span>
	</div>
	<WikiChips :items="tagChips(fm.tags || [])" class="tags" label="文章标签" />
	<p v-if="fm.empty" class="empty-state">
		这篇条目正在等待补充，欢迎通过页末源代码链接参与共建。
	</p>
</div>
</template>
