/**
 * 缩放分级的规则（纯函数，不依赖 Vue、不依赖高德）。
 *
 * 单独成模块是为了能被 Node 直接验算：`node scripts/check-lod.mjs`
 * 会拿真实点位数据跑一遍，报出每个校区、每个档位各有多少个标点。
 * 规则写在组件里的话，这类核对只能靠肉眼看地图，改一个分类有没有
 * 把点位挤到别的档，根本发现不了。
 *
 * 除了「哪个点在哪一档」，这里也管档位 1 那唯一一个标点落在哪儿
 * （campusAnchor）：它同样只表现为图上一个标点的位置偏没偏，
 * 肉眼在缩小的地图上根本判断不出几十米的偏差。
 */

/** 分类 → 档位的兜底映射。数据里给了 tier 字段就以字段为准 */
export const LOD_FALLBACK_TIER = {
	// 1 档：远景也要能认出来的地标
	landmark: 1,
	gate: 1,
	library: 1,
	// 2 档：日常高频的目的地
	teaching: 2,
	canteen: 2,
	admin: 2,
	transit: 2,
	// 其余（学院楼、宿舍、运动场、商铺…）落到 3 档
}

export const LOD_MAX_TIER = 3

/** 点位的档位：优先读数据里的 tier 字段，没有就按分类兜底 */
export function tierOf(building) {
	const explicit = Number(building && building.tier)
	if (explicit >= 1 && explicit <= LOD_MAX_TIER)
		return explicit
	return LOD_FALLBACK_TIER[building && building.category] || LOD_MAX_TIER
}

/**
 * 把高德给出的 zoom 归一到 0.1。
 *
 * 高德在缩放动画里常给出 16.999999999999996 这类值：直接显示出来是一行
 * 没意义的数字，拿去判档位更糟 —— 判 1 档的边界是 `zoom <= base-2`，
 * 15.000000000000002 会被判成 2 档，缩到边界时标点会莫名多出一撮。
 *
 * @returns {number|null} 非法输入返回 null，调用方自行兜底
 */
export function normalizeZoom(zoom) {
	/* 显式挡掉 null：Number(null) 是 0，会被当成「缩到 0 级」判进 1 档 */
	if (zoom == null)
		return null
	const v = Number(zoom)
	if (!Number.isFinite(v))
		return null
	return Math.round(v * 10) / 10
}

/**
 * 当前缩放落在哪一档。
 *
 * 阈值相对各校区自己的默认 zoom 定义（base - 2 / base / base 以上），
 * 不写绝对值：津南比八里台大一圈、默认停在 16，用绝对阈值会让它
 * 一进页面就掉到 1 档。
 *
 * 边界先归一：15.000000000000002 与 15 是同一档，不能被浮点尾巴劈开。
 */
export function tierForZoom(zoom, baseZoom) {
	const base = Number(baseZoom) || 16
	const z = normalizeZoom(zoom)
	if (z == null)
		return 2
	if (z <= base - 2)
		return 1
	if (z <= base)
		return 2
	return LOD_MAX_TIER
}

/** 点是否落在环内（射线法）。环不必闭合，首尾由取模补上 */
function pointInRing(point, ring) {
	const [x, y] = point
	let inside = false
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		const [xi, yi] = ring[i]
		const [xj, yj] = ring[j]
		if ((yi > y) !== (yj > y)
			&& x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
			inside = !inside
		}
	}
	return inside
}

/**
 * 档位 1 那唯一一个标点该落在哪儿（「代表整个框住的区域」）。
 *
 * 取边界多边形的**面积加权重心**，而不是 CAMPUS_CONFIG.coord —— 后者是
 * 打开地图时的视野中心，八里台东西狭长，那个点明显偏东；标点放那儿会
 * 贴着校园东缘，看起来不像在代表整块区域。
 *
 * 细节：
 * - 多个环（飞地）按面积加权。权重取 |A|：凹环算出来的有向面积可能是负的。
 * - 环首尾不必重复，取模自己闭合。边界数据本来就省掉了重复的收尾点。
 * - 重心落在所有环之外时退回 fallback（凹形校区可能出现），宁可偏一点，
 *   也不能把「八里台校区」四个字钉在校园外面。
 *
 * @param {number[][][]} rings 边界环，每个环是 [[lng, lat], ...]
 * @param {number[]} fallback 算不出来时的兜底坐标（校区配置的中心）
 * @returns {number[]|null} [lng, lat]
 */
export function campusAnchor(rings, fallback) {
	const list = (Array.isArray(rings) ? rings : [])
		.filter(ring => Array.isArray(ring) && ring.length >= 3)
	let sumArea = 0
	let sumX = 0
	let sumY = 0
	for (const ring of list) {
		let twiceArea = 0
		let cx = 0
		let cy = 0
		for (let i = 0; i < ring.length; i++) {
			const a = ring[i]
			const b = ring[(i + 1) % ring.length]
			const cross = a[0] * b[1] - b[0] * a[1]
			twiceArea += cross
			cx += (a[0] + b[0]) * cross
			cy += (a[1] + b[1]) * cross
		}
		if (!twiceArea)
			continue
		/* 单环重心 = Σ(x_i + x_i+1)·cross / (3·2A)，权重是这一环的面积 */
		const area = Math.abs(twiceArea) / 2
		sumArea += area
		sumX += (cx / (3 * twiceArea)) * area
		sumY += (cy / (3 * twiceArea)) * area
	}
	const point = sumArea
		? [sumX / sumArea, sumY / sumArea]
		: null
	if (point && Number.isFinite(point[0]) && Number.isFinite(point[1])
		&& list.some(ring => pointInRing(point, ring))) {
		return point
	}
	return fallback || null
}
