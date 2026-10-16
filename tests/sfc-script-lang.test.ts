/**
 * 守住一类「静默失效」：不带 lang="ts" 的 <script setup> 里写了 TS 语法。
 *
 * 背景：MapView.vue 是不带 lang="ts" 的普通 JS SFC，而它同时被 ESLint 忽略、
 * 也不会被 vue-tsc 检查（不是 TS 脚本）。上一轮在标点标签里写了
 * `root.querySelector<HTMLElement>('.qut-pin-label')`——这行在纯 JS 里语法合法，
 * 会被解析成 `(fn < HTMLElement) > '.qut-pin-label'`，结果恒为 false，
 * 「选中标点时标签同步变色」这个功能就此静默失效，构建、lint、类型检查全都不报。
 *
 * 所以这里专门扫一遍：非 TS 脚本里禁止出现「泛型调用」写法。
 * 只盯**大写开头的类型名**——这类名字（HTMLElement/Number/Array…）在浏览器里真实存在，
 * 表达式不会抛错，只会静默给出 false；而小写类型名（ref<number>）里的 number 是未定义标识符，
 * 一执行就 ReferenceError（响亮失败），不必在此覆盖。
 * 其它 TS 语法（as 断言、类型标注、非空断言）在 JS 里本就是语法错误，构建会直接拦下。
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const ROOTS = ['packages', 'docs/.vitepress']

function collectVueFiles(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.name === 'node_modules' || entry.name === '.temp')
			continue
		const full = join(dir, entry.name)
		if (entry.isDirectory())
			collectVueFiles(full, out)
		else if (entry.name.endsWith('.vue'))
			out.push(full)
	}
	return out
}

/** 取最后一个 script 块（<script setup> 与 <script> 可能各有一个）及其 lang */
function readScript(source: string) {
	const tags = [...source.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)]
	if (!tags.length)
		return null
	const last = tags[tags.length - 1]
	return { attrs: last[1], body: last[2] }
}

/**
     泛型调用写法：标识符紧跟 <大写开头的类型名>( —— 在纯 JS 里是合法的比较运算，最危险。
    字符类里刻意不含 \s，避免与相邻的 \s* 相互重叠（正则回溯告警）
 */
const GENERIC_CALL = /\b[A-Za-z_$][\w$]*\s*<[A-Z][\w$.]*(?:\s*,\s*[A-Za-z_$][\w$.]*)*>\s*\(/g

test('不带 lang="ts" 的 SFC 脚本里不能出现 TS 泛型写法', () => {
	const problems: string[] = []

	for (const root of ROOTS) {
		for (const file of collectVueFiles(root)) {
			const script = readScript(readFileSync(file, 'utf8'))
			if (!script || /lang\s*=\s*["']ts["']/.test(script.attrs))
				continue
			const lines = script.body.split('\n')
			lines.forEach((line, i) => {
				// 跳过注释行，避免把「举例说明」的注释也算进来
				const code = line.replace(/\/\/.*$/, '').replace(/^\s*\/?\*.*$/, '')
				GENERIC_CALL.lastIndex = 0
				const hit = GENERIC_CALL.exec(code)
				if (hit)
					problems.push(`${file}:${i + 1} 出现泛型写法 ${hit[0].trim()}（该文件脚本不是 TS）`)
			})
		}
	}

	assert.deepEqual(problems, [], `非 TS 脚本里的泛型写法会让功能静默失效：\n${problems.join('\n')}`)
})

test('模板里 ref="x" 用的引用必须在脚本里声明', () => {
	const problems: string[] = []

	for (const root of ROOTS) {
		for (const file of collectVueFiles(root)) {
			const source = readFileSync(file, 'utf8')
			const script = readScript(source)
			const tplStart = source.indexOf('<template>')
			if (!script || tplStart === -1)
				continue
			const template = source.slice(tplStart)
			const names = new Set([...template.matchAll(/\bref="([A-Za-z_$][\w$]*)"/g)].map(m => m[1]))
			for (const name of names) {
				const declared = new RegExp(`\\b(?:const|let|var)\\s+${name}\\b`).test(script.body)
				if (!declared)
					problems.push(`${file}: 模板用了 ref="${name}"，但脚本里没有声明（运行时 ReferenceError，mounted 之后的初始化会全部中断）`)
			}
		}
	}

	assert.deepEqual(problems, [], `模板 ref 缺少脚本声明：\n${problems.join('\n')}`)
})
