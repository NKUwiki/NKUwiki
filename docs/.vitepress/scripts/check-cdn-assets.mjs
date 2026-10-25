/**
 * 部署前闸门：产物里每一个指向图床的地址，都必须真的能取到。
 *
 * 为什么需要：replace-assets 是**无条件**改写（为支持「图片只存图床、仓库不放」），
 * 于是「仓库里有图、桶里没同步」时构建照常成功，`pnpm dev` 也不经过插件（apply: 'build'），
 * 本地怎么看都正常，只有线上 404。这个脚本把「静默缺图」变成 CI 红灯，
 * 且跑在上传产物之前——失败时部署不会发生，旧版本继续在线。
 *
 * 用法（产物必须是用同一个 WIKI_ASSETS_BASE 构建的，否则里面没有外链地址）：
 *   WIKI_ASSETS_BASE=https://img.freshnkuer.wiki node docs/.vitepress/scripts/check-cdn-assets.mjs
 *   node docs/.vitepress/scripts/check-cdn-assets.mjs docs/.vitepress/dist
 *
 * 只读探测：先 HEAD，个别 CDN 对 HEAD 不友好时退回 `Range: bytes=0-0` 的 GET。
 */
import { appendFileSync, existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import process from 'node:process'

const dist = process.argv[2] ?? 'docs/.vitepress/dist'
const base = (process.env.WIKI_ASSETS_BASE ?? '').replace(/\/+$/, '')
/**
 * main 分支卡死（默认），PR 只警告：contributor 没有桶的写权限，
 * 在 PR 阶段硬失败会让人无从下手——合并后由维护者 mirror 一次即可。
 */
const strict = process.env.CHECK_CDN_STRICT !== 'false'
const CONCURRENCY = 8
const TIMEOUT = 15_000
/** 产物里需要扫的文件类型（字体等二进制不必扫，它们不会含外链地址） */
const TEXT_FILE = /\.(?:html|js|mjs|cjs|css|webmanifest|json)$/i

if (!base) {
	console.log('未设置 WIKI_ASSETS_BASE：插件处于空转状态，产物里没有外链地址，跳过校验。')
	process.exit(0)
}

if (!existsSync(dist)) {
	console.error(`找不到产物目录 ${dist}——先构建（带同一个 WIKI_ASSETS_BASE）再来校验。`)
	process.exit(1)
}

function escapeRegExp(text) {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// 字符类与插件正文一致（packages/wiki-theme/lib/vite/replace-assets.ts 的 pattern），
// 额外排除 <>——shiki 会把代码块里的裸域名包进 <span>，不过滤会把紧跟其后的标签
// 当成路径的一部分。要求域名后带非空路径：代码示例里的裸域名不是资源。
const BACKTICK = String.fromCharCode(96)
const urlPattern = new RegExp(`${escapeRegExp(base)}(/[^"'${BACKTICK}()\\s<>]*)`, 'g')

function collect(directory) {
	const files = []
	const walk = (current) => {
		for (const entry of readdirSync(current)) {
			const full = join(current, entry)
			if (statSync(full).isDirectory())
				walk(full)
			else if (TEXT_FILE.test(entry))
				files.push(full)
		}
	}
	walk(directory)
	return files
}

/** 地址 → 第一个出现它的产物文件，报错时能直接定位到页面 */
const sources = new Map()
for (const file of collect(dist)) {
	for (const match of readFileSync(file, 'utf8').matchAll(urlPattern)) {
		if (!sources.has(match[0]))
			sources.set(match[0], relative(dist, file).split('\\').join('/'))
	}
}

if (!sources.size) {
	console.log(`产物 ${dist} 里没有 ${base} 开头的地址，跳过校验。`)
	process.exit(0)
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

/** 返回状态码，网络层失败返回 'ERR' */
async function probe(url) {
	try {
		const response = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(TIMEOUT) })
		if (response.status === 405 || response.status === 501)
			return await probeRange(url)
		return response.status
	}
	catch {
		return 'ERR'
	}
}

async function probeRange(url) {
	try {
		const response = await fetch(url, {
			headers: { range: 'bytes=0-0' },
			signal: AbortSignal.timeout(TIMEOUT),
		})
		return response.status
	}
	catch {
		return 'ERR'
	}
}

/** 网络抖动/5xx 重试一次；4xx 不重试——404 就是真缺对象 */
async function status(url) {
	const first = await probe(url)
	if (typeof first === 'number' && first < 500)
		return first
	await sleep(400)
	return probe(url)
}

const queue = [...sources.keys()]
const failures = []
let checked = 0

await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
	while (queue.length) {
		const url = queue.shift()
		const code = await status(url)
		checked++
		if (typeof code === 'number' && code < 400)
			continue
		failures.push({ code, source: sources.get(url), url })
	}
}))

function decode(url) {
	try {
		return decodeURIComponent(url)
	}
	catch {
		return url
	}
}

if (!failures.length) {
	console.log(`✓ 图床地址全部可达：${checked} 个（去重后）`)
	process.exit(0)
}

failures.sort((a, b) => a.url.localeCompare(b.url))
console.error(`✗ ${failures.length} / ${checked} 个图床地址取不到：\n`)
for (const { code, source, url } of failures) {
	console.error(`  [${code}] ${decode(url)}`)
	console.error(`         出现在 ${source}`)
}

const prefixes = [...new Set(failures.map(({ url }) =>
	decode(url).slice(base.length + 1).split('/').slice(0, 2).join('/'),
))]
console.error('\n修法：把缺的对象传进桶，然后重新构建（或直接重新推 CI）——')
console.error(`  node image-uploader/scripts/mirror-public.mjs ${prefixes[0]}`)
console.error('长期办法：给仓库配 CLOUDFLARE_API_TOKEN，CI 会在构建前自动镜像 docs/public。')

const summary = process.env.GITHUB_STEP_SUMMARY
if (summary) {
	const rows = failures.map(({ code, source, url }) => `| \`${code}\` | \`${decode(url)}\` | \`${source}\` |`)
	appendFileSync(summary, [
		`### 图床缺 ${failures.length} 个对象`,
		'',
		'| 状态 | 地址 | 首次出现在 |',
		'| --- | --- | --- |',
		...rows,
		'',
	].join('\n'))
}

if (!strict) {
	// PR 阶段：只annotation提示，不拦构建（贡献者没有桶的写权限）
	console.log(`::warning::有 ${failures.length} 个图床地址取不到，合并前请先 mirror 到桶`)
	process.exit(0)
}

process.exit(1)
