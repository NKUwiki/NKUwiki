/**
 * 地图数据条格式回归：buildBuildingSnippet 生成的数据条必须与 map-data.js
 * 里的现有条目一致，否则粘进数据文件后格式就花了。
 *
 * 判定时容忍两种已知且正确的等价差异（都写进断言消息里，改动时能立刻看出是哪一种）：
 * - 坐标尾随零：源数据个别坐标只有 5 位有效小数（39.10173），生成器统一 toFixed(6)
 *   补零——补零是为抹掉高德拾取器偶尔给出的浮点噪声（117.17127400000001）；
 * - 末条逗号：生成器面向「插入」总带尾逗号，而数组最后一条按 JS 语法没有逗号。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { BUILDINGS } from '../docs/.vitepress/data/map-data.js'
import { buildBuildingSnippet, formatCoord, nextBuildingId } from '../packages/wiki-map/pick-snippet.js'

const src = readFileSync(new URL('../docs/.vitepress/data/map-data.js', import.meta.url), 'utf8')

/** 从源文件里抠出某个 id 对应的原始条目文本（含首行缩进与结尾逗号） */
function extractRaw(id: string) {
	const at = src.indexOf(`    "id": ${JSON.stringify(id)},`)
	if (at < 0)
		return null
	const open = src.lastIndexOf('  {', at)
	const closeIdx = src.indexOf('\n  }', at)
	if (open < 0 || closeIdx < 0)
		return null
	const end = src[closeIdx + 4] === ',' ? closeIdx + 5 : closeIdx + 4
	return src.slice(open, end)
}

/**
 * 去掉小数末尾多余的零（39.101730 → 39.10173），用于比对时忽略这类纯格式差异。
 * 写成「先匹配整个小数部分、再在回调里裁尾零」而不是一条 `(\d+\.\d+?)0+` 的正则：
 * `\d+?` 与 `0+` 的字符集重叠（0 也是数字），会触发
 * regexp/no-super-linear-backtracking 的多项式回溯告警。
 */
function stripTrailingZeros(text: string) {
	return text.replace(/(\.\d+)(?=[,\n])/g, match => match.replace(/0+$/, ''))
}

const noLastComma = (s: string) => s.replace(/\n {2}\},$/, '\n  }')

test('数据条与现有条目格式一致（全量 76 条）', () => {
	const mismatched: string[] = []
	for (const b of BUILDINGS) {
		const raw = extractRaw(b.id)
		if (!raw) {
			mismatched.push(`${b.id}：在源文件里找不到对应条目`)
			continue
		}
		const generated = buildBuildingSnippet({
			id: b.id,
			name: b.name,
			category: b.category,
			campusId: b.campusId,
			coord: b.coord,
			desc: b.desc,
			photos: b.photos,
			article: b.article,
		})
		const same = raw === generated
			|| stripTrailingZeros(raw) === stripTrailingZeros(generated)
			|| noLastComma(stripTrailingZeros(raw)) === noLastComma(stripTrailingZeros(generated))
		if (!same) {
			mismatched.push(`${b.id}:\n源文件 ${JSON.stringify(raw)}\n生成   ${JSON.stringify(generated)}`)
		}
	}
	assert.deepEqual(mismatched, [], `以下条目格式不一致：\n${mismatched.join('\n')}`)
})

test('新 ID 序号取同前缀最大编号 +1，不撞号', () => {
	for (const [campus, cat] of [['n', 'landmark'], ['j', 'teaching'], ['n', 'canteen']]) {
		const prefix = `${campus}_${cat}_`
		const used = BUILDINGS
			.filter(b => typeof b.id === 'string' && b.id.startsWith(prefix))
			.map(b => Number.parseInt(b.id.slice(prefix.length), 10))
			.filter(Number.isFinite)
		const next = nextBuildingId(BUILDINGS, campus, cat)
		const nextNum = Number.parseInt(next.slice(prefix.length), 10)
		assert.match(next, new RegExp(`^${prefix}\\d{2}$`), `${next} 格式应为 ${prefix}NN`)
		assert.ok(
			used.length === 0 || nextNum > Math.max(...used),
			`${next} 与现有编号冲突（现有最大 ${used.length ? Math.max(...used) : 0}）`,
		)
		assert.ok(!BUILDINGS.some(b => b.id === next), `${next} 已存在`)
	}
})

test('必填项缺失时返回空串，不产出半截数据', () => {
	const base = { id: 'n_x_01', name: '测试', category: 'teaching', campusId: 'n', coord: [117.17, 39.1] }
	assert.equal(buildBuildingSnippet({ ...base, coord: null }), '')
	assert.equal(buildBuildingSnippet({ ...base, name: '' }), '')
	assert.equal(buildBuildingSnippet({ ...base, category: '' }), '')
	assert.equal(buildBuildingSnippet({ ...base, campusId: '' }), '')
	assert.equal(buildBuildingSnippet({}), '')
	assert.notEqual(buildBuildingSnippet(base), '')
})

test('坐标统一 6 位小数，非法值返回 null', () => {
	assert.deepEqual(formatCoord([117.171274123, 39.102101456]), ['117.171274', '39.102101'])
	// 5 位有效小数补零到 6 位，数值不变
	assert.deepEqual(formatCoord([117.17, 39.10173]), ['117.170000', '39.101730'])
	assert.equal(formatCoord(null), null)
	assert.equal(formatCoord([1]), null)
	assert.equal(formatCoord(['a', 'b']), null)
})

test('可选字段按现有顺序输出，末行不留尾逗号', () => {
	const full = buildBuildingSnippet({
		id: 'n_test_01',
		name: '测试楼',
		category: 'teaching',
		campusId: 'n',
		coord: [117.17, 39.1],
		desc: '描述',
		photos: ['/a.png', '/b.png'],
		article: '/pages/x/',
	})
	const lines = full.split('\n')
	assert.ok(full.includes('"desc"') && full.includes('"photos"') && full.includes('"article"'))
	// 字段顺序：desc → photos → article
	assert.ok(full.indexOf('"desc"') < full.indexOf('"photos"'))
	assert.ok(full.indexOf('"photos"') < full.indexOf('"article"'))
	// 末行是 "  },"，其上一行（article）带逗号，但整条最后不留多余逗号
	assert.equal(lines[lines.length - 1], '  },')
	assert.ok(!full.includes(',,'))

	// 只有 photos 时，photos 的闭合行不带逗号（原为尾行）
	const onlyPhotos = buildBuildingSnippet({
		id: 'n_test_02',
		name: '测试楼',
		category: 'teaching',
		campusId: 'n',
		coord: [117.17, 39.1],
		photos: ['/a.png'],
	})
	assert.ok(onlyPhotos.includes('    ]\n  },'))
	// 空字符串/空数组的可选字段不产出对应行
	const minimal = buildBuildingSnippet({
		id: 'n_test_03',
		name: '测试楼',
		category: 'teaching',
		campusId: 'n',
		coord: [117.17, 39.1],
		desc: '   ',
		photos: [],
		article: '',
	})
	assert.ok(!minimal.includes('"desc"') && !minimal.includes('"photos"') && !minimal.includes('"article"'))
})
