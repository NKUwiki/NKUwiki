/**
 * 缩放分级规则的测试。
 *
 * 为什么值得写测试而不是肉眼验：分级只在地图上表现为「某个点忽然不见了」，
 * 改一个分类映射、或数据里给某个点加了 tier，很容易把某一档挤空/挤爆，
 * 而这种退化在截图里几乎看不出来。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { BUILDINGS, CAMPUS_CONFIG, POLYGONS } from '../docs/.vitepress/data/map-data.js'
import { campusAnchor, LOD_MAX_TIER, normalizeZoom, tierForZoom, tierOf } from '../packages/wiki-map/lod.js'

/* 数据文件与 lod.js 都是不带类型的普通 JS，推导出来的对象是「两个具体键」
   而不是索引签名。这里各断言一次，比在每个调用点写 as 干净：
   - CAMPUSES / BOUNDARIES：让「按校区 id 取」通过类型检查
   - anchorOf：lod.js 对空值的容忍（`Array.isArray` 兜底）推导不出来，
     但那条分支正是本文件要守的行为之一 */
const CAMPUSES = CAMPUS_CONFIG as Record<string, { coord: number[] }>
const BOUNDARIES = POLYGONS as Record<string, number[][][]>
const anchorOf = campusAnchor as (
	rings: number[][][] | null,
	fallback: number[] | null,
) => number[] | null

test('点位档位落在 1~3 之间', () => {
	for (const b of BUILDINGS) {
		const tier = tierOf(b)
		assert.ok(tier >= 1 && tier <= LOD_MAX_TIER, `${b.name} 的档位是 ${tier}`)
	}
})

test('各校区默认缩放都落在 2 档', () => {
	for (const [id, cfg] of Object.entries(CAMPUS_CONFIG)) {
		assert.equal(tierForZoom(cfg.zoom, cfg.zoom), 2, `${id} 校区的默认 zoom 不在 2 档`)
	}
})

test('档位随缩放单调不减', () => {
	/* 从 10 到 20 逐级扫一遍：只要出现「放大反而降档」就是阈值写错了 */
	for (const cfg of Object.values(CAMPUS_CONFIG)) {
		let prev = 0
		for (let zoom = 10; zoom <= 20; zoom++) {
			const tier = tierForZoom(zoom, cfg.zoom)
			assert.ok(tier >= prev, `zoom ${zoom} 掉档：${prev} → ${tier}`)
			prev = tier
		}
		assert.equal(prev, LOD_MAX_TIER)
	}
})

test('中间档确实能省掉一批点位', () => {
	for (const [id] of Object.entries(CAMPUS_CONFIG)) {
		const own = BUILDINGS.filter(b => b.campusId === id)
		const visible = own.filter(b => tierOf(b) <= 2).length
		assert.ok(own.length > 0, `${id} 校区没有点位`)
		assert.ok(visible < own.length, `${id} 校区在 2 档就显示了全部点位，分级没有收敛作用`)
	}
})

test('1 档的地标不能太少', () => {
	/* 1 档在地图上已经收成一个「校区标点」、不再逐个画，但这档的点位也是
	   2 档的一部分（档位累加），太少会让 2 档看校区中心时发空 */
	for (const id of Object.keys(CAMPUS_CONFIG)) {
		const own = BUILDINGS.filter(b => b.campusId === id && tierOf(b) === 1)
		assert.ok(own.length >= 3, `${id} 校区 1 档只有 ${own.length} 个点，2 档的中心区域会空`)
	}
})

test('数据里的 tier 字段优先于分类兜底', () => {
	assert.equal(tierOf({ category: 'landmark', tier: 3 }), 3)
	assert.equal(tierOf({ category: 'unknown-category' }), LOD_MAX_TIER)
	assert.equal(tierOf({ category: 'library' }), 1)
})

test('campusId 都能在 CAMPUS_CONFIG 里找到', () => {
	for (const b of BUILDINGS) {
		assert.ok(CAMPUSES[b.campusId], `${b.name} 的 campusId（${b.campusId}）没有对应校区配置`)
	}
})

/* 环绕角法判断点是否在环内。刻意不复用 lod.js 里的射线法：两套独立实现，
   一处的疏漏不会让另一处跟着一起错 */
function insideByAngle(point: number[], ring: number[][]) {
	const [px, py] = point
	let sum = 0
	for (let i = 0; i < ring.length; i++) {
		const a = ring[i]
		const b = ring[(i + 1) % ring.length]
		let d = Math.atan2(b[1] - py, b[0] - px) - Math.atan2(a[1] - py, a[0] - px)
		while (d > Math.PI) d -= 2 * Math.PI
		while (d < -Math.PI) d += 2 * Math.PI
		sum += d
	}
	return Math.abs(Math.abs(sum) - 2 * Math.PI) < 1e-6
}

test('1 档的校区标点落在自己的边界内', () => {
	for (const [id, cfg] of Object.entries(CAMPUS_CONFIG)) {
		const rings = BOUNDARIES[id]
		assert.ok(rings?.length, `${id} 校区没有边界数据，1 档会退回一个没有边界的点`)
		const anchor = campusAnchor(rings, cfg.coord)
		assert.ok(anchor, `${id} 算不出校区标点位置`)
		assert.ok(
			rings.some(ring => insideByAngle(anchor, ring)),
			`${id} 的校区标点落在边界之外：${anchor}`,
		)
		/* 边界重心与配置中心本来就有几百米差（八里台东西狭长，重心偏西），
		   但差到 800m 以上就说明书里的 GEO 或边界数据出了问题 */
		const dLng = (anchor[0] - cfg.coord[0]) * 111320 * Math.cos((cfg.coord[1] * Math.PI) / 180)
		const dLat = (anchor[1] - cfg.coord[1]) * 110540
		const dist = Math.hypot(dLng, dLat)
		assert.ok(dist < 800, `${id} 的校区标点离配置中心 ${dist.toFixed(0)}m，偏得太远`)
	}
})

test('边界缺失或退化时退回校区配置的中心', () => {
	assert.deepEqual(anchorOf([], [117, 39]), [117, 39])
	assert.deepEqual(anchorOf(null, [117, 39]), [117, 39])
	/* 少于 3 个点的残环画不成面，等同于没有边界 */
	assert.deepEqual(anchorOf([[[117, 39]]], [117, 39]), [117, 39])
	assert.equal(anchorOf(null, null), null)
})

test('重心落在凹环之外时退回兜底点', () => {
	/* U 形：重心正好落在中间那道空槽里，也就是多边形外面。这种时候宁可
	   把标点放回校区中心，也不能让它钉在校园外 */
	const u = [[0, 0], [1, 0], [1, 1], [0.75, 1], [0.75, 0.25], [0.25, 0.25], [0.25, 1], [0, 1]]
	assert.deepEqual(campusAnchor([u], [0.5, 0.9]), [0.5, 0.9])
	/* 凸边形的重心就是几何重心，不该被兜底覆盖 */
	assert.deepEqual(campusAnchor([[[0, 0], [1, 0], [1, 1], [0, 1]]], [9, 9]), [0.5, 0.5])
})

test('zoom 归一到 0.1，吃掉浮点尾巴', () => {
	/* 高德缩放动画里给出的原值，直接显示就是一行没用的数字 */
	assert.equal(normalizeZoom(16.999999999999996), 17)
	assert.equal(normalizeZoom(15.000000000000002), 15)
	assert.equal(normalizeZoom(16.34), 16.3)
	assert.equal(normalizeZoom(16.36), 16.4)
	assert.equal(normalizeZoom(17), 17)
	/* 非法输入交给调用方兜底，不能返回 NaN 让页面显示 "NaN" */
	assert.equal(normalizeZoom(undefined), null)
	assert.equal(normalizeZoom(null), null)
	assert.equal(normalizeZoom(Number.NaN), null)
})

test('档位边界不被浮点尾巴劈开', () => {
	/* 八里台 base 17：15 及以下 1 档。15.000000000000002 必须还是 1 档，
	   否则缩到边界时标点会莫名多出一撮 */
	assert.equal(tierForZoom(15.000000000000002, 17), 1)
	assert.equal(tierForZoom(17.000000000000004, 17), 2)
	assert.equal(tierForZoom(17.06, 17), 3)
	/* 归一之后再判：16.96 → 17.0，仍属 2 档 */
	assert.equal(tierForZoom(16.96, 17), 2)
	assert.equal(tierForZoom(undefined, 17), 2)
})
