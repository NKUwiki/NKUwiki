/**
 * 「详情页 → 汇总页卡片」的守门测试。
 *
 * 详情页末尾那张卡片不另存一份数据，全靠汇总表里「文章」列的链接回到同一行。
 * 一列漏写、permalink 改动、锚点重名，都只表现为「某页少了卡片」或「点回去落在别处」，
 * 页面上不会报错，所以在这里卡死三条：表格行与详情页一一对应、锚点唯一、
 * 回顾卡与汇总页共用同一份渲染（链接指回锚点）。
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'
import test from 'node:test'
import { createMarkdownRenderer } from 'vitepress'
import { cardlist, parseCardTables, renderCard } from '../packages/wiki-theme/lib/content/cardlist.ts'

const DOCS = resolve(process.cwd(), 'docs')
const SUMMARY = join(DOCS, '03.群汇总/03.学生组织与社团.md')
const DETAIL_DIR = join(DOCS, '03.群汇总/05.组织详情')
const SUMMARY_URL = '/pages/association/'

/** 详情页的 permalink（去尾斜杠），与汇总表「文章」列的写法对齐 */
function detailPermalinks(): string[] {
	return readdirSync(DETAIL_DIR)
		.filter(name => name.endsWith('.md'))
		.map(name => readFileSync(join(DETAIL_DIR, name), 'utf8').match(/^permalink:\s*(\S+)\s*$/m)?.[1] ?? '')
		.filter(Boolean)
		.map(link => link.replace(/\/+$/, ''))
}

async function readRows() {
	const md = await createMarkdownRenderer(process.cwd(), { config: cardlist })
	return parseCardTables(md, readFileSync(SUMMARY, 'utf8'))
}

test('汇总表的每一行都能对上详情页，详情页也都能查到卡片', async () => {
	const rows = await readRows()
	const links = new Set(rows.map(row => row.link))
	const permalinks = detailPermalinks()

	assert.equal(rows.length, permalinks.length, '表格行数与详情页数量不一致')
	const missing = permalinks.filter(link => !links.has(link))
	assert.deepEqual(missing, [], `这些详情页在汇总表里没有对应卡片，页面不会出现「所属汇总」：\n${missing.join('\n')}`)

	const orphans = rows.filter(row => !row.link).map(row => row.cells[0])
	assert.deepEqual(orphans, [], `这些行没有「文章」列，无法生成锚点：\n${orphans.join('\n')}`)
})

test('锚点唯一、非空，能直接拼成回跳链接', async () => {
	const rows = await readRows()
	const anchors = rows.map(row => row.anchor)

	assert.ok(anchors.every(Boolean), '存在生成不出锚点的行')
	const duplicated = anchors.filter((anchor, index) => anchors.indexOf(anchor) !== index)
	assert.deepEqual(duplicated, [], `锚点重复，回跳会落到别的卡片：\n${duplicated.join('\n')}`)
	for (const anchor of anchors)
		assert.match(anchor ?? '', /^org-[a-z0-9-]+$/)
})

test('回顾卡与汇总页共用同一份渲染，链接指回锚点', async () => {
	const rows = await readRows()
	const row = rows.find(item => item.link === '/pages/Zipo')
	assert.ok(row, '找不到紫珀社那一行')
	const anchor = row.anchor
	assert.ok(anchor)

	const html = renderCard({ headers: row.headers, cells: row.cells, link: `${SUMMARY_URL}#${anchor}` })
	assert.match(html, /class="campus-card"/)
	assert.match(html, new RegExp(`class="card-overlay-link" href="${SUMMARY_URL}#${anchor}"`))
	// 名称来自汇总表，详情页不另存
	assert.match(html, /campus-card-title">南开大学紫珀社</)
	assert.doesNotMatch(html, /id="/, '详情页的回顾卡不该再带一份锚点 id')
})

test('回顾卡的悬停提示由 linkTitle 传入，汇总页的卡片保持原样', async () => {
	const rows = await readRows()
	const row = rows.find(item => item.link === '/pages/Zipo')
	assert.ok(row)
	const link = `${SUMMARY_URL}#${row.anchor}`
	const hint = '点击卡片可回到汇总页中的这张卡片'

	const recap = renderCard({ headers: row.headers, cells: row.cells, link, linkTitle: hint })
	assert.match(recap, new RegExp(`class="card-overlay-link" href="${link}" title="${hint}"`))

	// 汇总页的卡片只负责「进入详情」，不该凭空多出提示
	const summaryCard = renderCard({ headers: row.headers, cells: row.cells, link })
	assert.doesNotMatch(summaryCard, /class="card-overlay-link"[^>]*title=/)
})
