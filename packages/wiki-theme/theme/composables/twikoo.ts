/**
 * Twikoo 评论区实例的销毁。
 *
 * twikoo 2.x 没有公开的销毁 API（也不再有 $destroy）。只做 innerHTML = ''
 * 是不够的：它的 v-clickoutside 指令会在 document 上注册**捕获阶段**的 click
 * 监听，且只在指令 unmounted 时才摘掉；截掉 DOM 不会触发 unmounted，于是 Vue
 * app 与这个全局监听都还活着——文章页之间跳转（评论区组件带 :key 会整体重建）、
 * 每开关一次美食弹窗，都会多积一份孤儿实例与一个全局监听。
 *
 * 这里手动把 Twikoo 挂在各节点上的 __tkClickoutside 摘掉，再清空容器。
 *
 * 站点侧（美食评分）与主题侧（文章评论区）共用这一份实现，避免两边各写一半、
 * 行为漂移。
 */

/**
 * 销毁挂在 element 上的 Twikoo 实例：摘掉其注册在 document 捕获阶段的
 * click 监听，并清空容器 DOM。
 */
export function destroyTwikoo(element?: HTMLElement | null): void {
	if (!element)
		return
	for (const node of [element, ...element.querySelectorAll('*')]) {
		const handler = (node as unknown as { __tkClickoutside?: unknown }).__tkClickoutside
		if (typeof handler === 'function') {
			document.removeEventListener('click', handler as EventListener, true)
			delete (node as unknown as { __tkClickoutside?: unknown }).__tkClickoutside
		}
	}
	element.innerHTML = ''
}
