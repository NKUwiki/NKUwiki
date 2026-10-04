import type { Article, Catalog, DirectoryItem, TaxonomyCount } from '../types.ts'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import matter from 'gray-matter'
import { categoryPaths, collectCategories } from './category.ts'
import { minOrder, NO_ORDER, orderOf } from './order.ts'

/**
 * 定位站点 docs/ 根目录（内容不属于主题包，包里的构建期工具需要反查它）：
 * 1. 环境变量 WIKI_DOCS_ROOT 显式指定（CI 或包被安装到 monorepo 之外时用）；
 * 2. 从包位置向上找含 docs/.vitepress/config.mts 的仓库根（标准 monorepo 布局）；
 * 3. 兜底按「构建从仓库根运行」取 cwd/docs。
 * 末尾保留路径分隔符，与历史上 fileURLToPath(new URL('../../../', import.meta.url)) 的形态一致。
 */
function locateDocsRoot(): string {
	if (process.env.WIKI_DOCS_ROOT)
		return resolve(process.env.WIKI_DOCS_ROOT) + sep
	let dir = fileURLToPath(new URL('../../', import.meta.url))
	for (let i = 0; i < 6; i++) {
		if (existsSync(join(dir, 'docs', '.vitepress', 'config.mts')))
			return join(dir, 'docs') + sep
		const parent = dirname(dir)
		if (parent === dir)
			break
		dir = parent
	}
	return join(process.cwd(), 'docs') + sep
}

export const docsRoot = locateDocsRoot()
const label = (name: string) => name.replace(/^\d+\./, '').replace(/\.md$/, '')
function strings(value: unknown): string[] {
	const values: unknown[] = Array.isArray(value) ? value : [value]
	return [...new Set(values.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(Boolean))]
}

/**
 * 读取 frontmatter 的 order。
 *
 * 只接受有限数字（YAML 的 `order: 3` 和写错成字符串的 `order: "3"` 都算），
 * 其余写法（空值、非数字、NaN、Infinity）一律当作没写，避免一个手滑把整站顺序打乱。
 */
function readOrder(value: unknown): number | undefined {
	const order = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN
	return Number.isFinite(order) ? order : undefined
}

function hasTitleHeading(content: string): boolean {
	let fence = ''
	for (const line of content.replace(/^:::markmap[^\S\n]*\n[\s\S]*?^:::[^\S\n]*$/gm, '').split('\n')) {
		// 围栏标记最多允许 3 个空格缩进（CommonMark），\s* 会把代码块内的 ``` 也当围栏开关
		const marker = line.match(/^ {0,3}(`{3,}|~{3,})/)?.[1]
		if (marker) {
			if (!fence)
				fence = marker
			else if (marker[0] === fence[0] && marker.length >= fence.length)
				fence = ''
			continue
		}
		if (!fence && /^ {0,3}#\s+/.test(line))
			return true
	}
	return false
}

/** 预计阅读速度：每分钟字数（中文阅读通行取值，与参考主题一致） */
const WORDS_PER_MINUTE = 500

/** scanArticles 的结果缓存：同一 root 且 md 签名（mtime/size）不变时直接复用 */
let scanCache: {
	key: string
	signature: string
	articles: Article[]
	passThrough: string[]
	content: Map<string, string>
} | undefined

/**
 * 统计 Markdown 正文字数。
 *
 * 中日韩字符逐字计数，其余语言按词计数，代码块、行内代码、公式、图片、HTML 标签等
 * 占位性或不可读的内容不计入；链接与 Markdown 的强调符号只保留可读文本。
 */
export function countWords(content: string): number {
	const text = content
		.replace(/```[\s\S]*?```/g, ' ')
		.replace(/~~~[\s\S]*?~~~/g, ' ')
		.replace(/<!--[\s\S]*?-->/g, ' ')
		.replace(/\$\$[\s\S]*?\$\$/g, ' ')
		.replace(/`[^`\n]*`/g, ' ')
		.replace(/\$[^$\n]*\$/g, ' ')
		.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
		.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/^\s*:::.*$/gm, ' ')
		.replace(/<[^>]*>/g, ' ')
	const cjk = text.match(/[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF]/g) ?? []
	const words = text
		.replace(/[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF]/g, ' ')
		.split(/[^\p{L}\p{N}'’-]+/u)
		.filter(Boolean)
	return cjk.length + words.length
}

export function scanArticles(root = docsRoot) {
	// 非文章 md（index.md、map.md 等直通页，不经 rewrites 改写）也要参与 permalink
	// 查重：文章 permalink 撞上这些路径时 VitePress 会静默丢页面。activity/ 被
	// config 的 srcExclude 排除、不构建，同样排除（与 config.mts 保持一致）。
	const passThrough: string[] = []
	// 扫描结果缓存：config 顶层、catalog.data、search.data 会对同一 root 各扫一遍
	// （每遍都是全量 readdir + frontmatter 解析 + 字数统计）。签名取全部 md 的
	// mtime+size，文件没变就直接复用上次结果；dev 下改动 md 会命中新签名重新解析。
	const mdFiles: { source: string, full: string, isArticle: boolean }[] = []
	let signature = ''
	function visit(dir: string) {
		for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }))) {
			if (entry.name.startsWith('.') || entry.name.startsWith('@') || entry.name === 'public')
				continue
			const file = join(dir, entry.name)
			if (entry.isDirectory()) {
				visit(file)
				continue
			}
			if (!entry.name.endsWith('.md'))
				continue
			const source = relative(root, file).replaceAll('\\', '/')
			const isArticle = /^\d+\./.test(source)
			const stat = statSync(file)
			signature += `${source}:${stat.mtimeMs}:${stat.size};`
			if (!isArticle) {
				if (!source.startsWith('activity/'))
					passThrough.push(`/${source}`)
				continue
			}
			mdFiles.push({ source, full: file, isArticle })
		}
	}
	visit(root)

	// 缓存命中：md 文件的 mtime/size 签名没变就复用上次扫描结果
	const cacheKey = `${root}`
	if (scanCache && scanCache.key === cacheKey && scanCache.signature === signature)
		return scanCache.articles

	const articles: Article[] = []
	const contentCache = new Map<string, string>()
	for (const { source, full } of mdFiles) {
		const { data: fm, content } = matter(readFileSync(full, 'utf8'))
		if (fm.article === false)
			continue
		contentCache.set(source, content)
		const wordCount = countWords(content)
		const date = parseDateField(fm.date, source, 'date')
		// lastUpdated 没写时以 date 兜底（页面「最后更新」不缺栏）；
		// 旧字段 `updated` 一律不识别，防止历史残留悄悄生效
		const lastUpdated = parseDateField(fm.lastUpdated, source, 'lastUpdated') || date
		const folders = source.split('/').slice(0, -1).map(label)
		const url = fm.permalink || `/${source.replace(/\.md$/, '')}`
		if (!url.startsWith('/') || /[?#]|\.\./.test(url) || typeof url !== 'string')
			throw new Error(`无效 permalink: ${source}`)
		articles.push({
			source,
			url,
			title: fm.title || label(source.split('/').pop() || source),
			folders,
			// 目录层级本身就是分类层级（03.群汇总/05.组织详情/x.md → 群汇总/组织详情），
			// frontmatter 的 categories 可再用缩进补充层级；两者都按完整路径去重
			categories: [...new Set([folders.join('/'), ...categoryPaths(fm.categories)].filter(Boolean))],
			tags: strings(fm.tags),
			date,
			lastUpdated,
			lastUpdatedTime: lastUpdated ? Date.parse(lastUpdated) : 0,
			hasHeading: hasTitleHeading(content),
			empty: !content.trim(),
			wordCount,
			readingMinutes: wordCount ? Math.max(1, Math.ceil(wordCount / WORDS_PER_MINUTE)) : 0,
			order: readOrder(fm.order),
		})
	}

	// 归一到目录形式再做查重：/foo/ 与 /foo/index 的 outputPath 都是 foo/index.md，
	// 只按原始 url 去重会漏掉这两种写法的互撞；直通页一并纳入同一集合
	const normalizeKey = (url: string) =>
		outputPath(url).replace(/\.md$/, '').replace(/(^|\/)index$/, '$1').replace(/\/$/, '').toLowerCase()
	const urls = new Set<string>(passThrough.map(normalizeKey))
	for (const article of articles) {
		const key = normalizeKey(article.url)
		if (urls.has(key))
			throw new Error(`重复 permalink: ${article.url}`)
		urls.add(key)
	}

	scanCache = { key: cacheKey, signature, articles, passThrough, content: contentCache }
	return articles
}

/** 解析 frontmatter 日期为 YYYY-MM-DD；非法值直接报错并指明文件，避免晦涩的 Invalid Date 崩溃 */
function parseDateField(value: unknown, source: string, field: string): string {
	if (!value)
		return ''
	const date = new Date(String(value))
	if (Number.isNaN(date.getTime()))
		throw new Error(`${source} 的 frontmatter ${field} 不是合法日期：${String(value)}`)
	return date.toISOString().slice(0, 10)
}

/** 取 scanArticles 扫描时缓存的正文（search 建索引复用，避免二次读盘与 frontmatter 解析） */
export function getArticleContent(source: string): string | undefined {
	return scanCache?.content.get(source)
}

export function outputPath(url: string) {
	return url.slice(1) + (url.endsWith('/') ? 'index.md' : '.md')
}

/**
 * 目录在同级里的排序值。
 *
 * 两个来源，按顺序取第一个有值的：
 *
 * 1. 目录自己的 overview 页（`…/<目录>/index.md`）的 order —— 想直接指定某个目录的位置就写在这里；
 * 2. 目录内所有文章（含更深层子目录里的文章）order 的最小值 —— 只给文章写 order 时也能带动目录。
 *
 * 都没有就是 NO_ORDER，目录保持原来按目录名数字前缀排的顺序。
 */
function folderOrder(list: Article[], depth: number): number {
	const own = list
		.filter(article => article.folders.length === depth + 1 && article.source.endsWith('/index.md'))
		.map(article => orderOf(article.order))
	const explicit = minOrder(own)
	return explicit !== NO_ORDER ? explicit : minOrder(list.map(article => orderOf(article.order)))
}

/**
 * 把文章按目录层级聚成目录树。
 *
 * `openPath` 是「进入页面时默认展开的那一条分类路径」（就是当前文章的 folders，
 * 例如 [`群汇总`, `组织详情`]）：逐层比对，命中的分类展开、其余折叠。
 * 这样侧栏默认只展开当前分类，其它分类保持折叠；不传则全部折叠。
 *
 * 同级排序：文章取自己的 order，目录取 folderOrder，数字小的在前；
 * 排序值相同（尤其是都没写 order）时靠稳定排序保持扫描顺序，也就是文件名 / 目录名的顺序。
 */
export function buildTree(articles: Article[], depth = 0, openPath: string[] = []): DirectoryItem[] {
	const entries: { item: DirectoryItem, order: number, folder?: string }[] = []
	const groups = new Map<string, Article[]>()
	for (const article of articles) {
		const folder = article.folders[depth]
		if (!folder) {
			entries.push({ item: { text: article.title, link: article.url }, order: orderOf(article.order) })
			continue
		}
		if (!groups.has(folder)) {
			groups.set(folder, [])
			entries.push({ item: { text: folder, collapsed: openPath[depth] !== folder, items: [] }, order: NO_ORDER, folder })
		}
		groups.get(folder)!.push(article)
	}
	for (const entry of entries) {
		if (!entry.folder)
			continue
		const list = groups.get(entry.folder)!
		entry.item.items = buildTree(list, depth + 1, openPath)
		entry.order = folderOrder(list, depth)
	}
	return entries.sort((a, b) => a.order - b.order).map(entry => entry.item)
}

export function loadCatalog(root = docsRoot): Catalog {
	const articles = scanArticles(root)
	// tree（目录树）只由 config.mts 的 buildTree 消费（侧栏），不随 catalog.data 进客户端
	return { articles, categories: collectCategories(articles), tags: countTags(articles) }
}

function countTags(articles: Article[]): TaxonomyCount[] {
	const counts = new Map<string, number>()
	for (const article of articles) {
		for (const tag of article.tags) counts.set(tag, (counts.get(tag) || 0) + 1)
	}
	return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN'))
}
