import assert from 'node:assert/strict'
import test from 'node:test'
import { cleanEmail, cleanLink, collectAuthors, frontmatterAuthors, initialsAvatar } from '../packages/wiki-theme/lib/data/authors.ts'

test('frontmatter author 支持纯名字与对象写法，可混用', () => {
	const authors = frontmatterAuthors([
		'Cure',
		{
			name: '示例作者',
			link: 'https://blog.example.com',
			contact: 'QQ：123456789',
			email: 'author@example.com',
			avatar: 'https://img.example.com/avatar.png',
			github: 'someone',
		},
	])
	assert.deepEqual(authors.map(author => author.name), ['Cure', '示例作者'])
	assert.equal(authors[0].link, undefined)
	assert.equal(authors[1].link, 'https://blog.example.com')
	assert.equal(authors[1].contact, 'QQ：123456789')
	assert.equal(authors[1].email, 'author@example.com')
	assert.equal(authors[1].avatar, 'https://img.example.com/avatar.png')
	assert.equal(authors[1].github, 'someone')
	// email 兼容 mailto: 写法，非法邮箱被忽略
	assert.equal(frontmatterAuthors([{ name: '旧作者', email: 'mailto:author@example.com' }])[0].email, 'author@example.com')
	assert.equal(frontmatterAuthors([{ name: '旧作者', email: 'https://github.com/NKUwiki' }])[0].email, undefined)
	// 空白名字、缺 name、非数组元素等一律忽略；空白 contact 等于没填，作者保留
	const blankContact = frontmatterAuthors([{ name: '作者', contact: '   ' }])
	assert.deepEqual(blankContact.map(author => author.name), ['作者'])
	assert.equal(blankContact[0].contact, undefined)
	assert.deepEqual(frontmatterAuthors(['   ', { link: 'mailto:a@b.com' }, 42, ['甲'], null]), [])
	assert.deepEqual(frontmatterAuthors(null), [])
	assert.deepEqual(frontmatterAuthors('Cure'), [])
})

test('cleanLink 兼容引号包裹、mailto 与裸邮箱', () => {
	assert.equal(cleanLink('“author@example.com”'), 'mailto:author@example.com')
	assert.equal(cleanLink(' mailto:author@example.com '), 'mailto:author@example.com')
	assert.equal(cleanLink(' https://github.com/NKUwiki '), 'https://github.com/NKUwiki')
	// 裸邮箱自动补 mailto: 前缀；非字符串返回空串
	assert.equal(cleanLink('admin@nankai.edu.cn'), 'mailto:admin@nankai.edu.cn')
	assert.equal(cleanLink(42), '')
	assert.equal(cleanLink(undefined), '')
})

test('cleanEmail 只留裸邮箱做展示文本', () => {
	assert.equal(cleanEmail('“author@example.com”'), 'author@example.com')
	assert.equal(cleanEmail(' mailto:author@example.com '), 'author@example.com')
	assert.equal(cleanEmail('author@example.com'), 'author@example.com')
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

test('collectAuthors 按名字查成员表并遵守头像优先级', () => {
	// 成员表里的 Cure：头像走 GitHub，link 默认个人页，contact 显式给出
	const cure = collectAuthors(['Cure'])[0]
	assert.equal(cure.avatar, 'https://github.com/Cure2004.png')
	assert.equal(cure.link, 'https://github.com/Cure2004')
	assert.equal(cure.contact, '1352862815@qq.com')
	assert.equal(cure.fallback.startsWith('data:image/svg+xml'), true)

	// frontmatter 显式字段覆盖成员表，contact 未写时沿用成员表
	const custom = collectAuthors([{ name: 'Cure', avatar: 'https://img.example.com/me.png', link: 'https://example.com' }])[0]
	assert.equal(custom.avatar, 'https://img.example.com/me.png')
	assert.equal(custom.link, 'https://example.com')
	assert.equal(custom.contact, '1352862815@qq.com')

	// 悬停标签回退链：contact > GitHub 用户名 > 邮箱
	assert.equal(collectAuthors([{ name: '甲', contact: 'QQ：123', github: 'someone', email: 'a@b.com' }])[0].contact, 'QQ：123')
	assert.equal(collectAuthors([{ name: '甲', github: 'someone', email: 'a@b.com' }])[0].contact, 'someone')
	assert.equal(collectAuthors([{ name: '甲', email: 'a@b.com' }])[0].contact, 'a@b.com')
	assert.equal(collectAuthors([{ name: '甲', email: 'mailto:a@b.com' }])[0].contact, 'a@b.com')

	// 成员表里只有 github 的成员：头像用 GitHub，link 默认个人页，悬停标签回退成 GitHub 用户名
	const org = collectAuthors(['NKUwiki-Group'])[0]
	assert.equal(org.avatar, 'https://github.com/NKUwiki.png')
	assert.equal(org.link, 'https://github.com/NKUwiki')
	assert.equal(org.contact, 'NKUwiki')

	// 不在成员表又没补字段的作者：首字母兜底头像，不可点击、不弹标签
	const guest = collectAuthors([{ name: '客串作者' }])[0]
	assert.equal(guest.avatar, guest.fallback)
	assert.equal(guest.link, undefined)
	assert.equal(guest.contact, undefined)

	// 完全没写 author 时回退组织账号
	const fallback = collectAuthors(undefined)[0]
	assert.equal(fallback.name, 'NKUwiki-Group')
	assert.equal(fallback.avatar, 'https://github.com/NKUwiki.png')
})
