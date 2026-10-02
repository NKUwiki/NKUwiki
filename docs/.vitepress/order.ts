/**
 * frontmatter 的 `order` 字段：控制文章与分类在侧边栏、专题页里的排列顺序。
 *
 * 数字越小越靠前。没有写 `order` 的条目统一按 `NO_ORDER`（最大值）参与排序，
 * 于是「写了 order 的按数字升序排在前面，没写的保持原有顺序（文件名 / 目录名）跟在后面」。
 * 全站都不写 order 时，排序结果与没做这个功能之前完全一致。
 *
 * 本模块只放纯函数：客户端组件（专题页）也要用，所以不能依赖 node 内置模块。
 */

/** 未声明 order 时的排序值。取最大值，保证排在全部显式声明之后。 */
export const NO_ORDER = Number.MAX_SAFE_INTEGER

/** 取条目的排序值：没写 order 时为 NO_ORDER。 */
export function orderOf(order: number | undefined): number {
	return order ?? NO_ORDER
}

/** 一组排序值里最小的那个，用于「目录顺序 = 目录内文章 order 的最小值」。 */
export function minOrder(orders: number[]): number {
	return orders.length ? Math.min(...orders) : NO_ORDER
}
