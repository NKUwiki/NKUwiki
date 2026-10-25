/**
 * /api/* 路由。写操作统一走两条通道：
 *   owner / member → 直接执行（storage 层）
 *   guest          → 写入 _pending，由 owner 在「待审批」面板放行
 * 上传按单文件一次请求（前端串行发），把单请求体压在 Worker 内存限制之内。
 */
import type { AuthContext, Env } from './types.ts'
import { authenticate, AuthError } from './auth.ts'
import { getCatalog } from './catalog.ts'
import {
	actorLabel,
	createPending,
	decidePending,
	deletePath,
	ensureDir,
	listLevel,
	listPending,
	moveObject,
	storeFile,
} from './storage.ts'
import { base64ToBytes, normalizeDir, sanitizeFileName, sha256Hex, toManagedDir } from './util.ts'

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { 'content-type': 'application/json; charset=utf-8' },
	})
}

function fail(message: string, status = 400): Response {
	return json({ error: message }, status)
}

/** 空串/空白归一为根目录（''），其余目录走 normalizeDir 校验；非法返回 null */
function parseDir(raw: string | null | undefined): string | null {
	if (!raw || !raw.trim())
		return ''
	return normalizeDir(raw)
}

async function readJson<T>(request: Request): Promise<T> {
	try {
		return await request.json() as T
	}
	catch {
		throw new ApiError('请求体不是合法 JSON')
	}
}

export class ApiError extends Error {}

/** 每个处理器自己解析 auth；只有写操作需要区分角色 */
type Handler = (request: Request, env: Env, url: URL, auth: AuthContext) => Promise<Response>

const MAX_FILES_PER_REQUEST = 20

const routes: Record<string, Handler> = {
	'GET /api/me': async (_request, env, _url, auth) => {
		return json({
			role: auth.role,
			requireAuth: !!env.REQUIRE_AUTH && env.REQUIRE_AUTH !== 'false',
			user: {
				login: auth.user.login,
				email: auth.user.email,
				label: actorLabel(auth.user.login, auth.user.email, auth.user.source === 'anonymous'),
			},
		})
	},

	'GET /api/catalog': async (_request, env) => {
		try {
			const { groups, stale } = await getCatalog(env)
			return json({ groups, stale })
		}
		catch (error) {
			return json({ groups: [], stale: true, error: (error as Error).message })
		}
	},

	'GET /api/list': async (_request, env, url) => {
		const dir = parseDir(url.searchParams.get('dir'))
		if (dir === null)
			return fail('目录路径不合法')
		return json(await listLevel(env, dir))
	},

	'POST /api/upload': async (request, env, _url, auth) => {
		const maxMb = Number(env.MAX_UPLOAD_MB) || 25
		if ((Number(request.headers.get('content-length')) || 0) > maxMb * 1.4 * 1024 * 1024 + 64 * 1024)
			return fail(`请求过大，单文件上限 ${maxMb}MB`, 413)

		const body = await readJson<{ dir?: string, files?: Array<{ name?: string, b64?: string, sha256?: string }> }>(request)
		// 上传只落在 img/ 子树：'03/03'、'img/03/03'、'' 都归一为 'img/03/03' / 'img'
		const dir = toManagedDir(body.dir ?? '')
		if (dir === null)
			return fail('目标目录不合法')
		const files = (body.files ?? []).slice(0, MAX_FILES_PER_REQUEST)
		if (!files.length)
			return fail('没有文件')
		const actor = actorLabel(auth.user.login, auth.user.email, auth.user.source === 'anonymous')
		const asGuest = auth.role === 'guest'

		const results = []
		for (const file of files) {
			const name = sanitizeFileName(file.name ?? '')
			if (!file.b64) {
				results.push({ name, error: '缺少文件内容' })
				continue
			}
			try {
				const bytes = base64ToBytes(file.b64)
				if (bytes.byteLength > maxMb * 1024 * 1024) {
					results.push({ name, error: `超过单文件上限 ${maxMb}MB` })
					continue
				}
				const sha256 = await sha256Hex(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
				if (file.sha256 && file.sha256 !== sha256) {
					results.push({ name, error: '内容校验不符，请重试' })
					continue
				}
				if (asGuest) {
					// 必须把内容作为 blob 一并存进 _pending/：申请里只有元数据，
					// 批准时 applyPending 靠它还原文件
					const meta = await createPending(env, {
						action: 'upload',
						actor,
						actorRole: auth.role,
						dir,
						name,
						size: bytes.byteLength,
						sha256,
					}, bytes)
					results.push({ name, queued: true, id: meta.id })
				}
				else {
					// stored 含去重改名后的最终 name/key/url，直接作为结果返回
					const stored = await storeFile(env, dir, name, bytes, sha256, actor)
					results.push({ queued: false, ...stored })
				}
			}
			catch (error) {
				results.push({ name, error: (error as Error).message })
			}
		}
		return json({ results, asGuest })
	},

	'POST /api/action': async (request, env, _url, auth) => {
		const body = await readJson<{
			actions?: Array<{ type?: string, key?: string, name?: string, dir?: string }>
		}>(request)
		const actions = (body.actions ?? []).slice(0, MAX_FILES_PER_REQUEST)
		if (!actions.length)
			return fail('没有操作')
		const actor = actorLabel(auth.user.login, auth.user.email, auth.user.source === 'anonymous')
		const asGuest = auth.role === 'guest'

		const results = []
		for (const action of actions) {
			try {
				const key = action.key ? normalizeDir(action.key) : null
				if (action.key && key === null)
					throw new ApiError('源路径不合法')
				switch (action.type) {
					case 'delete': {
						if (!key)
							throw new ApiError('缺少目标路径')
						if (asGuest)
							await createPending(env, { action: 'delete', actor, actorRole: auth.role, key })
						else
							await deletePath(env, key)
						break
					}
					case 'rename': {
						if (!key || !action.name)
							throw new ApiError('缺少目标路径或新名称')
						const name = sanitizeFileName(action.name)
						if (asGuest)
							await createPending(env, { action: 'rename', actor, actorRole: auth.role, key, name })
						else
							await moveObject(env, key, key.slice(0, Math.max(key.lastIndexOf('/'), 0)), name)
						break
					}
					case 'move': {
						if (!key || action.dir === undefined)
							throw new ApiError('缺少目标路径或目标目录')
						const dir = toManagedDir(action.dir)
						if (dir === null)
							throw new ApiError('目标目录不合法')
						if (asGuest)
							await createPending(env, { action: 'move', actor, actorRole: auth.role, key, dir })
						else
							await moveObject(env, key, dir)
						break
					}
					case 'mkdir': {
						const dir = toManagedDir(action.dir ?? '')
						if (dir === null)
							throw new ApiError('目录名不合法')
						if (asGuest)
							await createPending(env, { action: 'mkdir', actor, actorRole: auth.role, dir })
						else
							await ensureDir(env, dir, actor)
						break
					}
					default:
						throw new ApiError(`未知操作类型 ${action.type}`)
				}
				results.push({ type: action.type, key: action.key, ok: true, queued: asGuest })
			}
			catch (error) {
				results.push({ type: action.type, key: action.key, ok: false, error: error instanceof ApiError ? error.message : (error as Error).message })
			}
		}
		return json({ results, asGuest })
	},

	'GET /api/pending': async (_request, env, _url, auth) => {
		const all = await listPending(env)
		const isOwner = auth.role === 'owner'
		const me = actorLabel(auth.user.login, auth.user.email, auth.user.source === 'anonymous')
		return json({
			role: auth.role,
			pendings: isOwner ? all : all.filter(meta => meta.actor === me),
		})
	},

	'POST /api/pending/decide': async (request, env, _url, auth) => {
		if (auth.role !== 'owner')
			return fail('只有 owner 可以审批', 403)
		const body = await readJson<{ ids?: string[], approve?: boolean }>(request)
		const ids = (body.ids ?? []).slice(0, 50)
		if (!ids.length)
			return fail('没有选择申请')
		const results = []
		for (const id of ids) {
			try {
				const meta = await decidePending(env, id, body.approve !== false)
				results.push({ id, ok: !!meta })
			}
			catch (error) {
				results.push({ id, ok: false, error: (error as Error).message })
			}
		}
		return json({ results })
	},
}

export async function handleApi(request: Request, env: Env, url: URL): Promise<Response> {
	const auth = await authenticate(request, env).catch((error) => {
		if (error instanceof AuthError)
			return fail(error.message, error.status)
		return fail('鉴权失败', 401)
	})
	if (auth instanceof Response)
		return auth

	const route = `${request.method} ${url.pathname}`
	const handler = routes[route]
	if (!handler)
		return fail('接口不存在', 404)
	try {
		return await handler(request, env, url, auth)
	}
	catch (error) {
		if (error instanceof ApiError)
			return fail(error.message)
		return fail(`服务器错误：${(error as Error).message}`, 500)
	}
}
