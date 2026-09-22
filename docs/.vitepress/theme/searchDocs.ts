// 搜索数据的客户端入口：首次使用时才动态加载构建期生成的索引文档，
// 并提供 MiniSearch 索引的构建与统一检索（分词、容错、筛选范围）。
import type { SearchDoc, SearchScope, SearchSection } from '../searchCore'
import MiniSearch from 'minisearch'
import { fuzzyTolerance, scopeFields, tokenize, tokenizeForIndex } from '../searchCore'

let docsPromise: Promise<SearchDoc[]> | undefined

/** 懒加载全部搜索文档（.data 模块单独成 chunk，不占首屏）。 */
export function loadSearchDocs(): Promise<SearchDoc[]> {
	// 必须带 .ts 后缀：VitePress 的 data loader 插件按 /\.data\.(m|t|j)s$/ 识别改写
	docsPromise ??= import('./search.data.ts').then(module => module.data)
	return docsPromise
}

export function createIndex(docs: SearchDoc[]): MiniSearch<SearchDoc> {
	const index = new MiniSearch<SearchDoc>({
		fields: ['title', 'headings', 'tags', 'text'],
		storeFields: ['title', 'text', 'sections', 'folders', 'categoriesList', 'tagsList', 'author', 'lastUpdated'],
		// 索引侧追加分词变体（吉他↔吉它），查询侧保持原词，双方共用同一分词器
		tokenize: tokenizeForIndex,
		searchOptions: {
			tokenize,
			prefix: true,
			fuzzy: fuzzyTolerance,
			boost: { title: 4, tags: 2, headings: 2, text: 1 },
		},
	})
	index.addAll(docs)
	return index
}

let indexPromise: Promise<MiniSearch<SearchDoc>> | undefined

/** 全站共享的 MiniSearch 索引单例：首次调用才加载数据并建索引。 */
export function ensureSearchIndex(): Promise<MiniSearch<SearchDoc>> {
	indexPromise ??= loadSearchDocs().then(docs => createIndex(docs))
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
	author?: string
	lastUpdated?: string
}

export interface SearchOutcome {
	results: SearchResult[]
	/** 命中总数（结果列表最多返回 20 条） */
	total: number
}

/** 按筛选范围检索：all=标题+正文，title=标题/章节/分类标签，body=仅正文。 */
export function searchDocs(index: MiniSearch<SearchDoc>, query: string, scope: SearchScope = 'all', limit = 20): SearchOutcome {
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
