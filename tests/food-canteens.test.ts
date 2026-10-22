/**
 * 食堂实拍数据的守门测试。
 *
 * 这批卡片是脚本从 B 站标题解析出来的：标题只当素材，解析成「地点 / 菜名」再生成卡片。
 * 规则一改就可能整批错位 —— 例如把「炸酱面和炒鸡面」当成一道菜、或者把楼层名
 * 当成卡片名。这种退化在页面上只表现为「某张卡没了 / 串到别的楼层」，
 * 肉眼几乎发现不了，所以按「每道菜恰好一张卡、每条实拍只进它自己楼层的卡」卡死。
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
 * 允许把「只写地点、没写菜名」的实拍合成一张卡的楼层。
 * 与 scripts/fetch-bili-food.mjs 的 SELF_SERVE 保持一致：
 * 一食堂一楼那 20 条全是午饭，是那层自选菜档口的日常记录；二食堂一楼的 9 条全是早饭，不能套这个名。
 */
const SELF_SERVE = new Map([['一食堂一楼', '自选菜']])

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
const ALL = FOODS as Array<{ id: string, category: string, campus: string, gallery?: string[], cover?: string }>

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

test('一种食物一张卡：卡片名是菜名，不是楼层', () => {
	const placeNames = new Set([...PLACES, TBD])
	for (const card of CARDS) {
		assert.ok(card.name.length >= 2, `${card.id} 的卡片名过短：${card.name}`)
		assert.ok(
			!placeNames.has(card.name),
			`${card.id} 把楼层当成了卡片名（「几食堂几楼」应落在 location 上，卡片是食物）：${card.name}`,
		)
	}
})

test('每道菜都有卡 —— 写了菜名的实拍一条都不许漏', () => {
	const expected = new Set<string>()
	const excludedBvids = new Set(EXCLUDED.map(shot => shot.bvid))
	for (const shot of SHOTS) {
		if (!shot.dishes.length || excludedBvids.has(shot.bvid)) {
			continue
		}
		for (const dish of shot.dishes) {
			expected.add(`${placeOf(shot)}\u0000${dish}`)
		}
	}
	const actual = new Set(CARDS.map(card => `${card.place}\u0000${card.name}`))
	const selfServeCards = new Set([...SELF_SERVE].map(([place, name]) => `${place}\u0000${name}`))

	for (const key of expected) {
		const [place, dish] = key.split('\u0000')
		assert.ok(actual.has(key), `「${place}」的「${dish}」没有生成卡片（解析规则可能把菜名吃掉了）`)
	}
	for (const card of CARDS) {
		const key = `${card.place}\u0000${card.name}`
		if (selfServeCards.has(key)) {
			continue
		}
		assert.ok(expected.has(key), `${card.id} 找不到来源实拍：${card.place} / ${card.name}`)
	}
	assert.equal(
		CARDS.length,
		expected.size + selfServeCards.size,
		'卡片数不等于「去重后的地点+菜名」数 + 自选菜卡数',
	)
})

test('没写菜名的实拍只能进自选菜卡，不许混进具体菜卡', () => {
	const byBvid = new Map(SHOTS.map(shot => [shot.bvid, shot]))
	for (const card of CARDS) {
		for (const item of card.shots) {
			const shot = byBvid.get(item.bvid)
			assert.ok(shot, `${card.id} 引用了不存在的实拍 ${item.bvid}`)
			if (!shot.dishes.length) {
				assert.equal(
					card.name,
					SELF_SERVE.get(card.place),
					`${item.bvid} 标题里没有菜名，却进了「${card.name}」卡`,
				)
			}
		}
	}
})

test('配置了自选菜的楼层，无菜名实拍必须全部收进那张卡', () => {
	const excludedBvids = new Set(EXCLUDED.map(shot => shot.bvid))
	for (const [place, name] of SELF_SERVE) {
		const expected = SHOTS
			.filter(shot => !shot.dishes.length && shot.place === place && !excludedBvids.has(shot.bvid))
			.map(shot => shot.bvid)
			.sort()
		const card = CARDS.find(item => item.place === place && item.name === name)
		assert.ok(card, `${place} 缺少「${name}」卡`)
		assert.deepEqual(
			card.shots.map(shot => shot.bvid).sort(),
			expected,
			`${place} 的「${name}」卡没有收全无菜名实拍`,
		)
		assert.ok(expected.length > 1, `${place} 的自选菜卡只有 ${expected.length} 条实拍，可能配错了楼层`)
	}
})

test('卡片的每条实拍都在同一楼层，且这道菜确实出自该实拍', () => {
	const byBvid = new Map(SHOTS.map(shot => [shot.bvid, shot]))
	for (const card of CARDS) {
		assert.ok(card.shots.length > 0, `${card.id} 没有来源实拍`)
		assert.equal(card.shotCount, card.shots.length, `${card.id} 的 shotCount 与 shots 长度不符`)
		for (const item of card.shots) {
			const shot = byBvid.get(item.bvid)
			assert.ok(shot, `${card.id} 引用了不存在的实拍 ${item.bvid}`)
			assert.equal(placeOf(shot), card.place, `${card.id} 混进了别的楼层的实拍 ${item.bvid}`)
			if (card.name === SELF_SERVE.get(card.place)) {
				// 自选菜卡本来就不对应某道菜，只校验楼层
				continue
			}
			assert.ok(
				shot.dishes.includes(card.name),
				`${card.id} 的菜名「${card.name}」在实拍 ${item.bvid} 的解析结果里找不到`,
			)
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
			assert.match(photo, /^\/food\/shots\/BV\w+\.webp$/, `${card.name} 的封面路径不合规范：${photo}`)
			const file = resolve(process.cwd(), 'docs/public', photo.slice(1))
			assert.ok(existsSync(file), `${card.name} 引用了不存在的封面：${photo}（重跑 fetch-bili-food.mjs 补齐）`)
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
	assert.equal(new Set(keys).size, keys.length, '同一楼层出现了重复的菜名，去重逻辑失效')
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
