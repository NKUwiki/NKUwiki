import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import process from 'node:process'
import test from 'node:test'
import matter from 'gray-matter'
import { createMarkdownRenderer } from 'vitepress'
import { flink, parseFlinkItems } from '../packages/wiki-theme/lib/content/flink.ts'

test('flink blocks parse items with boolean switches and drop incomplete entries', () => {
	const block = [
		'<flink>',
		'',
		'- name: 官微',
		'  url: http://weixin.qq.com/r/mp/abc',
		'  image: /img/10/10/a.jpg',
		'  description: 简介 & 说明 <b>富文本</b>',
		'  tag: 校园媒体',
		'  qr: true',
		'',
		'- name: 缺链接',
		'',
		'- name: 危险链接',
		'  url: javascript:alert(1)',
		'',
		'</flink>',
	].join('\n')
	const items = parseFlinkItems(block)
	assert.equal(items.length, 1)
	assert.equal(items[0].name, '官微')
	assert.equal(items[0].qr, true)
	assert.equal(items[0].preview, false)
	assert.equal(items[0].image, '/img/10/10/a.jpg')
	assert.equal(items[0].description, '简介 & 说明 <b>富文本</b>')
})

test('flink plugin renders the card component with escaped inline props', async () => {
	const md = await createMarkdownRenderer(process.cwd(), { config: flink })
	const html = md.render([
		'<flink>',
		'',
		'- name: A & B',
		'  url: https://example.com/',
		'  description: 介绍',
		'',
		'</flink>',
	].join('\n'))
	assert.match(html, /^<FriendLinks :links='/)
	assert.match(html, /\\u0026/)
	assert.doesNotMatch(html, /<flink/)
})

test('the friendship links page groups entries under headings and drops nothing', async () => {
	const md = await createMarkdownRenderer(process.cwd(), { config: flink })
	const { content } = matter(readFileSync('docs/10.贡献与其他/10.友情链接.md', 'utf8').replaceAll('\r\n', '\n'))
	const html = md.render(content)
	const blocks = [...content.matchAll(/<flink>[\s\S]*?<\/flink>/g)]
	assert.ok(blocks.length >= 3)
	assert.equal((html.match(/<FriendLinks\b/g) || []).length, blocks.length)
	const items = blocks.flatMap(block => parseFlinkItems(block[0]))
	assert.ok(items.length >= 6)
	for (const item of items)
		assert.ok(item.name && item.url, JSON.stringify(item))
	// 申请友链的 YAML 示例在 <flink> 块外，不得被解析进卡片 props
	assert.doesNotMatch(html, /<FriendLinks :links='[^']*站点名称/)
})
