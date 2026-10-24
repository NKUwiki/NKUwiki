/**
 * 修复 workspace 包在根 node_modules 里的链接。
 *
 * 背景：pnpm 12（Rust 版）在无「开发者模式」符号链接权限的 Windows 环境下，
 * 创建 workspace 包链接会静默失败——只留下空目录，站点随即报
 * "Cannot find package '@nkuwiki/theme'"（2026-10-15 事故）。
 *
 * 本脚本在每次 pnpm install 的 postinstall 阶段自动跑一遍：
 * 逐个检查 node_modules/@nkuwiki/<包名> 的链接是否指向 packages/ 下的真实目录，
 * 缺失或指错就重建为 junction（免权限、跨终端可用）。幂等，可随时手动执行：
 *
 *   node scripts/fix-workspace-links.mjs
 */
import { existsSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packagesDir = join(repoRoot, 'packages')
const scopeDir = join(repoRoot, 'node_modules', '@nkuwiki')

let fixed = 0
let ok = 0
const failed = []

for (const dir of readdirSync(packagesDir)) {
	const pkgDir = join(packagesDir, dir)
	const manifest = join(pkgDir, 'package.json')
	if (!existsSync(manifest))
		continue
	const { name } = JSON.parse(readFileSync(manifest, 'utf8'))
	const shortName = name.replace('@nkuwiki/', '')
	const linkPath = join(scopeDir, shortName)

	let valid = false
	try {
		// realpath 会穿透 junction 到真实目录：两边一致才算链接有效
		valid = realpathSync(linkPath) === realpathSync(pkgDir)
	}
	catch {}

	if (valid) {
		ok++
		continue
	}

	// 单包失败不中断整个 postinstall：杀软/权限拦截一个链接就放弃全部，
	// 会让「能用的包也坏掉」并让 pnpm install 整体失败。汇总后统一报告、非零退出
	try {
		rmSync(linkPath, { recursive: true, force: true })
		symlinkSync(pkgDir, linkPath, 'junction')
		fixed++
		console.log(`[fix-workspace-links] 重建 ${name} -> packages/${dir}`)
	}
	catch (error) {
		failed.push(`${name}: ${error.message}`)
	}
}

console.log(`[fix-workspace-links] 检查完成：正常 ${ok} 个，重建 ${fixed} 个${failed.length ? `，失败 ${failed.length} 个` : ''}`)
if (failed.length) {
	for (const message of failed)
		console.error(`[fix-workspace-links] ${message}`)
	process.exitCode = 1
}
