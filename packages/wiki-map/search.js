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
 * 召回后剩余的「相关度下限」：只保留得分不低于首名该比例的结果。
 *
 * MiniSearch 默认 OR 组合，配合单字+二元组分词在中文上召回极宽——
 * 97 个点位下搜「主楼」会召回 41 个、「药学院」62 个，列表基本失去筛选意义。
 * 改 combineWith: 'AND' 能收敛，但会丢「用户少字」的场景：
 * 搜「第二教学楼」就召回不到「第二主教学楼」了。
 * 按相对最高分截断两者兼得——实测从 41→2、62→2，而目标点位 100% 仍在结果里。
 */
const SCORE_CUTOFF = 0.3

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

	return (kw) => {
		const hits = engine.search(kw)
		if (!hits.length)
			return new Set()
		/* search() 已按得分降序，故 hits[0].score 即本次最高分；
		   一旦掉到下限以下，后面的只会更低，可以提前结束。 */
		const floor = hits[0].score * SCORE_CUTOFF
		const ids = new Set()
		for (const hit of hits) {
			if (hit.score < floor)
				break
			ids.add(hit.id)
		}
		return ids
	}
}
