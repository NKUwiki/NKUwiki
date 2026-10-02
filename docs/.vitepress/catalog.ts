import type { Article, Catalog, DirectoryItem, TaxonomyCount } from './types.ts'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import matter from 'gray-matter'
import { categoryPaths, collectCategories } from './category.ts'
import { minOrder, NO_ORDER, orderOf } from './order.ts'

export const docsRoot = fileURLToPath(new URL('../', import.meta.url))
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
		const marker = line.match(/^\s*(`{3,}|~{3,})/)?.[1]
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
	const articles: Article[] = []
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
			if (!/^\d+\./.test(source))
				continue
			const { data: fm, content } = matter(readFileSync(file, 'utf8'))
			if (fm.article === false)
				continue
			const wordCount = countWords(content)
			const lastUpdated = fm.lastUpdated ? new Date(fm.lastUpdated).toISOString().slice(0, 10) : ''
			const folders = source.split('/').slice(0, -1).map(label)
			const url = fm.permalink || `/${source.replace(/\.md$/, '')}`
			if (!url.startsWith('/') || /[?#]|\.\./.test(url))
				throw new Error(`无效 permalink: ${source}`)
			articles.push({
				source,
				url,
				title: fm.title || label(entry.name),
				folders,
				// 目录层级本身就是分类层级（03.群汇总/05.组织详情/x.md → 群汇总/组织详情），
				// frontmatter 的 categories 可再用缩进补充层级；两者都按完整路径去重
				categories: [...new Set([folders.join('/'), ...categoryPaths(fm.categories)].filter(Boolean))],
				tags: strings(fm.tags),
				date: fm.date ? new Date(fm.date).toISOString().slice(0, 10) : '',
				lastUpdated,
				lastUpdatedTime: lastUpdated ? Date.parse(lastUpdated) : 0,
				hasHeading: hasTitleHeading(content),
				empty: !content.trim(),
				wordCount,
				readingMinutes: wordCount ? Math.max(1, Math.ceil(wordCount / WORDS_PER_MINUTE)) : 0,
				order: readOrder(fm.order),
			})
		}
	}
	visit(root)
	const urls = new Set<string>()
	for (const article of articles) {
		const key = article.url.replace(/\/$/, '').toLowerCase()
		if (urls.has(key))
			throw new Error(`重复 permalink: ${article.url}`)
		urls.add(key)
	}
	return articles
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
	return { articles, tree: buildTree(articles), categories: collectCategories(articles), tags: countTags(articles) }
}

function countTags(articles: Article[]): TaxonomyCount[] {
	const counts = new Map<string, number>()
	for (const article of articles) {
		for (const tag of article.tags) counts.set(tag, (counts.get(tag) || 0) + 1)
	}
	return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN'))
}
