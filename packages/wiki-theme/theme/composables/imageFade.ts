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
	const root = document.documentElement

	root.classList.add(FADE_CLASS)

	function markLoaded(img: HTMLImageElement) {
		img.setAttribute(LOADED_ATTR, '')
	}

	document.querySelectorAll<HTMLImageElement>('.vp-doc img').forEach((img) => {
		// 已加载完（缓存命中）的直接标记，否则等 load / error
		if (img.complete) {
			markLoaded(img)
			return
		}
		img.addEventListener('load', () => markLoaded(img), { once: true })
		img.addEventListener('error', () => markLoaded(img), { once: true })
	})

	// 路由切换后新正文里的图片重新走一遍
	window.addEventListener('wiki:route-change', () => {
		requestAnimationFrame(() => {
			document.querySelectorAll<HTMLImageElement>('.vp-doc img').forEach((img) => {
				if (img.hasAttribute(LOADED_ATTR))
					return
				if (img.complete) {
					markLoaded(img)
					return
				}
				img.addEventListener('load', () => markLoaded(img), { once: true })
				img.addEventListener('error', () => markLoaded(img), { once: true })
			})
		})
	})
}
