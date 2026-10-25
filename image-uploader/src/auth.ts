/**
 * 登录与角色：
 *   owner  — GitHub 组织 owner，或邮箱命中 ADMIN_EMAILS；直接改桶 + 审批他人申请
 *   member — GitHub 组织成员；自己的操作直接生效
 *   guest  — 其余登录者；一切改动写入 _pending 等待审批
 *
 * REQUIRE_AUTH=false 时不做任何鉴权，一律按 owner 处理（配合 Cloudflare Access
 * 上线前的内测阶段；部署到公网前务必改成 true，见 README）。
 *
 * REQUIRE_AUTH=true 时走两步：
 *   1. 验 CF-Access-Jwt-Assertion（JWKS 验签 + iss/aud/exp），拿到登录邮箱；
 *   2. 用浏览器携带的 CF_Authorization 调 Access 的 get-identity 换 GitHub 身份，
 *      再查组织角色。GitHub 查询失败不阻塞登录——角色降级为 guest，
 *      邮箱命中 ADMIN_EMAILS 的除外（组织查询挂了也能管理）。
 */
import type { AuthContext, Env, Role } from './types.ts'

/** 角色缓存 TTL：组织角色不会频繁变化，避免每次操作都打 GitHub */
const ROLE_TTL_MS = 5 * 60 * 1000
const ROLE_CACHE_LIMIT = 500

interface JwkKey {
	kid: string
	kty: string
	alg: string
	n?: string
	e?: string
	[key: string]: unknown
}

interface AccessClaims {
	email?: string
	sub?: string
	exp?: number
	aud?: string | string[]
	iss?: string
}

interface RoleCacheEntry {
	role: Role
	expires: number
}

const jwksCache: { keys: JwkKey[] | null, expires: number } = { keys: null, expires: 0 }
const roleCache = new Map<string, RoleCacheEntry>()

function cacheRole(key: string, role: Role) {
	if (roleCache.size >= ROLE_CACHE_LIMIT)
		roleCache.clear()
	roleCache.set(key, { role, expires: Date.now() + ROLE_TTL_MS })
}

function cachedRole(key: string): Role | null {
	const hit = roleCache.get(key)
	if (!hit)
		return null
	if (Date.now() > hit.expires) {
		roleCache.delete(key)
		return null
	}
	return hit.role
}

async function getJwks(env: Env): Promise<JwkKey[]> {
	if (jwksCache.keys && Date.now() < jwksCache.expires)
		return jwksCache.keys
	const res = await fetch(`https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`)
	if (!res.ok)
		throw new Error(`Access JWKS 获取失败（${res.status}）`)
	const data = await res.json() as { keys?: JwkKey[] }
	jwksCache.keys = data.keys ?? []
	jwksCache.expires = Date.now() + ROLE_TTL_MS
	return jwksCache.keys
}

/** RS256 验签 + aud/iss/exp 校验，通过返回 claims */
export async function verifyAccessJwt(token: string, env: Env): Promise<AccessClaims> {
	const parts = token.split('.')
	if (parts.length !== 3)
		throw new Error('Access JWT 格式错误')
	const [headB64, payloadB64, sigB64] = parts
	const header = JSON.parse(atob(headB64.replace(/-/g, '+').replace(/_/g, '/'))) as { alg?: string, kid?: string }
	if (header.alg !== 'RS256')
		throw new Error(`不支持的 JWT 算法 ${header.alg}`)

	const keys = await getJwks(env)
	const jwk = keys.find(key => key.kid === header.kid && key.kty === 'RSA')
	if (!jwk?.n || !jwk?.e)
		throw new Error('JWKS 中没有匹配的密钥')
	const cryptoKey = await crypto.subtle.importKey(
		'jwk',
		{ kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
		// Web Crypto 标准算法名：importKey/verify 不接受 JWK 风格的 'RS256'
		{ name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
		false,
		['verify'],
	)
	const signature = Uint8Array.from(atob(sigB64.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0))
	const data = new TextEncoder().encode(`${headB64}.${payloadB64}`)
	const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, signature, data)
	if (!valid)
		throw new Error('JWT 签名校验失败')

	const claims = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/'))) as AccessClaims
	if (!claims.exp || Date.now() / 1000 > claims.exp)
		throw new Error('JWT 已过期')
	const aud = Array.isArray(claims.aud) ? claims.aud[0] : claims.aud
	if (!aud || aud !== env.ACCESS_AUD)
		throw new Error('JWT audience 不匹配')
	// 严格相等而非 endsWith：避免拼接域名绕过
	if (!env.ACCESS_TEAM_DOMAIN || claims.iss !== `https://${env.ACCESS_TEAM_DOMAIN}`)
		throw new Error('JWT issuer 不匹配')
	return claims
}

/**
 * Access identity → GitHub 账号。拿不到（未用 GitHub 登录/网络失败）返回 null。
 * 实测响应为扁平结构：{ id, email, idp: { id, type }, ... }，
 * idp.type 为 'github' 时 id 即 GitHub 数字账号 id。
 */
async function fetchGithubIdentity(env: Env, jwt: string, cookieHeader: string | null): Promise<{ id: string, login: string } | null> {
	try {
		// 文档用法：GET + 转发浏览器的 CF_Authorization cookie；拿不到 cookie 时退回 JWT
		const cookie = cookieHeader?.match(/(?:^|;\s*)CF_Authorization=([^;]*)/)?.[1] ?? ''
		const res = await fetch(`https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/get-identity`, {
			headers: { cookie: cookie ? `CF_Authorization=${cookie}` : '', ...(cookie ? {} : { 'cf-access-jwt-assertion': jwt }) },
		})
		if (!res.ok)
			return null
		const data = await res.json() as { id?: string, idp?: { type?: string } }
		if (!data?.id || data.idp?.type?.toLowerCase() !== 'github')
			return null
		return { id: data.id, login: await resolveGithubLogin(env, data.id) }
	}
	catch {
		return null
	}
}

/** GitHub 数字账号 id → login。GET /user/{id} 需要认证，无 GITHUB_TOKEN 时只能放弃 */
async function resolveGithubLogin(env: Env, accountId: string): Promise<string> {
	if (!env.GITHUB_TOKEN)
		return ''
	const res = await fetch(`https://api.github.com/user/${accountId}`, {
		headers: {
			'accept': 'application/vnd.github+json',
			'authorization': `Bearer ${env.GITHUB_TOKEN}`,
			'user-agent': 'nkuwiki-image-uploader',
		},
	})
	if (!res.ok)
		return ''
	const data = await res.json() as { login?: string }
	return data.login ?? ''
}

/** GitHub 组织角色查询：204 即命中。owner 查询失败时回落到普通成员查询 */
async function fetchGithubRole(env: Env, login: string): Promise<Role | null> {
	if (!login)
		return null
	const headers = {
		'accept': 'application/vnd.github+json',
		'user-agent': 'nkuwiki-image-uploader',
		...(env.GITHUB_TOKEN ? { authorization: `Bearer ${env.GITHUB_TOKEN}` } : {}),
	}
	try {
		const ownerRes = await fetch(`https://api.github.com/orgs/${env.GITHUB_ORG}/members/${login}?role=admin`, { headers })
		if (ownerRes.status === 204)
			return 'owner'
		const memberRes = await fetch(`https://api.github.com/orgs/${env.GITHUB_ORG}/members/${login}`, { headers })
		if (memberRes.status === 204)
			return 'member'
		if (memberRes.status === 404 || memberRes.status === 302)
			return 'guest'
		return null
	}
	catch {
		return null
	}
}

function isAdminEmail(env: Env, email: string | null): boolean {
	const list = (env.ADMIN_EMAILS || '').split(',').map(item => item.trim().toLowerCase()).filter(Boolean)
	return !!email && list.includes(email.toLowerCase())
}

/** /api/* 统一入口：返回登录上下文。REQUIRE_AUTH=true 且 JWT 无效时抛错 */
export async function authenticate(request: Request, env: Env): Promise<AuthContext> {
	if (!env.REQUIRE_AUTH || env.REQUIRE_AUTH === 'false') {
		return {
			user: { email: null, login: null, githubId: null, source: 'anonymous' },
			role: 'owner',
		}
	}

	const jwt = request.headers.get('cf-access-jwt-assertion')
	if (!jwt)
		throw new AuthError('未携带 Cloudflare Access 凭据', 401)
	let claims: AccessClaims
	try {
		claims = await verifyAccessJwt(jwt, env)
	}
	catch (error) {
		throw new AuthError(`Access 校验失败：${(error as Error).message}`, 401)
	}

	const email = claims.email ?? null
	if (isAdminEmail(env, email))
		return { user: { email, login: null, githubId: null, source: 'access' }, role: 'owner' }

	const identity = await fetchGithubIdentity(env, jwt, request.headers.get('cookie'))
	const cacheKey = identity?.id || email || ''
	if (cacheKey) {
		const cached = cachedRole(cacheKey)
		if (cached) {
			return {
				user: { email, login: cached === 'guest' ? null : identity?.login ?? null, githubId: identity?.id ?? null, source: 'access' },
				role: cached,
			}
		}
	}

	if (identity) {
		const role = await fetchGithubRole(env, identity.login)
		if (role) {
			cacheRole(cacheKey, role)
			return { user: { email, login: identity.login, githubId: identity.id, source: 'access' }, role }
		}
	}
	// GitHub 侧查不到角色：按 guest 处理（改动进待审批，不会误伤桶内容）
	if (cacheKey)
		cacheRole(cacheKey, 'guest')
	return { user: { email, login: null, githubId: identity?.id ?? null, source: 'access' }, role: 'guest' }
}

export class AuthError extends Error {
	status: number
	constructor(message: string, status = 401) {
		super(message)
		this.status = status
	}
}
