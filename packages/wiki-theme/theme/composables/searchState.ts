// 搜索弹窗的跨实例共享状态。
// WikiSearch 在导航栏与移动端菜单各挂一个实例，弹窗开关必须是模块级单例：
// 任意入口按钮打开的都是同一个弹窗（由导航栏实例渲染）。
import { withBase } from 'vitepress'
import { ref } from 'vue'

export const searchModalOpen = ref(false)
export const searchIndexLoading = ref(false)

// ================= 全局快捷键与跳转定位（模块层只注册一次） =================
// 必须放在模块层：WikiSearch 的两个实例都会挂载/卸载（移动端菜单是 v-if 挂载），
// 实例级注册会随开合无限累积，且双实例同时响应会让 Ctrl+K 的开合互相抵消。
// 这里的处理器只依赖本模块的 searchModalOpen 与 sessionStorage，不依赖组件状态。

function isEditable(target: EventTarget | null): boolean {
	return target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)
}

if (typeof window !== 'undefined') {
	window.addEventListener('keydown', (event) => {
		if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
			event.preventDefault()
			searchModalOpen.value = !searchModalOpen.value
			return
		}
		if (event.key === '/' && !searchModalOpen.value && !isEditable(event.target)) {
			event.preventDefault()
			searchModalOpen.value = true
			return
		}
		if (searchModalOpen.value && event.key === 'Escape')
			searchModalOpen.value = false
	})
	window.addEventListener('wiki:route-change', onRouteChange)
}

const normalize = (text: string) => text.replaceAll('#', '').replaceAll(/\s+/g, '')

function onRouteChange() {
	const raw = sessionStorage.getItem('wiki:search-jump')
	if (!raw)
		return
	sessionStorage.removeItem('wiki:search-jump')
	let jump: { url?: string, section?: string, terms?: string[], original?: string }
	try {
		jump = JSON.parse(raw)
	}
	catch {
		return
	}
	const strip = (path: string) => path.replace(/\.html$/, '').replace(/\/$/, '')
	if (jump.url && strip(window.location.pathname) !== strip(withBase(jump.url)))
		return
	scrollToMatch(jump.original ?? '', jump.terms ?? [], jump.section ?? '')
}

// 在渲染后的正文里找命中文本，包上临时 <mark> 原地闪烁。
// 优先在摘要所属章节的范围内找（对应搜索结果里展示的那一行），
// 找不到再退回全文，并跳过页首的文章元信息（面包屑/标签也常含查询词，会高亮错位置）。
function flashInRange(root: Element, startEl: Element | null, endEl: Element | null, words: string[]): boolean {
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
		acceptNode(node) {
			if (startEl && !(startEl.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING))
				return NodeFilter.FILTER_REJECT
			if (endEl && !(node.compareDocumentPosition(endEl) & Node.DOCUMENT_POSITION_FOLLOWING))
				return NodeFilter.FILTER_REJECT
			return NodeFilter.FILTER_ACCEPT
		},
	})
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		const text = (node.textContent ?? '').toLocaleLowerCase()
		if (!text.trim())
			continue
		const word = words.find(word => text.includes(word))
		if (!word)
			continue
		const range = document.createRange()
		const start = text.indexOf(word)
		range.setStart(node, start)
		range.setEnd(node, start + word.length)
		const mark = document.createElement('mark')
		mark.className = 'wiki-search-flash'
		try {
			range.surroundContents(mark)
		}
		catch {
			// 词元恰好跨行内元素边界时无法包裹，跳过这个文本节点
			continue
		}
		mark.scrollIntoView({ block: 'center' })
		// 路由切换后 VitePress 还会把页面滚回顶部、懒加载内容也会引起回流，
		// 与这里的定位存在竞态：等布局稳定后再校正一次居中。
		// 若用户已经自己滚动了（滚动位置离开了刚定位的位置），就不再打扰。
		const lastFlashScrollY = window.scrollY
		setTimeout(() => {
			if (Math.abs(window.scrollY - lastFlashScrollY) < 40)
				mark.scrollIntoView({ block: 'center' })
		}, 350)
		setTimeout(() => {
			const parent = mark.parentNode
			if (parent) {
				while (mark.firstChild) parent.insertBefore(mark.firstChild, mark)
				mark.remove()
				parent.normalize()
			}
		}, 2000)
		return true
	}
	return false
}

function flashTextMatch(original: string, terms: string[], section: string): boolean {
	// 完整查询串优先（如“向阳计划”整体），其次长词元，最后才放行单字词元
	const words = [original, ...terms.filter(term => term.length >= 2), ...terms].filter(Boolean)
	if (!words.length)
		return false
	// 页首的 ArticleMeta 容器也带 vp-doc class，用 main 下的主正文容器
	const root = document.querySelector('main .vp-doc:not(.article-meta)') ?? document.querySelector('.vp-doc')
	if (!root)
		return false
	// 1. 优先定位摘要所属章节：找到对应标题，在它与下一个标题之间找命中文本
	if (section) {
		const wanted = normalize(section)
		if (wanted) {
			const headings = [...document.querySelectorAll('.vp-doc h1, .vp-doc h2, .vp-doc h3')]
			let idx = headings.findIndex(el => normalize(el.textContent ?? '') === wanted)
			if (idx === -1)
				idx = headings.findIndex(el => normalize(el.textContent ?? '').includes(wanted))
			if (idx !== -1 && flashInRange(root, headings[idx], headings[idx + 1] ?? null, words))
				return true
		}
	}
	// 2. 全文兜底（root 已排除 .article-meta，标题 h1 仍参与：标题命中时高亮标题也算合理落点）
	return flashInRange(root, null, null, words)
}

function scrollToMatch(original: string, terms: string[], section: string) {
	// 新页面内容（尤其 dev 下按需编译的页面 chunk）在路由完成后仍需片刻才渲染，
	// 轮询等待正文出现，最多约 3 秒；优先定位正文里的命中文本，找不到再退回章节标题
	let attempts = 0
	const tryFind = () => {
		if (flashTextMatch(original, terms, section))
			return
		const wanted = normalize(section)
		if (wanted) {
			const headings = document.querySelectorAll('.vp-doc h1, .vp-doc h2, .vp-doc h3')
			const normalized = [...headings].map(el => ({ el, text: normalize(el.textContent ?? '') }))
			const target = normalized.find(item => item.text === wanted) ?? normalized.find(item => item.text.includes(wanted))
			if (target) {
				target.el.scrollIntoView({ block: 'center' })
				target.el.classList.add('wiki-search-flash')
				setTimeout(() => target.el.classList.remove('wiki-search-flash'), 2000)
				return
			}
		}
		if (++attempts < 25)
			setTimeout(tryFind, 120)
	}
	setTimeout(tryFind, 100)
}
