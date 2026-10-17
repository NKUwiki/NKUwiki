/**
 * 美食页评分逻辑：评分借 Twikoo 评论存储。
 *
 * - 每家店占用一个虚拟页面路径 /food/<id>，评论与评分不会出现在普通文章页
 * - 聚合：twikoo.getRecentComments 拉取评论，解析文本里的 [rating:n] 标记求平均
 * - 提交：twikoo 2.x 内置 Vue 3 且经打包压缩，拿不到组件实例（QUT wiki 那套
 *   __vue__ / $children 方案在 2.x 上是失效的），这里改走 DOM——
 *   用原生 value setter + input 事件驱动 v-model，再触发 Twikoo 自己的发送按钮，
 *   因此昵称 / 邮箱 / 反垃圾校验全部沿用 Twikoo 原有链路
 */
import { destroyTwikoo } from '@nkuwiki/theme/theme/composables/twikoo.ts'
import { reactive } from 'vue'

// 销毁实现与主题侧文章评论区共用一份（主题包 composables/twikoo.ts），
// 这里转出去，保持既有 import 路径不变
export { destroyTwikoo }

export const twikooEnvId = import.meta.env.VITE_TWIKOO_ENV_ID || ''

const RATING_RE = /\[rating:([1-5])\]/
/* 单次请求的评论上限。urls 过滤后再截断，所以这里的 500 是「这批店铺的评论总数」，
   不是全站；某家店评论量异常大时才会有尾部丢失。 */
const PAGE_SIZE = 500

/**
 * 每条美食的评分聚合：{ [id]: { sum, count, avg, loaded, loading } }
 *
 * @type {Record<string, { sum: number, count: number, avg: number, loaded: boolean, loading: boolean }>}
 */
export const ratingState = reactive({})

/**
 * 当前访客自己打过的分（本地记录，用于回显与防重复提交）
 *
 * @type {Record<string, number>}
 */
export const myRatings = reactive(readStoredRatings())

/**
 * 读取本地记录的评分
 *
 * @returns {Record<string, number>} 评分表，id → 星级（1-5）
 */
function readStoredRatings() {
	const result = {}
	if (typeof window === 'undefined')
		return result
	try {
		const raw = window.localStorage.getItem('nkuwiki:food-ratings')
		if (raw)
			Object.assign(result, JSON.parse(raw))
	}
	catch {}
	return result
}

export function setMyRating(id, value) {
	const rating = Number(value) || 0
	if (rating > 0)
		myRatings[id] = rating
	else delete myRatings[id]
	if (typeof window === 'undefined')
		return
	try {
		window.localStorage.setItem('nkuwiki:food-ratings', JSON.stringify(myRatings))
	}
	catch {}
}

/* 每条美食在 Twikoo 中占用的页面路径，作为评论与评分的唯一标识 */
export function foodUrl(id) {
	return `/food/${id}`
}

function idFromUrl(url) {
	const match = String(url || '').match(/\/food\/([^/?#]+)/)
	return match ? decodeURIComponent(match[1]) : null
}

export function parseRating(text) {
	const match = String(text || '').match(RATING_RE)
	return match ? Number(match[1]) : null
}

function applyStats(id, stats) {
	const state = ratingState[id] || (ratingState[id] = { sum: 0, count: 0, avg: 0, loaded: false, loading: false })
	state.sum = stats.sum
	state.count = stats.count
	state.avg = stats.count ? stats.sum / stats.count : 0
	state.loaded = true
	state.loading = false
	return state
}

let twikooModule = null

export async function getTwikoo() {
	if (!twikooModule)
		twikooModule = await import('twikoo')
	return twikooModule
}

function chunk(list, size) {
	const chunks = []
	for (let index = 0; index < list.length; index += size) chunks.push(list.slice(index, index + size))
	return chunks
}

function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms))
}

/* ============ 旧 id 兼容（aliases） ============ */
/* id 原则上永不更换；确需更换时（如当初的 slug 起得太糟），在 food-data.js 的
 * 条目上写 aliases: ['旧id']，这里登记后评分聚合会把旧路径的评论一并计入。
 * 注意 aliases 只保评分——弹窗里的历史评论列表仍挂在旧路径上，根治要靠
 * 数据库迁移（见 food-data.js 头部注释的 SOP）。 */

/** alias id → 当前 id */
const aliasToPrimary = new Map()
/** 当前 id → alias 列表 */
const primaryToAliases = new Map()

/**
 * 登记旧 id 映射，在拉取评分前调用一次。
 * @param {Record<string, string[]>} map 当前 id → 旧 id 列表
 */
export function registerAliases(map) {
	for (const [primary, aliases] of Object.entries(map || {})) {
		primaryToAliases.set(primary, aliases || [])
		for (const alias of aliases || []) aliasToPrimary.set(alias, primary)
	}
}

function isHttpEndpoint(value) {
	return typeof value === 'string' && /^https?:\/\//i.test(value)
}

/**
 * 拉取评论列表（按 urls 过滤）。
 *
 * 不能直接用 twikoo 的 getRecentComments()：2.0.13 的 SDK 只把
 * envId / funcName / pageSize / includeReply 打包进请求体，**urls 与 page 会被丢弃**
 * （dist 里 Od() 的实现），于是「只看 /food/<id>」这条过滤根本没下发到服务端，
 * 拿到的永远是全站最近 N 条——评论一多，早期店铺的评分就会静默归零，且无任何报错。
 * 服务端本身是支持 urls 的（对自建后端实测：带 urls 返回 0 条、不带返回全量），
 * 所以这里绕过 SDK 直接 POST 完整 payload；直传失败再退回 SDK（此时靠客户端过滤兜底）。
 */
async function fetchRecentComments(urls) {
	if (isHttpEndpoint(twikooEnvId)) {
		try {
			// 请求体与 SDK 的 jo() 保持完全一致：{ accessToken, ...payload, envId }。
			// SDK 用的是 XHR，这里用 fetch，跨域行为一致（两者默认都不带凭证）。
			let accessToken = ''
			try {
				accessToken = window.localStorage.getItem('twikoo-access-token') || ''
			}
			catch {}
			const response = await fetch(twikooEnvId, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					accessToken,
					event: 'GET_RECENT_COMMENTS',
					urls,
					pageSize: PAGE_SIZE,
					includeReply: false,
					envId: twikooEnvId,
				}),
			})
			if (!response.ok)
				throw new Error(`HTTP ${response.status}`)
			const payload = await response.json()
			if (Array.isArray(payload?.data))
				return payload.data
		}
		catch (error) {
			console.warn('[food-rating] 直连 Twikoo 失败，退回 SDK 全量拉取：', error)
		}
	}

	const twikoo = await getTwikoo()
	const list = await twikoo.getRecentComments({
		envId: twikooEnvId,
		pageSize: PAGE_SIZE,
		includeReply: false,
	})
	return Array.isArray(list) ? list : []
}

async function loadChunk(ids) {
	/* 每个当前 id 的请求范围 = 自身路径 + 全部旧别名路径，命中后都归到当前 id */
	const urlToId = new Map()
	for (const id of ids) {
		urlToId.set(foodUrl(id), id)
		for (const alias of primaryToAliases.get(id) || []) urlToId.set(foodUrl(alias), id)
	}
	const totals = new Map(ids.map(id => [id, { sum: 0, count: 0 }]))
	const seen = new Set()

	const list = await fetchRecentComments([...urlToId.keys()])
	for (const item of list) {
		if (!item || seen.has(item.id))
			continue
		seen.add(item.id)
		const rawId = idFromUrl(item.url)
		const id = rawId ? (aliasToPrimary.get(rawId) || rawId) : null
		if (!id || !totals.has(id))
			continue
		const rating = parseRating(item.commentText || item.comment)
		if (!rating)
			continue
		const total = totals.get(id)
		total.sum += rating
		total.count++
	}

	for (const [id, stats] of totals) applyStats(id, stats)
}

/**
 * 拉取指定美食的评分聚合。
 * 首次调用会标记 loaded；force 为 true 时始终重新请求（用于弹窗内刷新）。
 */
export async function loadRatings(ids, { force = false } = {}) {
	if (!twikooEnvId)
		return
	const pending = [...new Set(ids)].filter(id => id && (force || !ratingState[id]?.loaded))
	if (!pending.length)
		return

	for (const id of pending) {
		const state = ratingState[id] || (ratingState[id] = { sum: 0, count: 0, avg: 0, loaded: false, loading: false })
		state.loading = true
	}

	try {
		for (const group of chunk(pending, 40)) await loadChunk(group)
	}
	catch (error) {
		console.error('美食评分加载失败：', error)
		for (const id of pending) {
			const state = ratingState[id]
			// 只清 loading，不要置 loaded：一次网络抖动就把该 id 永久钉死在
			// 「暂无评分」（loadRatings 的跳过条件只看 loaded），再也拉不回来。
			if (state)
				state.loading = false
		}
	}
}

/* ============ Twikoo DOM 交互（Vue3 版） ============ */

/**
 * 定位主评论输入框。回复框也带 .tk-input / .tk-submit 类（在 .tk-comment 内），
 * 主评论框是 .tk-comments 的直接子级且在文档序上最靠前，两者都限定一下；
 * 找不到精确结构时退回首个匹配（主框在回复框之前，首匹配即主框）。
 */
/**
 * @param {Element | undefined} slot
 * @param {string} selector
 */
function findMainSubmit(slot, selector) {
	return slot?.querySelector(`.tk-comments > .tk-submit ${selector}`)
		|| slot?.querySelector(`.tk-submit ${selector}`)
		|| null
}

function findEditor(slot) {
	return findMainSubmit(slot, '.tk-input textarea, .tk-textarea__inner')
		|| slot?.querySelector('.tk-input textarea, .tk-textarea__inner')
		|| null
}

/**
 * 当前可见的错误文案集合。
 *
 * 提交前先快照一份：Twikoo 的错误卡片是列表/提交/回复共用的，评论区此前
 * 若已残留一条可见错误（例如列表加载失败），直接按「有 .tk-error 就判失败」
 * 会把**已经提交成功**的评分误报成失败，用户重试还会产生重复评论。
 */
function errorSnapshot(slot) {
	const set = new Set()
	for (const element of slot.querySelectorAll('.tk-error')) {
		const text = element.textContent.trim()
		if (text && element.offsetParent !== null)
			set.add(text)
	}
	return set
}

/**
 * 用原生 setter + input 事件改 textarea：保证 Vue3 的 v-model 同步更新，
 * 直接赋 value 不会触发响应式更新，发送按钮的 disabled 也就不会解除。
 */
function setEditorValue(editor, value) {
	const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
	if (setter)
		setter.call(editor, value)
	else editor.value = value
	editor.dispatchEvent(new Event('input', { bubbles: true }))
}

function metaMissing(slot) {
	const row = slot.querySelector('.tk-meta-input')
	// 整行未渲染 = 已记住身份；行被隐藏同样视为已有身份
	if (!row || row.offsetParent === null)
		return false
	const inputs = [...row.querySelectorAll('input')]
	const nick = inputs[0]?.value.trim() ?? ''
	const mail = inputs[1]?.value.trim() ?? ''
	return !nick || !mail
}

/**
 * 只提交评分，不携带文字评论。
 * 往 Twikoo 自己的输入框写 [rating:n] 后点它的发送按钮，
 * 因此昵称、邮箱、验证码和反垃圾配置继续生效。
 */
export async function submitRatingOnly(slot, getRating) {
	const editor = findEditor(slot)
	const sendButton = findMainSubmit(slot, '.tk-send')
	if (!editor || !sendButton)
		return { ok: false, reason: 'unavailable' }
	if (metaMissing(slot))
		return { ok: false, reason: 'meta' }

	const rating = Number(getRating())
	if (!(rating >= 1 && rating <= 5))
		return { ok: false, reason: 'rating' }
	if (String(editor.value).trim())
		return { ok: false, reason: 'comment' }
	if (sendButton.disabled)
		return { ok: false, reason: 'sending' }

	setEditorValue(editor, `[rating:${rating}]`)
	// 等 Vue 的 v-model 更新、发送按钮解除禁用
	for (let i = 0; i < 20 && sendButton.disabled; i++) await sleep(50)
	if (sendButton.disabled)
		return { ok: false, reason: 'unavailable' }

	const knownErrors = errorSnapshot(slot)
	sendButton.click()
	// 成功后输入框会被清空；失败会出现新的可见 .tk-error
	for (let i = 0; i < 40; i++) {
		await sleep(150)
		for (const element of slot.querySelectorAll('.tk-error')) {
			const text = element.textContent.trim()
			// 只认提交前没有的新错误，避免把评论区原有的旧错误当成提交失败
			if (text && element.offsetParent !== null && !knownErrors.has(text))
				return { ok: false, reason: 'submit', message: text }
		}
		if (!String(editor.value).trim())
			return { ok: true }
	}
	return { ok: false, reason: 'timeout' }
}

/**
 * 在用户自己的「发送」上打补丁：主评论发送前把星星拼进正文。
 * 用捕获阶段监听——祖先的捕获监听先于 Twikoo 按钮自身的 click 处理器执行，
 * input 事件同步驱动 v-model，Twikoo 的处理器读到的是已拼接的内容。
 * 每次点击时重新解析主提交框（而非缓存安装时的引用）：
 * Twikoo 重绘评论区后旧按钮会被替换成新节点，缓存引用会静默失效；
 * 回复框虽然也用 .tk-submit 类，但 findMainSubmit 已限定到主框。
 */
export function installRatingInjector(slot, getRating) {
	const handler = (event) => {
		const button = event.target?.closest?.('.tk-send')
		if (!button || button.disabled)
			return
		const mainSend = findMainSubmit(slot, '.tk-send')
		if (!button || button !== mainSend)
			return
		const editor = findEditor(slot)
		if (!editor)
			return
		const rating = Number(getRating()) || 0
		const raw = String(editor.value).trim()
		if (rating > 0 && raw && !RATING_RE.test(raw))
			setEditorValue(editor, `[rating:${rating}] ${editor.value}`)
	}
	slot.addEventListener('click', handler, true)
	return () => slot.removeEventListener('click', handler, true)
}

/**
 * 把渲染出来的 [rating:n] 文本替换成星级徽章，避免原始标记影响阅读。
 */
export function decorateRatings(element) {
	if (!element || typeof document === 'undefined')
		return
	const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
	const targets = []
	while (walker.nextNode()) {
		const node = walker.currentNode
		if (!node.nodeValue || !RATING_RE.test(node.nodeValue))
			continue
		if (node.parentElement?.classList.contains('nku-food-rating-badge'))
			continue
		targets.push(node)
	}

	for (const node of targets) {
		const match = node.nodeValue.match(RATING_RE)
		if (!match)
			continue
		const value = Number(match[1])
		const index = node.nodeValue.indexOf(match[0])
		const rest = node.nodeValue.slice(0, index) + node.nodeValue.slice(index + match[0].length)

		const badge = document.createElement('span')
		badge.className = 'nku-food-rating-badge'
		badge.title = `评分 ${value} / 5`
		badge.textContent = '★'.repeat(value) + '☆'.repeat(5 - value)

		const parent = node.parentNode
		if (!parent)
			continue
		if (rest.trim())
			parent.insertBefore(document.createTextNode(rest), node)
		parent.insertBefore(badge, node)
		parent.removeChild(node)
	}
}

/**
 * 清理弹窗内的 Twikoo 实例：见主题包 composables/twikoo.ts（与本文件顶部
 * 的转出导出同一实现），这里不再重复一份。
 */
