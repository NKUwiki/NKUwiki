import type { HeadTag, SeoArticle } from '../docs/.vitepress/seo.ts'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'
import test from 'node:test'
import { assertSeoTitleMapMatches, pageSeoHead, seoTitleFor, seoTitleMap, standaloneSeo } from '../docs/.vitepress/seo.ts'
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

// ================= 页面 <head> 生成 =================

const SITE = 'https://freshnkuer.wiki'
const FALLBACK_AUTHOR = 'NKUwiki-Group'

/** 从 head 数组里取 meta 的 content */
function metaContent(head: HeadTag[], key: string, by: 'property' | 'name' = 'property'): string | undefined {
	return head.find(([tag, attrs]) => tag === 'meta' && attrs[by] === key)?.[1].content
}

function canonicalOf(head: HeadTag[]): string | undefined {
	return head.find(([tag, attrs]) => tag === 'link' && attrs.rel === 'canonical')?.[1].href
}

/** 页面 <head> 里的 JSON-LD 文本（本站每页最多一段） */
function jsonLdOf(head: HeadTag[]): string {
	return head.find(([tag]) => tag === 'script')?.[2] ?? ''
}

function makeArticle(overrides: Partial<SeoArticle> = {}): SeoArticle {
	return {
		url: '/pages/GPA',
		title: '学分绩点',
		folders: ['浅谈学习'],
		tags: ['绩点', '保研'],
		date: '2026-09-01',
		lastUpdated: '2026-10-01',
		empty: false,
		...overrides,
	}
}

test('文章页 canonical 用 permalink，且不拼出双斜杠', () => {
	const head = pageSeoHead({
		siteUrl: `${SITE}/`,
		pagePath: '/pages/GPA',
		pageTitle: '学分绩点',
		ogTitle: '学分绩点',
		description: '描述',
		article: makeArticle(),
		fallbackAuthor: FALLBACK_AUTHOR,
	})
	assert.equal(canonicalOf(head), `${SITE}/pages/GPA`)
})

test('直通页 index.md 归一后的路径仍然合法', () => {
	// categories/index.md → "categories/"，尾部斜杠保留、前导不重复
	const head = pageSeoHead({
		siteUrl: SITE,
		pagePath: 'categories/',
		pageTitle: '文章分类',
		ogTitle: '文章分类',
		description: '描述',
		fallbackAuthor: FALLBACK_AUTHOR,
	})
	assert.equal(canonicalOf(head), `${SITE}/categories/`)
	assert.equal(metaContent(head, 'og:type'), 'website')
})

test('404 只产出一条 noindex，不带 canonical 与社交卡片', () => {
	const head = pageSeoHead({
		siteUrl: SITE,
		pagePath: '404',
		pageTitle: '',
		ogTitle: '',
		description: '',
		fallbackAuthor: FALLBACK_AUTHOR,
		is404: true,
	})
	assert.deepEqual(head, [['meta', { name: 'robots', content: 'noindex, nofollow' }]])
})

test('首页的图片替代文本不重复品牌名', () => {
	const head = pageSeoHead({
		siteUrl: SITE,
		pagePath: '',
		pageTitle: 'NKUwiki · 南开大学校园知识库',
		ogTitle: 'NKUwiki · 南开大学校园知识库',
		description: '描述',
		fallbackAuthor: FALLBACK_AUTHOR,
		isHome: true,
	})
	assert.equal(metaContent(head, 'og:image:alt'), 'NKUwiki · 南开大学校园知识库')
})

test('普通页面的图片替代文本补上品牌尾巴', () => {
	const head = pageSeoHead({
		siteUrl: SITE,
		pagePath: 'map',
		pageTitle: '校园地图',
		ogTitle: '校园地图',
		description: '描述',
		fallbackAuthor: FALLBACK_AUTHOR,
	})
	assert.equal(metaContent(head, 'og:image:alt'), '校园地图 · NKUwiki')
})

test('具名作者标 Person，组织兜底标 Organization', () => {
	const named = pageSeoHead({
		siteUrl: SITE,
		pagePath: '/pages/GPA',
		pageTitle: '学分绩点',
		ogTitle: '学分绩点',
		description: '描述',
		article: makeArticle(),
		authors: [{ name: '张三' }],
		fallbackAuthor: FALLBACK_AUTHOR,
	})
	assert.match(jsonLdOf(named), /"@type":"Person","name":"张三"/)

	// 没写 author 时 collectAuthors 会回退成组织账号，不能当成自然人
	const anonymous = pageSeoHead({
		siteUrl: SITE,
		pagePath: '/pages/GPA',
		pageTitle: '学分绩点',
		ogTitle: '学分绩点',
		description: '描述',
		article: makeArticle(),
		authors: [{ name: FALLBACK_AUTHOR }],
		fallbackAuthor: FALLBACK_AUTHOR,
	})
	assert.match(jsonLdOf(anonymous), /"name":"NKUwiki-Group"/)
	assert.doesNotMatch(jsonLdOf(anonymous), /"@type":"Person"/)
})

test('article:tag 最多 6 条，日期补成 ISO 8601', () => {
	const head = pageSeoHead({
		siteUrl: SITE,
		pagePath: '/pages/GPA',
		pageTitle: '学分绩点',
		ogTitle: '学分绩点',
		description: '描述',
		article: makeArticle({ tags: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] }),
		fallbackAuthor: FALLBACK_AUTHOR,
	})
	const tagCount = head.filter(([tag, attrs]) => tag === 'meta' && attrs.property === 'article:tag').length
	assert.equal(tagCount, 6)
	// 裸日期在部分抓取方眼里无效，必须带时区
	assert.equal(metaContent(head, 'article:published_time'), new Date('2026-09-01').toISOString())
})

test('空正文占位页不索引，正常文章可索引', () => {
	const empty = pageSeoHead({
		siteUrl: SITE,
		pagePath: '/pages/Empty',
		pageTitle: '占位',
		ogTitle: '占位',
		description: '描述',
		article: makeArticle({ url: '/pages/Empty', empty: true }),
		fallbackAuthor: FALLBACK_AUTHOR,
	})
	const robots = empty.filter(([tag, attrs]) => tag === 'meta' && attrs.name === 'robots').map(([, attrs]) => attrs.content)
	assert.ok(robots.includes('noindex, nofollow'))

	const normal = pageSeoHead({
		siteUrl: SITE,
		pagePath: '/pages/GPA',
		pageTitle: '学分绩点',
		ogTitle: '学分绩点',
		description: '描述',
		article: makeArticle(),
		fallbackAuthor: FALLBACK_AUTHOR,
	})
	assert.doesNotMatch(metaContent(normal, 'robots', 'name') ?? '', /noindex/)
})

test('首页带 WebSite 结构化数据，文章页带 Article', () => {
	const home = pageSeoHead({
		siteUrl: SITE,
		pagePath: '',
		pageTitle: 'NKUwiki',
		ogTitle: 'NKUwiki',
		description: '描述',
		fallbackAuthor: FALLBACK_AUTHOR,
		isHome: true,
	})
	assert.match(jsonLdOf(home), /"@type":"WebSite"/)

	const article = pageSeoHead({
		siteUrl: SITE,
		pagePath: '/pages/GPA',
		pageTitle: '学分绩点',
		ogTitle: '学分绩点',
		description: '描述',
		article: makeArticle(),
		fallbackAuthor: FALLBACK_AUTHOR,
	})
	assert.match(jsonLdOf(article), /"@type":"Article"/)
	// Article 的 image 是必填，缺了拿不到富结果
	assert.match(jsonLdOf(article), /"image":\{"@type":"ImageObject"/)
})
