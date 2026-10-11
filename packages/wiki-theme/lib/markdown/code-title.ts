// 代码块标题：fenced code 的信息串里写 title="文件名"，
//   ```ts title="config.mts"
// 渲染时把代码块包进 .wiki-code-title，由 CSS 用 data-title 画出顶栏标题。
// 默认渲染器不动：剥掉 title 后按原样渲染语言与高亮，再原样包回。
import type { MarkdownRenderer } from 'vitepress'

function escapeAttr(text: string): string {
	return text.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[ch]!)
}

export function codeTitle(md: MarkdownRenderer) {
	const raw = md.renderer.rules.fence
	md.renderer.rules.fence = (tokens, idx, options, env, self) => {
		const token = tokens[idx]
		const match = /^([\w-]+)\s+title="([^"]+)"\s*$/.exec(token.info)
		if (!match)
			return raw?.(tokens, idx, options, env, self) ?? self.renderToken(tokens, idx, options)
		const original = token.info
		token.info = match[1]
		const html = raw?.(tokens, idx, options, env, self) ?? self.renderToken(tokens, idx, options)
		token.info = original
		return `<div class="wiki-code-title" data-title="${escapeAttr(match[2])}">${html}</div>`
	}
}
