/**
 * 美食数据条生成 —— 把用户在页面上填的信息渲染成可直接粘进 food-data.js 的条目。
 *
 * 独立成纯函数（不是写在 FoodContribute.vue 里）是为了能测：格式必须与现有条目
 * **逐字符一致**（tab 缩进、单引号、字段顺序 id→name→category→campus→location→
 * price→tags→recommend→desc→detail→cover→gallery），这类细节靠肉眼看极易漏。
 *
 * desc 是卡片上的一行简介，detail 只在详情弹窗里出现 —— 两层分开后，卡片墙不会被
 * 「收录 N 条实拍」这类注脚刷屏，详情页又留得住完整交代。
 *
 * id 走 data/pinyin.js 的 slugify，与 scripts/fetch-bili-food.mjs 是同一份规则 ——
 * id 是 Twikoo 评论主键（/food/<id>），两处生成方式一旦分叉，同一条数据换个入口
 * 就会变成两条互不相干的评论。
 */
import { slugify } from '../../data/pinyin.js'

/** 仓库地址：投稿用 GitHub issue 收，不用登录站点也能提 */
export const REPO_URL = 'https://github.com/NKUwiki/NKUwiki'

/**
 * 食堂楼层 → id 里的短码，与 scripts/fetch-bili-food.mjs 的 PLACE_DEFS 一一对应。
 * 食堂卡的 id 是 `canteen-<短码>-<菜名>`，投稿助手得产出同一种形状，
 * 否则用户在页面上补一条「三食堂二楼的新菜」，id 会跟脚本生成的对不上。
 */
const CANTEEN_PLACE_SLUG = {
	一食堂一楼: 'yi-1f',
	一食堂二楼: 'yi-2f',
	二食堂一楼: 'er-1f',
	二食堂二楼: 'er-2f',
	二食堂三楼: 'er-3f',
	三食堂一楼: 'san-1f',
	三食堂二楼: 'san-2f',
	三食堂三楼: 'san-3f',
	清真食堂: 'qingzhen',
	静园餐厅: 'jingyuan',
	// 地点只写到食堂名（没标楼层）的卡，脚本给的是 tbd 前缀
	待定: 'tbd',
}

/**
 * 是不是食堂卡的分类。分类已按楼层拆开，key 形如 `canteen-yi-1f`，
 * 所以只认前缀 —— 以后加楼层不用回来改这里。
 */
export function isCanteenCategory(key) {
	return String(key ?? '').startsWith('canteen-')
}

/**
 * 地点 → id 前缀。
 *
 * 已有的商圈优先沿用老条目的前缀（`dayuecheng-luxihe` 的第一段是 `dayuecheng`），
 * 这样新店和老店落在同一个命名空间里；没有先例才用拼音逐音节拼。
 * 括号里的补充说明（「大悦城（南开店）」）不进 id。
 */
export function locationSlug(location, foods = []) {
	const text = String(location ?? '').trim()
	if (!text)
		return ''
	for (const food of foods) {
		if (isCanteenCategory(food?.category) || food?.location !== text)
			continue
		const head = String(food.id ?? '').split('-')[0]
		if (head)
			return head
	}
	return slugify(text.replace(/[（(][^）)]*[）)]/g, ''))
}

/**
 * 建议 id：食堂菜 → `canteen-<楼层短码>-<菜名>`；其余 → `<地点前缀>-<名称>`。
 *
 * 撞了已有 id 就加 `-2`、`-3`，不使用时间戳 —— 同一家店重名很常见（三个商场都有
 * 呷哺呷哺），序号让维护者一眼能看出「这是第二家」。
 *
 * @returns {{ id: string, missing: string[] }} id 为空表示名称里没有可用字符；
 *   missing 是缺拼音的字，前端据此提示用户手改
 */
export function suggestFoodId(fields, foods = []) {
	const { name, category, location } = fields || {}
	const missing = []
	const dish = slugify(String(name ?? '').trim(), char => missing.push(char))
	if (!dish)
		return { id: '', missing }

	const place = String(location ?? '').trim()
	const shortSlug = isCanteenCategory(category) ? CANTEEN_PLACE_SLUG[place] : ''
	let base = shortSlug
		? `canteen-${shortSlug}-${dish}`
		: [locationSlug(place, foods), dish].filter(Boolean).join('-')

	if (!base)
		return { id: '', missing }

	const used = new Set((foods || []).map(food => food?.id).filter(Boolean))
	if (used.has(base)) {
		let index = 2
		while (used.has(`${base}-${index}`)) {
			index++
		}
		base = `${base}-${index}`
	}
	return { id: base, missing: [...new Set(missing)] }
}

const quote = text => `'${String(text).replace(/\\/g, '\\\\').replace(/'/g, '\\\'')}'`

/** 字段是否算「填了」：空串、纯空白、空数组都当没填，空字段不写进数据条 */
const has = value => typeof value === 'string' ? value.trim().length > 0 : Array.isArray(value) && value.length > 0

/**
 * 生成一条完整的 FOODS 条目。必填（id / name / category / campus / location）缺任一
 * 返回空串，避免产出半截数据 —— 现有条目全部都有这五项。
 */
export function buildFoodSnippet(fields) {
	const { id, name, category, campus, location, price, tags, recommend, desc, detail, cover, gallery, photos } = fields || {}
	if (![id, name, category, campus, location].every(value => has(value)))
		return ''

	const lines = [
		'\t{',
		`\t\tid: ${quote(id.trim())},`,
		`\t\tname: ${quote(name.trim())},`,
		`\t\tcategory: ${quote(category.trim())},`,
		`\t\tcampus: ${quote(campus.trim())},`,
		`\t\tlocation: ${quote(location.trim())},`,
	]

	if (has(price))
		lines.push(`\t\tprice: ${quote(price.trim())},`)

	const tagList = Array.isArray(tags) ? tags.filter(has) : []
	if (tagList.length)
		lines.push(`\t\ttags: [${tagList.map(tag => quote(tag.trim())).join(', ')}],`)

	if (has(recommend))
		lines.push(`\t\trecommend: ${quote(recommend.trim())},`)
	if (has(desc))
		lines.push(`\t\tdesc: ${quote(desc.trim())},`)
	// 详情只在详情弹窗里出现，卡片上看不到；没有就不写，别留个空字符串占位
	if (has(detail))
		lines.push(`\t\tdetail: ${quote(detail.trim())},`)

	// 图片：cover 单张与 gallery/photos 多张二选一。
	// 现有条目里 gallery 与 photos 两种写法都有（photos 是早期字段，getFoodPhotos 都认），
	// 这里只产 gallery，避免同一批数据两种写法混着来。
	if (has(cover))
		lines.push(`\t\tcover: ${quote(cover.trim())},`)
	const photoList = [gallery, photos]
		.find(list => Array.isArray(list) && list.filter(has).length)
		?.filter(has) ?? []
	if (photoList.length)
		lines.push(`\t\tgallery: [${photoList.map(photo => quote(photo.trim())).join(', ')}],`)

	lines.push('\t},')
	return lines.join('\n')
}

/**
 * 从现有条目生成一份投稿草稿 —— 详情弹窗里的「基于这条投稿」用它预填表单。
 *
 * 图片按「封面 + 图集」给全（食堂卡一条实拍一张图，20 张也照样给），
 * 去重是因为现有条目里 cover 通常就是 gallery 的第一张。
 * id 不在这里定：保留原名/原地点时沿用旧 id（等于修订这条），改了才重新算。
 */
export function draftFromFood(food = {}) {
	const photos = [food?.cover, ...(Array.isArray(food?.gallery) ? food.gallery : []), ...(Array.isArray(food?.photos) ? food.photos : [])]
		.filter(photo => typeof photo === 'string' && photo.trim())
	return {
		name: String(food?.name ?? ''),
		category: String(food?.category ?? ''),
		campus: String(food?.campus ?? ''),
		location: String(food?.location ?? ''),
		price: String(food?.price ?? ''),
		tags: Array.isArray(food?.tags) ? food.tags.filter(Boolean).map(String) : [],
		recommend: String(food?.recommend ?? ''),
		desc: String(food?.desc ?? ''),
		detail: String(food?.detail ?? ''),
		photos: [...new Set(photos)],
	}
}

/**
 * 草稿是否还是「原来那一条」：名称、分类、地点三者都没改才算。
 *
 * 只改简介、人均、图片时应该继续用旧 id —— 否则评论（/food/<id>）会跟历史断开，
 * 等于给同一道菜又开了一张新卡。改了名称或地点就是另一条内容，交给 suggestFoodId
 * 重新起 id（撞车时那边会自动加 -2）。
 */
export function isSameFood(fields, food) {
	if (!food)
		return false
	const same = (a, b) => String(a ?? '').trim() === String(b ?? '').trim()
	return same(fields?.name, food.name)
		&& same(fields?.category, food.category)
		&& same(fields?.location, food.location)
}

/** 把用户填的信息整理成 issue 正文里的一段人读摘要 */
function issueSummary(fields) {
	const rows = [
		['名称', fields.name],
		['分类', fields.categoryLabel || fields.category],
		['校区', fields.campusLabel || fields.campus],
		['地点', fields.location],
		['人均', fields.price],
		['标签', Array.isArray(fields.tags) ? fields.tags.join('、') : fields.tags],
		['推荐菜', fields.recommend],
		['简介', fields.desc],
		['详细介绍', fields.detail],
	]
	return rows
		.filter(([, value]) => has(value))
		.map(([label, value]) => `- **${label}**：${String(value).trim()}`)
}

/**
 * 一键提 issue 的链接。
 *
 * 不走「留言」而是开 issue，是因为数据条是给维护者直接粘进文件的：
 * issue 里贴代码块不会丢格式，评论区会被富文本吃掉缩进。
 * URL 里同时放人读摘要和数据条，维护者扫一眼就知道该不该合。
 */
export function buildFoodIssueUrl(fields, snippet) {
	const { name, location } = fields || {}
	const title = `[美食投稿] ${String(name ?? '').trim() || '未命名'}（${String(location ?? '').trim() || '地点待定'}）`
	const body = [
		'### 美食投稿',
		'',
		...issueSummary(fields || {}),
		'',
		'### 数据条',
		'',
		'可直接粘进 `docs/.vitepress/data/food-data.js` 的 `FOODS` 数组末尾：',
		'',
		'```js',
		snippet,
		'```',
		'',
		'> 由「美食推荐」页的投稿助手生成。',
	].join('\n')

	return `${REPO_URL}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`
}

/**
 * 完全重复（同名 + 同地点）的已有条目。名称相似只是「可能重复」，这里要求两项都对上：
 * 三个商场都有呷哺呷哺、一层楼有好几家面馆，跨地点的同名是正常情况，不该拦。
 */
export function findExactDuplicate(fields, foods = []) {
	const name = String(fields?.name ?? '').trim()
	const location = String(fields?.location ?? '').trim()
	if (!name || !location)
		return undefined
	return (foods || []).find(food => food?.name === name && food?.location === location)
}

/**
 * 投稿前的重复检查：只按名称做包含匹配。
 * 不去比地点 —— 一个商圈几十家店，「同一地点」会把整层食堂的菜都列出来，提示就没用了。
 * 单字不查（「面」「饭」会命中一大片），名字完全不同的重复本来就该由人判断。
 */
export function findSimilarFoods(fields, foods = [], limit = 4) {
	const name = String(fields?.name ?? '').trim()
	if (name.length < 2)
		return []
	return (foods || [])
		.filter(food => food?.name && (food.name.includes(name) || name.includes(food.name)))
		.slice(0, limit)
}
