import type { DirectoryItem } from '../packages/wiki-theme/lib/types.ts'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'
import test from 'node:test'
import { buildTree, countWords, loadCatalog, outputPath, scanArticles } from '../packages/wiki-theme/lib/content/catalog.ts'
import { categoryChildren, categoryPaths, resolveCategory } from '../packages/wiki-theme/lib/content/category.ts'

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

test('side bar tree opens only the current article category path', () => {
	const articles = scanArticles()
	const categoryOf = (title: string) => articles.find(article => article.title === title)!.folders
	// 只展开当前分类：其余分类（含子分类）保持折叠
	const plain = buildTree(articles, 0, categoryOf('入学准备'))
	assert.deepEqual(plain.filter(item => !item.collapsed).map(item => item.text), ['新生入学'])
	const clubs = plain.find(item => item.text === '群汇总')!
	assert.equal(clubs.collapsed, true)
	assert.equal(clubs.items!.find(item => item.text === '组织详情')!.collapsed, true)
	// 当前文章所在的子分类逐级展开
	const nested = buildTree(articles, 0, categoryOf('电影协会'))
	const open = nested.find(item => item.text === '群汇总')!
	assert.equal(open.collapsed, false)
	assert.equal(open.items!.find(item => item.text === '组织详情')!.collapsed, false)
	// 不传路径时全部折叠
	assert.ok(buildTree(articles).every(item => item.collapsed === true))
})

test('word count ignores code, formulas, links and counts CJK per character', () => {
	const root = mkdtempSync(join(tmpdir(), 'ncepu-wordcount-'))
	try {
		mkdirSync(join(root, '01.专题'))
		// 四个汉字按字计，代码块整段不计入
		assert.equal(countWords('南开大学\n\n```js\nconst a = 1\n```\n'), 4)
		// 英文按词计，行内代码不计入，链接保留可读文字
		assert.equal(countWords('see [the docs](https://a.b) and `npm run build`'), 4)
		// 行内公式与图片不计入
		assert.equal(countWords('欧拉公式 $e^{i\\pi}+1=0$ 结果 ![图](/a.png)'), 6)
		assert.equal(countWords(''), 0)
		writeFileSync(join(root, '01.专题/01.空.md'), '')
		writeFileSync(join(root, '01.专题/02.正文.md'), '南开大学')
		const [blank, written] = scanArticles(root)
		assert.equal(blank.wordCount, 0)
		assert.equal(blank.readingMinutes, 0)
		assert.equal(written.wordCount, 4)
		// 不足 500 字也按 1 分钟算，够读才对得上体感
		assert.equal(written.readingMinutes, 1)
	}
	finally {
		const target = relative(tmpdir(), root)
		assert.ok(target && !target.startsWith('..') && !isAbsolute(target))
		rmSync(root, { recursive: true, force: true })
	}
})

test('siblings follow filename numbering, subfolders come first, and frontmatter order is ignored', () => {
	const root = mkdtempSync(join(tmpdir(), 'ncepu-sort-'))
	try {
		mkdirSync(join(root, '01.甲'))
		mkdirSync(join(root, '01.甲/10.子目录'))
		mkdirSync(join(root, '01.甲/20.另一子目录'))
		mkdirSync(join(root, '02.乙'))
		// 甲：散文章与子目录交错，侧栏里两个子目录整体排在散文章前面，各自仍按编号
		writeFileSync(join(root, '01.甲/01.靠前.md'), '---\ntitle: 靠前\n---\n正文')
		writeFileSync(join(root, '01.甲/30.靠后.md'), '---\ntitle: 靠后\n---\n正文')
		writeFileSync(join(root, '01.甲/10.子目录/01.子文章.md'), '---\ntitle: 子文章\n---\n正文')
		writeFileSync(join(root, '01.甲/20.另一子目录/01.另一篇.md'), '---\ntitle: 另一篇\n---\n正文')
		// 残留的 order 字段不再参与排序（乙按目录编号排在甲后）
		writeFileSync(join(root, '02.乙/01.乙文章.md'), '---\ntitle: 乙文章\norder: 0\n---\n正文')
		const articles = scanArticles(root)
		assert.ok(articles.every(article => !('order' in article)))
		assert.deepEqual(buildTree(articles).map(item => item.text), ['甲', '乙'])
		assert.deepEqual(buildTree(articles).find(item => item.text === '甲')!.items!.map(item => item.text), ['子目录', '另一子目录', '靠前', '靠后'])
		assert.deepEqual(buildTree(articles).find(item => item.text === '乙')!.items!.map(item => item.text), ['乙文章'])
		// 分类顺序同样由文件名编号决定，与侧栏一致；子分类跟在所属分类后面
		const { categories } = loadCatalog(root)
		assert.deepEqual(categories.map(category => category.path), ['甲', '甲/子目录', '甲/另一子目录', '乙'])
		assert.ok(categories.every(category => !('order' in category)))
		assert.deepEqual(categoryChildren(categories, '甲').map(category => category.path), ['甲/子目录', '甲/另一子目录'])
	}
	finally {
		const target = relative(tmpdir(), root)
		assert.ok(target && !target.startsWith('..') && !isAbsolute(target))
		rmSync(root, { recursive: true, force: true })
	}
})

test('lastUpdated prefers the explicit field, falls back to date, and ignores legacy updated', () => {
	const root = mkdtempSync(join(tmpdir(), 'ncepu-dates-'))
	try {
		mkdirSync(join(root, '01.专题'))
		writeFileSync(join(root, '01.专题/01.文章.md'), '---\ndate: 2025-08-31\nlastUpdated: 2026-09-14\n---\n正文')
		writeFileSync(join(root, '01.专题/02.无修改日期.md'), '---\ndate: 2025-08-31\nupdated: 2026-09-14\n---\n正文')
		const [article, missing] = loadCatalog(root).articles
		assert.equal(article.date, '2025-08-31')
		assert.equal(article.lastUpdated, '2026-09-14')
		assert.equal(article.lastUpdatedTime, Date.parse('2026-09-14'))
		// 没写 lastUpdated 时以 date 兜底；旧字段 updated 不识别，不得覆盖兜底值
		assert.equal(missing.date, '2025-08-31')
		assert.equal(missing.lastUpdated, '2025-08-31')
		assert.equal(missing.lastUpdatedTime, Date.parse('2025-08-31'))
	}
	finally {
		const target = relative(tmpdir(), root)
		assert.ok(target && !target.startsWith('..') && !isAbsolute(target))
		rmSync(root, { recursive: true, force: true })
	}
})
