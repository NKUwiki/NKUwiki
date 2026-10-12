<script setup lang="ts">
import type { Article, IndexMode } from '@nkuwiki/theme/lib/types.ts'
import type { SearchResult } from '../searchDocs'
import gridIcon from '@iconify-icons/ri/grid-line'
import listIcon from '@iconify-icons/ri/list-check'
import { Icon } from '@iconify/vue'
import { categoryChildren, resolveCategory } from '@nkuwiki/theme/lib/content/category.ts'
import { buildExcerpt, expandQuery, highlightText, tokenize } from '@nkuwiki/theme/lib/search/searchCore.ts'
import ArticleByline from '@nkuwiki/theme/theme/components/ArticleByline.vue'
import WikiChips from '@nkuwiki/theme/theme/components/WikiChips.vue'
import { tagChips } from '@nkuwiki/theme/theme/composables/chips.ts'
import { withBase } from 'vitepress'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { data } from '../../data/catalog.data.ts'
import { ensureSearchIndex, searchDocs } from '../searchDocs'

const props = withDefaults(defineProps<{ mode?: IndexMode, category?: string }>(), { mode: 'archives', category: '' })
const selected = ref(props.category)
const view = ref('cards')
const query = ref('')
const key = computed(() => props.mode === 'categories' ? 'category' : 'tag')
// 分类做成层级后，筛选栏只列最上层分类，子分类通过列表里的「子分类」条目逐级进入
const choices = computed(() => {
	if (props.mode === 'archives')
		return []
	if (props.mode === 'tags')
		return data.tags
	return data.categories.filter(category => !category.path.includes('/'))
})
/** 选中的分类路径，兼容只写末级名字的链接（例如 ?category=组织详情）。 */
const activeCategory = computed(() => props.mode === 'categories' ? resolveCategory(data.categories, selected.value) : selected.value)
/** 当前分类的下一级分类，以和文章一样的条目形式排在文章列表最前面。 */
const childEntries = computed(() => {
	if (props.mode !== 'categories' || !activeCategory.value)
		return []
	return categoryChildren(data.categories, activeCategory.value).map(category => ({
		name: category.name,
		href: withBase(`/categories/?category=${encodeURIComponent(category.path)}`),
	}))
})
/** 分组里只有当组正是当前分类时才排子分类条目。 */
const childEntriesOf = (group: string) => group === activeCategory.value ? childEntries.value : []
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
	// 分类页的导航入口也用查询串区分，切换后通知一遍，让导航高亮等跟着更新
	window.dispatchEvent(new Event('wiki:route-change'))
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
	// 只有排在前面的命中才生成摘要：buildExcerpt 要逐条做区间查找与分块渲染，
	// 对近千条命中全量生成会让每次输入都卡一下；靠后的条目用户基本翻不到，
	// 给标题高亮即可（hits 只决定「显示的条目」，不参与排序）
	let excerptBudget = 60
	for (const result of results) {
		if (!inScope(result))
			continue
		const titleHtml = highlightText(result.title ?? '', result.terms ?? [], queryTokens)
		if (excerptBudget <= 0) {
			map.set(result.id, { titleHtml, excerptHtml: '', section: '' })
			continue
		}
		excerptBudget--
		const excerpt = buildExcerpt(result.text ?? '', result.terms ?? [], result.sections ?? [], queryTokens)
		map.set(result.id, { titleHtml, excerptHtml: excerpt.html, section: excerpt.section })
	}
	hits.value = map
}

function inScope(result: SearchResult): boolean {
	if (!selected.value || props.mode === 'archives')
		return true
	return props.mode === 'tags'
		? (result.tagsList ?? []).includes(selected.value)
		: (result.categoriesList ?? []).includes(activeCategory.value)
}

const articles = computed(() => data.articles.filter((article) => {
	// 分类按完整路径精确匹配：查看上级分类时不会再带出子分类的文章
	const matches = props.mode === 'archives'
		? true
		: props.mode === 'categories'
			? !activeCategory.value || article.categories.includes(activeCategory.value)
			: !selected.value || article.tags.includes(selected.value)
	return matches && (!query.value.trim() || hits.value.has(article.url))
	// 最近更新页（archives）依然按更新时间倒序；分类页 / 标签页统一按文件名编号顺序，
	// 与侧栏目录、目录结构保持一致
}).sort(compareArticles))
function compareArticles(a: Article, b: Article): number {
	if (props.mode === 'archives')
		return (b.lastUpdated || b.date).localeCompare(a.lastUpdated || a.date) || a.title.localeCompare(b.title, 'zh-CN')
	return a.source.localeCompare(b.source, 'zh-CN', { numeric: true })
}
const groups = computed(() => {
	const result = new Map<string, Article[]>()
	// 选中分类后先建好这一组：即使它还没有直属文章，子分类条目也要有地方显示
	if (props.mode === 'categories' && activeCategory.value)
		result.set(activeCategory.value, [])
	for (const article of articles.value) {
		const group = props.mode === 'archives'
			? ((article.lastUpdated || article.date).slice(0, 7) || '日期待补充')
			// 选中分类后这一组就是这个分类本身；否则按文章所属的最上层分类分组
			: props.mode === 'categories' && activeCategory.value
				? activeCategory.value
				: (article.categories[0] || '').split('/')[0] || '未分类'
		if (!result.has(group))
			result.set(group, [])
		result.get(group)!.push(article)
	}
	return [...result]
})
const placeholder = computed(() => selected.value ? `搜索「${selected.value}」栏目的标题与正文…` : '搜索全部文章的标题与正文…')

// ================= 筛选切换的位置过渡（FLIP） =================
// 切换分类 / 标签时列表内容大幅变化：留住的条目位置跳动很大。
// FLIP：变化前记录每个条目的位置，变化后把它瞬时挪回原处，再过渡到新位置，
// 读者能看到条目「滑到新位置」而不是整列瞬间重排。
//
// 三条性能与正确性约束：
// 1. 不对搜索词变化做动画——输入时每敲一个字都会改变列表，是这里最高频的路径，
//    做动画只会让输入发卡；搜索本身已有 150ms 防抖，结果整体换一批即可；
// 2. 读 / 写严格分离：先一次性读完所有旧位置，再一次性读完新位置，最后统一写，
//    避免「读 → 写 → 读」交替触发的强制同步布局（一百多个条目各触发一次会明显掉帧）；
// 3. 只对当前视口内、且上限之内的条目做动画——视口外的位移没人看得到，
//    却照样要建合成层。新出现的条目一律不参与，避免刚挂上的节点被动画藏住。
const listRef = ref<HTMLElement>()
/** 参与动画的条目上限：超出部分直接到位，保证重排开销有上界 */
const FLIP_LIMIT = 60

/** 收集当前可参与动画的条目及其相对列表容器的位置（top 减去容器 top，消除滚动影响） */
function capturePositions(): Map<HTMLElement, number> {
	const positions = new Map<HTMLElement, number>()
	const container = listRef.value
	if (!container)
		return positions
	const containerTop = container.getBoundingClientRect().top
	const items = container.querySelectorAll<HTMLElement>('.article-list > li')
	for (const item of items) {
		if (positions.size >= FLIP_LIMIT)
			break
		const rect = item.getBoundingClientRect()
		// 视口外的条目不参与（留一点余量，滚动边缘的条目也能顺滑衔接）
		if (rect.bottom < -80 || rect.top > window.innerHeight + 80)
			continue
		positions.set(item, rect.top - containerTop)
	}
	return positions
}

async function flipList() {
	const previous = capturePositions()
	if (!previous.size)
		return
	await nextTick()
	const container = listRef.value
	if (!container)
		return
	// 第二个读阶段：同样一次性读完，不与写操作交替
	const containerTop = container.getBoundingClientRect().top
	const deltas = new Map<HTMLElement, number>()
	for (const item of container.querySelectorAll<HTMLElement>('.article-list > li')) {
		const before = previous.get(item)
		// 新出现的条目没有旧位置：跳过，保持默认可见（不参与位置动画）
		if (before === undefined)
			continue
		const delta = before - (item.getBoundingClientRect().top - containerTop)
		if (delta)
			deltas.set(item, delta)
	}
	if (!deltas.size)
		return
	// 写阶段：先把所有条目瞬时挪回旧位置
	for (const [item, delta] of deltas) {
		item.style.transition = 'none'
		item.style.transform = `translateY(${delta}px)`
	}
	// 下一帧再统一放行到新位置，让过渡真正发生
	requestAnimationFrame(() => {
		for (const item of deltas.keys()) {
			item.style.transition = 'transform var(--wiki-duration-slow) var(--wiki-ease-out)'
			item.style.transform = ''
		}
	})
}

// 只在分类 / 标签切换与视图切换时做位置过渡；搜索词高频变化不走这里
watch([selected, view], () => {
	flipList()
}, { flush: 'post' })

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
<div ref="listRef" class="article-index">
	<WikiChips
		v-if="choices.length && !category"
		:items="[{ text: '全部', value: '', count: data.articles.length }, ...choices.map(choice => ({ text: `${mode === 'tags' ? '# ' : ''}${choice.name}`, value: choice.name, count: choice.count }))]"
		:selected="selected"
		label="筛选文章"
		@select="updateQuery"
	/>
	<div class="index-controls">
		<input v-model="query" type="search" aria-label="搜索本页文章的标题与正文" :placeholder="placeholder" @input="updateQuery(selected, true)">
		<div class="layout-switch" role="group" aria-label="文章展示形式">
			<button :aria-pressed="view === 'cards'" aria-label="卡片视图" @click="view = 'cards'">
				<Icon :icon="gridIcon" />
			</button>
			<button :aria-pressed="view === 'list'" aria-label="列表视图" @click="view = 'list'">
				<Icon :icon="listIcon" />
			</button>
		</div>
	</div>

	<p v-if="!articles.length && (!childEntries.length || query.trim())" class="empty-state">
		没有找到符合条件的文章。<button @click="query = ''; updateQuery('')">
			清除筛选
		</button>
	</p>
	<section v-for="[name, list] in groups" :key="name">
		<div class="index-section-heading">
			<h2>{{ name }} <span class="section-count">{{ list.length }}</span></h2>
		</div>
		<ul class="article-list" :class="{ 'article-cards': view === 'cards' }">
			<li v-for="entry in childEntriesOf(name)" :key="entry.href">
				<div class="index-item-content">
					<a class="article-title" :href="entry.href">{{ entry.name }}</a>
					<span class="article-kind">子分类</span>
				</div>
			</li>
			<li v-for="article in list" :key="article.url">
				<div class="index-item-content">
					<!-- 搜索命中时 v-html 渲染高亮（searchCore 已转义）；未命中走插值，避免标题里的 <、& 被当 HTML 解析 -->
					<a v-if="hits.get(article.url)" class="article-title" :href="withBase(article.url)" v-html="hits.get(article.url)!.titleHtml" />
					<a v-else class="article-title" :href="withBase(article.url)">{{ article.title }}</a>
					<WikiChips :items="tagChips(article.tags)" class="tags" label="文章标签" />
					<!-- 只有生成过摘要的命中才展开摘要块（靠后的命中只有标题高亮） -->
					<span v-if="hits.get(article.url)?.excerptHtml" class="index-item-excerpt">
						<span v-if="hits.get(article.url)!.section" class="index-item-section">§ {{ hits.get(article.url)!.section }}</span>
						<span class="index-item-excerpt-text" v-html="hits.get(article.url)!.excerptHtml" />
					</span>
				</div>
				<!-- 索引页只显示日期，作者留在文章页页尾 -->
				<ArticleByline :date="article.lastUpdated || article.date" />
			</li>
		</ul>
	</section>
</div>
</template>
