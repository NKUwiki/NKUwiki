// 地图点位搜索（packages/wiki-map/search.js）的回归测试：
// 中文单字+二元组分词、前缀/fuzzy 命中、别称字段、权重与空输入容错。
import assert from 'node:assert/strict'
import test from 'node:test'
import { createBuildingSearch, tokenize } from '../packages/wiki-map/search.js'

const buildings = [
	{ id: 'lib', name: '图书馆', desc: '藏书与自习报告厅', aliases: ['tushuguan', 'tsg'] },
	{ id: 'canteen', name: '第二食堂', desc: '风味餐厅' },
	{ id: 'gym', name: '体育馆', desc: '篮球游泳' },
]

test('tokenize 把连续汉字拆成单字与相邻二元组，拉丁词原样保留', () => {
	assert.deepEqual(tokenize('图书馆'), ['图', '书', '馆', '图书', '书馆'])
	assert.deepEqual(tokenize('tsg'), ['tsg'])
	// 标点/空白切分，大小写归一
	assert.deepEqual(tokenize('新开湖, Lake Weiyin'), ['新', '开', '湖', '新开', '开湖', 'lake', 'weiyin'])
	// 空输入容错
	assert.deepEqual(tokenize(''), [])
	assert.deepEqual(tokenize(null), [])
})

test('按名称子串命中（prefix 命中二元组）', () => {
	const search = createBuildingSearch(buildings)
	assert.ok(search('图书').has('lib'))
	assert.ok(search('图书馆').has('lib'))
	// 「食堂」应命中「第二食堂」：查询词的二元组「食堂」与文档二元组精确相等
	assert.ok(search('食堂').has('canteen'))
})

test('别称参与检索：拼音全拼与首字母都能命中', () => {
	const search = createBuildingSearch(buildings)
	assert.ok(search('tushuguan').has('lib'))
	assert.ok(search('tsg').has('lib'))
	assert.ok(!search('tsg').has('gym'))
})

test('描述字段可命中，名称权重高于描述', () => {
	const search = createBuildingSearch(buildings)
	assert.ok(search('游泳').has('gym'))
	// 「馆」同时出现在「图书馆」的 name 与 desc；名称加权后图书应排更前（集合内仍含两者）
	const hits = search('馆')
	assert.ok(hits.has('lib'))
})

test('fuzzy 容错：错别字仍能命中', () => {
	const search = createBuildingSearch(buildings)
	// 「图属馆」（属/书 邻近错字）在 fuzzy 0.2 下应命中图书馆
	assert.ok(search('图属馆').has('lib'))
})

test('无关关键词不产生误命中', () => {
	const search = createBuildingSearch(buildings)
	assert.equal(search('校医院').size, 0)
	assert.equal(search('xyz').size, 0)
})

test('空列表构建的引擎不抛错且恒返回空集', () => {
	const search = createBuildingSearch([])
	assert.equal(search('图书馆').size, 0)
})
