import assert from 'node:assert/strict'
import test from 'node:test'
import { buildRelatedIndex } from '../packages/wiki-theme/lib/content/related.ts'

function doc(url: string, title: string, text: string, extra: Partial<Parameters<typeof buildRelatedIndex>[0][number]> = {}) {
	return {
		url,
		title,
		folders: ['浅谈学习'],
		categories: ['浅谈学习'],
		tags: [],
		text,
		...extra,
	}
}

test('同主题文章互相推荐，异主题不混进来', () => {
	const index = buildRelatedIndex([
		doc('/a', '选课指南', '选课系统在开学第一周开放，退课要经过教务审核，课程容量有限。'),
		doc('/b', '选课技巧', '选课系统开放后先抢必修课，退课窗口关闭前可以调整课程。'),
		// 放在不同分类：分类本身是弱信号（同分类会天然加分），这里要测的是正文主题的区分能力
		doc('/c', '食堂推荐', '食堂饭菜价格实惠，窗口排队时间集中在中午，二楼有清真窗口。', {
			folders: ['校园生活'],
			categories: ['校园生活'],
		}),
	])
	const relatedA = index.get('/a') ?? []
	assert.equal(relatedA[0]?.url, '/b', '选课类文章应互为第一推荐')
	assert.ok(!relatedA.some(item => item.url === '/c'), '食堂文章不该被推给选课文章')
})

test('输出只有展示需要的字段，不泄漏分数与词项', () => {
	const index = buildRelatedIndex([
		doc('/a', '选课指南', '选课系统与退课流程'),
		doc('/b', '选课技巧', '选课系统与退课流程'),
	])
	const item = index.get('/a')?.[0]
	assert.deepEqual(Object.keys(item ?? {}).sort(), ['folders', 'title', 'url'])
})

test('结果确定：重复构建顺序一致', () => {
	const docs = [
		doc('/a', '选课指南', '选课系统与退课流程说明'),
		doc('/b', '选课技巧', '选课系统与退课流程说明'),
		doc('/c', '选课答疑', '选课系统与退课流程说明'),
	]
	const first = buildRelatedIndex(docs).get('/a')
	const second = buildRelatedIndex([...docs].reverse()).get('/a')
	assert.deepEqual(first, second, '输入顺序变化不应影响同一篇的推荐结果')
})

test('limit 生效，单篇或空输入返回空表', () => {
	const docs = Array.from({ length: 6 }, (_, i) =>
		doc(`/p${i}`, `选课指南 ${i}`, '选课系统开放时间与退课流程，教务审核课程容量。'))
	const limited = buildRelatedIndex(docs, 2)
	assert.equal(limited.get('/p0')?.length, 2)

	assert.equal(buildRelatedIndex([]).size, 0)
	assert.equal(buildRelatedIndex([docs[0]!]).size, 0)
})

test('标签与分类参与加权：同标签但正文不同的文章也能被关联', () => {
	const index = buildRelatedIndex([
		doc('/a', '宿舍网络', '网线接口位置与报修电话。', { tags: ['校园网'] }),
		doc('/b', '校园网认证', '认证客户端下载与账号绑定。', { tags: ['校园网'] }),
		doc('/c', '快递点', '取件时间与驿站位置。', { tags: ['快递'] }),
	])
	const related = index.get('/a') ?? []
	assert.ok(related.some(item => item.url === '/b'), '共享标签应产生关联')
})

test('正文高频词被裁剪：不靠人人都有的话术凑出关联', () => {
	// 12 篇（≥ DF_MIN_DOCS）正文共用同一段套话，标题各不相同、彼此不共享词。
	// 裁剪生效时，/p0 不应把 /p2 这类纯套话邻居算作相关。
	const filler = '本站内容仅供参考 如有疑问 欢迎反馈 介绍 说明 整理'
	const titles = ['选课指南', '食堂推荐', '快递点', '宿舍分配', '校园网', '学生邮箱', '校园地图', '校车时刻', '澡堂开放', '洗衣房', '校医院', '图书馆']
	const docs = titles.map((title, i) => doc(
		`/p${i}`,
		title,
		`${filler} ${i === 0 ? '选课流程与退课窗口' : i === 1 ? '食堂窗口与饭菜价格' : `另有一些${i}号零散内容`}`,
	))
	const related = buildRelatedIndex(docs).get('/p0') ?? []
	assert.ok(!related.some(item => item.url === '/p2'), '仅共享高频套话不应产生推荐')
})
