import type { DirectoryItem } from '../docs/.vitepress/types.ts'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'
import test from 'node:test'
import { buildTree, loadCatalog, outputPath, scanArticles } from '../docs/.vitepress/catalog.ts'
import { categoryChildren, categoryPaths, resolveCategory } from '../docs/.vitepress/category.ts'

test('existing article URLs are unique and all articles appear once in the directory', () => {
	const articles = scanArticles()
	assert.ok(articles.length > 20)
	const flatten = (items: DirectoryItem[]): string[] => items.flatMap(item => item.link ? [item.link] : flatten(item.items || []))
	assert.deepEqual(flatten(buildTree(articles)).sort(), articles.map(article => article.url).sort())
	assert.equal(articles.find(article => article.title === '入学准备')!.url, '/pages/Preparation')
	assert.equal(articles.find(article => article.title === '友情链接')!.url, '/pages/FriendshipLinks/')
	assert.equal(outputPath('/pages/Preparation'), 'pages/Preparation.md')
	assert.equal(outputPath('/pages/FriendshipLinks/'), 'pages/FriendshipLinks/index.md')
})

test('category paths merge directory levels with nested frontmatter without duplicates', () => {
	const { articles, tags, categories } = loadCatalog()
	const article = articles.find(article => article.title === '入学准备')!
	assert.ok(article.categories.includes('新生入学'))
	assert.equal(article.categories.filter(category => category === '新生入学').length, 1)
	// 目录层级（群汇总/组织详情）与 frontmatter 的「群汇总 - 组织详情」是同一条路径
	const club = articles.find(article => article.title === '电影协会')!
	assert.deepEqual(club.categories, ['群汇总/组织详情'])
	for (const { name, count } of tags) assert.equal(count, articles.filter(article => article.tags.includes(name)).length)
	// 分类统计的是「直接属于该路径」的文章数，不含子分类
	for (const { path, count } of categories) assert.equal(count, articles.filter(article => article.categories.includes(path)).length)
	assert.ok(articles.every(article => !article.lastUpdated || /^\d{4}-\d{2}-\d{2}$/.test(article.lastUpdated)))
})

test('分类支持缩进层级，子分类可以逐级进入且按末级名字解析链接', () => {
	assert.deepEqual(categoryPaths(['群汇总 - 组织详情']), ['群汇总/组织详情'])
	assert.deepEqual(categoryPaths(['群汇总', '校园生活']), ['群汇总', '校园生活'])
	assert.deepEqual(categoryPaths(null), [])
	const { categories } = loadCatalog()
	assert.equal(categories.find(category => category.path === '组织详情'), undefined)
	assert.equal(resolveCategory(categories, '组织详情'), '群汇总/组织详情')
	assert.equal(resolveCategory(categories, '群汇总'), '群汇总')
	assert.deepEqual(categoryChildren(categories, '群汇总').map(category => category.path), ['群汇总/组织详情'])
})

test('new files use numeric directory order, preserve tags, infer missing titles, and reject duplicate routes', () => {
	const root = mkdtempSync(join(tmpdir(), 'ncepu-catalog-'))
	try {
		mkdirSync(join(root, '01.专题'))
		writeFileSync(join(root, '01.专题/10.后一篇.md'), '')
		writeFileSync(join(root, '01.专题/02.前一篇.md'), '---\ntitle: 前一篇\npermalink: /pages/test/\ntags: [测试, 测试, null, ""]\ncategories: [专题]\n---\n```sh\n# A code comment is not an article heading\n```\n正文')
		const articles = scanArticles(root)
		assert.deepEqual(articles.map(article => article.title), ['前一篇', '后一篇'])
		assert.deepEqual(articles[0].tags, ['测试'])
		assert.deepEqual(articles[0].categories, ['专题'])
		assert.equal(articles[1].empty, true)
		assert.equal(articles[0].hasHeading, false)
		mkdirSync(join(root, '01.专题/01.子专题'))
		writeFileSync(join(root, '01.专题/01.子专题/01.文章.md'), '# 文章')
		assert.equal(buildTree(scanArticles(root))[0].items![0].text, '子专题')
		writeFileSync(join(root, '01.专题/03.重复.md'), '---\npermalink: /pages/test\n---')
		assert.throws(() => scanArticles(root), /重复 permalink/)
	}
	finally {
		const target = relative(tmpdir(), root)
		assert.ok(target && !target.startsWith('..') && !isAbsolute(target))
		rmSync(root, { recursive: true, force: true })
	}
})

test('lastUpdated is explicit and never falls back to creation dates or legacy updated', () => {
	const root = mkdtempSync(join(tmpdir(), 'ncepu-dates-'))
	try {
		mkdirSync(join(root, '01.专题'))
		writeFileSync(join(root, '01.专题/01.文章.md'), '---\ndate: 2025-08-31\nlastUpdated: 2026-09-14\n---\n正文')
		writeFileSync(join(root, '01.专题/02.无修改日期.md'), '---\ndate: 2025-08-31\nupdated: 2026-09-14\n---\n正文')
		const [article, missing] = loadCatalog(root).articles
		assert.equal(article.date, '2025-08-31')
		assert.equal(article.lastUpdated, '2026-09-14')
		assert.equal(article.lastUpdatedTime, Date.parse('2026-09-14'))
		assert.equal(missing.lastUpdated, '')
		assert.equal(missing.lastUpdatedTime, 0)
	}
	finally {
		const target = relative(tmpdir(), root)
		assert.ok(target && !target.startsWith('..') && !isAbsolute(target))
		rmSync(root, { recursive: true, force: true })
	}
})
