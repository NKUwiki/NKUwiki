/**
 * R2 操作层：网盘式列目录、去重上传、删除/重命名/移动/新建目录、_pending 审批流。
 *
 * 桶键布局镜像主站 docs/public/ 的相对路径（img/05/09/美食.jpg、food/...、favicon 等），
 * 与站内 /img/... 引用经 replace-assets 改写后的 CDN 链接一一对应；上传器把所有写入
 * 归一到 img/ 子树（util.toManagedDir）。另有两组保留前缀：
 *   _meta/    — 图床自身数据（catalog 缓存），列表里隐藏
 *   _pending/ — 待审批申请：<id>.json 元数据 + <id>.blob 内容（仅上传申请有）
 * 空目录靠 .keep 占位实现（R2 没有真目录）；文件名清洗会把开头的点剥掉，
 * 用户永远上传不出与占位冲突的同名文件。
 */
import type { Env, Role } from './types.ts'
import type { StoreKind } from './util.ts'
import { dedupeTargetName, normalizeDir, sha256Hex, truncateFileName } from './util.ts'

export const PENDING_PREFIX = '_pending/'
const KEEP_NAME = '.keep'
/** 同名冲突改名最多尝试次数，超过则加时间戳兜底 */
const MAX_RENAME_TRIES = 5

export interface ListedFile {
	key: string
	name: string
	size: number
	/** ISO 时间 */
	uploaded: string | null
	sha256: string | null
	url: string
}

export interface ListLevelResult {
	dir: string
	dirs: string[]
	files: ListedFile[]
}

/** 公开链接：配了 IMAGE_BASE_URL 用之，否则走 Worker 自身 /img/* 代理（路径与键一一对应） */
export function publicUrl(env: Env, key: string): string {
	const base = (env.IMAGE_BASE_URL || '').replace(/\/+$/, '')
	return base ? `${base}/${key}` : `/${key}`
}

/** 列一层目录（目录浏览、移动目标选择都用它）。保留前缀与 .keep 不出现在结果里 */
export async function listLevel(env: Env, dir: string): Promise<ListLevelResult> {
	const prefix = dir ? `${dir}/` : ''
	const result: ListLevelResult = { dir, dirs: [], files: [] }
	let cursor: string | undefined
	do {
		const page = await env.BUCKET.list({ prefix, delimiter: '/', cursor, limit: 500 })
		for (const sub of page.delimitedPrefixes ?? []) {
			const name = sub.slice(prefix.length).replace(/\/$/, '')
			if (name && !name.startsWith('_'))
				result.dirs.push(name)
		}
		for (const object of page.objects) {
			const name = object.key.slice(prefix.length)
			if (name === KEEP_NAME)
				continue
			result.files.push({
				key: object.key,
				name,
				size: object.size,
				uploaded: object.uploaded?.toISOString() ?? null,
				sha256: object.customMetadata?.sha256 ?? null,
				url: publicUrl(env, object.key),
			})
		}
		cursor = page.truncated ? page.cursor : undefined
	} while (cursor)
	result.dirs.sort()
	result.files.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
	return result
}

export interface StoreResult {
	kind: StoreKind
	key: string
	name: string
	url: string
}

/** 去重上传：同名同内容复用现有对象，同名不同内容加短哈希改名 */
export async function storeFile(
	env: Env,
	dir: string,
	rawName: string,
	bytes: Uint8Array,
	sha256: string,
	actor: string,
): Promise<StoreResult> {
	let name = truncateFileName(rawName)
	let key = `${dir}/${name}`
	let kind: StoreKind = 'stored'

	const existing = await env.BUCKET.head(key)
	if (existing) {
		if (existing.customMetadata?.sha256 === sha256)
			return { kind: 'deduped', key, name, url: publicUrl(env, key) }
		kind = 'renamed'
		for (let attempt = 0; attempt < MAX_RENAME_TRIES; attempt++) {
			name = truncateFileName(dedupeTargetName(name, sha256))
			key = `${dir}/${name}`
			const clash = await env.BUCKET.head(key)
			if (!clash)
				break
			if (clash.customMetadata?.sha256 === sha256)
				return { kind: 'deduped', key, name, url: publicUrl(env, key) }
			if (attempt === MAX_RENAME_TRIES - 1)
				name = `${Date.now().toString(36)}-${name}`
		}
	}

	await env.BUCKET.put(key, bytes, {
		customMetadata: { sha256, uploader: actor, original: rawName },
		httpMetadata: { contentType: contentTypeOf(name) },
	})
	return { kind, key, name, url: publicUrl(env, key) }
}

const MIME: Record<string, string> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp',
	avif: 'image/avif',
	svg: 'image/svg+xml',
	bmp: 'image/bmp',
	ico: 'image/x-icon',
	mp4: 'video/mp4',
	webm: 'video/webm',
	pdf: 'application/pdf',
}

function contentTypeOf(name: string): string {
	const ext = name.split('.').pop()?.toLowerCase() ?? ''
	return MIME[ext] || 'application/octet-stream'
}

/** 新建目录：写 .keep 占位（幂等） */
export async function ensureDir(env: Env, dir: string, actor: string): Promise<void> {
	await env.BUCKET.put(`${dir}/${KEEP_NAME}`, new Uint8Array(0), {
		customMetadata: { placeholder: '1', uploader: actor },
	})
}

/** 递归删除：key 是文件就删它，否则当作目录前缀整删 */
export async function deletePath(env: Env, key: string): Promise<number> {
	const clean = normalizeDir(key)
	if (!clean)
		throw new Error(`非法路径：${key}`)
	// 图片根目录只允许通过控制台清桶，API 侧永远拒删（误删等于清空全部图片）
	if (clean === 'img')
		throw new Error('不允许删除图片根目录 img/')
	const target = `${clean}`
	const existing = await env.BUCKET.head(target)
	if (existing) {
		await env.BUCKET.delete(target)
		return 1
	}
	return deleteByPrefix(env, `${target}/`)
}

async function deleteByPrefix(env: Env, prefix: string): Promise<number> {
	let deleted = 0
	let cursor: string | undefined
	do {
		const page = await env.BUCKET.list({ prefix, cursor, limit: 500 })
		const keys = page.objects.map(object => object.key)
		if (keys.length)
			await env.BUCKET.delete(keys)
		deleted += keys.length
		cursor = page.truncated ? page.cursor : undefined
	} while (cursor)
	return deleted
}

/** 重命名 / 移动：get → put（保留元数据）→ delete */
export async function moveObject(env: Env, fromKey: string, toDir: string, toName?: string): Promise<string> {
	const from = normalizeDir(fromKey)
	const dir = normalizeDir(toDir)
	if (!from || !dir)
		throw new Error('非法路径')
	const name = toName ?? (from.split('/').pop() || '')
	const to = `${dir}/${name}`
	if (!name || to === from)
		return from
	const object = await env.BUCKET.get(from)
	if (!object)
		throw new Error(`源不存在：${from}`)
	const bytes = await object.arrayBuffer()
	await env.BUCKET.put(to, bytes, {
		customMetadata: object.customMetadata,
		httpMetadata: object.httpMetadata,
	})
	await env.BUCKET.delete(from)
	// 源目录若因此空了，保留占位让它在列表里继续可见
	if (from.includes('/')) {
		const parent = from.slice(0, from.lastIndexOf('/'))
		const remaining = await env.BUCKET.list({ prefix: `${parent}/`, limit: 1 })
		if (!remaining.objects.length)
			await ensureDir(env, parent, object.customMetadata?.uploader ?? '')
	}
	return to
}

/* ── 待审批 ── */

export type PendingAction = 'upload' | 'delete' | 'rename' | 'move' | 'mkdir'

export interface PendingMeta {
	id: string
	action: PendingAction
	/** 申请人标识（邮箱优先，其次 GitHub login） */
	actor: string
	actorRole: Role
	createdAt: string
	/** upload：目标目录；move：目标目录；mkdir：目录本身 */
	dir?: string
	/** upload：文件名；rename：新文件名 */
	name?: string
	/** delete / rename / move 的源 key */
	key?: string
	size?: number
	sha256?: string
}

export async function createPending(env: Env, meta: Omit<PendingMeta, 'id' | 'createdAt'>, blob?: Uint8Array): Promise<PendingMeta> {
	const full: PendingMeta = { ...meta, id: crypto.randomUUID(), createdAt: new Date().toISOString() }
	if (blob)
		await env.BUCKET.put(`${PENDING_PREFIX}${full.id}.blob`, blob)
	await env.BUCKET.put(`${PENDING_PREFIX}${full.id}.json`, JSON.stringify(full))
	return full
}

export async function listPending(env: Env): Promise<PendingMeta[]> {
	const metas: PendingMeta[] = []
	let cursor: string | undefined
	do {
		const page = await env.BUCKET.list({ prefix: PENDING_PREFIX, cursor, limit: 500 })
		for (const object of page.objects) {
			if (!object.key.endsWith('.json'))
				continue
			const body = await env.BUCKET.get(object.key)
			if (!body)
				continue
			try {
				metas.push(await body.json<PendingMeta>())
			}
			catch {
				// 单条损坏不阻塞整个列表
			}
		}
		cursor = page.truncated ? page.cursor : undefined
	} while (cursor)
	return metas.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export async function decidePending(env: Env, id: string, approve: boolean): Promise<PendingMeta | null> {
	const metaObj = await env.BUCKET.get(`${PENDING_PREFIX}${id}.json`)
	if (!metaObj)
		return null
	const meta = await metaObj.json<PendingMeta>()
	if (approve)
		await applyPending(env, meta)
	// 元数据与内容一起清理；R2 delete 幂等，非上传申请的 blob 本就不存在
	await env.BUCKET.delete(`${PENDING_PREFIX}${id}.json`)
	await env.BUCKET.delete(`${PENDING_PREFIX}${id}.blob`)
	return meta
}

/** 执行一条批准的申请。所有输入在创建申请时已校验，这里兜底再验一次 */
async function applyPending(env: Env, meta: PendingMeta): Promise<void> {
	switch (meta.action) {
		case 'upload': {
			if (!meta.dir || !meta.name || !meta.sha256)
				throw new Error('申请缺少上传参数')
			const blob = await env.BUCKET.get(`${PENDING_PREFIX}${meta.id}.blob`)
			if (!blob)
				throw new Error('上传内容已丢失')
			const bytes = new Uint8Array(await blob.arrayBuffer())
			if (await sha256Hex(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer) !== meta.sha256)
				throw new Error('内容校验不符')
			await storeFile(env, meta.dir, meta.name, bytes, meta.sha256, meta.actor)
			break
		}
		case 'delete':
			if (meta.key)
				await deletePath(env, meta.key)
			break
		case 'rename': {
			if (meta.key && meta.name) {
				// 同目录改名；源在根目录时父目录为空串
				const parent = meta.key.slice(0, Math.max(meta.key.lastIndexOf('/'), 0))
				await moveObject(env, meta.key, parent, meta.name)
			}
			break
		}
		case 'move':
			if (meta.key && meta.dir)
				await moveObject(env, meta.key, meta.dir)
			break
		case 'mkdir':
			if (meta.dir)
				await ensureDir(env, meta.dir, meta.actor)
			break
	}
}

/** 申请人标识：邮箱优先（Access 场景），匿名/无邮箱时给个可读占位 */
export function actorLabel(login: string | null, email: string | null, anonymous: boolean): string {
	if (email)
		return email
	if (login)
		return login
	return anonymous ? '匿名（开发模式）' : '未登录用户'
}
