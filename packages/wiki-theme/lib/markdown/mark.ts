// 马克笔（mark）：正文里写 `==重点==` 渲染为高亮底色的 <mark>，支持配色后缀
// `==内容=={.tip}`。语法与配色参考 plume 主题（plume 用 @mdit/plugin-mark +
// @mdit/plugin-attrs 实现，这里手写等价规则，保持主题包零额外依赖）：
//
//   ==内容==              默认配色（品牌色）
//   ==内容=={.tip}        内置配色：info / note / tip / warning / danger / caution / important
//                        （其余类名输出为 wiki-marker-<类名>，可在样式里自定义）
//
// 匹配约定（对齐 plugin-mark）：
//   - 开头 == 后不能紧跟空白或 =（避免误伤 a === b、a == b）；
//   - 闭合 == 前必须有非空白字符（`== x ==` 不算）；
//   - 内容走正常行内解析，**加粗**、`代码` 等嵌套标记可用。
import type { MarkdownRenderer } from 'vitepress'

// 内置配色类名
const KNOWN_CLASSES = new Set(['info', 'note', 'tip', 'warning', 'danger', 'caution', 'important'])

const WS = new Set([0x20, 0x09, 0x0A, 0x0B, 0x0C, 0x0D])

export function mark(md: MarkdownRenderer) {
	md.renderer.rules.wiki_marker_open = (tokens, index) => {
		const cls = (tokens[index].meta as string | undefined) ?? ''
		return `<mark${cls ? ` class="${cls}"` : ''}>`
	}
	md.renderer.rules.wiki_marker_close = () => '</mark>'

	md.inline.ruler.before('emphasis', 'wiki-marker', (state, silent) => {
		const start = state.pos
		const max = state.posMax
		// 必须以 == 开头；前面不能是 =（排除 === 的尾部）；开头后不能是 = 或空白
		if (state.src.charCodeAt(start) !== 0x3D || state.src.charCodeAt(start + 1) !== 0x3D)
			return false
		if (start > 0 && state.src.charCodeAt(start - 1) === 0x3D)
			return false
		const next = state.src.charCodeAt(start + 2)
		if (Number.isNaN(next) || next === 0x3D || WS.has(next))
			return false

		// 扫描闭合 ==（skipToken 跳过代码 span 等整体单元，内容里的 `==` 字面量不受影响）
		let found = false
		state.pos = start + 2
		while (state.pos < max) {
			if (state.src.charCodeAt(state.pos) === 0x3D && state.src.charCodeAt(state.pos + 1) === 0x3D) {
				found = true
				break
			}
			state.md.inline.skipToken(state)
		}
		if (!found) {
			// 失败必须复位 pos：行内循环不会代为恢复，残留的扫描位置会吞掉后续文本
			state.pos = start
			return false
		}
		// 闭合 == 前必须有非空白字符且内容非空（"== x =="、"====" 都不算）
		const closePos = state.pos
		const prev = state.src.charCodeAt(closePos - 1)
		if (closePos === start + 2 || WS.has(prev)) {
			state.pos = start
			return false
		}

		const end0 = closePos + 2
		// 可选配色后缀 {.classname}
		let className = ''
		let end = end0
		const attrMatch = /^\s*\{\.([\w-]{1,32})\}/.exec(state.src.slice(end0, end0 + 40))
		if (attrMatch) {
			end += attrMatch[0].length
			className = KNOWN_CLASSES.has(attrMatch[1]) ? attrMatch[1] : `wiki-marker-${attrMatch[1]}`
		}

		if (silent) {
			state.pos = end
			return true
		}
		const open = state.push('wiki_marker_open', 'mark', 1)
		open.meta = className
		// 内容递归走行内解析（与 @mdit/plugin-mark 一致的做法）
		state.pos = start + 2
		state.posMax = closePos
		state.md.inline.tokenize(state)
		state.push('wiki_marker_close', 'mark', -1)
		state.pos = end
		state.posMax = max
		return true
	})
}
