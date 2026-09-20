// 站内搜索的核心纯函数：中文分词、变体展开、正文摘要与高亮。
// 只依赖语言内置能力，不碰 Node API：构建端（search.ts）与客户端
// （WikiSearch / ArticleIndex）共用同一份实现，保证索引与查询切词一致。

export interface SearchSection {
	/** 章节标题（已清理行内语法） */
	t: string
	/** 标题在正文纯文本中的起始偏移 */
	o: number
}

/** 一篇文章的搜索文档：检索字段（title/headings/tags/text）+ 展示用的存储字段。 */
export interface SearchDoc {
	id: string
	title: string
	/** 全部章节标题，空格拼接（仅标题/全部模式下参与检索） */
	headings: string
	/** 分类 + 标签，空格拼接 */
	tags: string
	text: string
	sections: SearchSection[]
	folders: string[]
	categoriesList: string[]
	tagsList: string[]
	author: string
	lastUpdated: string
}

export type SearchScope = 'all' | 'title' | 'body'

/** 各筛选范围命中的检索字段：仅标题时含标题、章节、分类与标签。 */
export const scopeFields: Record<SearchScope, string[] | undefined> = {
	all: undefined,
	title: ['title', 'headings', 'tags'],
	body: ['text'],
}

// ================= 分词 =================

let cachedSegmenter: Intl.Segmenter | null | undefined

function getSegmenter(): Intl.Segmenter | null {
	if (cachedSegmenter === undefined) {
		cachedSegmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl
			? new Intl.Segmenter('zh-CN', { granularity: 'word' })
			: null
	}
	return cachedSegmenter
}

/**
 * 中文按词典切成自然词（中英文混排、字母数字各成一词），全部小写归一。
 * 不支持 Intl.Segmenter 的旧环境退化为：非 CJK 按空格标点切、CJK 逐字切。
 */
export function tokenize(text: string): string[] {
	const lowered = text.toLocaleLowerCase()
	const segmenter = getSegmenter()
	if (!segmenter) {
		// CJK 逐字、拉丁字母与数字按连续段切，其余（标点、符号）丢弃
		return lowered.split(/[\s\p{P}\p{S}]+/u).flatMap(part => part.match(/\p{Script=Han}|[a-z0-9]+/gu) ?? []).filter(Boolean)
	}
	const tokens: string[] = []
	for (const { segment, isWordLike } of segmenter.segment(lowered)) {
		if (isWordLike)
			tokens.push(segment)
	}
	return tokens
}

// ================= 变体展开 =================

// 同义/异写词组：组内词在检索时互相等价（索引侧展开，查询词不必改写）。
// 发现搜不到的常见说法时，往这里加一组即可。
export const synonymGroups: string[][] = [
	['吉他', '吉它'],
	['账号', '帐号', '账户'],
	['登录', '登陆'],
	['宿舍', '寝室'],
	['食堂', '饭堂'],
	['保研', '推免'],
	['挂科', '不及格'],
	['转专业', '换专业'],
	['微信公众号', '公众号'],
]

const synonymLookup = new Map<string, string[][]>()
for (const group of synonymGroups) {
	for (const word of group) {
		const key = word.toLocaleLowerCase()
		synonymLookup.set(key, [...synonymLookup.get(key) ?? [], group])
	}
}

/**
 * 索引侧分词：在 tokenize 结果上追加每个词的同组变体，
 * 让“吉它”这一查询词能直接命中只写了“吉他”的文档，且不打乱 AND 语义。
 */
export function tokenizeForIndex(text: string): string[] {
	const tokens = tokenize(text)
	const extra: string[] = []
	for (const token of new Set(tokens)) {
		for (const group of synonymLookup.get(token) ?? []) {
			for (const word of group) {
				if (!tokens.includes(word))
					extra.push(word)
			}
		}
	}
	return [...tokens, ...extra]
}

/** 给定命中的词元，返回应在高亮时一并标出的变体词（如查询“吉它”时也标“吉他”）。 */
export function highlightTerms(terms: string[]): string[] {
	const out = new Set(terms.map(term => term.toLocaleLowerCase()))
	for (const term of terms) {
		for (const group of synonymLookup.get(term.toLocaleLowerCase()) ?? []) {
			for (const word of group)
				out.add(word.toLocaleLowerCase())
		}
	}
	return [...out]
}

/**
 * 查询侧变体展开：查询串里出现某变体词时，把组内其他词追加到查询里。
 * 这样“吉它”等价于搜“吉它 吉他”，命中的是完整的“吉他”而不是单字碎片，
 * 结果更准，标记也更干净。
 */
export function expandQuery(query: string): string {
	const lowered = query.toLocaleLowerCase()
	const additions: string[] = []
	for (const group of synonymGroups) {
		if (group.some(word => lowered.includes(word.toLocaleLowerCase()))) {
			for (const word of group) {
				if (!lowered.includes(word.toLocaleLowerCase()))
					additions.push(word)
			}
		}
	}
	return additions.length ? `${query} ${additions.join(' ')}` : query
}

// ================= 摘要与高亮 =================

function escapeHtml(text: string): string {
	return text.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[ch]!)
}

interface Range {
	start: number
	end: number
}

/** 在正文中找出所有命中区间，相邻（间隙 ≤ 2 字符）的合并，如“南开”+“大学”连成一枚标记。 */
export function findRanges(text: string, terms: string[], queryTokens: string[] = []): Range[] {
	const lowered = text.toLocaleLowerCase()
	const raw: Range[] = []
	for (const term of highlightTerms(terms)) {
		// 单字词元只有确实是查询词元时才标出：模糊命中带出的碎片单字（如“校园网”模糊带到“校”）会让标记失去意义
		if (term.length < 2 && !queryTokens.includes(term))
			continue
		let from = 0
		for (;;) {
			const index = lowered.indexOf(term, from)
			if (index === -1)
				break
			raw.push({ start: index, end: index + term.length })
			from = index + 1
		}
	}
	raw.sort((a, b) => a.start - b.start || a.end - b.end)
	const merged: Range[] = []
	for (const range of raw) {
		const last = merged[merged.length - 1]
		// 只合并相邻或重叠的命中（如“南开”+“大学”连成一枚标记）；隔着普通文字的命中各自独立
		if (last && range.start <= last.end)
			last.end = Math.max(last.end, range.end)
		else
			merged.push({ ...range })
	}
	return merged
}

export interface ExcerptResult {
	/** 已转义、命中处带 <mark> 的摘要 HTML */
	html: string
	/** 命中位置所在章节标题（无章节结构时为空） */
	section: string
}

const EXCERPT_RADIUS = 70
const EXCERPT_MAX = 180

/** 以第一处命中为中心截取摘要窗口，命中区间包上 <mark>。terms 为空时返回开头一段纯文本。 */
export function buildExcerpt(text: string, terms: string[], sections: SearchSection[] = [], queryTokens: string[] = []): ExcerptResult {
	const ranges = terms.length ? findRanges(text, terms, queryTokens) : []
	if (!ranges.length) {
		const head = text.length > EXCERPT_MAX ? `${text.slice(0, EXCERPT_MAX).trimEnd()}…` : text
		return { html: escapeHtml(head), section: '' }
	}
	const first = ranges[0]
	const start = Math.max(0, first.start - EXCERPT_RADIUS)
	const end = Math.min(text.length, Math.max(first.end + EXCERPT_RADIUS, start + EXCERPT_MAX))
	const clipped = ranges.filter(range => range.end > start && range.start < end).map(range => ({ start: Math.max(range.start, start), end: Math.min(range.end, end) }))
	const parts: string[] = []
	let cursor = start
	for (const range of clipped) {
		parts.push(escapeHtml(text.slice(cursor, range.start)))
		parts.push(`<mark>${escapeHtml(text.slice(range.start, range.end))}</mark>`)
		cursor = range.end
	}
	parts.push(escapeHtml(text.slice(cursor, end)))
	const html = (start > 0 ? '…' : '') + parts.join('') + (end < text.length ? '…' : '')
	let section = sections.length ? sections[0].t : ''
	for (const item of sections) {
		if (item.o <= first.start)
			section = item.t
		else break
	}
	return { html, section }
}

/** 与 buildExcerpt 相同的高亮规则，用在标题上（不截断、无省略号）。 */
export function highlightText(text: string, terms: string[], queryTokens: string[] = []): string {
	const ranges = terms.length ? findRanges(text, terms, queryTokens) : []
	if (!ranges.length)
		return escapeHtml(text)
	const parts: string[] = []
	let cursor = 0
	for (const range of ranges) {
		if (range.start < cursor)
			continue
		parts.push(escapeHtml(text.slice(cursor, range.start)))
		parts.push(`<mark>${escapeHtml(text.slice(range.start, range.end))}</mark>`)
		cursor = range.end
	}
	parts.push(escapeHtml(text.slice(cursor)))
	return parts.join('')
}

/**
 * MiniSearch 查询侧的容错策略：
 * 两个字及以上的词允许编辑距离 1，五个字以上放宽到 2，单字必须精确。
 * 编辑距离按词长比例计算，中文一两字的错别字（吉他/吉它）正好落在容错内。
 */
export function fuzzyTolerance(term: string): number {
	return term.length >= 5 ? 2 : term.length >= 2 ? 1 : 0
}
