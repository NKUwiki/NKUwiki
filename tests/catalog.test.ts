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

test('order decides sibling order, unset entries keep their natural order behind ordered ones', () => {
	const root = mkdtempSync(join(tmpdir(), 'ncepu-order-'))
	try {
		mkdirSync(join(root, '01.甲'))
		mkdirSync(join(root, '01.甲/01.子'))
		mkdirSync(join(root, '02.乙'))
		// 甲：更后(order 1) 会排到 后(order 2) 前面，没写 order 的 无序号 留在最后
		writeFileSync(join(root, '01.甲/10.后.md'), '---\ntitle: 后\norder: 2\n---\n正文')
		writeFileSync(join(root, '01.甲/20.更后.md'), '---\ntitle: 更后\norder: 1\n---\n正文')
		writeFileSync(join(root, '01.甲/30.无序号.md'), '---\ntitle: 无序号\n---\n正文')
		// 子目录按自己文章的最小值(3)参与同级排序，落在 后(2) 与 无序号 之间
		writeFileSync(join(root, '01.甲/01.子/01.子文章.md'), '---\ntitle: 子文章\norder: 3\n---\n正文')
		// 乙：只有一篇文章但 order 更小，整个分类排到 01.甲 前面
		writeFileSync(join(root, '02.乙/01.乙文章.md'), '---\ntitle: 乙文章\norder: 0\n---\n正文')
		// 写成字符串的数字同样有效，非数字当作没写
		writeFileSync(join(root, '02.乙/02.字符串.md'), '---\ntitle: 字符串\norder: "3"\n---\n正文')
		writeFileSync(join(root, '02.乙/03.非法.md'), '---\ntitle: 非法\norder: 靠前\n---\n正文')
		const articles = scanArticles(root)
		const orderOf = (title: string) => articles.find(article => article.title === title)!.order
		assert.equal(orderOf('后'), 2)
		assert.equal(orderOf('字符串'), 3)
		assert.equal(orderOf('无序号'), undefined)
		assert.equal(orderOf('非法'), undefined)
		assert.deepEqual(buildTree(articles).map(item => item.text), ['乙', '甲'])
		const jia = buildTree(articles).find(item => item.text === '甲')!
		assert.deepEqual(jia.items!.map(item => item.text), ['更后', '后', '子', '无序号'])
		assert.deepEqual(buildTree(articles).find(item => item.text === '乙')!.items!.map(item => item.text), ['乙文章', '字符串', '非法'])
		// 分类顺序与侧栏同口径：取分类内（含子分类）文章 order 的最小值
		const { categories } = loadCatalog(root)
		assert.deepEqual(categories.map(category => category.path), ['乙', '甲', '甲/子'])
		assert.equal(categories.find(category => category.path === '甲')!.order, 1)
		assert.equal(categories.find(category => category.path === '甲/子')!.order, 3)
	}
	finally {
		const target = relative(tmpdir(), root)
		assert.ok(target && !target.startsWith('..') && !isAbsolute(target))
		rmSync(root, { recursive: true, force: true })
	}
})

test('a folder can pin its own position with an index.md order', () => {
	const root = mkdtempSync(join(tmpdir(), 'ncepu-order-index-'))
	try {
		mkdirSync(join(root, '01.甲'))
		mkdirSync(join(root, '02.乙'))
		writeFileSync(join(root, '01.甲/01.文章.md'), '---\ntitle: 甲文章\norder: 1\n---\n正文')
		writeFileSync(join(root, '02.乙/01.文章.md'), '---\ntitle: 乙文章\norder: 0\n---\n正文')
		// 乙的 index.md 写了 order: 9，显式指定优先于「目录内文章的最小值」，于是乙退到甲后面
		writeFileSync(join(root, '02.乙/index.md'), '---\ntitle: 乙概览\norder: 9\n---\n正文')
		assert.deepEqual(buildTree(scanArticles(root)).map(item => item.text), ['甲', '乙'])
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
