/**
 * 地图点位搜索（独立于站点全站搜索，随 wiki-map 包分发）。
 *
 * 引擎：MiniSearch（内存索引），针对中文场景定制 tokenize：
 * 把连续汉字拆成「单字 + 相邻二元组」，拉丁/数字词原样保留。
 * 这样「图书」能命中「图书馆报告厅」（prefix 命中二元组「图书」），
 * 同时保留 fuzzy 容错（错别字、少字）。
 *
 * 点位可选 `aliases` 字段（字符串数组，别称/拼音/首字母）参与检索，
 * 如 { aliases: ['tushuguan', 'tsg'] }——数据驱动，无需改组件。
 */
import MiniSearch from 'minisearch'

/** CJK 单字 + 二元组 + 拉丁词 */
export function tokenize(text) {
	if (!text)
		return []
	const tokens = []
	for (const word of String(text).toLowerCase().split(/[\s\p{P}]+/u)) {
		if (!word)
			continue
		if (/[\u4E00-\u9FFF]/.test(word)) {
			const chars = [...word]
			for (const c of chars) tokens.push(c)
			for (let i = 0; i < chars.length - 1; i++) tokens.push(chars[i] + chars[i + 1])
		}
		else {
			tokens.push(word)
		}
	}
	return tokens
}

/**
 * 由点位列表构建搜索引擎，返回 search(kw) => 命中的点位 id 集合。
 * 索引覆盖全部点位，校区/分类过滤仍由 MapView 在其结果上继续做。
 */
export function createBuildingSearch(buildings) {
	const engine = new MiniSearch({
		fields: ['name', 'desc', 'aliases'],
		tokenize,
		extractField: (doc, field) =>
			field === 'aliases' ? (doc.aliases || []).join(' ') : doc[field],
		searchOptions: {
			prefix: true,
			fuzzy: 0.2,
			boost: { name: 3, aliases: 2, desc: 1 },
		},
	})
	engine.addAll(buildings)
	return kw => new Set(engine.search(kw).map(r => r.id))
}
