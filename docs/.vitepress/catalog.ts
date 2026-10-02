import type { Article, Catalog, DirectoryItem, TaxonomyCount } from './types.ts'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import matter from 'gray-matter'
import { categoryPaths, collectCategories } from './category.ts'

export const docsRoot = fileURLToPath(new URL('../', import.meta.url))
const label = (name: string) => name.replace(/^\d+\./, '').replace(/\.md$/, '')
function strings(value: unknown): string[] {
	const values: unknown[] = Array.isArray(value) ? value : [value]
	return [...new Set(values.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(Boolean))]
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
 * 把文章按目录层级聚成目录树。
 *
 * `openPath` 是「进入页面时默认展开的那一条分类路径」（就是当前文章的 folders，
 * 例如 [`群汇总`, `组织详情`]）：逐层比对，命中的分类展开、其余折叠。
 * 这样侧栏默认只展开当前分类，其它分类保持折叠；不传则全部折叠。
 */
export function buildTree(articles: Article[], depth = 0, openPath: string[] = []): DirectoryItem[] {
	const items: DirectoryItem[] = []
	const groups = new Map<string, Article[]>()
	for (const article of articles) {
		const folder = article.folders[depth]
		if (!folder) {
			items.push({ text: article.title, link: article.url })
			continue
		}
		if (!groups.has(folder)) {
			groups.set(folder, [])
			items.push({ text: folder, collapsed: openPath[depth] !== folder, items: [] })
		}
		groups.get(folder)!.push(article)
	}
	for (const item of items) {
		if (!item.link)
			item.items = buildTree(groups.get(item.text)!, depth + 1, openPath)
	}
	return items
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
