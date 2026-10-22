/**
 * 正文图片加载淡入。
 *
 * 与 image-size 插件（构建期注入 width/height）配合：尺寸已预留，图片加载完成前
 * 不会抖动布局，此时把淡入的时机放在 load 事件上，观感是「图从模糊处清晰浮现」。
 *
 * 三层降级：
 * 1. 隐藏只在 <html class="wiki-image-fade"> 下生效，而该 class 由本模块添加——
 *    SSR 输出与禁用 JS 环境下图片直接显示；
 * 2. 无 JS 时类不加；有 JS 但图片加载失败时，error 事件同样会摘掉隐藏状态，
 *    不会留下永远不显示的破图；
 * 3. reduced-motion 下 --wiki-duration-slow 为 0s，淡入即时完成。
 */
const FADE_CLASS = 'wiki-image-fade'
const LOADED_ATTR = 'data-loaded'

export function installImageFade() {
	if (typeof document === 'undefined')
		return

	document.documentElement.classList.add(FADE_CLASS)

	// 已挂过监听的图片。wiki:route-change 不只在跨页导航时派发——
	// 分类页切换筛选也会（ArticleIndex 主动 dispatch），
	// 少了这道防护，同一张尚未加载完的图会被反复挂上 load/error 监听。
	const watching = new WeakSet<HTMLImageElement>()

	function markLoaded(img: HTMLImageElement) {
		img.setAttribute(LOADED_ATTR, '')
	}

	function watch(img: HTMLImageElement) {
		if (watching.has(img) || img.hasAttribute(LOADED_ATTR))
			return
		// Twikoo 的头像/表情是评论渲染后才插入的 img，不参与正文淡入——
		// 否则它们赶不上扫描时机，会被隐藏态 CSS 永久藏住（评论区头像不显示的根因）
		if (img.closest('.twikoo'))
			return
		// 已加载完（缓存命中）的直接标记，否则等 load / error
		if (img.complete) {
			markLoaded(img)
			return
		}
		watching.add(img)
		img.addEventListener('load', () => markLoaded(img), { once: true })
		// 加载失败也要结束隐藏态，否则破图会一直不可见
		img.addEventListener('error', () => markLoaded(img), { once: true })
	}

	function scan() {
		document.querySelectorAll<HTMLImageElement>('.vp-doc img').forEach(watch)
	}

	/** 把一批新增节点里的图片交给 watch（只认 .vp-doc 里的） */
	function watchAdded(node: Node) {
		if (node.nodeType !== 1)
			return
		const el = node as Element
		// 新增的可能是页面容器本身（首屏 / 路由切换），此时 closest 会命中它自己
		if (!el.closest('.vp-doc'))
			return
		if (el.tagName === 'IMG') {
			watch(el as HTMLImageElement)
			return
		}
		el.querySelectorAll<HTMLImageElement>('img').forEach(watch)
	}

	scan()
	window.addEventListener('wiki:route-change', () => requestAnimationFrame(scan))

	/**
	 * 运行期插入的图片也必须接上：Vue 组件渲染的卡片封面、Twikoo 评论里的头像，
	 * 都是首屏扫描之后才进 DOM 的。补不上 data-loaded 就会被隐藏态 CSS 永久藏住
	 * ——「美食卡片的封面默认不显示、只有点开详情才看得到」就是这么来的
	 * （详情弹窗 Teleport 到 body，不在 .vp-doc 里，所以躲过了那条规则）。
	 *
	 * 只观察 childList：本模块自己写的 data-loaded 是属性变更，不会反过来触发；
	 * 仍按 rAF 合并，Vue 一次 patch 插入几十个节点也只处理一遍。
	 */
	if (typeof MutationObserver !== 'undefined') {
		const pending = new Set<Node>()
		let queued = false
		const observer = new MutationObserver((records) => {
			for (const record of records) {
				for (const node of record.addedNodes)
					pending.add(node)
			}
			if (queued || !pending.size)
				return
			queued = true
			requestAnimationFrame(() => {
				queued = false
				for (const node of pending)
					watchAdded(node)
				pending.clear()
			})
		})
		// 页面内容在 #app 里，观察 body + subtree 就够覆盖所有插入点
		observer.observe(document.body, { childList: true, subtree: true })
	}
}
