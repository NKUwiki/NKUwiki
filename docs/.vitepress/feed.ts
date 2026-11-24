/**
 * RSS 2.0 订阅源生成。
 *
 * 站点原先只有 sitemap.xml：它能告诉搜索引擎「有哪些页面」，但不会告诉
 * 聚合器与阅读器「最近更新了什么、更新在哪一篇」。校园 wiki 的更新节奏是
 * 「开学季密集修一批」，订阅源比全量站点地图更适合这种场景。
 *
 * 纯函数实现（不读文件、不依赖 vite/vitepress），因此可以直接单测；
 * 摘要由调用方以回调传入，避免本模块反向依赖 content 扫描层。
 */

/** 生成订阅源所需的文章字段（Article 的子集） */
export interface FeedArticle {
	/** 站内 permalink，带前导斜杠 */
	url: string
	title: string
	/** 分类层级，从最外层到最内层 */
	folders: string[]
	/** 标签 */
	tags: string[]
	/** 发布日期，frontmatter 原值（可能是裸日期） */
	date: string
	/** 最后更新日期 */
	lastUpdated: string
	/** 最后更新时间的毫秒值，用于排序；未知为 0 */
	lastUpdatedTime: number
}

export interface FeedInput<T extends FeedArticle = FeedArticle> {
	/** 站点正式地址，尾斜杠可有可无 */
	siteUrl: string
	/** 频道标题 */
	title: string
	/** 频道描述 */
	description: string
	/** 候选文章（内部会过滤、排序、截断） */
	articles: T[]
	/** 每条的摘要；返回空串时该条不带 description */
	summaryFor?: (article: T) => string
	/** 最多输出条数，默认 30 */
	limit?: number
	/** 构建时间，用于 lastBuildDate；默认取当前时间 */
	buildDate?: Date
}

/** RSS 默认条目数：聚合器通常只看最近几十条，再多也没有意义 */
const DEFAULT_LIMIT = 30

/**
 * 滤掉 XML 1.0 不允许的控制字符（除 \t \n \r 之外的 C0 段）。
 *
 * 逐个码点过滤而不是写正则：`[\u0000-\u001F]` 这类写法会被 ESLint 的
 * no-control-regex 拦下，而在这条规则上开豁免不划算——正文里其它地方
 * 还依赖它拦截真正有害的写法。
 */
function stripInvalidXmlChars(value: string): string {
	let out = ''
	for (const char of value) {
		const code = char.charCodeAt(0)
		if (code < 0x20 && code !== 0x09 && code !== 0x0A && code !== 0x0D)
			continue
		out += char
	}
	return out
}

/**
 * XML 文本转义。
 *
 * 顺序很重要：`&` 必须最先替换，否则后续插入的实体会被二次转义。
 */
export function escapeXml(value: string): string {
	return stripInvalidXmlChars(value)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;')
}

/**
 * 日期转 RSS 要求的 RFC 822 格式。
 *
 * 解析失败返回 `null`：宁可不写这一项，也不要输出 `Invalid Date` 让整个源失效。
 */
export function rfc822(value: string | undefined): string | null {
	if (!value)
		return null
	const time = new Date(value)
	return Number.isNaN(time.getTime()) ? null : time.toUTCString()
}

/** 拼一个 `<tag>text</tag>`；text 为空时返回空串（整项省略） */
function element(tag: string, text: string, attrs = ''): string {
	return text ? `    <${tag}${attrs}>${escapeXml(text)}</${tag}>` : ''
}

/**
 * 生成 RSS 2.0 文档。
 *
 * 条目按「最后更新时间」降序取前 N 条——订阅源关心的是「最近改了什么」，
 * 而不是创建顺序；`/archives` 页也是同一口径。
 */
export function buildRssFeed<T extends FeedArticle>(input: FeedInput<T>): string {
	const base = input.siteUrl.replace(/\/+$/, '')
	const limit = input.limit ?? DEFAULT_LIMIT
	const buildDate = (input.buildDate ?? new Date()).toUTCString()

	const items = [...input.articles]
		// 没有正文的占位页不进订阅源：它们和 sitemap / 索引页的处理一致
		.filter(article => article.url)
		.sort((a, b) => b.lastUpdatedTime - a.lastUpdatedTime)
		.slice(0, Math.max(limit, 0))
		.map((article) => {
			const link = `${base}${article.url}`
			const summary = input.summaryFor?.(article) ?? ''
			const pubDate = rfc822(article.date)
			const categories = article.folders.map(folder => element('category', folder))
			return [
				'  <item>',
				element('title', article.title),
				element('link', link),
				element('guid', link, ' isPermaLink="true"'),
				pubDate ? element('pubDate', pubDate) : '',
				element('description', summary),
				...categories,
				'  </item>',
			].filter(Boolean).join('\n')
		})

	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
		'  <channel>',
		element('title', input.title),
		element('link', `${base}/`),
		element('description', input.description),
		element('language', 'zh-CN'),
		element('lastBuildDate', buildDate),
		// atom:link 让聚合器知道订阅源自身的规范地址（同名 feed 部署在多个域名时必需）
		`    <atom:link href="${escapeXml(`${base}/feed.xml`)}" rel="self" type="application/rss+xml"/>`,
		...items,
		'  </channel>',
		'</rss>',
		'',
	].filter(Boolean).join('\n')
}
