import type { SpotlightNode } from '../packages/wiki-theme/theme/composables/spotlightTarget.ts'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { nearestChild, resolveSpotlightTarget } from '../packages/wiki-theme/theme/composables/spotlightTarget.ts'

/** 最小 DOM 桩：只需满足 spotlightTarget.ts 的结构要求 */
interface Fake extends SpotlightNode {
	parentElement: Fake | null
	children: SpotlightNode[]
}

interface FakeOpts {
	tag?: string
	top?: number
	height?: number
	kids?: Fake[]
	pre?: boolean
	codeGroup?: boolean
}

function fake(opts: FakeOpts = {}): Fake {
	const top = opts.top ?? 0
	const height = opts.height ?? 0
	const node: Fake = {
		tagName: opts.tag ?? 'DIV',
		parentElement: null,
		children: opts.kids ?? [],
		classList: { contains: name => name === 'vp-code-group' && !!opts.codeGroup },
		querySelector: sel => (sel === ':scope > pre' && opts.pre ? ({ tagName: 'PRE' } as SpotlightNode) : null),
		getBoundingClientRect: () => ({ top, bottom: top + height, height }),
	}
	for (const kid of opts.kids ?? [])
		kid.parentElement = node
	return node
}

function rootWith(...kids: Fake[]): Fake {
	return fake({ tag: 'DIV', kids })
}

describe('nearestChild 按区间距离取最近子节点', () => {
	const parent = fake({ kids: [fake({ tag: 'LI', top: 0, height: 40 }), fake({ tag: 'LI', top: 48, height: 40 })] })

	it('指针落在子节点内部时返回它', () => {
		assert.equal(nearestChild(parent, 10), parent.children[0])
		assert.equal(nearestChild(parent, 60), parent.children[1])
	})

	it('缝隙里取更近的一侧', () => {
		assert.equal(nearestChild(parent, 42), parent.children[0])
		assert.equal(nearestChild(parent, 54), parent.children[1])
	})

	it('两块正中距离相等时固定取靠上的（DOM 序在前）', () => {
		assert.equal(nearestChild(parent, 44), parent.children[0])
	})

	it('高度为 0 的隐藏元素不参与', () => {
		const p = fake({ kids: [fake({ top: 0, height: 0 }), fake({ tag: 'P', top: 10, height: 20 })] })
		assert.equal(nearestChild(p, 5), p.children[1])
	})

	it('没有可见子节点时返回 null', () => {
		assert.equal(nearestChild(fake({ kids: [fake({ height: 0 })] }), 0), null)
	})
})

describe('resolveSpotlightTarget 目标恒为正文根的直接子块', () => {
	const para = fake({ tag: 'P', top: 0, height: 80 })
	const list = fake({
		tag: 'UL',
		top: 100,
		height: 88,
		kids: [
			fake({ tag: 'LI', top: 100, height: 40 }),
			fake({ tag: 'LI', top: 148, height: 40 }),
		],
	})
	const root = rootWith(para, list)

	it('直接命中顶层块原样返回', () => {
		assert.equal(resolveSpotlightTarget(para, root, 40), para)
	})

	it('深层元素上提到顶层块', () => {
		const strong = fake({ tag: 'STRONG', top: 10, height: 20 })
		para.children.push(strong)
		strong.parentElement = para
		assert.equal(resolveSpotlightTarget(strong, root, 15), para)
	})

	it('列表命中下探到直接 li：文字、缝隙、项目符号缩进带都一样', () => {
		const [li1, li2] = list.children as Fake[]
		assert.equal(resolveSpotlightTarget(list.children[0], root, 110), li1)
		assert.equal(resolveSpotlightTarget(list, root, 110), li1)
		assert.equal(resolveSpotlightTarget(list, root, 142), li1)
		assert.equal(resolveSpotlightTarget(list, root, 146), li2)
		assert.equal(resolveSpotlightTarget(list, root, 150), li2)
	})

	it('嵌套子列表归到外层 li，不单独亮', () => {
		const nestedLi = fake({ tag: 'LI', top: 110, height: 10 })
		const nestedUl = fake({ tag: 'UL', top: 108, height: 20, kids: [nestedLi] })
		const outerLi = list.children[0] as Fake
		outerLi.children.push(nestedUl)
		nestedUl.parentElement = outerLi
		assert.equal(resolveSpotlightTarget(nestedLi, root, 115), outerLi)
	})

	it('命中正文根（块间空白）就近取块，最近是列表时同样下沉到 li', () => {
		assert.equal(resolveSpotlightTarget(root, root, 96), list.children[0])
		assert.equal(resolveSpotlightTarget(root, root, 40), para)
	})

	it('代码块包装层返回 null（框维持原状，与原组件行为一致）', () => {
		const code = fake({ tag: 'DIV', top: 200, height: 60, pre: true })
		const pre = fake({ tag: 'PRE', top: 205, height: 50 })
		code.children.push(pre)
		pre.parentElement = code
		const r = rootWith(code)
		assert.equal(resolveSpotlightTarget(code, r, 220), null)
		assert.equal(resolveSpotlightTarget(pre, r, 220), null)
		assert.equal(resolveSpotlightTarget(fake({ codeGroup: true }), rootWith(fake({ codeGroup: true })), 0), null)
	})

	it('指针不在正文根内返回 null', () => {
		const outside = fake({ tag: 'NAV', top: 0, height: 40 })
		assert.equal(resolveSpotlightTarget(outside, root, 20), null)
	})

	it('raw 或 root 为空返回 null', () => {
		assert.equal(resolveSpotlightTarget(null, root, 0), null)
		assert.equal(resolveSpotlightTarget(para, null, 0), null)
	})
})
