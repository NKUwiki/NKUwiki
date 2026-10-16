/**
 * 地图悬停提示（hover tip）的定位计算。
 *
 * 单独成模块是为了能测：夹取的边界顺序、卡片整体在视口外时 rect 为负、可视区比提示还窄
 * 这几种情形写错了都不会报错，只会在某些点位上「提示压住左侧卡片」或「跑到屏幕外」。
 */

/** 提示的最大宽度，与 MapView 里 .map-hover-tip 的 max-width 保持一致 */
export const HOVER_TIP_MAX_WIDTH = 300
/** 提示与悬浮卡片、地图边缘之间留的间隙 */
export const HOVER_TIP_MARGIN = 12

/**
 * 把提示的中心 x 夹到「悬浮卡片右侧 + 间隙」与「地图右边缘 − 间隙」之间。
 *
 * - 卡片整体落在视口外时 rect.right 为负，max(0, …) 自然退回 0，只保留与视口边缘的间隙；
 * - 可视区比提示还窄时（极端窄屏 + 卡片很宽）优先保证不压卡片，返回左边界。
 */
export function clampTipCenterX({
	x,
	viewWidth,
	cardRight,
	tipWidth = HOVER_TIP_MAX_WIDTH,
	margin = HOVER_TIP_MARGIN,
}) {
	const half = tipWidth / 2
	const minX = Math.max(0, cardRight) + margin + half
	const maxX = viewWidth - margin - half
	return Math.round(Math.min(Math.max(x, minX), Math.max(minX, maxX)))
}
