import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'
import test from 'node:test'
import { collectAuthors, frontmatterAuthors, gitAuthors, githubLogin, initialsAvatar, mergeAuthors, normalizeEmail, parseGitLog } from '../docs/.vitepress/authors.ts'

function hasGit(): boolean {
	try {
		execFileSync('git', ['--version'], { stdio: 'ignore' })
		return true
	}
	catch {
		return false
	}
}

/** 模拟 `git log --pretty=format:\x1e%an\x1f%ae --name-only` 的一段输出。 */
function commit(name: string, email: string, ...files: string[]): string {
	return `\u001E${name}\u001F${email}\n${files.join('\n')}\n`
}

test('frontmatter author 支持字符串、对象与数组写法', () => {
	// 一个字符串就是一个作者的名字，不再按空格或顿号切分
	assert.deepEqual(frontmatterAuthors('示例作者').map(author => author.name), ['示例作者'])
	assert.deepEqual(frontmatterAuthors('示例作者 NKUwiki-Group').map(author => author.name), ['示例作者 NKUwiki-Group'])
	assert.deepEqual(frontmatterAuthors(['示例作者', 'Liu']).map(author => author.name), ['示例作者', 'Liu'])
	const authors = frontmatterAuthors([
		{ name: '示例编者', email: 'editor@example.com' },
		{ name: '示例作者', email: 'mailto:author@example.com', avatar: 'https://img.example.com/avatar.png' },
	])
	assert.deepEqual(authors.map(author => author.name), ['示例编者', '示例作者'])
	assert.equal(authors[0].email, 'editor@example.com')
	assert.equal(authors[0].avatar, undefined)
	assert.equal(authors[1].email, 'author@example.com')
	assert.equal(authors[1].avatar, 'https://img.example.com/avatar.png')
	// 单个对象写法
	assert.deepEqual(frontmatterAuthors({ name: '示例作者' }).map(author => author.name), ['示例作者'])
	// 缺 name、链接、数字、嵌套数组、null 等一律忽略
	assert.deepEqual(frontmatterAuthors([{ link: 'mailto:a@b.com' }, 42, ['甲'], null]), [])
	assert.deepEqual(frontmatterAuthors(null), [])
	assert.equal(frontmatterAuthors([{ name: '示例作者', link: 'mailto:author@example.com' }])[0].email, undefined)
})

test('parseGitLog 按文件累计提交次数，跳过合并提交与目录外文件', () => {
	const output = [
		commit('示例作者', '“12345678+ExampleUser@users.noreply.github.com”', 'docs/02.专题/06.文章.md', 'docs/index.md'),
		commit('示例作者', '12345678+ExampleUser@users.noreply.github.com', 'docs/02.专题/06.文章.md'),
		commit('示例编者', 'editor@example.com', 'docs/02.专题/06.文章.md'),
		commit('Merge Bot', 'bot@example.com'),
		commit('Repo Owner', 'owner@example.com', 'package.json'),
	].join('')
	const authors = parseGitLog(output, 'docs')
	assert.deepEqual(authors.get('02.专题/06.文章.md')?.map(author => [author.name, author.email, author.commits]), [
		['示例作者', '12345678+ExampleUser@users.noreply.github.com', 2],
		['示例编者', 'editor@example.com', 1],
	])
	assert.deepEqual(authors.get('index.md')?.map(author => author.name), ['示例作者'])
	assert.equal(authors.has('package.json'), false)
	assert.equal(authors.has('README.md'), false)
})

test('mergeAuthors 按邮箱或姓名去重，frontmatter 作者优先且头像逐级回退', () => {
	const authors = mergeAuthors(
		frontmatterAuthors([
			{ name: '示例作者', email: 'author@example.com' },
			{ name: '示例贡献者', avatar: 'https://img.example.com/contributor.png' },
		]),
		[
			{ name: '示例作者', email: '12345678+ExampleUser@users.noreply.github.com', commits: 12, origin: 'git' },
			{ name: 'ExampleUser', email: 'author@example.com', commits: 3, origin: 'git' },
			{ name: '示例乙', email: '87654321+ExampleDev@users.noreply.github.com', commits: 5, origin: 'git' },
			{ name: 'DevUser', email: 'dev@example.com', commits: 2, origin: 'git' },
			{ name: '示例甲', commits: 1, origin: 'git' },
		],
	)
	// 姓名相同（两个示例作者）与邮箱相同（示例作者 ↔ ExampleUser）都会并成一条
	assert.deepEqual(authors.map(author => author.name), ['示例作者', '示例贡献者', '示例乙', 'DevUser', '示例甲'])
	assert.equal(authors[0].commits, 15)
	assert.equal(authors[0].email, 'author@example.com')
	assert.match(authors[0].avatar!, /^https:\/\/gravatar\.com\/avatar\/[0-9a-f]{32}\?d=identicon&s=80$/)
	assert.equal(authors[1].avatar, 'https://img.example.com/contributor.png')
	assert.equal(authors[2].avatar, 'https://github.com/ExampleDev.png?size=80')
	assert.match(authors[3].avatar!, /^https:\/\/gravatar\.com\/avatar\/[0-9a-f]{32}\?d=identicon&s=80$/)
	assert.equal(authors[4].avatar, authors[4].fallback)
	assert.ok(authors[4].avatar!.startsWith('data:image/svg+xml'))
})

test('邮箱与 GitHub 用户名识别兼容引号、mailto 和主页链接', () => {
	assert.equal(normalizeEmail('“editor@example.com”'), 'editor@example.com')
	assert.equal(normalizeEmail('mailto:editor@example.com'), 'editor@example.com')
	assert.equal(normalizeEmail(' https://github.com/NKUwiki '), '')
	assert.equal(githubLogin('12345678+ExampleUser@users.noreply.github.com'), 'ExampleUser')
	assert.equal(githubLogin('ExampleUser@users.noreply.github.com'), 'ExampleUser')
	assert.equal(githubLogin('https://github.com/NKUwiki/NKUwiki'), 'NKUwiki')
	assert.equal(githubLogin('mailto:editor@example.com'), '')
	assert.equal(initialsAvatar('示例作者'), initialsAvatar('示例作者'))
	assert.notEqual(initialsAvatar('示例作者'), initialsAvatar('示例编者'))
})

test('两个来源都没有作者时回退到 NKUwiki-Group 组织账号', () => {
	const [fallback] = collectAuthors('01.专题/未提交.md', undefined, join(tmpdir(), 'nku-authors-missing'))
	assert.equal(fallback.name, 'NKUwiki-Group')
	assert.equal(fallback.url, 'https://github.com/NKUwiki/NKUwiki')
	assert.equal(fallback.avatar, 'https://github.com/NKUwiki.png?size=80')
})

test('gitAuthors 读取仓库历史，collectAuthors 与 frontmatter 作者合并', { skip: !hasGit() }, () => {
	const root = mkdtempSync(join(tmpdir(), 'nku-authors-'))
	try {
		const docs = join(root, 'docs')
		const file = join(docs, '01.专题/01.文章.md')
		mkdirSync(join(docs, '01.专题'), { recursive: true })
		const run = (args: string[]) => execFileSync('git', ['-C', root, ...args], { stdio: 'ignore' })
		const commitAs = (name: string, email: string, message: string) => run(['-c', `user.name=${name}`, '-c', `user.email=${email}`, 'commit', '-m', message])
		writeFileSync(file, '# 文章\n')
		run(['init', '--initial-branch=main'])
		run(['add', '.'])
		commitAs('甲', 'jia@example.com', '第一篇')
		writeFileSync(file, '# 文章\n\n补充\n')
		run(['add', '.'])
		commitAs('乙', 'yi@example.com', '第二篇')
		writeFileSync(file, '# 文章\n\n补充\n\n再补充\n')
		run(['add', '.'])
		commitAs('甲', 'jia@example.com', '第三篇')

		const authors = gitAuthors(docs).get('01.专题/01.文章.md') ?? []
		assert.deepEqual(authors.map(author => [author.name, author.commits]), [['甲', 2], ['乙', 1]])

		const merged = collectAuthors('01.专题/01.文章.md', [{ name: '甲', email: 'jia@example.com' }], docs)
		assert.deepEqual(merged.map(author => author.name), ['甲', '乙'])
		assert.equal(merged[0].commits, 2)
		assert.equal(merged[0].email, 'jia@example.com')
		assert.equal(merged[0].origin, 'frontmatter')
		assert.equal(merged[1].origin, 'git')
		assert.ok(merged[1].fallback!.startsWith('data:image/svg+xml'))
		assert.deepEqual(collectAuthors('01.专题/02.不存在.md', [{ name: '凝雨' }], docs).map(author => author.name), ['凝雨'])
	}
	finally {
		const target = relative(tmpdir(), root)
		assert.ok(target && !target.startsWith('..') && !isAbsolute(target))
		rmSync(root, { recursive: true, force: true })
	}
})
