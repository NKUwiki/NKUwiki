/**
 * 地图数据条生成 —— 把拾取到的点位信息渲染成可直接粘进 map-data.js 的文本。
 *
 * 独立成模块（而不是写在 MapPickPanel 里）是为了能测：格式要求与现有条目
 * **逐字符一致**（2 空格缩进、双引号键值、coord/photos 数组换行、坐标 6 位小数），
 * 这类细节靠肉眼看极易漏，做成纯函数就能直接拿真实数据回归比对。
 */

/** 坐标统一保留的小数位（与现有数据一致） */
const COORD_DIGITS = 6

/** 把坐标格式化成 [经度文本, 纬度文本]；非法输入返回 null */
export function formatCoord(coord) {
	if (!Array.isArray(coord) || coord.length !== 2)
		return null
	const lng = Number(coord[0])
	const lat = Number(coord[1])
	if (!Number.isFinite(lng) || !Number.isFinite(lat))
		return null
	return [lng.toFixed(COORD_DIGITS), lat.toFixed(COORD_DIGITS)]
}

/**
 * 下一个可用 ID：`{校区}_{分类}_{两位序号}`。
 * 不取数组长度充当序号——删过条目就会撞号；改为扫现有点位里同前缀的最大编号 +1。
 */
export function nextBuildingId(buildings, campusId, category) {
	if (!campusId || !category)
		return ''
	const prefix = `${campusId}_${category}_`
	let max = 0
	for (const b of buildings || []) {
		if (typeof b?.id !== 'string' || !b.id.startsWith(prefix))
			continue
		const n = Number.parseInt(b.id.slice(prefix.length), 10)
		if (Number.isFinite(n) && n > max)
			max = n
	}
	return `${prefix}${String(max + 1).padStart(2, '0')}`
}

/**
 * 生成一条完整的 BUILDINGS 条目文本；必填项（id / name / category / campusId / coord）
 * 缺任一即返回空串，避免产出半截数据。
 *
 * 逐行拼接而不用 JSON.stringify 整体序列化：需要控制 coord 与 photos 的换行缩进，
 * 才能和现有条目长得一模一样。
 */
export function buildBuildingSnippet(fields) {
	const { id, name, category, campusId, coord, aliases, desc, photos, article } = fields || {}
	const pair = formatCoord(coord)
	if (!id || !name || !category || !campusId || !pair)
		return ''

	const q = v => JSON.stringify(v)
	const lines = [
		'  {',
		`    "id": ${q(id)},`,
		`    "name": ${q(name)},`,
		`    "category": ${q(category)},`,
		`    "campusId": ${q(campusId)},`,
		'    "coord": [',
		`      ${pair[0]},`,
		`      ${pair[1]}`,
		'    ],',
	]

	// 可选字段按现有条目的出现顺序追加：aliases → desc → photos → article。
	// aliases（别称，参与点位搜索）单行输出：别称通常只有一两个，照 photos 那样逐行展开
	// 会让条目白长一截；也因此它是唯一「数组但单行」的可选字段。
	const aliasList = Array.isArray(aliases) ? aliases.filter(a => typeof a === 'string' && a.trim()) : []
	const tail = []
	if (aliasList.length)
		tail.push(`    "aliases": [${aliasList.map(a => q(a.trim())).join(', ')}],`)
	if (typeof desc === 'string' && desc.trim())
		tail.push(`    "desc": ${q(desc.trim())},`)
	const list = Array.isArray(photos) ? photos.filter(p => typeof p === 'string' && p.trim()) : []
	if (list.length) {
		tail.push('    "photos": [')
		list.forEach((p, i) => {
			tail.push(`      ${q(p.trim())}${i < list.length - 1 ? ',' : ''}`)
		})
		tail.push('    ],')
	}
	if (typeof article === 'string' && article.trim())
		tail.push(`    "article": ${q(article.trim())},`)

	// 末行不留尾逗号：现有条目最后一行都没有。无可选字段时要收尾的是
	// coord 数组行（"    ],"），只处理 tail 会漏掉这种情况
	const all = [...lines, ...tail]
	all[all.length - 1] = all[all.length - 1].replace(/,$/, '')
	return [...all, '  },'].join('\n')
}
