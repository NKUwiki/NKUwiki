/**
 * 守住「类名撞车」这类静默失效：组件 <style> 里定义的类名，如果和主题全局样式
 * （packages/wiki-theme/theme/styles/*.css，经 theme/index.ts 全站引入）中的
 * **裸选择器**同名，那条全局规则会连带作用到组件元素上，凭空多出边框、背景等样式。
 *
 * 真实案例（排查了多轮才定位）：MapView.vue 地图卡片的 `.sidebar-top`
 * （校区药丸那一行）撞上 cards.css 里的
 *     .sidebar-top { border-bottom: 1px solid var(--vp-c-divider); }
 * 于是校区药丸底下凭空多出一条分割线，看起来正是「按钮压在分割线上」。
 * 这类问题 ESLint、vue-tsc、构建、现有单测统统不报——只有这条守卫拦得住。
 *
 * 判定规则：只看「第一个复合选择器恰好就是一个类名」的选择器，允许后缀伪类/
 * 伪元素/属性选择器（`.foo`、`.foo:hover`、`.foo::before`、`.foo[aria-x]`）；
 * `.vp-doc .foo` 这类要求祖先的选择器不算——它不会误伤组件。
 *
 * 范围：排除 wiki-theme 包自身的组件。它们与全局样式本就同属一套、有意复用
 * （如 .wiki-print-button、.wiki-watermark、.vp-doc、.dark），在这里属于正常。
 * 守卫盯的是**消费方**组件：它们不知道主题里有哪些全局类名，撞上了纯属意外。
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const THEME_STYLE_DIR = 'packages/wiki-theme/theme/styles'
/** 消费方组件所在目录（主题自身的组件有意排除，理由见文件头注释） */
const CONSUMER_ROOTS = ['packages/wiki-map', 'docs/.vitepress']

/** 去掉注释：注释里的大括号会干扰「按大括号切选择器」 */
function stripComments(css: string): string {
	return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/**
 * 切出 CSS 里的选择器列表（不含 at-rule 自身）。
 * 按字符走一遍：遇到 `{` 就把前面攒的文本当选择器收下（`@media` 等 at-rule 跳过，
 * 但会继续往它们内部收集规则）；`}` 与 `;` 清空缓冲，免得把 `color: red` 当选择器。
 */
function collectSelectors(css: string): string[] {
	const out: string[] = []
	let buf = ''
	for (const ch of stripComments(css)) {
		if (ch === '{') {
			const prelude = buf.trim()
			buf = ''
			if (prelude && !prelude.startsWith('@'))
				out.push(prelude)
		}
		else if (ch === '}' || ch === ';') {
			buf = ''
		}
		else {
			buf += ch
		}
	}
	return out
}

/** 按顶层逗号拆分选择器列表（`(` `)` 里的逗号，如 :is(.a, .b)，不拆） */
function splitSelectorList(list: string): string[] {
	const out: string[] = []
	let depth = 0
	let buf = ''
	for (const ch of list) {
		if (ch === '(')
			depth++
		else if (ch === ')')
			depth--
		if (ch === ',' && depth === 0) {
			out.push(buf)
			buf = ''
		}
		else {
			buf += ch
		}
	}
	out.push(buf)
	return out
}

/**
 * 若选择器的第一个复合选择器恰是一个裸类名，返回该类名，否则返回 null。
 * `.foo` → foo；`.foo:hover` → foo；`.foo-2[data-x]` → foo-2；
 * `.vp-doc .foo` → null（有祖先要求，不会误伤）。
 */
function bareClassOf(selector: string): string | null {
	const first = selector.trim().split(/[\s>+~]/)[0] ?? ''
	const match = first.match(/^\.([\w-]+)/)
	if (!match)
		return null
	const rest = first.slice(match[0].length)
	return /^(?::[\w-]+(?:\([^)]*\))?|::[\w-]+|\[[^\]]*\])*$/.test(rest) ? match[1]! : null
}

/** 收集目录下所有 .vue 文件 */
function walkVue(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.name === 'node_modules' || entry.name === '.temp')
			continue
		const full = join(dir, entry.name)
		if (entry.isDirectory())
			walkVue(full, out)
		else if (entry.name.endsWith('.vue'))
			out.push(full)
	}
	return out
}

/** 组件所有 <style> 块里定义的裸类名 */
function definedClasses(source: string): Set<string> {
	const classes = new Set<string>()
	for (const block of source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
		for (const list of collectSelectors(block[1] ?? '')) {
			for (const one of splitSelectorList(list)) {
				const cls = bareClassOf(one)
				if (cls)
					classes.add(cls)
			}
		}
	}
	return classes
}

test('消费方组件的类名不得与主题全局裸选择器重名', () => {
	// 1) 主题全局样式里的裸类名 → 出处文件
	const bare = new Map<string, string>()
	for (const file of readdirSync(THEME_STYLE_DIR).filter(f => f.endsWith('.css'))) {
		const full = join(THEME_STYLE_DIR, file)
		for (const list of collectSelectors(readFileSync(full, 'utf8'))) {
			for (const one of splitSelectorList(list)) {
				const cls = bareClassOf(one)
				if (cls && !bare.has(cls))
					bare.set(cls, file)
			}
		}
	}
	// 解析器自检：真解析出东西了才谈得上守卫（解析失效时不能静默放行）
	assert.ok(bare.size > 50, `只从主题样式解析出 ${bare.size} 个裸类名，解析逻辑可能失效`)

	// 2) 消费方组件里定义的类名，逐个比对
	const offences: string[] = []
	for (const root of CONSUMER_ROOTS) {
		for (const file of walkVue(root)) {
			for (const cls of definedClasses(readFileSync(file, 'utf8'))) {
				const from = bare.get(cls)
				if (from)
					offences.push(`${file} 的 .${cls} 撞上 ${THEME_STYLE_DIR}/${from}`)
			}
		}
	}
	assert.deepEqual(offences, [], `发现类名撞车（请给组件内的类换个名字）：\n${offences.join('\n')}`)
})
