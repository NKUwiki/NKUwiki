/**
 * 把 docs/public 的静态资源镜像上传到 R2 图床桶（键 = 相对 docs/public 的路径），
 * 使桶内布局与站内引用一致：/img/05/09/x.png → img/05/09/x.png。
 *
 * 跳过 CNAME 与 robots.txt（Pages 站点自身的配置，不作为资源被改写引用）。
 *
 * ── 增量：默认只传变了的 ──
 * `wrangler r2 object` 没有 list 子命令，拿不到桶内清单；但 R2 对象的 ETag 就是内容的
 * MD5（单段上传），而 IMAGE_BASE_URL 是公开域，HEAD 一次就能读到。于是先 HEAD 再比对，
 * 内容一致就跳过——196 个文件里通常只有新加的几个需要真传，几分钟降到十几秒。
 * 判据是「相等才跳过」：HEAD 失败、404、ETag 缺失或有差异一律照传，最坏只是多传，
 * 不会出现「本地改了但桶里还是旧的」。
 *
 * 用法（需要先 `npx wrangler login`）：
 *   node scripts/mirror-public.mjs             # 增量：只传新增/变化的
 *   node scripts/mirror-public.mjs img/03      # 只处理某前缀（增量补传）
 *   node scripts/mirror-public.mjs --force     # 全量重传（ETag 不可信时用，比如桶被人工改过）
 *   node scripts/mirror-public.mjs --dry       # 只打印判定结果，不写桶
 *
 * 实现：直接以 node 启动 wrangler 的 JS 入口（node_modules/wrangler/bin/wrangler.js）。
 * 不能 spawn `npx.cmd`——Node ≥20.12 出于 CVE-2024-27980 禁止无 shell 直接执行
 * .cmd/.bat（EINVAL），这正是本脚本首版在 Windows 上全量失败的根因。
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join, relative, sep } from 'node:path'
// 显式导入而非直接用全局：ESLint 的 node/prefer-global/process 要求如此
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const PUBLIC_ROOT = fileURLToPath(new URL('../../docs/public/', import.meta.url))
const WRANGLER_BIN = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url))
/** 桶名以 wrangler.toml 为准（[[r2_buckets]] 的 bucket_name），单一事实来源 */
const wranglerToml = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8')
const BUCKET = wranglerToml.match(/^\s*bucket_name\s*=\s*"([^"]+)"/m)?.[1]
if (!BUCKET) {
	console.error('未能从 wrangler.toml 解析 bucket_name')
	process.exit(1)
}
/** 并发上传数：wrangler 每次冷启 1~2s，8 并发把全量 200 个文件压到一分钟级 */
const CONCURRENCY = 8
/** 并发比对数：HEAD 是普通 HTTP，比 spawn wrangler 轻得多，可以开大 */
const COMPARE_CONCURRENCY = 12
/** 公开图片域名，HEAD 比对用；留空则退回全量上传（不知道地址就没法比对） */
const IMAGE_BASE = (wranglerToml.match(/^\s*IMAGE_BASE_URL\s*=\s*"([^"]*)"/m)?.[1] ?? '').replace(/\/+$/, '')
/** 站点自身配置，不进桶 */
const SKIP = new Set(['CNAME', 'robots.txt', '.DS_Store'])

const MIME = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	jfif: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp',
	avif: 'image/avif',
	svg: 'image/svg+xml',
	bmp: 'image/bmp',
	ico: 'image/x-icon',
	mp4: 'video/mp4',
	webm: 'video/webm',
	pdf: 'application/pdf',
	woff: 'font/woff',
	woff2: 'font/woff2',
	ttf: 'font/ttf',
	eot: 'application/vnd.ms-fontobject',
	webmanifest: 'application/manifest+json',
	json: 'application/json',
	vtt: 'text/vtt',
}

const args = process.argv.slice(2)
const dry = args.includes('--dry')
/** 跳过 ETag 比对、强制重传全部（桶被人工改过或怀疑不一致时用） */
const force = args.includes('--force')
const only = args.find(arg => !arg.startsWith('--'))
/** 能不能比对：既要 --force 没开，也要知道公开域名 */
const compared = !force && Boolean(IMAGE_BASE)

function* walk(dir) {
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry)
		const stat = statSync(full)
		if (stat.isDirectory())
			yield* walk(full)
		else
			yield full
	}
}

function putOnce(key, file, type) {
	return new Promise((resolve) => {
		const child = spawn(process.execPath, [
			WRANGLER_BIN,
			'r2',
			'object',
			'put',
			key,
			'--file',
			file,
			'--content-type',
			type,
			'--remote',
		], { stdio: ['ignore', 'pipe', 'pipe'] })
		let output = ''
		child.stdout.on('data', chunk => (output += chunk))
		child.stderr.on('data', chunk => (output += chunk))
		child.on('error', error => resolve({ ok: false, output: String(error) }))
		child.on('close', code => resolve({ ok: code === 0, output }))
	})
}

const md5Of = file => createHash('md5').update(readFileSync(file)).digest('hex')

/**
 * 读桶里同名对象的 ETag。返回规范化的 MD5，取不到（没配域名 / 404 / 网络错 /
 * 响应无 ETag）一律返回 null —— 调用方据此照传，宁可多传一次也不留旧内容。
 */
async function remoteEtag(rel) {
	if (!IMAGE_BASE)
		return null
	try {
		// 逐段编码：encodeURI 会放过 # ? % 等字符（它们会截断路径或改变语义），
		// 按路径段用 encodeURIComponent 才不会把「文件名里有 #」读成锚点。
		const path = rel.split('/').map(encodeURIComponent).join('/')
		const res = await fetch(`${IMAGE_BASE}/${path}`, {
			method: 'HEAD',
			signal: AbortSignal.timeout(15_000),
		})
		if (res.status !== 200)
			return null
		return (res.headers.get('etag') ?? '').replace(/^W\//, '').replace(/"/g, '').toLowerCase() || null
	}
	catch {
		return null
	}
}

let uploaded = 0
let skipped = 0
let failed = 0

const candidates = []
for (const file of walk(PUBLIC_ROOT)) {
	const rel = relative(PUBLIC_ROOT, file).split(sep).join('/')
	if (SKIP.has(basename(file)) || SKIP.has(rel))
		continue
	if (only && !rel.startsWith(only))
		continue
	candidates.push({ rel, file, type: MIME[rel.split('.').pop().toLowerCase()] || 'application/octet-stream' })
}

/** 并发比对，只留下内容不一致（或取不到远端状态）的项 */
async function pickChanged(items) {
	const changed = []
	let cursor = 0
	await Promise.all(Array.from({ length: Math.min(COMPARE_CONCURRENCY, items.length) }, async () => {
		while (cursor < items.length) {
			const item = items[cursor++]
			const etag = await remoteEtag(item.rel)
			if (etag && etag === md5Of(item.file)) {
				skipped++
				continue
			}
			changed.push(item)
		}
	}))
	return changed
}

if (!compared && !dry)
	console.log(force ? '--force：跳过比对，全量重传。' : 'wrangler.toml 未配置 IMAGE_BASE_URL，无法比对 ETag，按全量上传。')

const todo = compared ? await pickChanged(candidates) : candidates

const queue = todo.map(item => async () => {
	if (dry) {
		console.log(`[dry] 上传 ${item.rel} (${item.type}, ${statSync(item.file).size} B)`)
		uploaded++
		return
	}
	const result = await putOnce(`${BUCKET}/${item.rel}`, item.file, item.type)
	if (result.ok) {
		uploaded++
		console.log(`✓ ${item.rel}`)
	}
	else {
		failed++
		console.error(`✗ ${item.rel}\n${result.output.trim().slice(-400) || '未知错误'}`)
	}
})

// 简单并发池：始终维持 CONCURRENCY 个任务在跑
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
	while (queue.length)
		await queue.shift()()
}))

const parts = [`上传 ${uploaded}`]
if (compared)
	parts.push(`跳过 ${skipped}（内容一致）`)
if (failed)
	parts.push(`失败 ${failed}`)
console.log(`\n完成：${parts.join('，')}${dry ? '（dry run）' : ''}`)
process.exitCode = failed ? 1 : 0
