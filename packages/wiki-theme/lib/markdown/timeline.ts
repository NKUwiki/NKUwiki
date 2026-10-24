// Timeline 时间线容器：把容器内的无序列表渲染成带时间点、竖向连线的 时间轴。
// 语法与视觉参考 plume 主题的 plugin-md-power timeline 规则，但渲染为纯 HTML
// 结构 + CSS（enhance.css），不依赖 plume 的 VPTimeline Vue 组件与 iconify：
//
//   ::: timeline
//   - 立项
//     time="2025-03" type="tip" color="#3eaf7c"
//
//     项目启动，完成……
//   - 内测
//     time="2025-06" line="dashed"
//
//     内容……
//   :::
//
// 有序列表同样支持（渲染与无序一致，编号不进时间轴）；内容里可以嵌套 ::: tip
// 等容器与代码块，闭合行按嵌套深度匹配（见 ./container-end.ts）。
// 容器级属性：horizontal（横向）/ card（卡片化）/ placement（left|right，默认 left）
//           / line（solid|dashed|dotted，默认 solid，item 可单独覆盖）
// 条目级属性（写在标题同段的下一行，形如 key="value" 空格分隔）：
//   time / type（info|tip|success|warning|danger|caution|important）/ color / line / card / placement
// plume 的 icon 属性依赖图标系统，这里暂不支持（写了会被忽略）。
import type { MarkdownRenderer } from 'vitepress'
import { findContainerEnd } from './container-end.ts'

const OPEN_RE = /^:{3,}[\t ]*timeline\b/

interface ContainerAttrs {
	horizontal: boolean
	card: boolean
	placement: 'left' | 'right'
	line: 'solid' | 'dashed' | 'dotted'
}

interface ItemMeta {
	time?: string
	type?: string
	color?: string
	line?: string
	card?: string
	placement?: string
}

const ITEM_KEYS = new Set(['time', 'type', 'color', 'line', 'card', 'placement'])
const TYPES = new Set(['info', 'tip', 'success', 'warning', 'danger', 'caution', 'important'])
const LINES = new Set(['solid', 'dashed', 'dotted'])

function escapeHtml(text: string): string {
	return text.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[ch]!)
}

/** 只放行安全字符，防把引号等注入 style 属性 */
function safeValue(value: string): string {
	return /^[\w#(),.%\s-]+$/.test(value) ? value : ''
}

/** 解析容器级属性：无值键（horizontal/card）视为开启，其余 key="value" */
function parseContainerAttrs(info: string): ContainerAttrs {
	const attrs: ContainerAttrs = { horizontal: false, card: false, placement: 'left', line: 'solid' }
	const source = info.trim()
	let i = 0
	while (i < source.length) {
		while (i < source.length && /\s/.test(source[i]))
			i++
		const rest = source.slice(i)
		// key="value" / key='value' / key=value
		const kv = /^([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/.exec(rest)
		if (kv) {
			const key = kv[1].toLowerCase()
			const value = (kv[2] ?? kv[3] ?? kv[4] ?? '').trim()
			if (key === 'placement' && (value === 'left' || value === 'right'))
				attrs.placement = value
			else if (key === 'line' && LINES.has(value))
				attrs.line = value as ContainerAttrs['line']
			else if (key === 'horizontal' && value === 'true')
				attrs.horizontal = true
			else if (key === 'card' && value === 'true')
				attrs.card = true
			i += kv[0].length
			continue
		}
		// 裸词键：horizontal / card
		const word = /^([\w-]+)/.exec(rest)
		if (!word)
			break
		if (word[1] === 'horizontal')
			attrs.horizontal = true
		else if (word[1] === 'card')
			attrs.card = true
		i += word[0].length
	}
	return attrs
}

/**
 * 从条目标题段落的属性行提取条目元数据。
 * 仅当行内所有键都在白名单内才认定是属性行（否则当作普通文本保留）。
 * 算法参考 plume 的 extractTimelineAttributes。
 */
function extractItemMeta(raw: string): ItemMeta | null {
	const meta: ItemMeta = {}
	let buffer = raw.trim()
	let matched = false
	while (buffer) {
		// 锚定行首：属性行必须以 key= 开头，否则不当作属性行（避免吞正文）
		const keyMatch = /^(\w+)\s*=\s*/.exec(buffer)
		if (!keyMatch)
			return null
		const key = keyMatch[1].toLowerCase()
		if (!ITEM_KEYS.has(key))
			return null
		let rest = buffer.slice(keyMatch.index + keyMatch[0].length)
		const valueEnd = rest.search(/\s+\w+=\s*|$/)
		const value = rest.slice(0, valueEnd).trim().replace(/^(['"])(.*)\1$/, '$2')
		rest = rest.slice(valueEnd)
		if (key === 'type' && TYPES.has(value))
			meta.type = value
		else if (key === 'line' && LINES.has(value))
			meta.line = value
		else if (key === 'card' && (value === 'true' || value === 'false'))
			meta.card = value
		else if (key === 'placement' && (value === 'left' || value === 'right'))
			meta.placement = value
		else if (key === 'time' || key === 'color')
			meta[key] = safeValue(value) || undefined
		matched = true
		buffer = rest.trim()
	}
	return matched ? meta : null
}

/** 把容器内的 token 树按 plume 的方式改写：根级列表项 → timeline 条目，首个段落 → 标题 */
function rewriteTimelineTokens(tokens: ReturnType<MarkdownRenderer['parse']>) {
	// 同时跟踪 ul/ol 嵌套层级，避免条目内的嵌套列表被误判成根级条目（plume 只跟踪 ul）
	const listStack: string[] = []
	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i]
		if (token.type === 'bullet_list_open' || token.type === 'ordered_list_open') {
			listStack.push(token.type === 'bullet_list_open' ? 'bullet' : 'ordered')
			if (listStack.length === 1)
				token.hidden = true
		}
		else if (token.type === 'bullet_list_close' || token.type === 'ordered_list_close') {
			listStack.pop()
			// 与 open 侧对称：根级列表不论 bullet / ordered 都隐藏包裹层——
			// 此前只隐藏 bullet，有序列表写出「无 <ol> 开头的孤立 </ol>」损坏 HTML
			if (listStack.length === 0)
				token.hidden = true
		}
		else if (token.type === 'list_item_open' && listStack.length === 1) {
			token.type = 'wiki_timeline_item_open'
			// 按类型定位标题段落（首个 paragraph_open），避免 loose/嵌套列表下固定偏移错位
			let j = i + 1
			while (j < tokens.length) {
				const type = tokens[j].type
				if (type === 'paragraph_open')
					break
				if (type === 'bullet_list_open' || type === 'ordered_list_open' || type === 'list_item_close')
					break
				j++
			}
			const closeIndex = tokens.findIndex((t, k) => k > j && t.type === 'paragraph_close')
			if (j < tokens.length && tokens[j].type === 'paragraph_open' && closeIndex !== -1) {
				tokens[j].type = 'wiki_timeline_item_title_open'
				tokens[closeIndex].type = 'wiki_timeline_item_title_close'
				const inline = tokens[j + 1]
				const children = inline.children
				const softbreakIndex = children?.findLastIndex(t => t.type === 'softbreak') ?? -1
				const meta = children && softbreakIndex !== -1 ? extractItemMeta(children[children.length - 1].content) : null
				if (meta) {
					token.meta = meta
					inline.children = children!.slice(0, softbreakIndex)
				}
			}
		}
		else if (token.type === 'list_item_close' && listStack.length === 1) {
			token.type = 'wiki_timeline_item_close'
		}
	}
}

export function timeline(md: MarkdownRenderer) {
	// 渲染条目时需要读容器级默认值；块规则内同步完成解析+渲染，模块级变量是安全的
	let containerAttrs: ContainerAttrs = { horizontal: false, card: false, placement: 'left', line: 'solid' }

	md.renderer.rules.wiki_timeline_item_open = (tokens, index) => {
		const meta: ItemMeta = tokens[index].meta ?? {}
		const type = meta.type ?? 'info'
		const line = LINES.has(meta.line ?? '') ? meta.line! : containerAttrs.line
		const placement = meta.placement === 'right' || meta.placement === 'left' ? meta.placement : containerAttrs.placement
		const classes = ['wiki-timeline-item', type, `line-${line}`, `placement-${placement}`]
		if (containerAttrs.horizontal)
			classes.push('horizontal')
		if (meta.card ? meta.card === 'true' : containerAttrs.card)
			classes.push('card')
		const style = meta.color ? ` style="--wiki-timeline-c-line:${escapeHtml(meta.color)};--wiki-timeline-c-point:${escapeHtml(meta.color)}"` : ''
		// data-reveal：条目随滚动逐条淡入（composables/reveal.ts；SSR 与无 JS 环境默认可见）
		return `<div class="${classes.join(' ')}" data-reveal${style}>`
			+ `<div class="wiki-timeline-line"><span class="wiki-timeline-point"></span></div>`
			+ `<div class="wiki-timeline-container"><div class="wiki-timeline-content">`
	}

	md.renderer.rules.wiki_timeline_item_close = (tokens, index) => {
		// time 存在条目 open token 的 meta 上，回溯找最近的一个
		let open = index - 1
		while (open >= 0 && tokens[open].type !== 'wiki_timeline_item_open')
			open--
		const time = open >= 0 ? (tokens[open].meta as ItemMeta | undefined)?.time : undefined
		return `</div>${time ? `<p class="wiki-timeline-time">${escapeHtml(time)}</p>` : ''}</div></div>`
	}

	md.renderer.rules.wiki_timeline_item_title_open = () => '<p class="wiki-timeline-title">'
	md.renderer.rules.wiki_timeline_item_title_close = () => '</p>'

	md.block.ruler.before('fence', 'wiki-timeline', (state, startLine, endLine, silent) => {
		const line = (index: number) => state.src.slice(state.bMarks[index] + state.tShift[index], state.eMarks[index]).trim()
		const open = OPEN_RE.exec(line(startLine))
		if (!open)
			return false
		const close = findContainerEnd(state, startLine, endLine)
		if (close === endLine)
			return false
		if (silent)
			return true
		containerAttrs = parseContainerAttrs(line(startLine).slice(open[0].length))
		const tokens = md.parse(state.getLines(startLine + 1, close, state.blkIndent, false), state.env)
		rewriteTimelineTokens(tokens)
		const inner = md.renderer.render(tokens, md.options, state.env)
		const classes = ['wiki-timeline']
		if (containerAttrs.horizontal)
			classes.push('horizontal')
		const html = `<div class="${classes.join(' ')}"><div class="wiki-timeline-box">${inner}</div></div>`
		const token = state.push('html_block', '', 0)
		token.content = html
		token.map = [startLine, close + 1]
		state.line = close + 1
		return true
	}, { alt: ['paragraph', 'reference', 'blockquote', 'list'] })
}
