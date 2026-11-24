/**
 * 相关文章推荐：TF-IDF 余弦相似度。
 *
 * 站点原先没有任何「读完这篇还能去哪」的出口，内链全靠侧栏与分类页，
 * 权重传递和停留时长都拿不到。这里在构建期把全站文章两两算一次相似度，
 * 每篇取前 5 条注入 pageData，客户端零计算。
 *
 * 设计取舍：
 * - **字段加权**：标题 3、标签 2、分类 2、正文 1。人工标注的主题信号（标签、分类）
 *   必须压过正文里偶然共现的词，否则「南开」「大学」这类到处都有的词会主导排序。
 * - **词项带字段前缀**（t:/g:/c:/b:）：让「高频裁剪只作用于正文」成为可能。
 *   正文里 df 超过 30% 的词（N ≥ 10 时）视为背景词丢弃；标签分类即使人人都有也保留。
 * - **不改写正文**：正文只取前 3000 字参与建模，避免长文（教程页上万字）靠体量压过短文。
 * - 结果不输出分数，只输出展示需要的三个字段——分数对读者没有意义，还会随算法调整抖动。
 */
import type { Article } from '../types.ts'
import { tokenize } from '../search/searchCore.ts'

/** 参与建模的文章字段（Article 的子集 + 正文） */
export interface RelatedSource extends Pick<Article, 'url' | 'title' | 'folders' | 'categories' | 'tags'> {
	/** 正文原文，内部只取前 BODY_LIMIT 字符 */
	text: string
}

/** 输出给页面的相关文章条目 */
export interface RelatedItem {
	url: string
	title: string
	folders: string[]
}

/**
 * 字段前缀与权重：前缀同时用于「高频裁剪只作用于正文」的判定。
 *
 * 权重的相对关系经过实测：标题 4 让「同一主题的不同说法」排在前面（军训 ↔ 入学准备）；
 * 分类降到 1.5 是刻意的——同分类权重给到 2 时，「WSL 安装教程」的第一推荐会变成
 * 同属「计算机知识」的 Markdown 教程，分类信号压过了正文主题。
 */
const FIELD_WEIGHT = {
	t: 4,
	g: 2.5,
	c: 1.5,
	b: 1,
} as const

type FieldPrefix = keyof typeof FIELD_WEIGHT

/** 正文参与建模的最大字符数 */
const BODY_LIMIT = 3000
/** 每篇最多保留的词项数（按权重降序），防止长文把向量撑得过大 */
const MAX_TERMS = 200
/** 出现在这个比例以上的正文词项会被丢弃 */
const DF_RATIO = 0.3
/** 文档数少于这个值时不做高频裁剪：小集合里「人人都有」恰恰是相关性证据 */
const DF_MIN_DOCS = 10
/** 余弦相似度下限，低于它的不推荐（避免每篇都硬凑满 5 条） */
const MIN_SCORE = 0.06
/** 默认推荐条数 */
const DEFAULT_LIMIT = 5

/**
 * 停用词：分词器切出来的高频虚词与泛化词。
 *
 * 只收「在任何一篇文章里都不携带主题信息」的词；像「课程」「宿舍」这类
 * 校园 wiki 的核心词必须留在词表里——它们正是分类之外的横向关联线索。
 */
const STOP_WORDS = new Set([
	// 中文虚词与代词
	'我们',
	'你们',
	'他们',
	'这个',
	'那个',
	'这些',
	'那些',
	'这样',
	'那样',
	'什么',
	'怎么',
	'如何',
	'可以',
	'可能',
	'需要',
	'应该',
	'因为',
	'所以',
	'但是',
	'如果',
	'已经',
	'以及',
	'还有',
	'或者',
	'而且',
	'然后',
	'其中',
	'通过',
	'进行',
	'使用',
	'一个',
	'一些',
	'没有',
	'就是',
	'不是',
	'自己',
	'大家',
	'时候',
	'地方',
	'情况',
	'问题',
	'方面',
	'相关',
	'注意',
	'建议',
	'一般',
	'通常',
	'比较',
	'非常',
	'特别',
	'其实',
	'当然',
	'另外',
	'此外',
	'同时',
	'目前',
	'现在',
	// 域名级背景词：在本站几乎每篇都会出现，不携带任何区分度。
	// 收在这里而不是靠 df 裁剪，是因为它们在部分文章里出现得还不够频繁
	// （df 阈值按全站 30% 算，校区名往往刚好落在阈值下方）。
	//
	// 刻意不收「校园」：分词器会把「校园网」「校园卡」切成「校园 + 网/卡」，
	// 一滤掉「校园」，「校园网」这个真正的主题词就只剩单字被丢弃，
	// 同标签的「宿舍网络」与「校园网认证」再也关联不起来（已由单测守住）。
	'南开',
	'大学',
	'八里台',
	'津南',
	'校区',
	'学校',
	// 英文
	'the',
	'and',
	'for',
	'are',
	'was',
	'were',
	'but',
	'not',
	'you',
	'this',
	'that',
	'with',
	'from',
	'will',
	'can',
	'has',
	'have',
	'its',
	'our',
	'their',
	'when',
	'what',
	'which',
	'how',
	'use',
	'using',
	'used',
	'also',
	'into',
	'than',
	'then',
	'there',
	'here',
	'about',
])

/** 页面展示用的字段前缀（首字符） */
function isBody(term: string): boolean {
	return term.charCodeAt(0) === 98 /* b */
}

/**
 * 把一段文本切词并按字段权重累加进词频表。
 *
 * 单字词直接丢弃：中文分词切出的单字多是虚词碎片，偶尔的实词（「课」「分」）
 * 也过于宽泛，留下的噪声大于信息量。
 */
function addTerms(text: string, field: FieldPrefix, out: Map<string, number>): void {
	for (const token of tokenize(text)) {
		if (token.length < 2 || STOP_WORDS.has(token))
			continue
		const term = `${field}:${token}`
		out.set(term, (out.get(term) ?? 0) + FIELD_WEIGHT[field])
	}
}

/** 一篇文章的原始词频表 */
function buildDocTerms(doc: RelatedSource): Map<string, number> {
	const terms = new Map<string, number>()
	addTerms(doc.title, 't', terms)
	for (const tag of doc.tags)
		addTerms(tag, 'g', terms)
	// categories 已包含 folders 拼出的完整路径（catalog 里就是这样构造的），
	// 再单独加一遍 folders 会重复计权
	for (const category of doc.categories)
		addTerms(category, 'c', terms)
	addTerms(doc.text.slice(0, BODY_LIMIT), 'b', terms)
	return terms
}

interface Posting {
	ids: number[]
	weights: number[]
}

interface VectorizedDoc {
	vector: Map<string, number>
	norm: number
}

/**
 * 构建全站相关文章索引。
 *
 * @param docs - 候选文章（调用方负责过滤空正文占位页）
 * @param limit - 每篇最多保留几条
 * @returns url → 相关文章列表；没有达标的候选时为空数组
 */
export function buildRelatedIndex(docs: RelatedSource[], limit = DEFAULT_LIMIT): Map<string, RelatedItem[]> {
	const result = new Map<string, RelatedItem[]>()
	if (docs.length < 2)
		return result

	const total = docs.length
	const perDoc = docs.map(buildDocTerms)

	// 词项文档频率：决定 idf，也决定哪些正文词属于背景噪声
	const df = new Map<string, number>()
	for (const terms of perDoc) {
		for (const term of terms.keys())
			df.set(term, (df.get(term) ?? 0) + 1)
	}

	const maxDf = total >= DF_MIN_DOCS ? Math.floor(total * DF_RATIO) : Number.POSITIVE_INFINITY

	const postings = new Map<string, Posting>()
	const vectors: VectorizedDoc[] = []

	perDoc.forEach((terms, id) => {
		// 权重降序 + 词项字典序兜底：保证结果与 Map 的插入顺序无关
		const entries = [...terms]
			.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
			.slice(0, MAX_TERMS)

		const vector = new Map<string, number>()
		let sumSq = 0

		for (const [term, tf] of entries) {
			const dfi = df.get(term) ?? 0
			// 高频裁剪只作用于正文：标签、分类、标题是人工标注的主题信号
			if (isBody(term) && dfi > maxDf)
				continue

			const idf = Math.log(1 + total / (1 + dfi))
			const weight = (1 + Math.log(tf)) * idf

			vector.set(term, weight)
			sumSq += weight * weight

			const posting = postings.get(term) ?? { ids: [], weights: [] }
			posting.ids.push(id)
			posting.weights.push(weight)
			postings.set(term, posting)
		}

		vectors.push({ vector, norm: Math.sqrt(sumSq) || 1 })
	})

	docs.forEach((doc, i) => {
		const acc = new Map<number, number>()
		/**
		 * 与当前文章有「非分类词」交集的候选。
		 *
		 * 只看分类词也能把余弦推过阈值（全站约十几个分类，同分类文章共享一个大权重），
		 * 但那是「同类」不是「相关」——真实语料里表现为「美食推荐 → 电教中心」这种
		 * 仅因同属「校园生活」而上榜的条目。这里要求至少共享一个标题/标签/正文词。
		 */
		const meaningful = new Set<number>()

		// 倒排累加：只遍历「本文出现过的词」对应的文章，复杂度远低于两两全比
		for (const [term, weight] of vectors[i].vector) {
			const posting = postings.get(term)
			if (!posting)
				continue
			// 字段前缀：t 标题 / g 标签 / c 分类 / b 正文
			const isCategory = term.charCodeAt(0) === 99 /* c */
			for (let k = 0; k < posting.ids.length; k++) {
				const j = posting.ids[k]!
				if (j === i)
					continue
				acc.set(j, (acc.get(j) ?? 0) + weight * posting.weights[k]!)
				if (!isCategory)
					meaningful.add(j)
			}
		}

		const scored = [...acc]
			.map(([j, dot]) => ({
				index: j,
				score: dot / (vectors[i].norm * vectors[j]!.norm),
			}))
			.filter(item => item.score >= MIN_SCORE && meaningful.has(item.index))
			// 确定性排序：分数降序 → url 升序（构建多次结果一致，diff 才不会抖）
			.sort((a, b) => b.score - a.score || docs[a.index]!.url.localeCompare(docs[b.index]!.url))
			.slice(0, Math.max(limit, 0))
			.map(item => ({
				url: docs[item.index]!.url,
				title: docs[item.index]!.title,
				folders: docs[item.index]!.folders,
			}))

		result.set(doc.url, scored)
	})

	return result
}
