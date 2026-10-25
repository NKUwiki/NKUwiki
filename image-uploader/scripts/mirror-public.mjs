/**
 * 把 docs/public 的静态资源镜像上传到 R2 图床桶（键 = 相对 docs/public 的路径），
 * 使桶内布局与站内引用一致：/img/05/09/x.png → img/05/09/x.png。
 *
 * 跳过 CNAME 与 robots.txt（Pages 站点自身的配置，不作为资源被改写引用）。
 * 幂等可重跑：同名对象直接覆盖，内容相同的多传一次没有副作用。
 *
 * 用法（需要先 `npx wrangler login`）：
 *   node scripts/mirror-public.mjs             # 全量上传
 *   node scripts/mirror-public.mjs img/03      # 只上传某前缀（增量补传）
 *   node scripts/mirror-public.mjs --dry       # 只打印将要上传的清单
 *
 * 实现：直接以 node 启动 wrangler 的 JS 入口（node_modules/wrangler/bin/wrangler.js）。
 * 不能 spawn `npx.cmd`——Node ≥20.12 出于 CVE-2024-27980 禁止无 shell 直接执行
 * .cmd/.bat（EINVAL），这正是本脚本首版在 Windows 上全量失败的根因。
 */
import { spawn } from 'node:child_process'
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
const only = args.find(arg => !arg.startsWith('--'))

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

const pending = []
let uploaded = 0
let failed = 0

for (const file of walk(PUBLIC_ROOT)) {
	const rel = relative(PUBLIC_ROOT, file).split(sep).join('/')
	if (SKIP.has(basename(file)) || SKIP.has(rel))
		continue
	if (only && !rel.startsWith(only))
		continue
	const type = MIME[rel.split('.').pop().toLowerCase()] || 'application/octet-stream'
	if (dry) {
		console.log(`[dry] ${rel} (${type}, ${statSync(file).size} B)`)
		uploaded++
		continue
	}
	pending.push(async () => {
		const result = await putOnce(`${BUCKET}/${rel}`, file, type)
		if (result.ok) {
			uploaded++
			console.log(`✓ ${rel}`)
		}
		else {
			failed++
			console.error(`✗ ${rel}\n${result.output.trim().slice(-400) || '未知错误'}`)
		}
	})
}

// 简单并发池：始终维持 CONCURRENCY 个任务在跑
const queue = [...pending]
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
	while (queue.length)
		await queue.shift()()
}))

console.log(`\n完成：${uploaded} 个对象${dry ? '（dry run）' : ''}${failed ? `，失败 ${failed} 个` : ''}`)
process.exitCode = failed ? 1 : 0
