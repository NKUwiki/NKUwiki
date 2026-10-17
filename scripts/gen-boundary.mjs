/**
 * 生成校区边界数据：OSM（WGS84）→ GCJ02 → src/data/campus-boundary.js
 *
 * 用法：
 *   node scripts/gen-boundary.mjs           # 重新拉取并生成
 *   node scripts/gen-boundary.mjs --dry     # 只打印统计，不写文件
 *
 * 为什么要转坐标：OSM 是 WGS84，高德底图是 GCJ02，直接拿来画会整体偏
 * 300~600 米（正好错开一个街区）。转换公式与 MapView.vue 内的
 * wgs84ToGcj02 完全一致（同一套常数与多项式），不要另找实现。
 *
 * 数据来源：OpenStreetMap，ODbL 1.0。站点上需要署名
 * 「© OpenStreetMap contributors」。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(HERE, '../docs/.vitepress/data/campus-boundary.js')

/* OSM way id → 本项目的校区 key。
 * 48165388  南开大学八里台校区（闭合 way，约 1.74 km²）
 * 476603067 南开大学津南校区（闭合 way，约 3.58 km²）
 * 换校区 / 边界被 OSM 编辑过时，用 overpass-turbo 重新查 [amenity=university]["name"~"南开"] 拿新 id。 */
const WAYS = [
	{ campusId: 'n', wayId: 48165388, name: '八里台校区' },
	{ campusId: 'j', wayId: 476603067, name: '津南校区' },
]

/** 简化容差（米）：0.9 m 对 20 缩放级别仍看不出差别，点数可压掉一半 */
const TOLERANCE_M = 0.9

/* 主站经常 502/504（并发限流），备两个镜像轮询；全部失败才报错 */
const ENDPOINTS = [
	'https://overpass-api.de/api/interpreter',
	'https://overpass.kumi.systems/api/interpreter',
	'https://overpass.private.coffee/api/interpreter',
]
/* Overpass 要求 UA 能标识调用方与用途，否则可能直接被拒 */
const UA = 'NKUwiki-map/1.0 (campus boundary extraction; https://freshnkuer.wiki)'

/* ================= 坐标转换（与 MapView.vue 同源） ================= */
const AXIS = 6378245
const ECCENTRICITY = 0.006693421622965943

function transformLat(lng, lat) {
	let v = -100 + 2 * lng + 3 * lat + 0.2 * lat * lat + 0.1 * lng * lat + 0.2 * Math.sqrt(Math.abs(lng))
	v += ((20 * Math.sin(6 * lng * Math.PI) + 20 * Math.sin(2 * lng * Math.PI)) * 2) / 3
	v += ((20 * Math.sin(lat * Math.PI) + 40 * Math.sin((lat / 3) * Math.PI)) * 2) / 3
	v += ((160 * Math.sin((lat / 12) * Math.PI) + 320 * Math.sin((lat * Math.PI) / 30)) * 2) / 3
	return v
}

function transformLng(lng, lat) {
	let v = 300 + lng + 2 * lat + 0.1 * lng * lng + 0.1 * lng * lat + 0.1 * Math.sqrt(Math.abs(lng))
	v += ((20 * Math.sin(6 * lng * Math.PI) + 20 * Math.sin(2 * lng * Math.PI)) * 2) / 3
	v += ((20 * Math.sin(lng * Math.PI) + 40 * Math.sin((lng / 3) * Math.PI)) * 2) / 3
	v += ((150 * Math.sin((lng / 12) * Math.PI) + 300 * Math.sin((lng / 30) * Math.PI)) * 2) / 3
	return v
}

function wgs84ToGcj02([lng, lat]) {
	const dLat = transformLat(lng - 105, lat - 35)
	const dLng = transformLng(lng - 105, lat - 35)
	const rad = (lat / 180) * Math.PI
	const magic = 1 - ECCENTRICITY * Math.sin(rad) ** 2
	const sqrtMagic = Math.sqrt(magic)
	const aLat = (dLat * 180) / (((AXIS * (1 - ECCENTRICITY)) / (magic * sqrtMagic)) * Math.PI)
	const aLng = (dLng * 180) / ((AXIS / sqrtMagic) * Math.cos(rad) * Math.PI)
	return [lng + aLng, lat + aLat]
}

/* ================= 几何工具 ================= */

/** 简化前先按米制容差做 Douglas–Peucker：直接按经纬度算距离会因纬度压缩失真 */
function simplify(ring, toleranceM) {
	if (ring.length < 4)
		return ring
	/* 1 度纬度 ≈ 110574 m；1 度经度按当前纬度收缩。把点投到本地米制平面再算垂距 */
	const lat0 = ring.reduce((s, p) => s + p[1], 0) / ring.length
	const kx = 111320 * Math.cos((lat0 * Math.PI) / 180)
	const ky = 110574
	const pts = ring.map(([lng, lat]) => [lng * kx, lat * ky])

	const keep = ring.map(() => false)
	keep[0] = true
	keep[ring.length - 1] = true
	const stack = [[0, ring.length - 1]]
	while (stack.length) {
		const [start, end] = stack.pop()
		let maxD = -1
		let idx = -1
		const [x1, y1] = pts[start]
		const [x2, y2] = pts[end]
		const dx = x2 - x1
		const dy = y2 - y1
		const len = Math.hypot(dx, dy) || 1e-12
		for (let i = start + 1; i < end; i++) {
			const [x, y] = pts[i]
			const d = Math.abs(dy * (x - x1) - dx * (y - y1)) / len
			if (d > maxD) {
				maxD = d
				idx = i
			}
		}
		if (maxD > toleranceM && idx > 0) {
			keep[idx] = true
			stack.push([start, idx], [idx, end])
		}
	}
	return ring.filter((_, i) => keep[i])
}

/** 球面多边形面积（m²），用于核对边界规模是否与真实校区相符 */
function polygonArea(ring) {
	const R = 6378137
	let sum = 0
	for (let i = 0; i < ring.length; i++) {
		const [lng1, lat1] = ring[i]
		const [lng2, lat2] = ring[(i + 1) % ring.length]
		sum += ((lng2 - lng1) * Math.PI / 180) * (2 + Math.sin((lat1 * Math.PI) / 180) + Math.sin((lat2 * Math.PI) / 180))
	}
	return Math.abs((sum * R * R) / 2)
}

/* ================= 拉取 ================= */
async function fetchWays() {
	const ids = WAYS.map(w => `way(${w.wayId});`).join('\n  ')
	const query = `[out:json][timeout:90];
(
  ${ids}
);
out geom;`

	const errors = []
	for (let round = 0; round < 2; round++) {
		for (const endpoint of ENDPOINTS) {
			try {
				const res = await fetch(endpoint, {
					method: 'POST',
					headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
					body: new URLSearchParams({ data: query }),
					signal: AbortSignal.timeout(120000),
				})
				if (!res.ok) {
					errors.push(`${endpoint} → ${res.status}`)
					continue
				}
				const json = await res.json()
				const byId = new Map(json.elements.filter(e => e.type === 'way').map(e => [e.id, e]))
				console.log(`拉取自 ${endpoint}`)
				return byId
			}
			catch (e) {
				errors.push(`${endpoint} → ${e.message}`)
			}
		}
		/* 全部端点失败才退避：Overpass 的限流窗口一般几十秒 */
		if (round === 0) {
			console.warn('本轮全部失败，30 秒后重试…')
			await new Promise(r => setTimeout(r, 30000))
		}
	}
	throw new Error(`拿不到边界数据：\n  ${errors.join('\n  ')}`)
}

/* ================= 主流程 ================= */
const dry = process.argv.includes('--dry')
/* --from <file>：复用之前跑过的 Overpass 原始响应（.json），离线重跑生成逻辑 */
const fromIdx = process.argv.indexOf('--from')
const ways = fromIdx > -1
	? new Map(
			JSON.parse(readFileSync(process.argv[fromIdx + 1], 'utf8'))
				.elements
				.filter(e => e.type === 'way')
				.map(e => [e.id, e]),
		)
	: await fetchWays()

const result = {}
const report = []

for (const { campusId, wayId, name } of WAYS) {
	const way = ways.get(wayId)
	if (!way)
		throw new Error(`OSM 里找不到 way ${wayId}（${name}），边界可能被编辑过`)

	const raw = way.geometry.map(p => [p.lon, p.lat])
	const closed = raw[0][0] === raw[raw.length - 1][0] && raw[0][1] === raw[raw.length - 1][1]
	if (!closed)
		console.warn(`  ! way ${wayId} 不是闭合环，AMap.Polygon 仍会自动闭合首尾，但形状可能不对`)

	/* 去掉重复的首尾点：AMap.Polygon 自己会闭合，多一个重复点只是白占体积 */
	const ring = closed ? raw.slice(0, -1) : raw
	const simplified = simplify(ring, TOLERANCE_M).map(wgs84ToGcj02)
	/* 坐标保留 6 位小数（约 0.11 m），再多就是对渲染无意义的小数噪声 */
	const rounded = simplified.map(([lng, lat]) => [Number(lng.toFixed(6)), Number(lat.toFixed(6))])

	result[campusId] = rounded
	report.push({
		campusId,
		name,
		osmName: way.tags?.name || '(无名)',
		points: `${ring.length} → ${rounded.length}`,
		area: `${(polygonArea(rounded) / 1e6).toFixed(2)} km²`,
	})
}

console.log('校区边界生成结果：')
for (const r of report)
	console.log(`  ${r.campusId}  ${r.name}（OSM: ${r.osmName}）  点数 ${r.points}  面积 ${r.area}`)

if (dry) {
	console.log('\n--dry：不写文件')
	process.exit(0)
}

/* 输出格式：{ 校区 key: [环, 环...] }，与 MapView 里 POLYGONS 的
   「paths.map(path => new AMap.Polygon({ path }))」逐层对应。
   一个校区通常只有一个环；不相连的飞地就多写一个环。 */
function formatRings(rings) {
	const body = rings
		.map(ring => `\t\t[\n${ring.map(p => `\t\t\t[${p[0]}, ${p[1]}],`).join('\n')}\n\t\t],`)
		.join('\n')
	return `[\n${body}\n\t]`
}

const body = Object.entries(result)
	.map(([k, v]) => `\t${k}: ${formatRings([v])},`)
	.join('\n')

const file = `/**
 * 校区边界（GCJ02，可直接喂给 AMap.Polygon）。
 *
 * 由 scripts/gen-boundary.mjs 生成，不要手改：边界若需调整，
 * 去 OSM 改图形后重跑脚本，或按下方格式填手绘点。
 *
 * 数据结构：{ 校区 key: [环, 环...] }，每个环是 [[经度, 纬度], ...]。
 * 一个校区通常只有一个环；不相连的飞地就多写一个环。首尾不必重复，
 * AMap.Polygon 会自己闭合。
 *
 * 来源：OpenStreetMap（ODbL 1.0）— © OpenStreetMap contributors
 * 生成时间：${new Date().toISOString().slice(0, 10)}
 */

export const CAMPUS_BOUNDARIES = {
${body}
}

/* 说明：坐标已做 WGS84 → GCJ02 转换（与 MapView.vue 的 wgs84ToGcj02 同一套公式）。
   千万不要在这里改用 WGS84 原始值——高德底图上会整体偏移约 300~600 米。 */
`
writeFileSync(OUT, file, 'utf8')
console.log(`\n已写入 ${OUT}`)
