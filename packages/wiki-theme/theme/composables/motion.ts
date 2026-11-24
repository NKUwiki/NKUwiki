/**
 * 动效降级判据。
 *
 * 原先 `prefers-reduced-motion` 的判断散在四处（标题滚动、深浅色转场、
 * 返回顶部、文章元信息计数），各写一遍 matchMedia。除了重复，判据都只看了
 * 系统偏好这一项——而真正需要跳过动画的场合不止这一种：
 *
 * - 系统开了「减少动态效果」（无障碍，必须尊重）
 * - 浏览器开了省流模式（saveData）：用户明确表达了「少花点资源」
 * - 老旧的触屏设备：四核以下 + 指针粗，这类机器上整页交叉淡入、
 *   跟随滚动的缓动都会掉帧，观感比直接切换还差
 *
 * 判据只影响「动画怎么播」，不影响任何内容是否显示，因此放宽是安全的：
 * 即使 hardwareConcurrency 被浏览器限制成 2（反指纹策略）导致误判，
 * 代价也只是这台设备上看不到过渡动画。
 *
 * 不做结果缓存：省流模式可以在会话中开关，MediaQueryList 的 `.matches`
 * 本身是实时的，这里只把它缓存成对象，避免每次调用都新建查询。
 */

let reduceQuery: MediaQueryList | null | undefined

function queryReduce(): MediaQueryList | null {
	if (typeof window === 'undefined' || typeof window.matchMedia !== 'function')
		return null
	reduceQuery ??= window.matchMedia('(prefers-reduced-motion: reduce)')
	return reduceQuery
}

/**
 * 是否应当跳过高开销动画。
 *
 * 纯读取，无副作用，可在点击回调、rAF 循环之外任意位置调用。
 */
export function shouldReduceMotion(): boolean {
	if (queryReduce()?.matches)
		return true

	if (typeof navigator === 'undefined')
		return false

	// 省流模式：标准 API 且各浏览器实现一致（iOS Safari 不支持则读不到）
	const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
	if (connection?.saveData === true)
		return true

	// 低端触屏：核数读不到（0/undefined）时不做判断，宁可放动画也不要误伤桌面端
	const cores = navigator.hardwareConcurrency
	if (typeof cores !== 'number' || cores <= 0 || cores > 4)
		return false

	return typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches === true
}
