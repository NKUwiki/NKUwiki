// 构建期为每篇文档生成 Git 提交历史（docs/.vitepress/history.json），
// 供 config.transformPageData 按页注入、主题的「页面历史」组件（theme/components/GitHistory.vue）渲染。
// 使用 git log --follow 追踪跨改名/跨目录移动的历史；键为相对 docs 的文档路径。
//
// 带缓存：以 HEAD 哈希为键。HEAD 没变时 git 历史不可能变化，直接复用上次的
// history.json 跳过全量扫描（150 个文件 × 每次 git spawn ≈ 30-40s）；
// 提交或切换分支后自动全量重建。工作区未提交的改动不影响 git log 结果。
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const docsDir = resolve(__dirname, '..', '..')
const repoRoot = resolve(__dirname, '..', '..', '..')
const outPath = resolve(__dirname, '..', 'history.json')
const mappingPath = resolve(__dirname, 'contributors-mapping.json')
const cachePath = resolve(__dirname, 'gen-history.cache.json')

const COMMIT_SEP = '\u001E'
const FIELD_SEP = '\u001F'
const MAX_BUFFER = 64 * 1024 * 1024

/** 与 activity.ts 的 ignored 规则保持一致：这些文件被 srcExclude 排除、永不构建 */
function isExcluded(relPath) {
	return relPath.startsWith('activity/')
}

function walkMdFiles(dir) {
	const files = []
	for (const entry of readdirSync(dir)) {
		if (entry.startsWith('.'))
			continue
		const full = resolve(dir, entry)
		if (statSync(full).isDirectory()) {
			if (entry === 'node_modules')
				continue
			files.push(...walkMdFiles(full))
		}
		else if (extname(entry) === '.md') {
			const relPath = relative(docsDir, full).replaceAll('\\', '/')
			if (!isExcluded(relPath))
				files.push(relPath)
		}
	}
	return files
}

/**
 * 从 GitHub noreply 邮箱提取用户名；其余邮箱与姓名靠 contributors-mapping.json 兜底。
 *  注意：Cure 的 GitHub 归属在本 mapping 与 lib/data/members.ts 各有一份（前者供提交
 *  归属、后者供作者胶囊），改动时两处同步。
 */
function resolveGithub(email, author, mapping) {
	const noreply = email.match(/^(?:\d+\+)?([^@]+)@users\.noreply\.github\.com$/)
	if (noreply)
		return noreply[1]
	const mapped = mapping[email] ?? mapping[author]
	if (typeof mapped === 'string')
		return mapped
	if (mapped && typeof mapped === 'object' && typeof mapped.github === 'string')
		return mapped.github
	return null
}

function getHistory(repoPath, mapping) {
	try {
		const output = execFileSync(
			'git',
			['log', '--follow', `--format=%h%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f${COMMIT_SEP}`, '--', repoPath],
			{ encoding: 'utf-8', cwd: repoRoot, maxBuffer: MAX_BUFFER },
		)
		return output
			.split(COMMIT_SEP)
			.map(chunk => chunk.replace(/^\r?\n/, '').trimEnd())
			.filter(Boolean)
			.map((chunk) => {
				const [hash, author, email, date, message] = chunk.split(FIELD_SEP)
				return { hash, message, author, github: resolveGithub(email, author, mapping), date }
			})
	}
	catch {
		return []
	}
}

function main() {
	if (!existsSync(resolve(repoRoot, '.git'))) {
		writeFileSync(outPath, '{}')
		console.log('未检测到 git 仓库，已生成空的页面历史数据')
		return
	}

	// 缓存命中：HEAD 与 contributors-mapping.json 都没变时直接复用上次结果
	const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf-8', cwd: repoRoot }).trim()
	const mappingSig = existsSync(mappingPath) ? statSync(mappingPath).mtimeMs : 0
	const cache = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf-8')) : {}
	if (cache.head === head && cache.mappingSig === mappingSig && existsSync(outPath)) {
		console.log(`git 历史未变化（HEAD ${head.slice(0, 8)}），复用已有页面历史数据`)
		return
	}

	const mapping = existsSync(mappingPath) ? JSON.parse(readFileSync(mappingPath, 'utf-8')) : {}
	const history = {}
	for (const file of walkMdFiles(docsDir)) {
		const commits = getHistory(`docs/${file}`, mapping)
		if (commits.length > 0)
			history[file] = commits
	}

	writeFileSync(outPath, `${JSON.stringify(history, null, '\t')}\n`)
	writeFileSync(cachePath, `${JSON.stringify({ head, mappingSig })}\n`)
	console.log(`已生成 ${Object.keys(history).length} 篇文档的页面历史数据（HEAD ${head.slice(0, 8)}）`)
}

main()
