// Markdown 扩展插件的回归测试：mark（马克笔）、annotation（行内注释）、
// code-title（代码块标题）、steps（步骤容器）、timeline（时间线容器）。
// 渲染器用 VitePress 的 createMarkdownRenderer（与 config.mts 同一入口，
// 保证测试环境与生产一致）；插件通过 config 选项传入。
import assert from 'node:assert/strict'
import process from 'node:process'
import test from 'node:test'
import { createMarkdownRenderer } from 'vitepress'
import { annotation } from '../packages/wiki-theme/lib/markdown/annotation.ts'
import { codeTitle } from '../packages/wiki-theme/lib/markdown/code-title.ts'
import { mark } from '../packages/wiki-theme/lib/markdown/mark.ts'
import { steps } from '../packages/wiki-theme/lib/markdown/steps.ts'
import { timeline } from '../packages/wiki-theme/lib/markdown/timeline.ts'

function all(md: Parameters<typeof mark>[0]) {
	annotation(md)
	codeTitle(md)
	mark(md)
	steps(md)
	timeline(md)
}

async function render(source: string) {
	const md = await createMarkdownRenderer(process.cwd(), { config: all })
	return md.render(source)
}

test('mark renders ==highlight== with optional color class', async () => {
	const html = await render('==重点==和==提示=={.tip}\n')
	assert.ok(html.includes('<mark>重点</mark>'), html)
	assert.ok(html.includes('<mark class="tip">提示</mark>'), html)
})

test('mark ignores ===, spaced content and unclosed marker without eating text', async () => {
	const html = await render('a == b 与 a === b；== x == 不是马克笔；==abc 后面没有闭合，这段要完整保留\n')
	assert.ok(!html.includes('<mark'), html)
	assert.ok(html.includes('a == b'), html)
	// 回归：未闭合的 == 不得吞掉后续文本
	assert.ok(html.includes('这段要完整保留'), html)
})

test('mark supports nested emphasis and keeps literal == in code span', async () => {
	const html = await render('==**加粗**与`a == b`代码==\n')
	assert.ok(html.includes('<mark>'), html)
	assert.ok(html.includes('<strong>加粗</strong>'), html)
	assert.ok(html.includes('a == b'), html)
})

test('annotation renders sup bubble but not for math superscript', async () => {
	const html = await render('南开大学{^Nankai University} 与 2^{10}\n')
	assert.ok(html.includes('wiki-annotation'), html)
	assert.ok(html.includes('Nankai University'), html)
	// 纯数字注释疑似数学上标，annotation 规则应放行（{10} 会被 VitePress 内置
	// attrs 插件消费成段落属性，这是生产环境的既有行为，这里只验证不产生注释气泡）
	assert.ok(html.includes('2^'), html)
	assert.ok(!html.includes('注释：10'), html)
})

test('code-title wraps fence with data-title and keeps language', async () => {
	const html = await render('```ts title="config.mts"\nconst a = 1\n```\n')
	assert.ok(html.includes('class="wiki-code-title" data-title="config.mts"'), html)
	assert.ok(html.includes('language-ts'), html)
	// 无 title 的代码块不受影响
	const plain = await render('```ts\nconst a = 1\n```\n')
	assert.ok(!plain.includes('wiki-code-title'), plain)
})

test('steps wraps ordered list into wiki-steps container', async () => {
	const html = await render('::: steps\n1. 第一步\n2. 第二步\n:::\n')
	assert.ok(html.includes('<div class="wiki-steps">'), html)
	assert.ok(html.includes('第一步'), html)
	assert.ok(html.includes('<ol>'), html)
	// 未闭合的容器不吞内容
	const open = await render('::: steps\n1. 第一步\n')
	assert.ok(!open.includes('wiki-steps'), open)
})

test('timeline renders items with time, type and container attrs', async () => {
	const html = await render([
		'::: timeline card line="dashed"',
		'- 立项',
		'  time="2025-03" type="tip"',
		'',
		'  项目启动',
		'- 内测',
		'  time="2025-06"',
		'',
		'  内容',
		':::',
		'',
	].join('\n'))
	assert.ok(html.includes('<div class="wiki-timeline">'), html)
	// 条目级 type 覆盖默认 info；容器级 card/line 生效
	assert.ok(html.includes('class="wiki-timeline-item tip line-dashed placement-left card"'), html)
	assert.ok(html.includes('wiki-timeline-time">2025-03<'), html)
	assert.ok(html.includes('<p class="wiki-timeline-title">立项</p>'), html)
})

test('timeline keeps plain text when attrs are not whitelist keys', async () => {
	const html = await render([
		'::: timeline',
		'- 条目',
		'  foo="bar" 不是属性行',
		':::',
		'',
	].join('\n'))
	// 非白名单键整行当正文，不得当属性吞掉（引号会被 HTML 转义为 &quot;）
	assert.ok(html.includes('foo=&quot;bar&quot;'), html)
})
