/**
 * 悬停提示的夹取定位回归测试。
 *
 * 这几种情形写错了不报错，只会在某些点位上手感不对（提示压住左侧卡片、
 * 或跑到地图外面），所以把边界钉住。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { clampTipCenterX, HOVER_TIP_MARGIN, HOVER_TIP_MAX_WIDTH } from '../packages/wiki-map/hover-tip.js'

/** 桌面：卡片右边界 364（left 12 + 22rem），地图宽 1400 */
const desktop = { viewWidth: 1400, cardRight: 364 }

test('点位在卡片右侧远处：位置不动', () => {
	assert.equal(clampTipCenterX({ x: 900, ...desktop }), 900)
})

test('点位贴地图左缘：被推到卡片右侧，不再压住卡片', () => {
	// 卡片右边界 364，再留 12px 间隙与半个提示宽度
	const expected = 364 + HOVER_TIP_MARGIN + HOVER_TIP_MAX_WIDTH / 2
	assert.equal(clampTipCenterX({ x: 20, ...desktop }), expected)
})

test('点位贴地图右缘：被拉回，提示不越出地图', () => {
	assert.equal(
		clampTipCenterX({ x: 1395, ...desktop }),
		desktop.viewWidth - HOVER_TIP_MARGIN - HOVER_TIP_MAX_WIDTH / 2,
	)
})

test('窄屏抽屉在场外（cardRight 为负）：退回 0，只留间隙', () => {
	// 抽屉被 translateX 移出屏幕时 getBoundingClientRect().right 是负数
	assert.equal(
		clampTipCenterX({ x: 5, viewWidth: 390, cardRight: -12 }),
		HOVER_TIP_MARGIN + HOVER_TIP_MAX_WIDTH / 2,
	)
})

test('可视区比提示还窄：优先不压卡片，返回左边界', () => {
	// 比如 1025px 视口配 22rem 卡片：右侧可用宽度不足一个提示
	const cramped = { viewWidth: 400, cardRight: 364 }
	assert.equal(clampTipCenterX({ x: 0, ...cramped }), 364 + HOVER_TIP_MARGIN + HOVER_TIP_MAX_WIDTH / 2)
	assert.equal(clampTipCenterX({ x: 9999, ...cramped }), 364 + HOVER_TIP_MARGIN + HOVER_TIP_MAX_WIDTH / 2)
})
