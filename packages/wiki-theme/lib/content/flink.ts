import type { MarkdownRenderer } from 'vitepress'

/**
 * 友链数据块插件：把 md 里的 <flink> 列表解析成 FriendLinks 组件的 props，
 * 让「友链数据」直接在 md 中编辑，组件只负责卡片样式（数据与样式分离）。
 *
 * md 中的书写格式（空行分隔条目，字段可省略，见 docs/10.贡献与其他/10.友情链接.md）：
 *
 * <flink>
 *
 * - name: 站点名称
 *   image: /img/10/10/头像.png
 *   url: https://example.com/
 *   description: 一句话介绍
 *   tag: 兄弟院校
 *   qr: true
 *
 * </flink>
 *
 * YAML 会把缩进列表折叠成「name: xx - image: yy」样式的字符串，
 * 与 cardlist 一致的思路：解析时按「 - 」拆回条目。qr/preview 是开关字段。
 */
export interface FlinkItem {
	name: string
	url: string
	image?: string
	description?: string
	tag?: string
	qr?: boolean
	preview?: boolean
}

const OPEN_RE = /^<flink(?:\s[^>]*)?>$/
const CLOSE_RE = /^<\/flink>$/
const ITEM_RE = /^-\s+([\w-]+):(.*)$/
const KV_RE = /^([\w-]+):(.*)$/

/** url 只放行站内相对路径与 http(s) 外链，拦掉 javascript: 等危险协议 */
function isSafeLink(value: string): boolean {
	if (/^(?:\/|\.\/|\.\.\/|#)/.test(value))
		return !value.startsWith('//')
	try {
		const url = new URL(value)
		return url.protocol === 'https:' || url.protocol === 'http:'
	}
	catch {
		return false
	}
}

function toBoolean(value: string | undefined): boolean {
	return value === 'true' || value === '1'
}

/** 解析 <flink> 容器内的列表数据，缺 name / url 或 url 不安全的条目直接丢弃 */
export function parseFlinkItems(block: string): FlinkItem[] {
	const inner = block
		.replace(/^<flink(?:\s[^>]*)?>[^\S\r\n]*\r?\n/, '')
		.replace(/\r?\n[^\S\r\n]*<\/flink>[^\S\r\n]*$/, '')
	const items: Record<string, string>[] = []
	let current: Record<string, string> | null = null
	for (const raw of inner.split(/\r?\n/)) {
		const line = raw.trim()
		if (!line)
			continue
		const item = line.match(ITEM_RE)
		if (item) {
			current = { [item[1]]: item[2].trim() }
			items.push(current)
			continue
		}
		const kv = line.match(KV_RE)
		if (kv && current)
			current[kv[1]] = kv[2].trim()
	}
	return items
		.filter(item => item.name && item.url && isSafeLink(item.url))
		.map(item => ({
			name: item.name!,
			url: item.url!,
			image: item.image,
			description: item.description ?? item.desc,
			tag: item.tag,
			qr: toBoolean(item.qr),
			preview: toBoolean(item.preview),
		}))
}

/** 序列化成组件 props；转义 & < ' 防止破坏 markdown-it 产出的 SFC 片段 */
function toComponentTag(items: FlinkItem[]): string {
	const json = JSON.stringify(items)
		.replace(/&/g, '\\u0026')
		.replace(/</g, '\\u003c')
		.replace(/'/g, '\\u0027')
	return `<FriendLinks :links='${json}' />`
}

export function flink(md: MarkdownRenderer) {
	md.block.ruler.before('html_block', 'flink_block', (state, startLine, endLine, silent) => {
		const line = (index: number) => state.src.slice(state.bMarks[index] + state.tShift[index], state.eMarks[index]).trim()
		if (!OPEN_RE.test(line(startLine)))
			return false
		let close = startLine + 1
		while (close < endLine && !CLOSE_RE.test(line(close)))
			close++
		if (close === endLine)
			return false
		if (silent)
			return true
		const items = parseFlinkItems(state.getLines(startLine, close + 1, state.blkIndent, false))
		if (!items.length)
			return false
		const token = state.push('html_block', '', 0)
		token.content = `${toComponentTag(items)}\n`
		token.map = [startLine, close + 1]
		state.line = close + 1
		return true
	})
}
