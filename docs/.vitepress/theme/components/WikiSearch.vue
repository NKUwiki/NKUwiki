<script setup lang="ts">
import type MiniSearch from 'minisearch'
import type { SearchDoc, SearchScope } from '../../lib/search/searchCore'
import type { SearchResult } from '../composables/searchDocs'
import chevronIcon from '@iconify-icons/ri/arrow-right-s-line'
import closeIcon from '@iconify-icons/ri/close-line'
import searchIcon from '@iconify-icons/ri/search-line'
import historyIcon from '@iconify-icons/ri/time-line'
import { Icon } from '@iconify/vue'
import { useRouter, withBase } from 'vitepress'
import { onUnmounted, ref, watch } from 'vue'
import { buildExcerpt, expandQuery, highlightText, tokenize } from '../../lib/search/searchCore'
import { ensureSearchIndex, searchDocs } from '../composables/searchDocs'
import { searchIndexLoading, searchModalOpen } from '../composables/searchState'

const props = defineProps<{ screen?: boolean }>()
// 弹窗开关是 searchState.ts 里的模块级单例：导航栏与移动端菜单两个实例
// 点任意入口按钮，打开的都是导航栏实例渲染的同一个弹窗。
const modalOpen = searchModalOpen
const indexLoading = searchIndexLoading
let searchIndex: MiniSearch<SearchDoc> | undefined

const HISTORY_KEY = 'wiki:search-history'
const HISTORY_MAX = 8

interface DisplayResult {
	id: string
	titleHtml: string
	meta: string
	tags: string[]
	excerptHtml: string
	section: string
	/** 命中的查询词元，跳转后用于在正文里定位原始匹配位置 */
	terms: string[]
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform ?? '')
const shortcutLabel = isMac ? '⌘K' : 'Ctrl K'

const query = ref('')
const scope = ref<SearchScope>('all')
const results = ref<DisplayResult[]>([])
const total = ref(0)
const selectedIndex = ref(-1)
const history = ref<string[]>(readHistory())

const inputEl = ref<HTMLInputElement>()

const scopeOptions: { value: SearchScope, label: string }[] = [
	{ value: 'all', label: '标题+正文' },
	{ value: 'title', label: '仅标题' },
	{ value: 'body', label: '仅正文' },
]

function readHistory(): string[] {
	if (typeof localStorage === 'undefined')
		return []
	try {
		const parsed: unknown = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]')
		return Array.isArray(parsed)
			? parsed.filter((item): item is string => typeof item === 'string').slice(0, HISTORY_MAX)
			: []
	}
	catch {
		return []
	}
}

function saveHistory(text: string) {
	const trimmed = text.trim()
	if (!trimmed)
		return
	history.value = [trimmed, ...history.value.filter(item => item !== trimmed)].slice(0, HISTORY_MAX)
	localStorage.setItem(HISTORY_KEY, JSON.stringify(history.value))
}

function clearHistory() {
	history.value = []
	localStorage.removeItem(HISTORY_KEY)
}

// ================= 索引与检索 =================

async function ensureIndex() {
	if (searchIndex || indexLoading.value)
		return
	indexLoading.value = true
	try {
		searchIndex = await ensureSearchIndex()
	}
	finally {
		indexLoading.value = false
	}
	runSearch()
}

function runSearch() {
	const text = query.value.trim()
	if (!text || !searchIndex) {
		results.value = []
		total.value = 0
		selectedIndex.value = -1
		return
	}
	// 变体展开后的查询串用于检索与标记（如“吉它”追加“吉他”）
	const expanded = expandQuery(text)
	const outcome = searchDocs(searchIndex, expanded, scope.value)
	const queryTokens = tokenize(expanded)
	results.value = outcome.results.map(result => toDisplay(result, queryTokens))
	total.value = outcome.total
	selectedIndex.value = outcome.results.length ? 0 : -1
}

let searchTimer: ReturnType<typeof setTimeout> | undefined
function scheduleSearch() {
	clearTimeout(searchTimer)
	searchTimer = setTimeout(runSearch, 150)
}

function toDisplay(result: SearchResult, queryTokens: string[]): DisplayResult {
	const excerpt = buildExcerpt(result.text ?? '', result.terms ?? [], result.sections ?? [], queryTokens)
	return {
		id: result.id,
		titleHtml: highlightText(result.title ?? '', result.terms ?? [], queryTokens),
		meta: (result.folders ?? []).join(' · '),
		tags: result.tagsList ?? [],
		excerptHtml: excerpt.html,
		section: excerpt.section,
		terms: queryTokens,
	}
}

function pickHistory(item: string) {
	query.value = item
	scheduleSearch()
}

watch([query, scope], scheduleSearch)

// ================= 打开 / 关闭 =================

function openModal() {
	modalOpen.value = true
}

function closeModal() {
	modalOpen.value = false
}

// 弹窗由导航栏实例负责渲染与副作用（移动端菜单实例只提供按钮），
// 打开时同步最近搜索、加载索引并聚焦输入框。
if (!props.screen) {
	watch(modalOpen, (open) => {
		if (open) {
			// 组件常驻布局，历史在每次打开时重新读取，保证跨页面都能看到最近记录
			history.value = readHistory()
			ensureIndex()
			document.body.style.overflow = 'hidden'
			requestAnimationFrame(() => inputEl.value?.focus())
		}
		else {
			document.body.style.overflow = ''
		}
	})
}

const router = useRouter()

function openResult(result: DisplayResult) {
	saveHistory(query.value)
	const original = query.value.trim().replaceAll(/\s+/g, '')
	sessionStorage.setItem('wiki:search-jump', JSON.stringify({ url: result.id, section: result.section, terms: result.terms, original }))
	closeModal()
	router.go(withBase(result.id))
}

// ================= 跳转定位与全局快捷键 =================
// 已整体移至 composables/searchState.ts（模块层只注册一次）：
// 本组件在导航栏与移动端菜单各挂一个实例，实例级注册会随移动菜单开合无限累积，
// 且双实例同时响应会让 Ctrl+K 的开合互相抵消。

onUnmounted(() => {
	clearTimeout(searchTimer)
})

function moveSelection(step: number) {
	if (!results.value.length)
		return
	selectedIndex.value = (selectedIndex.value + step + results.value.length) % results.value.length
	document.querySelector('.result.selected')?.scrollIntoView({ block: 'nearest' })
}
</script>

<template>
<!-- screen 标记移动端菜单里的整行按钮，否则渲染导航栏按钮（样式对齐原生 VPNavBarSearchButton） -->
<button class="wiki-search-trigger" :class="{ screen }" aria-label="搜索文档" @click="openModal()">
	<span class="trigger-icon"><Icon :icon="searchIcon" /></span>
	<span class="text">搜索文档</span>
	<span class="keys" aria-hidden="true"><kbd>{{ shortcutLabel }}</kbd></span>
</button>
<Teleport v-if="!screen" to="body">
	<div v-if="modalOpen" class="wiki-search-box">
		<div class="backdrop" @click="closeModal()" />
		<div class="shell" role="dialog" aria-modal="true" aria-label="站内搜索">
			<div class="search-bar" @click="inputEl?.focus()">
				<Icon :icon="searchIcon" class="search-icon" />
				<input
					ref="inputEl" v-model="query" class="search-input" type="search" placeholder="搜索标题与正文…" enterkeyhint="go"
					@keydown.down.prevent="moveSelection(1)"
					@keydown.up.prevent="moveSelection(-1)"
					@keydown.enter="results[selectedIndex] && openResult(results[selectedIndex])"
				>
				<div class="search-actions">
					<div class="wiki-search-scopes" role="radiogroup" aria-label="搜索范围">
						<button
							v-for="option in scopeOptions" :key="option.value" type="button"
							:class="{ active: scope === option.value }" role="radio"
							:aria-checked="scope === option.value" @click="scope = option.value"
						>
							{{ option.label }}
						</button>
					</div>
					<span class="search-loading" :class="{ active: indexLoading }" />
					<button class="clear-button" type="button" :disabled="!query" title="清除搜索" @click="query = ''; inputEl?.focus()">
						<Icon :icon="closeIcon" />
					</button>
				</div>
			</div>
			<p v-if="query.trim() && total" class="results-count">
				共 {{ total }} 条结果
			</p>
			<ul class="results">
				<template v-if="query.trim()">
					<li v-for="(result, index) in results" :key="result.id">
						<a
							class="result" :class="{ selected: index === selectedIndex }" :href="withBase(result.id)"
							@mouseenter="selectedIndex = index" @click.prevent="openResult(result)"
						>
							<div>
								<div class="titles">
									<span class="title-icon">#</span>
									<span v-if="result.meta" class="title"><span class="text">{{ result.meta }}</span><Icon :icon="chevronIcon" class="chevron" /></span>
									<span class="title main"><span class="text" v-html="result.titleHtml" /></span>
									<span v-if="result.tags.length" class="title-tags">{{ result.tags.map(tag => `#${tag}`).join(' ') }}</span>
								</div>
								<div v-if="result.excerptHtml" class="excerpt-wrapper">
									<div class="excerpt">
										<span v-if="result.section" class="excerpt-section">§ {{ result.section }} · </span><span v-html="result.excerptHtml" />
									</div>
									<div class="excerpt-gradient-bottom" />
									<div class="excerpt-gradient-top" />
								</div>
							</div>
						</a>
					</li>
					<li v-if="!results.length" class="no-results">
						{{ indexLoading ? '搜索索引加载中…' : '没有找到相关结果' }}
					</li>
				</template>
				<template v-else-if="history.length">
					<li class="history-label">
						最近搜索 <button class="history-clear" @click="clearHistory()">
							清空
						</button>
					</li>
					<li v-for="item in history" :key="item">
						<button class="result history" type="button" @click="pickHistory(item)">
							<div class="titles">
								<Icon :icon="historyIcon" class="title-icon history-icon" />
								<span class="title main"><span class="text">{{ item }}</span></span>
							</div>
						</button>
					</li>
				</template>
				<li v-else class="no-results">
					输入即搜：支持标题、章节与正文检索
				</li>
			</ul>
			<div class="search-keyboard-shortcuts">
				<span><kbd>↑</kbd><kbd>↓</kbd> 选择</span>
				<span><kbd>Enter</kbd> 打开</span>
				<span><kbd>esc</kbd> 关闭</span>
			</div>
		</div>
	</div>
</Teleport>
</template>
