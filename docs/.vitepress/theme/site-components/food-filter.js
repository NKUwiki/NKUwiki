/**
 * 校区 × 地点分类的联动规则（纯函数）。
 *
 * 为什么需要这层：八里台与津南相距 20km，食堂名字也完全不重合 —— 一食堂二楼在
 * 八里台，津南那边叫别的名字。所以「几食堂几楼」这组分类并不通用：
 *   · 选「全部校区」→ 列出所有分类（两地混着看）；
 *   · 选某个校区   → 只列该校区真的有卡片的分类，否则点进去就是一片空白。
 *
 * 判定一律走**数据**（这个校区里有没有卡片），不给分类硬绑校区 —— 校外商圈
 * 两个校区都有，硬绑就得破例，以后再加校区还要回来改。
 *
 * 前端 chip 与分组、投稿助手的分类下拉共用这里的口径，组件里不再各写一套。
 */

/**
 * 未登记的分类统一归为 'other'。chip、分组、过滤三处必须同一口径，
 * 否则「其他」这个入口点下去什么都筛不到。
 */
export function normalizeCategory(categories, key) {
	return (categories || []).some(category => category.key === key) ? key : 'other'
}

/** 只按校区筛卡片；campus 为 'all'（或空）表示不筛 */
export function foodsInCampus(foods, campus) {
	const list = foods || []
	return campus && campus !== 'all' ? list.filter(food => food?.campus === campus) : list.slice()
}

/**
 * 当前校区下该显示的分类 chip 与计数。
 *
 * 计数按**当前校区**统计（不是全局），「全部」的计数也是该校区的卡片总数：
 * 用户在八里台下看到的「全部 120」与卡片数对得上，切到津南变成「全部 28」。
 * 顺序沿用 categories 的定义顺序（= 楼层动线），这里不重排。
 */
export function categoryOptionsFor(foods, categories, campus = 'all') {
	const scoped = foodsInCampus(foods, campus)
	const counts = new Map()
	for (const food of scoped) {
		const key = normalizeCategory(categories, food?.category)
		counts.set(key, (counts.get(key) || 0) + 1)
	}

	const known = (categories || [])
		.filter(category => counts.has(category.key))
		.map(category => ({ key: category.key, label: category.label, count: counts.get(category.key) }))

	// 数据里出现了未定义分类时也要给个入口，否则「其他」分组没有任何 chip 能筛到
	const otherCount = counts.get('other') || 0

	return [
		{ key: 'all', label: '全部', count: scoped.length },
		...known,
		...(otherCount ? [{ key: 'other', label: '其他', count: otherCount }] : []),
	]
}

/**
 * 切校区后把选中项收回「全部」—— 刚选中的分类在新校区不存在时（八里台选了
 * 「一食堂二楼」，切到津南），不复位就会停在零结果上，看着像页面坏了。
 */
export function keepCategory(options, key) {
	return (options || []).some(option => option.key === key) ? key : 'all'
}

/** 校区下拉：只列数据里真的出现过的校区，展示名走 FOOD_CAMPUS */
export function campusOptionsFor(foods, labels) {
	const keys = [...new Set((foods || []).map(food => food?.campus).filter(Boolean))]
	return keys.map(key => ({ key, label: (labels && labels[key]) || key }))
}
