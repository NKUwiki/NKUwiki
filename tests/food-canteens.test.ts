/**
 * 食堂实拍数据的守门测试。
 *
 * 这批卡片是脚本从 B 站标题解析出来的：标题只当素材，按「一个窗口一张卡」聚合成
 * 「地点 + 粗档口」。规则一改就可能整批错位 —— 例如把某条视频同时塞进两个窗口、
 * 或者把楼层名当成卡片名。这种退化在页面上只表现为「某张卡没了 / 串到别的楼层」，
 * 肉眼几乎发现不了，所以按「每条写了菜名的实拍恰好进一张卡、卡不串楼层」卡死。
 */
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import test from 'node:test'
import { CANTEEN_EXCLUDED, CANTEEN_FOODS, CANTEEN_SHOTS } from '../docs/.vitepress/data/food-canteens.js'
import { FOOD_CAMPUS, FOOD_CATEGORIES, FOODS } from '../docs/.vitepress/data/food-data.js'

/** 楼层白名单，与 scripts/fetch-bili-food.mjs 的 PLACE_DEFS 保持一致 */
const PLACES = new Set([
	'一食堂一楼',
	'一食堂二楼',
	'二食堂一楼',
	'二食堂二楼',
	'二食堂三楼',
	'三食堂一楼',
	'三食堂二楼',
	'三食堂三楼',
	'清真食堂',
	'静园餐厅',
])
/** 地点写不精确时的落点 */
const TBD = '待定'
/**
 * 窗口卡的合法名字（与 scripts/fetch-bili-food.mjs 的 STALL_RULES / SELF_SERVE 一致）。
 * 不在这个集合里的卡是「按菜名单独建卡」的占位卡。
 */
const STALL_NAMES = new Set(['自选菜', '面食窗口', '早点窗口', '饭菜窗口'])

/* 数据文件是普通 JS，导出对象推出的是具体键而非索引签名，用断言收窄一次 */
const CARDS = CANTEEN_FOODS as Array<{
	id: string
	name: string
	category: string
	campus: string
	location: string
	place: string
	cover: string
	gallery?: string[]
	tags?: string[]
	desc: string
	detail: string
	shotCount: number
	lastDate: string
	shots: Array<{ bvid: string, date: string, meal?: string }>
}>
const SHOTS = CANTEEN_SHOTS as Array<{
	bvid: string
	date: string
	meal: string
	place: string
	dishes: string[]
	views: number
	cover: string
}>
const EXCLUDED = CANTEEN_EXCLUDED as Array<{ bvid: string }>
const ALL = FOODS as Array<{ id: string, category: string, campus: string, gallery?: string[], cover?: string, tags?: string[] }>

/** 卡片实际归属的地点：楼层认得就用楼层，否则待定 */
function placeOf(shot: { place: string }) {
	return PLACES.has(shot.place) ? shot.place : TBD
}

test('卡片与实拍的 id 都不重复', () => {
	const cardIds = CARDS.map(card => card.id)
	assert.equal(new Set(cardIds).size, cardIds.length, `卡片 id 有重复：${cardIds}`)

	const bvids = SHOTS.map(shot => shot.bvid)
	assert.equal(new Set(bvids).size, bvids.length, 'bvid 有重复，说明接口分页拿到了重叠数据')

	const foodIds = ALL.map(food => food.id)
	assert.equal(new Set(foodIds).size, foodIds.length, 'FOODS 合并后 id 有重复（食堂卡与手写条目撞了 id）')
})

test('一个窗口一张卡：卡片名是窗口名或菜名，不是楼层', () => {
	const placeNames = new Set([...PLACES, TBD])
	for (const card of CARDS) {
		assert.ok(card.name.length >= 2, `${card.id} 的卡片名过短：${card.name}`)
		assert.ok(
			!placeNames.has(card.name),
			`${card.id} 把楼层当成了卡片名（「几食堂几楼」应落在 location 上）：${card.name}`,
		)
	}
})

test('每条写了菜名的实拍恰好进一张卡（视频级归类，不许漏也不许重）', () => {
	const excludedBvids = new Set(EXCLUDED.map(shot => shot.bvid))
	const withDish = SHOTS.filter(shot => shot.dishes.length && !excludedBvids.has(shot.bvid))

	const seen = new Map<string, string>()
	for (const card of CARDS) {
		for (const item of card.shots) {
			const prev = seen.get(item.bvid)
			assert.ok(!prev, `实拍 ${item.bvid} 同时进了两张卡：${prev} 和 ${card.id}（一条视频只能属于一个窗口）`)
			seen.set(item.bvid, card.id)
		}
	}
	for (const shot of withDish) {
		assert.ok(seen.has(shot.bvid), `写了菜名的实拍 ${shot.bvid}（${shot.dishes.join('、')}）没有进任何卡片`)
	}
})

test('没写菜名的实拍只能进窗口卡（早点窗口 / 自选菜），不许混进单菜卡', () => {
	const byBvid = new Map(SHOTS.map(shot => [shot.bvid, shot]))
	for (const card of CARDS) {
		for (const item of card.shots) {
			const shot = byBvid.get(item.bvid)
			assert.ok(shot, `${card.id} 引用了不存在的实拍 ${item.bvid}`)
			if (!shot.dishes.length) {
				assert.ok(
					STALL_NAMES.has(card.name),
					`${item.bvid} 标题里没有菜名，却进了非窗口卡「${card.name}」`,
				)
			}
		}
	}
})

test('窗口卡收齐了各自楼层的无菜名实拍（一食一楼自选菜 20 条、二食一楼早点等）', () => {
	const excludedBvids = new Set(EXCLUDED.map(shot => shot.bvid))
	const byBvid = new Map(SHOTS.map(shot => [shot.bvid, shot]))
	const dishless = SHOTS.filter(shot => !shot.dishes.length && !excludedBvids.has(shot.bvid))
	// 无菜名实拍的可归口：早饭 → 该楼层早点窗口；一食一楼午饭 → 自选菜
	const allowed = (shot: { place: string, meal: string }) =>
		(shot.meal || '').startsWith('早')
			? `${placeOf(shot)}\u0000早点窗口`
			: shot.place === '一食堂一楼'
				? `${placeOf(shot)}\u0000自选菜`
				: null

	const expected = new Map<string, string[]>()
	for (const shot of dishless) {
		const key = allowed(shot)
		if (!key) {
			continue
		}
		if (!expected.has(key)) {
			expected.set(key, [])
		}
		expected.get(key)!.push(shot.bvid)
	}

	const actual = new Map<string, string[]>()
	for (const card of CARDS) {
		const key = `${card.place}\u0000${card.name}`
		const items = card.shots
			.filter(item => !byBvid.get(item.bvid)!.dishes.length)
			.map(item => item.bvid)
		if (items.length) {
			actual.set(key, items)
		}
	}
	assert.deepEqual(
		Object.fromEntries([...actual].map(([key, list]) => [key, [...list].sort()])),
		Object.fromEntries([...expected].map(([key, list]) => [key, [...list].sort()])),
		'无菜名实拍的归口与窗口卡不一致（要么漏收、要么收错窗口）',
	)
	assert.ok(actual.get('一食堂一楼\u0000自选菜')!.length > 1, '一食一楼自选菜卡只有一两条实拍，可能配错了楼层')
})

test('单菜卡：卡名确实出自每条来源实拍的标题解析结果', () => {
	const byBvid = new Map(SHOTS.map(shot => [shot.bvid, shot]))
	for (const card of CARDS) {
		if (STALL_NAMES.has(card.name)) {
			continue
		}
		for (const item of card.shots) {
			const shot = byBvid.get(item.bvid)
			assert.ok(shot, `${card.id} 引用了不存在的实拍 ${item.bvid}`)
			assert.ok(
				shot.dishes.includes(card.name),
				`${card.id} 的菜名「${card.name}」在实拍 ${item.bvid} 的解析结果里找不到`,
			)
		}
	}
})

test('卡片的每条实拍都在同一楼层', () => {
	const byBvid = new Map(SHOTS.map(shot => [shot.bvid, shot]))
	for (const card of CARDS) {
		assert.ok(card.shots.length > 0, `${card.id} 没有来源实拍`)
		assert.equal(card.shotCount, card.shots.length, `${card.id} 的 shotCount 与 shots 长度不符`)
		for (const item of card.shots) {
			const shot = byBvid.get(item.bvid)
			assert.ok(shot, `${card.id} 引用了不存在的实拍 ${item.bvid}`)
			assert.equal(placeOf(shot), card.place, `${card.id} 混进了别的楼层的实拍 ${item.bvid}`)
		}
	}
})

test('location 与 place 一致，且地点都登记过', () => {
	for (const card of CARDS) {
		assert.ok(PLACES.has(card.place) || card.place === TBD, `未登记的地点：${card.place}（${card.id}）`)
		assert.equal(
			card.location,
			card.place === TBD ? TBD : card.place,
			`${card.id} 的 location 与 place 不一致`,
		)
	}
})

test('分类就是楼层，且都在 FOOD_CATEGORIES 里登记过', () => {
	const categories = new Set(FOOD_CATEGORIES.map(item => item.key))
	// 笼统的「校内食堂」分类已经取消，别再混回来
	assert.ok(!categories.has('canteen'), 'FOOD_CATEGORIES 里还留着 canteen，分类应该按楼层拆开')
	for (const card of CARDS) {
		assert.ok(categories.has(card.category), `${card.id} 的分类 ${card.category} 没登记`)
		// 「几食堂几楼」既是 location 也是分类，两者必须是同一个楼层名
		const label = FOOD_CATEGORIES.find(item => item.key === card.category)?.label
		assert.equal(label, card.location, `${card.id} 的分类标签与地点不一致`)
		assert.ok(card.campus in FOOD_CAMPUS, `未登记的校区：${card.campus}`)
	}
})

test('封面就是图集第一张，且文件真实存在', () => {
	for (const card of CARDS) {
		const photos = card.gallery ?? [card.cover]
		assert.equal(photos.length, card.shotCount, `${card.name} 的图集长度与 shotCount 不符`)
		assert.equal(card.cover, photos[0], `${card.name} 的封面不是图集第一张（第一张应是最新实拍）`)
		for (const photo of photos) {
			assert.match(photo, /^\/img\/food\/shots\/(BV\w+|zuiai-[\w-]+)\.webp$/, `${card.name} 的封面路径不合规范：${photo}`)
			const file = resolve(process.cwd(), 'docs/public', photo.slice(1))
			assert.ok(existsSync(file), `${card.name} 引用了不存在的封面：${photo}（重跑 fetch-bili-food.mjs 补齐）`)
		}
	}
})

test('窗口卡的 detail 都带「窗口名是推断的」注脚，单菜卡带占位说明', () => {
	for (const card of CARDS) {
		// 待定卡的注脚是「认出楼层后会挪到对应分类」，两套文案都算数
		if (card.place === TBD) {
			continue
		}
		if (STALL_NAMES.has(card.name)) {
			assert.ok(
				card.detail.includes('窗口名是按实拍内容粗分'),
				`${card.id} 的窗口卡缺推断注脚，读者会当成官方窗口名`,
			)
		}
		else {
			assert.ok(
				card.detail.includes('先按菜名单独建卡'),
				`${card.id} 的单菜卡缺占位说明`,
			)
		}
	}
})

test('日期与菜名格式合法', () => {
	for (const shot of SHOTS) {
		assert.match(shot.date, /^\d{4}-\d{2}-\d{2}$/, `${shot.bvid} 的日期格式不对：${shot.date}`)
		for (const dish of shot.dishes) {
			assert.ok(dish.length >= 2, `${shot.bvid} 出现了过短的菜名「${dish}」，多半是清洗规则漏了`)
		}
	}
	for (const card of CARDS) {
		assert.match(card.lastDate, /^\d{4}-\d{2}-\d{2}$/, `${card.name} 的 lastDate 格式不对`)
		for (const item of card.shots) {
			assert.match(item.date, /^\d{4}-\d{2}-\d{2}$/, `${card.id} 里 ${item.bvid} 的日期格式不对`)
		}
	}
})

test('同一楼层内不会出现两张同名的卡', () => {
	const keys = CARDS.map(card => `${card.place}\u0000${card.name}`)
	assert.equal(new Set(keys).size, keys.length, '同一楼层出现了重复的窗口名，去重逻辑失效')
})

test('每个食堂楼层的分类在 FOODS 里都有条目——筛选点下去不能是空的', () => {
	const counted = new Map<string, number>()
	for (const food of ALL) {
		counted.set(food.category, (counted.get(food.category) || 0) + 1)
	}
	for (const card of CARDS) {
		assert.ok((counted.get(card.category) || 0) > 0, `${card.category} 分类为空，页面上会点到一个没有结果的筛选`)
	}
	const canteenTotal = ALL.filter(food => food.category.startsWith('canteen-')).length
	assert.equal(canteenTotal, CARDS.length, 'FOODS 里的食堂条目数与生成文件不一致')
})

test('旧分类归并后仍有条目：西南村单独一类，校外统一一类', () => {
	const counted = new Map<string, number>()
	for (const food of ALL) {
		counted.set(food.category, (counted.get(food.category) || 0) + 1)
	}
	assert.ok((counted.get('xinancun') || 0) > 0, '西南村分类为空')
	assert.ok((counted.get('outside') || 0) > 0, '校外商圈分类为空')
	// 「饮品甜点」已并入校外商圈，不该再有残留
	assert.ok(!counted.has('dessert'), '数据里还留着 dessert 分类')
	assert.ok(!counted.has('inside'), '数据里还留着 inside 分类')
})

test('每张卡都至少带一个标签、至多三个且不重复——标签是卡片上唯一的品类线索', () => {
	for (const food of ALL) {
		const tags = food.tags || []
		assert.ok(tags.length > 0, `${food.id} 没有任何标签，卡片上只会剩下名称和地点`)
		assert.ok(tags.length <= 3, `${food.id} 标签超过 3 个，卡片药丸放不下`)
		assert.equal(new Set(tags).size, tags.length, `${food.id} 有重复标签：${tags.join('/')}`)
	}
})
