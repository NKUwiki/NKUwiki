// 隐秘文本（plot）：正文里写 `!!需要隐藏的内容!!`，渲染为黑幕/模糊遮罩的 span，
// 悬停或点击（可配）才显示原文。语法与交互参考 plume 主题的 plugin-md-power plot 规则：
//   !!内容!!            默认 遮罩(mask) + 悬停(hover)
//   !!内容!!{.click}    点击切换显示（点击页面其他处收起，逻辑在 theme/composables/plot.ts）
//   !!内容!!{.blur}     模糊效果代替黑幕
// `.hover` / `.mask` 也可显式书写；内容是纯文本（不解析内部行内标记，与 plume 一致）。
import type { MarkdownRenderer } from 'vitepress'

function escapeHtml(text: string): string {
	return text.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[ch]!)
}

export function plot(md: MarkdownRenderer) {
	md.inline.ruler.before('emphasis', 'wiki-plot', (state, silent) => {
		const start = state.pos
		const max = state.posMax

		// 必须以 !! 开头
		if (state.src.charCodeAt(start) !== 0x21 || state.src.charCodeAt(start + 1) !== 0x21)
			return false
		// "!! xxx"（开头后紧跟空白）与 "!!!xxx"（三个以上叹号）不算隐秘文本
		const next = state.src.charCodeAt(start + 2)
		if (next === 0x20 || next === 0x21)
			return false
		// 至少要有 !!x!! 五个字符
		if (max - start < 5)
			return false

		let found = false
		state.pos = start + 2
		while (state.pos < max) {
			if (state.src.charCodeAt(state.pos) === 0x21 && state.src.charCodeAt(state.pos + 1) === 0x21) {
				found = true
				break
			}
			state.md.inline.skipToken(state)
		}

		// 没找到闭合、空内容、或闭合前是空白（"!!xxx !!"）都不算
		if (!found || start + 2 === state.pos || state.src.charCodeAt(state.pos - 1) === 0x20) {
			state.pos = start
			return false
		}

		const content = state.src.slice(start + 2, state.pos)
		let end = state.pos + 2

		// 可选属性后缀：{.click .blur .hover .mask}（只认类名，长度截断防扫全文）
		const classes = new Set<string>()
		const attrMatch = /^\s*\{([\w\s.-]{0,64})\}/.exec(state.src.slice(end, end + 80))
		if (attrMatch) {
			end += attrMatch[0].length
			for (const name of attrMatch[1].split('.')) {
				const cls = name.trim()
				if (cls === 'click' || cls === 'hover' || cls === 'mask' || cls === 'blur')
					classes.add(cls)
			}
		}
		// 未显式指定触发方式/效果时用默认值：hover + mask
		if (!classes.has('click') && !classes.has('hover'))
			classes.add('hover')
		if (!classes.has('mask') && !classes.has('blur'))
			classes.add('mask')
		const classList = [...classes].join(' ')

		if (!silent) {
			const token = state.push('html_inline', '', 0)
			token.content = `<span class="wiki-plot ${classList}">${escapeHtml(content)}</span>`
		}
		state.pos = end
		return true
	})
}
