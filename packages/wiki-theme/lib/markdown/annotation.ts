// 行内注释（annotation）：在正文中写 `{^注释内容}`，
// 渲染为可悬停/聚焦的小气泡注释（Obsidian 风格的行内脚注），用于名词解释、补充说明。
// 语法约定：^ 后的第一个字符不能是数字或空白（避免误伤 2^{10} 这类数学上标写法）。
import type { MarkdownRenderer } from 'vitepress'

function escapeHtml(text: string): string {
	return text.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[ch]!)
}

// 行内注释的图标：信息圆圈（info circle）。用内联 SVG 而非字符，
// 避免 ※ / ⓘ 在 Windows、macOS、安卓上的字形与基线各不相同。
const INFO_ICON
	= '<svg viewBox="0 0 16 16" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.8" '
		+ 'stroke-linecap="round" aria-hidden="true" focusable="false">'
		+ '<circle cx="8" cy="8" r="6.4"/>'
		+ '<path d="M8 7.4v3.8"/>'
		+ '<circle cx="8" cy="4.9" r="0.85" fill="currentColor" stroke="none"/>'
		+ '</svg>'

export function annotation(md: MarkdownRenderer) {
	md.inline.ruler.after('emphasis', 'wiki-annotation', (state, silent) => {
		const { pos } = state
		if (state.src.charCodeAt(pos) !== 0x7B || state.src.charCodeAt(pos + 1) !== 0x5E)
			return false
		const end = state.src.indexOf('}', pos + 2)
		if (end === -1)
			return false
		const content = state.src.slice(pos + 2, end).trim()
		// 空内容、纯数字（疑似数学上标）都不当注释：直接返回 false，
		// 交回给后续规则按普通文本原样输出（不能推进 pos——silent 轮不允许改状态，
		// 且非 silent 轮推进后返回 false 会把这段文字静默吞掉）
		if (!content || /^\d/.test(content))
			return false
		if (!silent) {
			const token = state.push('html_inline', '', 0)
			token.content = `<sup class="wiki-annotation" tabindex="0" aria-label="注释：${escapeHtml(content)}"><span class="wiki-annotation-dot" aria-hidden="true">${INFO_ICON}</span><span class="wiki-annotation-bubble" role="note">${escapeHtml(content)}</span></sup>`
		}
		state.pos = end + 1
		return true
	})
}
