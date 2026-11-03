/**
 * 聚光灯命中目标的统一解析。
 *
 * 配套 `theme/components/SpotlightHoverBlock.vue`（Nolebase 组件的仓库内修补副本，
 * 经 lib/vite/spotlight-patch.ts 在解析期重定向）。原版组件的目标选择是「从命中
 * 元素向上找最深合法块」（白名单含 UL/OL/LI），带来两类观感问题：
 *
 * - 指在列表项间缝隙（li 的 margin 不参与命中）或项目符号缩进带（ul 的 padding）
 *   → 命中整个 UL，高亮框在「一项高」和「整块高」之间跳变；
 * - 命中正文根容器（块与块之间的空白）→ 原版返回 null，框冻结在原处。
 *
 * 这里的规则只有一条：**目标恒为正文根的直接子块**——段落、标题、引用块、自定义
 * 容器、表格各自整体算一个，容器内部不再细分（越细反而越跳）；唯一例外是列表，
 * 下探到它的直接 `<li>`（嵌套子列表不单独成目标，否则外层一项 ↔ 内层一小项又是
 * 跳变）。指针落在两块之间的空白时按 y 就近取一块，高亮始终跟随而不是冻住。
 *
 * 只负责「选哪个元素」，不碰渲染：框的位置、过渡、滚动跟随仍全部由组件自己完成。
 */

/** 解析所需的最小结构（真实 DOM 与测试桩都满足） */
export interface SpotlightNode {
	tagName: string
	parentElement: SpotlightNode | null
	children: ArrayLike<SpotlightNode>
	classList: { contains: (name: string) => boolean }
	querySelector: (selectors: string) => SpotlightNode | null
	getBoundingClientRect: () => { top: number, bottom: number, height: number }
}

/** 候选块是否为代码块包装层：组件同样排除它们，返回 null 让框维持原状 */
function isCodeWrapper(node: SpotlightNode): boolean {
	return node.tagName === 'DIV'
		&& (node.classList.contains('vp-code-group') || node.querySelector(':scope > pre') !== null)
}

/**
 * 按「到区间 [top, bottom] 的距离」取最近的直接子节点。
 * 指针落在子节点内部时距离为 0（覆盖列表项命中）；距离相等取 DOM 序靠前的
 * （即靠上的那个），保证在两块正中不会来回抖。隐藏元素（height 0）不参与。
 */
export function nearestChild(parent: SpotlightNode, y: number): SpotlightNode | null {
	let best: SpotlightNode | null = null
	let bestDistance = Number.POSITIVE_INFINITY
	for (const child of Array.from(parent.children)) {
		const rect = child.getBoundingClientRect()
		if (rect.height === 0)
			continue
		const distance = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0
		if (distance < bestDistance) {
			best = child
			bestDistance = distance
		}
	}
	return best
}

/**
 * 把命中元素解析成高亮目标。
 *
 * @param raw  指针下的最深元素（document.elementFromPoint 的返回值）
 * @param root 正文根容器（`.VPDoc main .vp-doc > div`）
 * @param y    指针的视口 y 坐标
 * @returns 高亮目标；返回 null 时框维持原状（与原版对代码块的行为一致）
 */
export function resolveSpotlightTarget(
	raw: SpotlightNode | null,
	root: SpotlightNode | null,
	y: number,
): SpotlightNode | null {
	if (!raw || !root)
		return null

	let block: SpotlightNode | null
	if (raw === root) {
		// 命中正文根本身：指针在块间空白里，就近取一块
		block = nearestChild(root, y)
	}
	else {
		// 沿祖先链上提到正文根的直接子块
		let node = raw
		while (node.parentElement && node.parentElement !== root)
			node = node.parentElement
		if (node.parentElement !== root)
			return null
		block = node
	}

	if (!block || isCodeWrapper(block))
		return null
	// 列表（含缝、缩进带、嵌套子列表内的命中）统一下探到直接 li
	if (block.tagName === 'UL' || block.tagName === 'OL')
		return nearestChild(block, y)
	return block
}
