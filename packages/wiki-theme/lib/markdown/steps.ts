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
import type { MarkdownRenderer } from 'vitepress'

const OPEN_RE = /^:{3,}\s*steps\s*$/
const CLOSE_RE = /^:{3,}\s*$/

export function steps(md: MarkdownRenderer) {
	md.block.ruler.before('fence', 'wiki-steps', (state, startLine, endLine, silent) => {
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
		const inner = md.parse(state.getLines(startLine + 1, close, state.blkIndent, false), state.env)
		const html = `<div class="wiki-steps">${md.renderer.render(inner, md.options, state.env)}</div>`
		const token = state.push('html_block', '', 0)
		token.content = html
		token.map = [startLine, close + 1]
		state.line = close + 1
		return true
	})
}
