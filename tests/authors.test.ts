import assert from 'node:assert/strict'
import test from 'node:test'
import { cleanEmail, collectAuthors, frontmatterAuthors, initialsAvatar } from '../docs/.vitepress/authors.ts'

test('frontmatter author 只支持对象数组写法', () => {
	const authors = frontmatterAuthors([
		{ name: '示例编者', email: 'editor@example.com' },
		{ name: '示例作者', email: 'mailto:author@example.com', avatar: 'https://img.example.com/avatar.png' },
	])
	assert.deepEqual(authors.map(author => author.name), ['示例编者', '示例作者'])
	assert.equal(authors[0].email, 'editor@example.com')
	assert.equal(authors[0].avatar, undefined)
	assert.equal(authors[1].email, 'author@example.com')
	assert.equal(authors[1].avatar, 'https://img.example.com/avatar.png')
	// 字符串、单个对象、名字字符串元素、缺 name、链接、数字等一律忽略
	assert.deepEqual(frontmatterAuthors('示例作者'), [])
	assert.deepEqual(frontmatterAuthors({ name: '示例作者' }), [])
	assert.deepEqual(frontmatterAuthors(['示例作者', 'Liu']), [])
	assert.deepEqual(frontmatterAuthors([{ link: 'mailto:a@b.com' }, 42, ['甲'], null]), [])
	assert.deepEqual(frontmatterAuthors(null), [])
	assert.equal(frontmatterAuthors([{ name: '示例作者', link: 'mailto:author@example.com' }])[0].email, undefined)
})

test('cleanEmail 兼容 mailto、引号包裹与非法值', () => {
	assert.equal(cleanEmail('“editor@example.com”'), 'editor@example.com')
	assert.equal(cleanEmail(' mailto:editor@example.com '), 'editor@example.com')
	assert.equal(cleanEmail('admin@nankai.edu.cn'), 'admin@nankai.edu.cn')
	// 主页链接、非字符串、缺域名等一律返回空串
	assert.equal(cleanEmail(' https://github.com/NKUwiki '), '')
	assert.equal(cleanEmail(42), '')
	assert.equal(cleanEmail(undefined), '')
})

test('initialsAvatar 由姓名决定且稳定', () => {
	assert.equal(initialsAvatar('示例作者'), initialsAvatar('示例作者'))
	assert.notEqual(initialsAvatar('示例作者'), initialsAvatar('示例编者'))
	assert.ok(initialsAvatar('示例作者').startsWith('data:image/svg+xml'))
	// 空名字也要有可用的图（首字回退成 ?）
	assert.ok(initialsAvatar('   ').startsWith('data:image/svg+xml'))
})

test('collectAuthors 只按 frontmatter 声明，缺省时回退组织账号', () => {
	const authors = collectAuthors([
		{ name: '示例作者', email: 'author@example.com' },
		{ name: '示例贡献者', avatar: 'https://img.example.com/contributor.png' },
	])
	assert.deepEqual(authors.map(author => author.name), ['示例作者', '示例贡献者'])
	assert.equal(authors[0].email, 'author@example.com')
	assert.equal(authors[0].url, undefined)
	// 没有显式 avatar 时用姓名首字本地头像，不请求任何远程头像服务
	assert.equal(authors[0].avatar, initialsAvatar('示例作者'))
	assert.equal(authors[0].avatar, authors[0].fallback)
	assert.equal(authors[1].avatar, 'https://img.example.com/contributor.png')

	const [fallback] = collectAuthors(undefined)
	assert.equal(fallback.name, 'NKUwiki-Group')
	assert.equal(fallback.url, 'https://github.com/NKUwiki/NKUwiki')
	assert.equal(fallback.avatar, initialsAvatar('NKUwiki-Group'))
})
