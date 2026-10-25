/**
 * 投稿助手的数据条生成器测试。
 *
 * 这里的守卫核心是「一份 id 规则」：脚本 fetch-bili-food.mjs 生成的食堂卡 id
 * 必须和用户在页面上填同样的名称/地点算出来的 id 逐字符一致。若两处分叉，
 * 同一道菜从页面投稿进来会变成另一张卡，评论（/food/<id>）也就跟着裂成两处。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { CANTEEN_FOODS } from '../docs/.vitepress/data/food-canteens.js'
import { FOODS } from '../docs/.vitepress/data/food-data.js'
import { slugify } from '../docs/.vitepress/data/pinyin.js'
import {
	buildFoodIssueUrl,
	buildFoodSnippet,
	draftFromFood,
	findExactDuplicate,
	findSimilarFoods,
	isSameFood,
	locationSlug,
	suggestFoodId,
} from '../docs/.vitepress/theme/site-components/food-snippet.js'

const CARDS = CANTEEN_FOODS as Array<{ id: string, name: string, category: string, location: string, place: string }>

/**
 * 把生成的数据条当 JS 求值，用来验证字段值没被转义搞坏。
 * 用 vm 而不是 new Function：这条测试的输入是我们自己造的，但 lint 会拦下
 * 构造函数求值（no-new-func），换个显式的沙箱也更能说明「只在这里求值」。
 */
function evaluate(snippet: string) {
	return runInNewContext(`[${snippet}]`)[0]
}

test('拼音规则与脚本产出的 id 一致', () => {
	// 生字退化成码位，不抛错
	const missing: string[] = []
	assert.equal(slugify('烤鸭饭', char => missing.push(char)), 'kao-ya-fan')
	assert.equal(slugify('自选菜'), 'zi-xuan-cai')
	assert.equal(missing.length, 0)
	assert.equal(slugify('𠮷野家'), 'u20bb7-ye-jia')
})

/**
 * 窗口卡的名字是脚本里的粗分桶，不是用户投稿会填的名字；
 * id 由脚本里的手写 slug 决定（不是 slugify 逐字转写），这里钉死映射防两边漂移。
 */
const STALL_SLUGS: Record<string, string> = {
	自选菜: 'zi-xuan-cai',
	面食窗口: 'mianshi',
	早点窗口: 'zaodian',
	饭菜窗口: 'fancai',
}

test('食堂楼层 + 菜名算出的 id，与脚本生成的一模一样', () => {
	for (const card of CARDS) {
		if (card.name in STALL_SLUGS) {
			const floorSlug = card.category.replace(/^canteen-/, '')
			assert.equal(
				card.id,
				`canteen-${floorSlug}-${STALL_SLUGS[card.name]}`,
				`${card.place} 的窗口卡「${card.name}」id 与约定映射不一致`,
			)
			continue
		}
		const { id } = suggestFoodId({
			name: card.name,
			// 投稿面板里的分类选项就是楼层 key（canteen-yi-1f 这种）
			category: card.category,
			location: card.place,
		}, [])
		assert.equal(id, card.id, `${card.place} 的「${card.name}」id 与脚本不一致`)
	}
})

test('非食堂条目沿用同商圈老条目的 id 前缀，食堂卡不当前缀来源', () => {
	const foods = [
		{ id: 'dayuecheng-luxihe', name: '泸溪河', category: 'outside', location: '大悦城（南开店）' },
		{ id: 'xinancun-laotao-baozipu', name: '老陶包子铺', category: 'xinancun', location: '西南村' },
	]
	assert.equal(locationSlug('大悦城（南开店）', foods), 'dayuecheng')
	assert.equal(locationSlug('西南村', foods), 'xinancun')
	// 没有先例的地点用拼音逐音节拼，括号里的补充说明不进 id
	assert.equal(locationSlug('吾悦广场', []), 'wu-yue-guang-chang')
	assert.equal(locationSlug('大悦城（南开店）', []), 'da-yue-cheng')
	// 食堂卡的 id 第一段是 canteen，不能当成「这个地点的前缀」用，
	// 否则楼层的 id 会退化成 canteen-xxx
	assert.equal(
		locationSlug('一食堂一楼', [{ id: 'canteen-yi-1f-kao-ya-fan', name: '烤鸭饭', category: 'canteen-yi-1f', location: '一食堂一楼' }]),
		'yi-shi-tang-yi-lou',
	)

	const { id } = suggestFoodId({ name: '新店', category: 'outside', location: '大悦城（南开店）' }, foods)
	assert.equal(id, 'dayuecheng-xin-dian')
})

test('id 撞车时加序号，不生成时间戳', () => {
	const foods = [
		{ id: 'lunengcheng-xin-dian', name: '新店', category: 'outside', location: '鲁能城' },
		{ id: 'lunengcheng-xin-dian-2', name: '新店', category: 'outside', location: '鲁能城' },
	]
	const { id } = suggestFoodId({ name: '新店', category: 'outside', location: '鲁能城' }, foods)
	assert.equal(id, 'lunengcheng-xin-dian-3')
})

test('缺拼音时退回码位并报告是哪个字', () => {
	const { id, missing } = suggestFoodId({ name: '𠮷野家', category: 'outside', location: '鲁能城' }, [])
	assert.match(id, /^lu-neng-cheng-u20bb7-ye-jia$/)
	assert.deepEqual(missing, ['𠮷'])
})

test('数据条格式与现有条目一致：tab 缩进、单引号、字段顺序固定', () => {
	const snippet = buildFoodSnippet({
		id: 'lunengcheng-xin-dian',
		name: '新店',
		category: 'outside',
		campus: 'balitai',
		location: '鲁能城',
		price: '¥15-25',
		tags: ['面食', '现做'],
		recommend: '牛肉面',
		desc: '一句话描述。',
	})
	const lines = snippet.split('\n')
	assert.equal(lines[0], '\t{')
	assert.equal(lines[lines.length - 1], '\t},')
	assert.deepEqual(lines.slice(1, 5), [
		'\t\tid: \'lunengcheng-xin-dian\',',
		'\t\tname: \'新店\',',
		'\t\tcategory: \'outside\',',
		'\t\tcampus: \'balitai\',',
	])
	assert.ok(lines.includes('\t\ttags: [\'面食\', \'现做\'],'))
	assert.deepEqual(Object.keys(evaluate(snippet)), [
		'id',
		'name',
		'category',
		'campus',
		'location',
		'price',
		'tags',
		'recommend',
		'desc',
	])

	// 现有条目全部符合这个形状：粘进去不会让文件出现第二种缩进风格
	for (const food of FOODS as Array<Record<string, unknown>>) {
		if (!food.id || !food.name || !food.category || !food.campus || !food.location)
			continue
		const generated = buildFoodSnippet(food as never)
		assert.ok(generated.startsWith('\t{\n\t\tid: '), `${food.id} 的数据条缩进不对`)
	}
})

test('必填项缺失就不生成数据条', () => {
	const base = { id: 'a', name: 'b', category: 'outside', campus: 'balitai', location: '鲁能城' }
	assert.equal(buildFoodSnippet({ ...base, name: '' }), '')
	assert.equal(buildFoodSnippet({ ...base, location: '   ' }), '')
	assert.equal(buildFoodSnippet({ ...base, id: '' }), '')
	assert.ok(buildFoodSnippet(base))
})

test('空的可选字段不出现在数据条里，引号会被转义', () => {
	const snippet = buildFoodSnippet({
		id: 'a',
		name: '张记\'s 面馆',
		category: 'inside',
		campus: 'balitai',
		location: '西南村',
		price: '',
		tags: ['', '  '],
		desc: '带反斜杠 \\ 的描述',
	})
	assert.ok(!snippet.includes('price'))
	assert.ok(!snippet.includes('tags'))
	const parsed = evaluate(snippet)
	assert.equal(parsed.name, '张记\'s 面馆')
	assert.equal(parsed.desc, '带反斜杠 \\ 的描述')
})

test('图片：第一张作封面，其余进 gallery', () => {
	const one = buildFoodSnippet({
		id: 'a',
		name: 'b',
		category: 'outside',
		campus: 'balitai',
		location: '鲁能城',
		cover: 'https://x/1.webp',
		gallery: [],
	})
	assert.ok(one.includes('cover'))
	assert.ok(!one.includes('gallery'))

	const many = buildFoodSnippet({
		id: 'a',
		name: 'b',
		category: 'outside',
		campus: 'balitai',
		location: '鲁能城',
		cover: 'https://x/1.webp',
		gallery: ['https://x/2.webp', 'https://x/3.webp'],
	})
	assert.match(many, /gallery: \['https:\/\/x\/2\.webp', 'https:\/\/x\/3\.webp'\]/)
})

test('issue 链接带人读摘要和完整数据条', () => {
	const fields = {
		name: '新店',
		category: 'outside',
		categoryLabel: '校外商圈',
		campus: 'balitai',
		campusLabel: '八里台校区',
		location: '鲁能城',
		price: '¥15-25',
		tags: ['面食'],
		recommend: '牛肉面',
		desc: '一句话描述。',
	}
	const snippet = buildFoodSnippet({ ...fields, id: 'lunengcheng-xin-dian' })
	const url = buildFoodIssueUrl(fields, snippet)
	const parsed = new URL(url)
	assert.equal(parsed.hostname, 'github.com')
	assert.match(parsed.pathname, /\/NKUwiki\/NKUwiki\/issues\/new$/)

	const title = parsed.searchParams.get('title') || ''
	const body = parsed.searchParams.get('body') || ''
	assert.match(title, /\[美食投稿\] 新店（鲁能城）/)
	assert.ok(body.includes('校外商圈'))
	assert.ok(body.includes('```js'))
	assert.ok(body.includes(snippet), 'issue 正文里必须带完整数据条，否则维护者还要手抄')
})

test('重名提示只按名称匹配，且不拿单字去凑', () => {
	const foods = [
		{ id: 'a', name: '老陶包子铺', location: '西南村' },
		{ id: 'b', name: '温野菜日本涮涮锅', location: '大悦城（南开店）' },
	]
	assert.deepEqual(findSimilarFoods({ name: '老陶包子铺' }, foods).map(f => f.id), ['a'])
	assert.deepEqual(findSimilarFoods({ name: '包子' }, foods).map(f => f.id), ['a'])
	assert.deepEqual(findSimilarFoods({ name: '面' }, foods), [])
	assert.deepEqual(findSimilarFoods({ name: '完全不存在的店' }, foods), [])
})

test('同名同地点才算完全重复，跨商场的同名是正常情况', () => {
	const foods = [
		{ id: 'dayuecheng-xiabuxiabu', name: '呷哺呷哺', location: '大悦城（南开店）' },
		{ id: 'lunengcheng-xiabuxiabu', name: '呷哺呷哺', location: '鲁能城' },
	]
	assert.equal(findExactDuplicate({ name: '呷哺呷哺', location: '鲁能城' }, foods)?.id, 'lunengcheng-xiabuxiabu')
	// 地点不同 → 不是重复，不该拦
	assert.equal(findExactDuplicate({ name: '呷哺呷哺', location: '吾悦广场' }, foods), undefined)
	// 地点没填 → 还判断不了
	assert.equal(findExactDuplicate({ name: '呷哺呷哺', location: '' }, foods), undefined)
})

test('简介与详细介绍是两个字段，详情排在简介之后', () => {
	const base = { id: 'a', name: 'b', category: 'outside', campus: 'balitai', location: '鲁能城' }
	const withDetail = buildFoodSnippet({ ...base, desc: '一句简介', detail: '一长段详细介绍' })
	assert.deepEqual(Object.keys(evaluate(withDetail)).slice(-2), ['desc', 'detail'])
	assert.equal(evaluate(withDetail).detail, '一长段详细介绍')

	// 没写详细介绍就不出这个键：空字符串会把详情区撑出一段空白
	const withoutDetail = buildFoodSnippet({ ...base, desc: '一句简介' })
	assert.ok(!withoutDetail.includes('detail'))
})

test('基于现有条目投稿：信息整条搬过来，原名原地点沿用同一个 id', () => {
	const source = {
		id: 'canteen-yi-1f-kao-ya-fan',
		name: '烤鸭饭',
		category: 'canteen-yi-1f',
		campus: 'balitai',
		location: '一食堂一楼',
		price: '¥12',
		tags: ['盖饭'],
		desc: '一句简介',
		detail: '一段详情',
		// 现有条目里 cover 通常就是 gallery 第一张，搬过来要去重
		cover: '/img/food/shots/a.webp',
		gallery: ['/img/food/shots/a.webp', '/img/food/shots/b.webp'],
	}
	const draft = draftFromFood(source)
	assert.equal(draft.name, '烤鸭饭')
	assert.equal(draft.detail, '一段详情')
	assert.deepEqual(draft.tags, ['盖饭'])
	assert.deepEqual(draft.photos, ['/img/food/shots/a.webp', '/img/food/shots/b.webp'])

	const same = { name: '烤鸭饭', category: 'canteen-yi-1f', location: '一食堂一楼' }
	assert.ok(isSameFood(same, source), '只改人均/简介/图片时应当沿用原 id')
	assert.ok(!isSameFood({ ...same, name: '烤鸭饭（大份）' }, source), '改了名称就是另一条')
	assert.ok(!isSameFood({ ...same, location: '二食堂一楼' }, source), '换了楼层就是另一条')
	assert.ok(!isSameFood({ ...same, category: 'outside' }, source), '换了分类就是另一条')
	assert.ok(!isSameFood(same, undefined))
	// 空条目（从工具栏直接投稿）不该被当成任何一条
	assert.deepEqual(draftFromFood({}).photos, [])
})
