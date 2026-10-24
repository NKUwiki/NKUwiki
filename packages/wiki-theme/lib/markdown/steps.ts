// Steps 步骤容器：把容器内的有序/无序列表渲染成带圆点编号与竖向连线的步骤条。
// 语法与视觉参考 plume 主题的 plugin-md-power steps 规则：
//
//   ::: steps
//   1. 第一步
//      具体操作……
//   2. 第二步
//   :::
//
// 容器只负责包一层 .wiki-steps，视觉全部由 CSS（enhance.css 的步骤条段）完成；
// ol / ul 都可以，编号用 CSS counter(list-item) 生成，无序但连贯。
// 内容里可以嵌套 ::: tip / ::: details 等容器与代码块，闭合行按嵌套深度匹配
// （见 ./container-end.ts）。
import type { MarkdownRenderer } from 'vitepress'
import { findContainerEnd } from './container-end.ts'

const OPEN_RE = /^:{3,}\s*steps\s*$/

export function steps(md: MarkdownRenderer) {
	// alt 链让本规则能打断段落 / 嵌进列表——没有它，紧跟正文段落的 ::: steps
	// 会被惰性续行吞成文字（markdown-it-container 的内置容器都带 alt，同款写法）
	md.block.ruler.before('fence', 'wiki-steps', (state, startLine, endLine, silent) => {
		const line = (index: number) => state.src.slice(state.bMarks[index] + state.tShift[index], state.eMarks[index]).trim()
		if (!OPEN_RE.test(line(startLine)))
			return false
		const close = findContainerEnd(state, startLine, endLine)
		if (close === endLine)
			return false
		if (silent)
			return true
		const inner = md.parse(state.getLines(startLine + 1, close, state.blkIndent, false), state.env)
		const html = `<div class="wiki-steps">${md.renderer.render(inner, md.options, state.env)}</div>`
		const token = state.push('html_block', '', 0)
		token.content = html
		token.map = [startLine, close + 1]
		state.line = close + 1
		return true
	}, { alt: ['paragraph', 'reference', 'blockquote', 'list'] })
}
