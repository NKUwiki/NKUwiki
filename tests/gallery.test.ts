import assert from 'node:assert/strict'
import test from 'node:test'
import { layoutGallery } from '../packages/wiki-theme/lib/content/gallery.ts'

/** 行内宽度求和（含间距），用于校验「铺满容器」 */
function rowWidth(row: ReturnType<typeof layoutGallery>[number], gap: number) {
	return row.images.reduce((sum, item) => sum + item.width, 0) + gap * (row.images.length - 1)
}

test('a row that reaches the container width is stretched to span it exactly', () => {
	const rows = layoutGallery([
		{ src: '/img/a.png', aspect: 1 },
		{ src: '/img/b.png', aspect: 2 },
		{ src: '/img/c.png', aspect: 1 },
	], 660, 200, 10)
	assert.equal(rows.length, 1)
	assert.ok(Math.abs(rows[0]!.height - 160) < 1e-9)
	assert.ok(Math.abs(rowWidth(rows[0]!, 10) - 660) < 1e-9)
	assert.ok(rows[0]!.images.every(item => Math.abs(item.height - rows[0]!.height) < 1e-9))
})

test('the last row keeps the target height and does not stretch', () => {
	const rows = layoutGallery([
		{ src: '/img/a.png', aspect: 1 },
		{ src: '/img/b.png', aspect: 2 },
		{ src: '/img/c.png', aspect: 1 },
		{ src: '/img/d.png', aspect: 0.5 },
	], 660, 200, 10)
	assert.equal(rows.length, 2)
	assert.ok(Math.abs(rowWidth(rows[0]!, 10) - 660) < 1e-9)
	assert.equal(rows[1]!.height, 200)
	assert.ok(Math.abs(rows[1]!.images[0]!.width - 100) < 1e-9)
	assert.ok(rowWidth(rows[1]!, 10) < 660)
})

test('multiple rows each fill the container width', () => {
	const square = { src: '/img/s.png', aspect: 1 }
	const rows = layoutGallery([square, square, square, square], 500, 300, 0)
	assert.equal(rows.length, 2)
	for (const row of rows) {
		assert.equal(row.images.length, 2)
		assert.ok(Math.abs(row.height - 250) < 1e-9)
		assert.ok(Math.abs(rowWidth(row, 0) - 500) < 1e-9)
	}
})

test('a panorama just fitting the container is stretched at the target height', () => {
	const rows = layoutGallery([{ src: '/img/pano.png', aspect: 5 }], 1000, 200, 0)
	assert.equal(rows.length, 1)
	assert.ok(Math.abs(rows[0]!.height - 200) < 1e-9)
	assert.ok(Math.abs(rows[0]!.images[0]!.width - 1000) < 1e-9)
})

test('a single tall image gets its own row at the target height', () => {
	const rows = layoutGallery([{ src: '/img/tall.png', aspect: 0.5 }], 1000, 200, 0)
	assert.equal(rows.length, 1)
	assert.equal(rows[0]!.height, 200)
	assert.ok(Math.abs(rows[0]!.images[0]!.width - 100) < 1e-9)
})

test('gaps are subtracted before computing the stretched row height', () => {
	const wide = { src: '/img/w.png', aspect: 3 }
	const rows = layoutGallery([wide, wide], 420, 100, 10)
	assert.equal(rows.length, 1)
	assert.ok(Math.abs(rows[0]!.height - (420 - 10) / 6) < 1e-9)
	assert.ok(Math.abs(rowWidth(rows[0]!, 10) - 420) < 1e-9)
})

test('invalid aspects are skipped and empty input yields no rows', () => {
	assert.deepEqual(layoutGallery([], 800), [])
	assert.deepEqual(layoutGallery([{ src: '/img/x.png', aspect: 0 }], 800), [])
	assert.deepEqual(layoutGallery([{ src: '/img/x.png', aspect: Number.NaN }], 800), [])
	assert.deepEqual(layoutGallery([{ src: '/img/x.png', aspect: 1 }], 0), [])
})
