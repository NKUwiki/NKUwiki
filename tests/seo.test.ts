import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'
import test from 'node:test'
import { assertSeoTitleMapMatches, seoTitleFor, seoTitleMap, standaloneSeo } from '../docs/.vitepress/seo.ts'
import { scanArticles } from '../packages/wiki-theme/lib/content/catalog.ts'

test('404.md 不被当成文章扫描', () => {
	const articles = scanArticles()
	// 404.md 满足「数字开头」的命名（"404." + "md"），但它是错误页：
	// 一旦进了目录树就会被列进侧栏、分类、标签、搜索索引和站点地图
	assert.equal(articles.find(article => article.source === '404.md'), undefined)
	assert.equal(articles.find(article => article.url === '/404'), undefined)
})

test('临时目录里 404.md 同样不进文章列表', () => {
	const root = mkdtempSync(join(tmpdir(), 'nkuwiki-404-'))
	try {
		mkdirSync(join(root, '01.新生入学'))
		writeFileSync(join(root, '404.md'), '---\ntitle: 页面未找到 (404)\n---\n\n正文')
		writeFileSync(join(root, '01.新生入学/01.入学准备.md'), '---\ntitle: 入学准备\n---\n\n正文')
		assert.deepEqual(scanArticles(root).map(article => article.source), ['01.新生入学/01.入学准备.md'])
	}
	finally {
		const target = relative(tmpdir(), root)
		assert.ok(target && !target.startsWith('..') && !isAbsolute(target))
		rmSync(root, { recursive: true, force: true })
	}
})

test('seoTitleMap 的每个 key 都能对上真实文章', () => {
	// 映射靠 permalink 字符串匹配，key 写错会静默失效，构建期必须能发现
	assert.doesNotThrow(() => assertSeoTitleMapMatches(scanArticles()))
	// 传一份空目录：所有映射都指向不存在的文章，必须报错而不是静默失效
	assert.throws(() => assertSeoTitleMapMatches([]), /映射不会生效/)
})

test('没有映射的标题原样返回', () => {
	assert.equal(seoTitleFor({ url: '/pages/MilitaryTraining', title: '军训', folders: ['新生入学'] }), seoTitleMap['/pages/MilitaryTraining'])
	assert.equal(seoTitleFor({ url: '/pages/not-mapped', title: '某篇文章', folders: ['浅谈学习'] }), '某篇文章')
})

test('社团详情页自动补校名，已带「南开」的不重复', () => {
	const folders = ['群汇总', '组织详情']
	assert.equal(seoTitleFor({ url: '/pages/Redology', title: '红学社', folders }), '南开大学红学社')
	assert.equal(seoTitleFor({ url: '/pages/WomenFootball', title: '南开女足', folders }), '南开女足')
	// 非组织详情目录不做补全
	assert.equal(seoTitleFor({ url: '/pages/not-mapped', title: '校园趣闻', folders: ['校园生活'] }), '校园趣闻')
})

test('SEO 标题主体里不重复品牌名', () => {
	// 品牌后缀由 titleTemplate 统一拼一次，主体再写一遍会得到「… | NKUwiki」里套 NKUwiki
	const titles = [
		...Object.values(seoTitleMap),
		...Object.values(standaloneSeo).map(entry => entry.title).filter(Boolean),
	]
	for (const title of titles)
		assert.equal((title!.match(/NKUwiki/gi) || []).length, 0, `标题重复出现品牌名：${title}`)
})

test('SEO 标题主体不超过 SERP 常见宽度', () => {
	// 按显示宽度算而不是字符数：中文占 2 个宽度、ASCII 占 1 个，所以
	// 「WSL 安装教程：在 Windows 上安装 Linux 子系统」虽然 32 字符但并不比
	// 22 个汉字的标题长。上限 50 ≈ 25 个汉字，再长会在结果页被省略号截掉
	const displayWidth = (text: string) => [...text].reduce((sum, ch) => sum + (/[\u0020-\u007E]/.test(ch) ? 1 : 2), 0)
	const titles = [
		...Object.entries(seoTitleMap).map(([url, title]) => [url, title] as const),
		...Object.entries(standaloneSeo).map(([file, entry]) => [file, entry.title] as const),
	]
	for (const [key, title] of titles) {
		if (!title)
			continue
		assert.ok(displayWidth(title) <= 50, `${key} 的标题过宽（${displayWidth(title)}，上限 50）：${title}`)
	}
})

test('standaloneSeo 的 key 都对应真实页面', () => {
	// 与 seoTitleMap 同样的坑：索引页改名或挪位置后，覆盖会静默失效、退回短标题。
	// 这里直接检查源文件是否存在（key 是相对 docs 的路径）
	const docsDir = join(import.meta.dirname, '..', 'docs')
	for (const file of Object.keys(standaloneSeo))
		assert.ok(existsSync(join(docsDir, file)), `standaloneSeo 的 key 不是真实页面：${file}`)
})
