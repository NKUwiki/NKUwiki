<script setup lang="ts">
import type MiniSearch from 'minisearch'
import type { SearchDoc, SearchScope } from '../../searchCore'
import type { SearchResult } from '../searchDocs'
import closeIcon from '@iconify-icons/ri/close-line'
import searchIcon from '@iconify-icons/ri/search-line'
import historyIcon from '@iconify-icons/ri/time-line'
import { Icon } from '@iconify/vue'
import { useRouter, withBase } from 'vitepress'
import { onUnmounted, ref, watch } from 'vue'
import { buildExcerpt, expandQuery, highlightText, tokenize } from '../../searchCore'
import { ensureSearchIndex, searchDocs } from '../searchDocs'
import { searchIndexLoading, searchModalOpen } from '../searchState'

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
	sessionStorage.setItem('wiki:search-jump', JSON.stringify({ url: result.id, section: result.section }))
	closeModal()
	router.go(withBase(result.id))
}

// ================= 跳转后定位高亮（模块层注册，全站只挂一份） =================

const normalize = (text: string) => text.replaceAll('#', '').replaceAll(/\s+/g, '')

function onRouteChange() {
	const raw = sessionStorage.getItem('wiki:search-jump')
	if (!raw)
		return
	sessionStorage.removeItem('wiki:search-jump')
	let jump: { url?: string, section?: string }
	try {
		jump = JSON.parse(raw)
	}
	catch {
		return
	}
	const strip = (path: string) => path.replace(/\.html$/, '').replace(/\/$/, '')
	if (jump.url && strip(window.location.pathname) !== strip(withBase(jump.url)))
		return
	// 等新页面内容渲染完成后再定位
	requestAnimationFrame(() => setTimeout(() => jump.section && scrollToSection(jump.section!), 50))
}

function scrollToSection(section: string) {
	const wanted = normalize(section)
	if (!wanted)
		return
	const headings = document.querySelectorAll('.vp-doc h1, .vp-doc h2, .vp-doc h3')
	const normalized = [...headings].map(el => ({ el, text: normalize(el.textContent ?? '') }))
	const target = normalized.find(item => item.text === wanted) ?? normalized.find(item => item.text.includes(wanted))
	if (!target)
		return
	target.el.scrollIntoView({ block: 'center' })
	target.el.classList.add('wiki-search-flash')
	setTimeout(() => target.el.classList.remove('wiki-search-flash'), 2000)
}

// ================= 全局快捷键（模块层只注册一次，双实例不会重复触发） =================

function isEditable(target: EventTarget | null): boolean {
	return target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)
}

if (typeof window !== 'undefined') {
	window.addEventListener('keydown', (event) => {
		if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
			event.preventDefault()
			modalOpen.value = !modalOpen.value
			return
		}
		if (event.key === '/' && !modalOpen.value && !isEditable(event.target)) {
			event.preventDefault()
			modalOpen.value = true
			return
		}
		if (modalOpen.value && event.key === 'Escape')
			modalOpen.value = false
	})
	window.addEventListener('wiki:route-change', onRouteChange)
}

onUnmounted(() => {
	clearTimeout(searchTimer)
})

function moveSelection(step: number) {
	if (!results.value.length)
		return
	selectedIndex.value = (selectedIndex.value + step + results.value.length) % results.value.length
	document.querySelector('.wiki-search-result.selected')?.scrollIntoView({ block: 'nearest' })
}
</script>

<template>
<!-- screen 标记移动端菜单里的整行按钮，否则渲染导航栏按钮 -->
<button class="wiki-search-trigger" :class="{ screen }" aria-label="搜索文档" @click="openModal()">
	<Icon :icon="searchIcon" class="trigger-icon" />
	<span v-if="!screen" class="trigger-label">搜索文档</span>
	<span v-else class="trigger-label">搜索文档<span class="trigger-hint">标题与正文</span></span>
	<kbd v-if="!screen" class="trigger-key">{{ shortcutLabel }}</kbd>
</button>
<Teleport v-if="!screen" to="body">
	<div v-if="modalOpen" class="wiki-search-backdrop" @click.self="closeModal()">
		<div class="wiki-search-modal" role="dialog" aria-modal="true" aria-label="站内搜索">
			<div class="wiki-search-bar">
				<Icon :icon="searchIcon" class="bar-icon" />
				<input
					ref="inputEl" v-model="query" type="text" placeholder="搜索标题与正文…"
					@keydown.down.prevent="moveSelection(1)"
					@keydown.up.prevent="moveSelection(-1)"
					@keydown.enter="results[selectedIndex] && openResult(results[selectedIndex])"
				>
				<div class="wiki-search-scopes" role="radiogroup" aria-label="搜索范围">
					<button
						v-for="option in scopeOptions" :key="option.value"
						:class="{ active: scope === option.value }" role="radio"
						:aria-checked="scope === option.value" @click="scope = option.value"
					>
						{{ option.label }}
					</button>
				</div>
				<button class="wiki-search-close" aria-label="关闭搜索" @click="closeModal()">
					<Icon :icon="closeIcon" />
				</button>
			</div>
			<div class="wiki-search-body">
				<template v-if="query.trim()">
					<p v-if="indexLoading && !results.length" class="wiki-search-note">
						搜索索引加载中…
					</p>
					<p v-else-if="total" class="wiki-search-count">
						共 {{ total }} 条结果
					</p>
					<p v-else class="wiki-search-note">
						没有找到相关结果
					</p>
					<a
						v-for="(result, index) in results" :key="result.id"
						class="wiki-search-result" :class="{ selected: index === selectedIndex }"
						:href="withBase(result.id)"
						@mouseenter="selectedIndex = index" @click.prevent="openResult(result)"
					>
						<span class="result-title" v-html="result.titleHtml" />
						<span class="result-meta">{{ result.meta }}<template v-if="result.tags.length"> · {{ result.tags.join(' / ') }}</template></span>
						<span v-if="result.excerptHtml" class="result-excerpt">
							<span v-if="result.section" class="result-section">§ {{ result.section }}</span>
							<span class="result-excerpt-text" v-html="result.excerptHtml" />
						</span>
					</a>
				</template>
				<template v-else-if="history.length">
					<p class="wiki-search-count">
						最近搜索 <button class="history-clear" @click="clearHistory()">
							清空
						</button>
					</p>
					<button v-for="item in history" :key="item" class="wiki-search-history" @click="pickHistory(item)">
						<Icon :icon="historyIcon" class="history-icon" />
						<span>{{ item }}</span>
					</button>
				</template>
				<p v-else class="wiki-search-note">
					支持标题与正文检索，输入即搜
				</p>
			</div>
			<div class="wiki-search-footer">
				<span><kbd>↑</kbd><kbd>↓</kbd> 选择</span>
				<span><kbd>Enter</kbd> 打开</span>
				<span><kbd>Esc</kbd> 关闭</span>
			</div>
		</div>
	</div>
</Teleport>
</template>
