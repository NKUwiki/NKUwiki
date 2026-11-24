// 搜索数据的客户端入口：首次使用时才动态加载构建期生成的索引文档，
// 并提供 MiniSearch 索引的构建与统一检索（分词、容错、筛选范围）。
import type { SearchDoc, SearchScope, SearchSection } from '@nkuwiki/theme/lib/search/searchCore.ts'
import { fuzzyTolerance, scopeFields, tokenize, tokenizeForIndex } from '@nkuwiki/theme/lib/search/searchCore.ts'
import MiniSearch from 'minisearch'

let docsPromise: Promise<SearchDoc[]> | undefined

/** 懒加载全部搜索文档（.data 模块单独成 chunk，不占首屏）。 */
export function loadSearchDocs(): Promise<SearchDoc[]> {
	// 必须带 .ts 后缀：VitePress 的 data loader 插件按 /\.data\.(m|t|j)s$/ 识别改写
	docsPromise ??= import('../data/search.data.ts').then(module => module.data)
	return docsPromise
}

/** 建索引用的文档：在 SearchDoc 基础上补两个可推导的检索拼接串（不随数据下发）。 */
export type IndexedSearchDoc = SearchDoc & { headings: string, tags: string }

/**
 * 构建 MiniSearch 索引。
 *
 * 返回 Promise：分批构建（见下方 addAllAsync 的说明），调用方本来就在等
 * `ensureSearchIndex()`，签名变化不影响任何使用点。
 */
export async function createIndex(docs: SearchDoc[]): Promise<MiniSearch<IndexedSearchDoc>> {
	const index = new MiniSearch<IndexedSearchDoc>({
		fields: ['title', 'headings', 'tags', 'text'],
		storeFields: ['title', 'text', 'sections', 'folders', 'categoriesList', 'tagsList'],
		// 索引侧追加分词变体（吉他↔吉它），查询侧保持原词，双方共用同一分词器
		tokenize: tokenizeForIndex,
		searchOptions: {
			tokenize,
			prefix: true,
			fuzzy: fuzzyTolerance,
			boost: { title: 4, tags: 2, headings: 2, text: 1 },
		},
	})
	// headings / tags 由展示字段推导：sections 偏移表、分类与标签数组本就要下发供筛选使用
	const prepared = docs.map(doc => ({
		...doc,
		headings: doc.sections.map(section => section.t).join(' '),
		tags: [...doc.categoriesList, ...doc.tagsList].join(' '),
	}))
	// 分批构建而不是一次 addAll：165 篇实测，同步 addAll 是一次 200–400ms 的长任务，
	// 会把首次搜索的输入与动画一起卡住；切成 20 篇一片后最长单次阻塞降到 ~24ms，
	// 总耗时只多约 15%（分词在每一片内完成，不会因为分片重复计算）。
	await index.addAllAsync(prepared, { chunkSize: 20 })
	return index
}

let indexPromise: Promise<MiniSearch<IndexedSearchDoc>> | undefined

/**
 * 全站共享的 MiniSearch 索引单例：首次调用才加载数据并建索引。
 *  加载/建索引失败时复位单例，允许下次调用重试，避免一次瞬时网络错误
 *  把被拒绝的 promise 永久缓存住（之后整个会话搜索都起不来）。
 */
export function ensureSearchIndex(): Promise<MiniSearch<IndexedSearchDoc>> {
	indexPromise ??= loadSearchDocs()
		.then(docs => createIndex(docs))
		.catch((error) => {
			indexPromise = undefined
			throw error
		})
	return indexPromise
}

export interface SearchResult {
	id: string
	/** MiniSearch 评分（仅用于结果排序展示） */
	score: number
	/** 实际命中的词元（含前缀展开与容错变体），用于摘要与标题高亮 */
	terms: string[]
	/** 以下为 storeFields 回读的展示数据 */
	title?: string
	text?: string
	sections?: SearchSection[]
	folders?: string[]
	categoriesList?: string[]
	tagsList?: string[]
}

export interface SearchOutcome {
	results: SearchResult[]
	/** 命中总数（结果列表最多返回 20 条） */
	total: number
}

/** 按筛选范围检索：all=标题+正文，title=标题/章节/分类标签，body=仅正文。 */
export function searchDocs(index: MiniSearch<IndexedSearchDoc>, query: string, scope: SearchScope = 'all', limit = 20): SearchOutcome {
	const options = { fields: scopeFields[scope] }
	let results = index.search(query, options)
	if (!results.length && query.trim().split(/\s+/).length > 1) {
		// 多词 AND 全落空时放宽为 OR，按相关度兜底
		results = index.search(query, { ...options, combineWith: 'OR' })
	}
	return {
		results: results.slice(0, limit).map(result => ({ ...result, ...index.getStoredFields(result.id) } as SearchResult)),
		total: results.length,
	}
}
