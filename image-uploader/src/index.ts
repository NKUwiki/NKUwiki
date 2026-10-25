/**
 * Worker 入口：
 *   /          — 上传器单页 UI
 *   /api/*     — JSON 接口（见 api.ts）
 *   /img/*     — 图片读取代理。桶绑了自定义域名（IMAGE_BASE_URL）后流量不经过
 *                Worker；这条路由是没绑域名时的兜底，让上传器开箱即用。
 *                路径与桶键一一对应（/img/05/09/x.png → 键 img/05/09/x.png）。
 */
import type { Env } from './types.ts'
import { handleApi } from './api.ts'
import { pageHtml } from './ui.ts'

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url)
		if (url.pathname === '/' || url.pathname === '/index.html')
			return new Response(pageHtml(), { headers: { 'content-type': 'text/html; charset=utf-8' } })
		if (url.pathname.startsWith('/api/'))
			return handleApi(request, env, url)
		if (url.pathname === '/img' || url.pathname.startsWith('/img/'))
			return serveImage(request, env, url)
		return new Response('Not Found', { status: 404 })
	},
}

async function serveImage(request: Request, env: Env, url: URL): Promise<Response> {
	let key = ''
	try {
		// 桶键镜像 docs/public 的相对路径：URL 路径去掉开头的斜杠即为键
		key = decodeURIComponent(url.pathname.slice(1))
	}
	catch {
		return new Response('Bad Request', { status: 400 })
	}
	// 保留前缀（_pending/_meta）与路径穿越不通过代理暴露；列表接口同样把它们隐藏
	if (!key || key.startsWith('_') || key.split('/').some(segment => segment === '' || segment === '.' || segment === '..'))
		return new Response('Not Found', { status: 404 })

	const headers = new Headers({ 'cache-control': 'public, max-age=31536000, immutable' })
	if (request.method === 'HEAD') {
		const object = await env.BUCKET.head(key)
		if (!object)
			return new Response('Not Found', { status: 404 })
		headers.set('etag', object.httpEtag)
		if (object.httpMetadata?.contentType)
			headers.set('content-type', object.httpMetadata.contentType)
		if (object.size !== undefined)
			headers.set('content-length', String(object.size))
		return new Response(null, { status: 200, headers })
	}

	const object = await env.BUCKET.get(key, { onlyIf: request.headers })
	if (!object)
		return new Response('Not Found', { status: 404 })
	// onlyIf 未命中时 R2 返回无 body 的 R2Object（304 场景），缓存头照常下发
	if (!('body' in object) || !object.body) {
		headers.set('etag', object.httpEtag)
		return new Response(null, { status: 304, headers })
	}
	headers.set('etag', object.httpEtag)
	if (object.httpMetadata?.contentType)
		headers.set('content-type', object.httpMetadata.contentType)
	return new Response(object.body, { headers })
}
