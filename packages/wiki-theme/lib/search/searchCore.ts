// 站内搜索的核心纯函数：中文分词、变体展开、正文摘要与高亮。
// 只依赖语言内置能力，不碰 Node API：构建端（search.ts）与客户端
// （WikiSearch / ArticleIndex）共用同一份实现，保证索引与查询切词一致。

export interface SearchSection {
	/** 章节标题（已清理行内语法） */
	t: string
	/** 标题在正文纯文本中的起始偏移 */
	o: number
}

/**
 * 一篇文章的搜索文档：检索字段 + 展示用的存储字段。
 * headings / tags 两个检索拼接串不入库（可由 sections / categoriesList+tagsList
 * 推导），由客户端 searchDocs.ts 在建索引前现场生成。
 */
export interface SearchDoc {
	id: string
	title: string
	text: string
	sections: SearchSection[]
	folders: string[]
	categoriesList: string[]
	tagsList: string[]
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

const EXCERPT_RADIUS = 120
const EXCERPT_MAX = 360

/** 单行摘要 HTML：行内命中区间包 <mark>，其余转义。 */
function excerptLineHtml(text: string, lineStart: number, lineEnd: number, ranges: Range[]): string {
	const parts: string[] = []
	let cursor = lineStart
	for (const range of ranges) {
		if (range.end <= lineStart || range.start >= lineEnd)
			continue
		const from = Math.max(range.start, lineStart)
		const to = Math.min(range.end, lineEnd)
		if (from > cursor)
			parts.push(escapeHtml(text.slice(cursor, from)))
		parts.push(`<mark>${escapeHtml(text.slice(from, to))}</mark>`)
		cursor = to
	}
	parts.push(escapeHtml(text.slice(cursor, lineEnd)))
	return parts.join('')
}

interface ExcerptBlock { type: 'p' | 'li' | 'quote', html: string }

/** 把窗口内的行还原为原始排版块：列表行 → li、引用行 → quote、其余 → 段落。 */
function renderExcerptBlocks(text: string, start: number, end: number, ranges: Range[]): string {
	const blocks: ExcerptBlock[] = []
	let pos = start
	for (const raw of text.slice(start, end).split('\n')) {
		const lineEnd = pos + raw.length
		if (raw.trim()) {
			// 去掉行首缩进与列表/引用标记后才是要展示的内容
			const trimmed = raw.trimStart()
			const marker = trimmed.match(/^([-*+]\s+|>\s?)/)
			const type: ExcerptBlock['type'] = !marker ? 'p' : marker[0].startsWith('>') ? 'quote' : 'li'
			const contentStart = pos + (raw.length - trimmed.length) + (marker ? marker[0].length : 0)
			blocks.push({ type, html: excerptLineHtml(text, contentStart, lineEnd, ranges) })
		}
		pos = lineEnd + 1
	}
	const out: string[] = []
	let i = 0
	while (i < blocks.length) {
		if (blocks[i].type === 'li') {
			const items: string[] = []
			while (i < blocks.length && blocks[i].type === 'li') {
				items.push(`<li>${blocks[i].html}</li>`)
				i++
			}
			out.push(`<ul>${items.join('')}</ul>`)
		}
		else {
			const block = blocks[i]
			out.push(block.type === 'quote' ? `<blockquote>${block.html}</blockquote>` : `<p>${block.html}</p>`)
			i++
		}
	}
	return out.join('')
}

/**
 * 以第一处命中为中心截取摘要窗口（按整行对齐），命中区间包上 <mark>，
 * 并按原文排版渲染：列表还原为 <ul>/<li>、引用还原为 <blockquote>。
 * terms 为空时返回开头一段（同样保留排版）。
 */
export function buildExcerpt(text: string, terms: string[], sections: SearchSection[] = [], queryTokens: string[] = []): ExcerptResult {
	const ranges = terms.length ? findRanges(text, terms, queryTokens) : []
	let start = 0
	let end = Math.min(text.length, EXCERPT_MAX)
	if (ranges.length) {
		const first = ranges[0]
		start = Math.max(0, first.start - EXCERPT_RADIUS)
		end = Math.min(text.length, Math.max(first.end + EXCERPT_RADIUS, start + EXCERPT_MAX))
	}
	// 窗口对齐整行：起点收到所在行行首，终点扩到所在行行尾，保证分块渲染不出现半行
	if (start > 0)
		start = text.lastIndexOf('\n', start - 1) + 1
	if (end < text.length) {
		const nl = text.indexOf('\n', end)
		end = nl === -1 ? text.length : nl
	}
	const prefix = start > 0 ? '…' : ''
	const suffix = end < text.length ? '…' : ''
	const html = `${prefix}${renderExcerptBlocks(text, start, end, ranges)}${suffix}`
	const anchor = ranges.length ? ranges[0].start : start
	let section = sections.length ? sections[0].t : ''
	for (const item of sections) {
		if (item.o <= anchor)
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
