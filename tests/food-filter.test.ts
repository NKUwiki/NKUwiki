/**
 * 校区 × 地点分类联动的测试。
 *
 * 守的是三条产品规则（八里台与津南相距 20km，食堂名字完全不一样）：
 *   1. 全部校区 → 列出所有分类；
 *   2. 某个校区 → 只列该校区真的有卡片的分类，计数也只算这个校区；
 *   3. 切校区后原来选中的分类若已不存在，收回「全部」。
 *
 * 另外守一条数据卫生：分类表里声明了 campus 的分类（食堂楼层、西南村都在八里台），
 * 它的卡片就不能出现别的校区 —— 否则 chip 的显隐会跟下拉选项打架。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { FOOD_CAMPUS, FOOD_CATEGORIES, FOODS } from '../docs/.vitepress/data/food-data.js'
import {
	campusOptionsFor,
	categoryOptionsFor,
	foodsInCampus,
	keepCategory,
	normalizeCategory,
} from '../docs/.vitepress/theme/site-components/food-filter.js'

const CATEGORIES = FOOD_CATEGORIES as Array<{ key: string, label: string, campus?: string }>
const ITEMS = FOODS as Array<{ id: string, category?: string, campus?: string }>

function countOf(options: Array<{ key: string, count: number }>, key: string) {
	return options.find(option => option.key === key)?.count ?? 0
}

test('未登记的分类归到 other，与分组和过滤同一口径', () => {
	assert.equal(normalizeCategory(CATEGORIES, 'canteen-yi-1f'), 'canteen-yi-1f')
	assert.equal(normalizeCategory(CATEGORIES, 'no-such-key'), 'other')
	assert.equal(normalizeCategory(CATEGORIES, undefined), 'other')
})

test('全部校区：列出所有有卡片的分类，计数是全局的', () => {
	const options = categoryOptionsFor(ITEMS, CATEGORIES, 'all')
	assert.equal(countOf(options, 'all'), ITEMS.length)

	const withCards = CATEGORIES.filter(category => ITEMS.some(item => item.category === category.key))
	for (const category of withCards)
		assert.ok(options.some(option => option.key === category.key), `${category.label} 应该有 chip`)

	// 没有卡片（静园餐厅）不出 chip，避免点进去一片空白
	for (const category of CATEGORIES.filter(item => !withCards.includes(item)))
		assert.ok(!options.some(option => option.key === category.key), `${category.label} 不该有 chip`)
	assert.equal(options[0].key, 'all')
})

test('单个校区：饮食分类按校区隔离，计数只算该校区', () => {
	const balitai = categoryOptionsFor(ITEMS, CATEGORIES, 'balitai')
	const jinnan = categoryOptionsFor(ITEMS, CATEGORIES, 'jinnan')

	// 食堂楼层全在八里台：津南一个都不该出现
	assert.ok(balitai.some(option => option.key === 'canteen-yi-1f'))
	assert.ok(!jinnan.some(option => option.key === 'canteen-yi-1f'))

	// 校外商圈两校区都有，都要在
	assert.ok(balitai.some(option => option.key === 'outside'))
	assert.ok(jinnan.some(option => option.key === 'outside'))

	// 「全部」计数 = 该校区卡片数，且等于各分类计数之和
	for (const [campus, options] of [['balitai', balitai], ['jinnan', jinnan]] as const) {
		const scoped = foodsInCampus(ITEMS, campus).length
		assert.equal(countOf(options, 'all'), scoped, `${campus} 的「全部」计数`)
		const sum = options.filter(option => option.key !== 'all').reduce((total, option) => total + option.count, 0)
		assert.equal(sum, scoped, `${campus} 各分类计数之和应等于总数`)
	}
})

test('切校区后收不回来的分类会被复位成「全部」', () => {
	const jinnan = categoryOptionsFor(ITEMS, CATEGORIES, 'jinnan')
	assert.equal(keepCategory(jinnan, 'canteen-yi-1f'), 'all')
	assert.equal(keepCategory(jinnan, 'outside'), 'outside')
	assert.equal(keepCategory(jinnan, 'all'), 'all')
})

test('校区下拉只列数据里出现过的校区，名称走 FOOD_CAMPUS', () => {
	const options = campusOptionsFor(ITEMS, FOOD_CAMPUS)
	assert.deepEqual(options.map(option => option.key).sort(), Object.keys(FOOD_CAMPUS).sort())
	for (const option of options)
		assert.equal(option.label, FOOD_CAMPUS[option.key])
})

test('分类声明的校区与卡片实际的校区一致（数据不漂移）', () => {
	const wrong: string[] = []
	for (const category of CATEGORIES) {
		if (!category.campus)
			continue
		for (const item of ITEMS) {
			if (item.category === category.key && item.campus !== category.campus)
				wrong.push(`${item.id}（${item.category} 声明 ${category.campus}，实际 ${item.campus || '空'}）`)
		}
	}
	assert.deepEqual(wrong, [])
})

test('每条卡片都有校区，否则按校区筛时会凭空消失', () => {
	assert.deepEqual(ITEMS.filter(item => !item.campus).map(item => item.id), [])
})
