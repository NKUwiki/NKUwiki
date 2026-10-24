// 块级容器（::: xxx … :::）闭合行的扫描，供 steps / timeline / cardlist 共用。
//
// 朴素扫描（「找到下一行只剩 ::: 的行」）在内容里嵌套其它 ::: 容器时会撞上
// 内层容器的闭合行：外层内容被拦腰截断、内层容器解体成字面段落、真正的容器尾
// 渲染成正文里的「:::」。这里统一改为两类感知：
//
// 1. 围栏感知：``` / ~~~ 代码块里的 ::: 不是容器标记，跳过；
// 2. 深度计数：::: tip / :::: warning 这类开启行使深度 +1，只剩冒号的行先抵扣
//    深度、抵扣到 0 才是本容器的闭合行。
//
// 与 markdown-it-container 的口径一致：闭合行只看「整行只有 ≥3 个冒号」，
// 不要求与开启行的冒号数严格相等。

/** 扫描所需的最小块状态：steps / timeline / cardlist 的行读取只用这三个数组 */
interface BlockStateLike {
	src: string
	bMarks: number[]
	tShift: number[]
	eMarks: number[]
}

/**
 * 从 startLine + 1 起查找容器的真正闭合行。
 * 找到返回该行号；扫到 endLine 仍没有（未闭合）返回 endLine，调用方按「非容器」回退。
 */
export function findContainerEnd(state: BlockStateLike, startLine: number, endLine: number): number {
	const line = (index: number) => state.src.slice(state.bMarks[index] + state.tShift[index], state.eMarks[index]).trim()
	let fence = ''
	let depth = 0
	for (let i = startLine + 1; i < endLine; i++) {
		const text = line(i)
		// 围栏标记最多允许 3 个空格缩进（CommonMark），\s* 会把代码块内的 ``` 也当围栏开关；
		// 闭合行需与开启行同字符且长度不小于开启行
		const marker = /^ {0,3}(`{3,}|~{3,})/.exec(text)?.[1]
		if (marker) {
			if (!fence)
				fence = marker
			else if (marker[0] === fence[0] && marker.length >= fence.length)
				fence = ''
			continue
		}
		if (fence)
			continue
		// 判定顺序不能反：先认「整行只有 ≥3 个冒号」的闭合行——若先测开启行，
		// `::::` 会被 `^:{3,}[\t ]*\S` 的回溯吃掉（{3,} 让一个冒号给 \S）而漏判。
		// 纯冒号行之后：仍以 ≥3 个冒号开头且后面还有内容的，是嵌套容器的开启行
		// （::: tip / :::: card horizontal / :::tip 均算）
		if (/^:{3,}$/.test(text)) {
			if (depth === 0)
				return i
			depth--
			continue
		}
		if (/^:{3}/.test(text)) {
			depth++
			continue
		}
	}
	return endLine
}
