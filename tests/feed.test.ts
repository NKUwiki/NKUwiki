import assert from 'node:assert/strict'
import test from 'node:test'
import { buildRssFeed, escapeXml, rfc822 } from '../docs/.vitepress/feed.ts'

const SITE = 'https://freshnkuer.wiki/'

function makeArticle(overrides: Record<string, unknown> = {}) {
	return {
		url: '/pages/GPA',
		title: '学分绩点',
		folders: ['浅谈学习'],
		tags: [],
		date: '2026-09-01',
		lastUpdated: '2026-10-01',
		lastUpdatedTime: 1_790_000_000_000,
		...overrides,
	}
}

function feed(articles: ReturnType<typeof makeArticle>[], extra: Record<string, unknown> = {}) {
	return buildRssFeed({
		siteUrl: SITE,
		title: 'NKUwiki',
		description: '南开校园知识库',
		articles,
		buildDate: new Date('2026-11-24T03:00:00Z'),
		...extra,
	})
}

test('生成合法的 RSS 2.0 文档骨架', () => {
	const xml = feed([makeArticle()])
	assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/)
	assert.match(xml, /<rss version="2\.0" xmlns:atom="http:\/\/www\.w3\.org\/2005\/Atom">/)
	assert.match(xml, /<channel>/)
	// channel 的三项必填字段
	assert.match(xml, /<title>NKUwiki<\/title>/)
	assert.match(xml, /<link>https:\/\/freshnkuer\.wiki\/<\/link>/)
	assert.match(xml, /<description>南开校园知识库<\/description>/)
	assert.match(xml, /<atom:link href="https:\/\/freshnkuer\.wiki\/feed\.xml" rel="self"/)
})

test('条目按最后更新时间降序，站点地址不拼出双斜杠', () => {
	const xml = feed([
		makeArticle({ url: '/pages/old', title: '旧文', lastUpdatedTime: 1000 }),
		makeArticle({ url: '/pages/new', title: '新文', lastUpdatedTime: 3000 }),
	])
	const newIndex = xml.indexOf('新文')
	const oldIndex = xml.indexOf('旧文')
	assert.ok(newIndex > 0 && oldIndex > newIndex, '新文应排在旧文之前')
	assert.match(xml, /<link>https:\/\/freshnkuer\.wiki\/pages\/new<\/link>/)
	// 站点地址带尾斜杠时不能拼成 //pages
	assert.doesNotMatch(xml, /wiki\/\/pages/)
})

test('limit 生效，默认最多 30 条', () => {
	const many = Array.from({ length: 40 }, (_, i) => makeArticle({ url: `/pages/p${i}`, title: `第${i}篇`, lastUpdatedTime: i }))
	assert.equal((feed(many).match(/<item>/g) ?? []).length, 30)
	assert.equal((feed(many, { limit: 5 }).match(/<item>/g) ?? []).length, 5)
})

test('XML 特殊字符被转义，标签不会破坏文档', () => {
	const xml = feed([makeArticle({ title: 'A & B <script>alert(1)</script>', folders: ['群汇总 & 组织'] })])
	assert.match(xml, /<title>A &amp; B &lt;script&gt;alert\(1\)&lt;\/script&gt;<\/title>/)
	assert.doesNotMatch(xml, /<script>/)
	assert.match(xml, /<category>群汇总 &amp; 组织<\/category>/)

	assert.equal(escapeXml(`<&>"'`), '&lt;&amp;&gt;&quot;&apos;')
})

test('日期缺失或非法时省略 pubDate，不输出 Invalid Date', () => {
	const xml = feed([makeArticle({ date: '不是日期' })])
	assert.doesNotMatch(xml, /Invalid Date/)
	assert.doesNotMatch(xml, /<pubDate>/)
	assert.equal(rfc822('2026-09-01'), new Date('2026-09-01').toUTCString())
	assert.equal(rfc822(undefined), null)
})

test('摘要在无内容时省略 description 标签', () => {
	const withSummary = feed([makeArticle()], { summaryFor: () => '正文首段摘要' })
	assert.match(withSummary, /<description>正文首段摘要<\/description>/)

	const withoutSummary = feed([makeArticle()], { summaryFor: () => '' })
	// channel 有自己的 description，条目里不该再出现一个空的
	assert.equal((withoutSummary.match(/<description>/g) ?? []).length, 1)
})
