/**
 * 文章目录：上传时让投稿人选「哪个栏目哪篇文章」，而不是手填图片目录。
 *
 * 数据源是主站仓库的 git 树（GitHub API），拉一次缓存到 R2（_meta/catalog.json）
 * 与实例内存，TTL 一小时——上传器对 GitHub 的依赖被压到每天至多几十次请求。
 * GitHub 不可用时回退到过期缓存；连缓存都没有才报错，UI 侧允许改用手动路径。
 */
import type { Env } from './types.ts'
import type { CatalogGroup } from './util.ts'
import { buildCatalog } from './util.ts'

const CATALOG_KEY = '_meta/catalog.json'
/** 目录变化低频（新文章才变），24h 缓存把对 GitHub 的依赖压到最低 */
const TTL_MS = 24 * 60 * 60 * 1000

interface CacheEntry {
	fetchedAt: number
	groups: CatalogGroup[]
}

/** isolate 级内存缓存：Worker 实例存活期间不再打 R2 */
let memoryCache: CacheEntry | null = null

async function fetchArticlePaths(env: Env, anonymous = false): Promise<string[]> {
	const res = await fetch(`https://api.github.com/repos/${env.WIKI_REPO}/git/trees/HEAD?recursive=1`, {
		headers: {
			'accept': 'application/vnd.github+json',
			'user-agent': 'nkuwiki-image-uploader',
			...(env.GITHUB_TOKEN && !anonymous ? { authorization: `Bearer ${env.GITHUB_TOKEN}` } : {}),
		},
	})
	if (!res.ok)
		throw new Error(`GitHub API 返回 ${res.status}${res.status === 401 ? '（GITHUB_TOKEN 无效？）' : res.status === 403 ? '（限流，配置 GITHUB_TOKEN 可解）' : ''}`)
	const data = await res.json() as { tree?: Array<{ path?: string }> }
	return (data.tree ?? []).map(item => item.path ?? '').filter(Boolean)
}

async function readCached(env: Env): Promise<CacheEntry | null> {
	const obj = await env.BUCKET.get(CATALOG_KEY)
	if (!obj)
		return null
	try {
		const parsed = await obj.json<CacheEntry>()
		if (!Array.isArray(parsed?.groups))
			return null
		// fetchedAt 兼容 ISO 字符串与毫秒数两种历史格式，统一成毫秒
		const fetchedAt = typeof parsed.fetchedAt === 'number' ? parsed.fetchedAt : Date.parse(parsed.fetchedAt)
		if (!Number.isFinite(fetchedAt))
			return null
		return { fetchedAt, groups: parsed.groups }
	}
	catch {
		return null
	}
}

export async function getCatalog(env: Env): Promise<{ groups: CatalogGroup[], stale: boolean }> {
	const now = Date.now()
	if (memoryCache && now - memoryCache.fetchedAt < TTL_MS)
		return { groups: memoryCache.groups, stale: false }

	const cached = await readCached(env)
	if (cached && now - cached.fetchedAt < TTL_MS) {
		memoryCache = cached
		return { groups: cached.groups, stale: false }
	}

	try {
		let paths: string[]
		try {
			paths = await fetchArticlePaths(env)
		}
		catch (error) {
			// 配置的 GITHUB_TOKEN 无效（401）时降级为匿名重试：公开仓库无需 token，
			// 匿名受共享出口限流影响，但聊胜于完全不可用
			if (!(error instanceof Error) || !error.message.includes('401') || !env.GITHUB_TOKEN)
				throw error
			paths = await fetchArticlePaths(env, true)
		}
		const groups = buildCatalog(paths)
		const entry: CacheEntry = { fetchedAt: now, groups }
		memoryCache = entry
		await env.BUCKET.put(CATALOG_KEY, JSON.stringify(entry))
		return { groups, stale: false }
	}
	catch (error) {
		if (cached) {
			memoryCache = cached
			return { groups: cached.groups, stale: true }
		}
		throw new Error(`文章目录获取失败：${(error as Error).message}；请稍后重试，或改用自定义路径上传`)
	}
}
