<script setup lang="ts">
import type { Article, IndexMode } from '../../types'
import type { SearchResult } from '../searchDocs'
import gridIcon from '@iconify-icons/ri/grid-line'
import listIcon from '@iconify-icons/ri/list-check'
import { Icon } from '@iconify/vue'
import { withBase } from 'vitepress'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { buildExcerpt, expandQuery, highlightText, tokenize } from '../../searchCore'
import { data } from '../catalog.data'
import { tagChips } from '../chips'
import { ensureSearchIndex, searchDocs } from '../searchDocs'
import ArticleByline from './ArticleByline.vue'
import WikiChips from './WikiChips.vue'

const props = withDefaults(defineProps<{ mode?: IndexMode, category?: string }>(), { mode: 'archives', category: '' })
const selected = ref(props.category)
const view = ref('cards')
const query = ref('')
const key = computed(() => props.mode === 'categories' ? 'category' : 'tag')
const choices = computed(() => props.mode === 'archives' ? [] : data[props.mode])
function readQuery() {
	const params = new URLSearchParams(window.location.search)
	selected.value = props.category || params.get(key.value) || ''
	query.value = params.get('q') || ''
	scheduleFilter()
}
function updateQuery(value = selected.value, replace = false) {
	selected.value = value
	const params = new URLSearchParams()
	if (value && !props.category)
		params.set(key.value, value)
	if (query.value)
		params.set('q', query.value)
	window.history[replace ? 'replaceState' : 'pushState']({}, '', window.location.pathname + (params.size ? `?${params}` : ''))
	scheduleFilter()
}

// ================= 限定范围的正文检索 =================
// 搜索只作用于本页文章列表（带 category 的专题页仅搜该栏目）；命中正文时在条目下展示高亮摘要。

interface FilterHit {
	titleHtml: string
	excerptHtml: string
	section: string
}

const hits = ref<Map<string, FilterHit>>(new Map())
let filterTimer: ReturnType<typeof setTimeout> | undefined

function scheduleFilter() {
	clearTimeout(filterTimer)
	filterTimer = setTimeout(runFilter, 150)
}

async function runFilter() {
	const text = query.value.trim()
	if (!text) {
		hits.value = new Map()
		return
	}
	const index = await ensureSearchIndex()
	// 变体展开后的查询串用于检索与标记（如“吉它”追加“吉他”）
	const expanded = expandQuery(text)
	// 范围先于截断：多取一些结果再按本页栏目过滤，保证限定范围内不漏命中
	const { results } = searchDocs(index, expanded, 'all', 999)
	const queryTokens = tokenize(expanded)
	const map = new Map<string, FilterHit>()
	for (const result of results) {
		if (!inScope(result))
			continue
		const excerpt = buildExcerpt(result.text ?? '', result.terms ?? [], result.sections ?? [], queryTokens)
		map.set(result.id, {
			titleHtml: highlightText(result.title ?? '', result.terms ?? [], queryTokens),
			excerptHtml: excerpt.html,
			section: excerpt.section,
		})
	}
	hits.value = map
}

function inScope(result: SearchResult): boolean {
	if (!selected.value || props.mode === 'archives')
		return true
	return props.mode === 'tags'
		? (result.tagsList ?? []).includes(selected.value)
		: (result.categoriesList ?? []).includes(selected.value)
}

const articles = computed(() => data.articles.filter((article) => {
	const matches = !selected.value || props.mode === 'archives' || article[props.mode].includes(selected.value)
	return matches && (!query.value.trim() || hits.value.has(article.url))
}).sort((a, b) => (b.lastUpdated || b.date).localeCompare(a.lastUpdated || a.date) || a.title.localeCompare(b.title, 'zh-CN')))
const groups = computed(() => {
	const result = new Map<string, Article[]>()
	for (const article of articles.value) {
		const group = props.mode === 'archives' ? ((article.lastUpdated || article.date).slice(0, 7) || '日期待补充') : article.folders[0]
		if (!result.has(group))
			result.set(group, [])
		result.get(group)!.push(article)
	}
	return [...result]
})
const placeholder = computed(() => selected.value ? `搜索「${selected.value}」栏目的标题与正文…` : '搜索全部文章的标题与正文…')
onMounted(() => {
	readQuery()
	runFilter()
	window.addEventListener('popstate', readQuery)
	window.addEventListener('wiki:route-change', readQuery)
})
onUnmounted(() => {
	window.removeEventListener('popstate', readQuery)
	window.removeEventListener('wiki:route-change', readQuery)
	clearTimeout(filterTimer)
})
</script>

<template>
<div class="article-index">
	<WikiChips
		v-if="choices.length && !category"
		:items="[{ text: '全部', value: '', count: data.articles.length }, ...choices.map(choice => ({ text: `${mode === 'tags' ? '# ' : ''}${choice.name}`, value: choice.name, count: choice.count }))]"
		:selected="selected"
		label="筛选文章"
		@select="updateQuery"
	/>
	<div class="index-controls">
		<input v-model="query" type="search" aria-label="搜索本页文章的标题与正文" :placeholder="placeholder" @input="updateQuery(selected, true)">
		<div class="layout-switch" aria-label="文章展示形式">
			<button :aria-pressed="view === 'cards'" aria-label="卡片视图" @click="view = 'cards'">
				<Icon :icon="gridIcon" />
			</button>
			<button :aria-pressed="view === 'list'" aria-label="列表视图" @click="view = 'list'">
				<Icon :icon="listIcon" />
			</button>
		</div>
	</div>

	<p v-if="!articles.length" class="empty-state">
		没有找到符合条件的文章。<button @click="query = ''; updateQuery('')">
			清除筛选
		</button>
	</p>
	<section v-for="[name, list] in groups" :key="name">
		<div class="index-section-heading">
			<h2>{{ name }} <span class="section-count">{{ list.length }}</span></h2>
		</div>
		<ul class="article-list" :class="{ 'article-cards': view === 'cards' }">
			<li v-for="article in list" :key="article.url">
				<div class="index-item-content">
					<a class="article-title" :href="withBase(article.url)" v-html="hits.get(article.url)?.titleHtml ?? article.title" />
					<WikiChips :items="tagChips(article.tags)" class="tags" label="文章标签" />
					<span v-if="hits.get(article.url)" class="index-item-excerpt">
						<span v-if="hits.get(article.url)!.section" class="index-item-section">§ {{ hits.get(article.url)!.section }}</span>
						<span class="index-item-excerpt-text" v-html="hits.get(article.url)!.excerptHtml" />
					</span>
				</div>
				<ArticleByline :date="article.lastUpdated || article.date" :author="article.author" />
			</li>
		</ul>
	</section>
</div>
</template>
