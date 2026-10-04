// 一次性图片优化脚本（pnpm images:optimize）：
//   1. 生成社交分享默认图 docs/public/og-default.png（1200×630，品牌紫底 + 校徽）
//   2. 就地压缩 docs/public/img 下超过 200KB 的 jpg/png（保持格式，不改动任何引用）
// 图片都被 git 跟踪，压缩效果不满意可用 git checkout 恢复原图。
import { Buffer } from 'node:buffer'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const imgDirPath = fileURLToPath(new URL('../../public/img/', import.meta.url))
const THRESHOLD = 200 * 1024

/* ---------- 1. og-default.png ---------- */
{
	const badge = await sharp(fileURLToPath(new URL('../../public/favicon-light.svg', import.meta.url)), { density: 300 })
		.resize(360, 360)
		.png()
		.toBuffer()

	const og = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
		<rect width="1200" height="630" fill="#572966"/>
		<rect x="24" y="24" width="1152" height="582" fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="3" rx="18"/>
	</svg>`

	await sharp(Buffer.from(og))
		.composite([{ input: badge, left: Math.round((1200 - 360) / 2), top: Math.round((630 - 360) / 2) }])
		.png({ compressionLevel: 9 })
		.toFile(fileURLToPath(new URL('../../public/og-default.png', import.meta.url)))

	const size = statSync(fileURLToPath(new URL('../../public/og-default.png', import.meta.url))).size
	console.log(`og-default.png 已生成（${Math.round(size / 1024)}KB）`)
}

/* ---------- 2. 大图就地压缩 ---------- */
function walk(dir) {
	const files = []
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry)
		if (statSync(full).isDirectory())
			files.push(...walk(full))
		else if (/\.(?:jpe?g|png)$/i.test(entry))
			files.push(full)
	}
	return files
}

let savedTotal = 0
for (const file of walk(imgDirPath)) {
	const before = statSync(file).size
	if (before <= THRESHOLD)
		continue
	const buffer = readFileSync(file)
	const isPng = /\.png$/i.test(file)
	const compressed = isPng
		? await sharp(buffer).png({ palette: true, compressionLevel: 9, quality: 90 }).toBuffer()
		: await sharp(buffer).jpeg({ quality: 78, progressive: true, mozjpeg: true }).toBuffer()
	if (compressed.length >= before * 0.95)
		continue // 压缩收益不足 5% 就不重写，避免无谓的画质损失
	writeFileSync(file, compressed)
	savedTotal += before - compressed.length
	console.log(`${relative(imgDirPath, file)}: ${Math.round(before / 1024)}KB → ${Math.round(compressed.length / 1024)}KB`)
}

console.log(`完成，共节省 ${Math.round(savedTotal / 1024)}KB`)
