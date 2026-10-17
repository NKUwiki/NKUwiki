/**
 * 缩放分级的分布核对：每个校区、每个档位各多少个点位。
 *
 * 用法：node scripts/check-lod.mjs
 *
 * 这条检查的意义在于：分级规则改一个分类、或数据里给某个点加了 tier，
 * 在地图上只表现为「某个点忽然不出现了」，很难发现。这里把分布打成表，
 * 数字不对一眼就能看出来（比如 2 档从 32 掉到 8，多半是映射写错了）。
 *
 * 规则直接 import packages/wiki-map/lod.js，不复制一份逻辑。
 */
import process from 'node:process'
import { BUILDINGS, CAMPUS_CONFIG, CATEGORY_CONFIG, POLYGONS } from '../docs/.vitepress/data/map-data.js'
import { campusAnchor, LOD_MAX_TIER, tierForZoom, tierOf } from '../packages/wiki-map/lod.js'

let failed = 0

for (const [campusId, campus] of Object.entries(CAMPUS_CONFIG)) {
	const own = BUILDINGS.filter(b => b.campusId === campusId)
	const base = campus.zoom

	console.log(`\n${campus.name}（默认 zoom ${base}）`)

	/* 把「缩放 → 档位」的边界直接列出来：写死 -2 档之后，人能一眼核对 */
	const tierAtBase = tierForZoom(base, base)
	console.log(`  缩放映射    ≤${base - 2} → 1 档 | ${base - 1}~${base} → 2 档 | ≥${base + 1} → ${LOD_MAX_TIER} 档`)

	if (tierAtBase !== 2) {
		console.log(`  ✗ 默认缩放应落在 2 档，实际 ${tierAtBase} 档`)
		failed++
	}

	/* 档位是「累加可见」的：2 档看到的是 1+2 档的点位，所以这里同时打
	   每档新增多少、以及累计可见多少——只看每档数量会误以为 2 档比 1 档少 */
	let cumulative = 0
	for (let tier = 1; tier <= LOD_MAX_TIER; tier++) {
		const list = own.filter(b => tierOf(b) === tier)
		const names = [...new Set(list.map(b => CATEGORY_CONFIG[b.category]?.label || b.category))].join('、')
		cumulative += list.length
		console.log(
			`  ${tier} 档      +${String(list.length).padStart(2)} 个（累计可见 ${String(cumulative).padStart(3)} / ${own.length}）  分类：${names || '（无）'}`,
		)
	}
	if (cumulative !== own.length) {
		console.log(`  ✗ 三档合计 ${cumulative} 与点位总数 ${own.length} 不符`)
		failed++
	}

	/* 中间档必须是「真的能省掉一批」：若 2 档就见了全部，分级等于没做 */
	const tier2Visible = own.filter(b => tierOf(b) <= 2).length
	if (tier2Visible >= own.length) {
		console.log('  ✗ 2 档已包含全部点位，分级没有收敛作用')
		failed++
	}

	/* 1 档在地图上不再逐个画点位（整块校区收成一个「校区标点」），但这档
	   的点位也是 2 档的一部分（档位是累加的），太少会让 2 档的校区中心发空 */
	const tier1 = own.filter(b => tierOf(b) === 1).length
	const ratio = own.length ? tier1 / own.length : 0
	console.log(`  1 档占比    ${(ratio * 100).toFixed(0)}%（同时是 2 档的一部分）`)
	if (tier1 < 3) {
		console.log(`  ✗ 1 档点位数 ${tier1} 太少，2 档看校区中心会空得不像个校园`)
		failed++
	}
	if (ratio > 0.5) {
		console.log(`  ✗ 1 档占比超过一半（${(ratio * 100).toFixed(0)}%），分级没起到收敛作用`)
		failed++
	}

	/* 1 档那唯一一个标点落在哪儿：边界多边形的面积加权重心 */
	const anchor = campusAnchor(POLYGONS[campusId], campus.coord)
	if (!anchor) {
		console.log('  ✗ 算不出 1 档校区标点的位置（没有边界数据也没有配置中心）')
		failed++
	}
	else {
		console.log(`  1 档标点   ${anchor[0].toFixed(6)}, ${anchor[1].toFixed(6)}`)
	}
}

/* 数据侧显式写了 tier 的点也列出来，方便人工确认这些「手工抬档」是否还有必要 */
const explicit = BUILDINGS.filter(b => b.tier != null)
if (explicit.length) {
	console.log(`\n数据里显式指定 tier 的点位：${explicit.length} 个`)
	for (const b of explicit)
		console.log(`  ${b.tier} 档  ${b.name}（${b.category}）`)
}

console.log(failed ? `\n${failed} 项未通过` : '\n全部通过')
process.exit(failed ? 1 : 0)
