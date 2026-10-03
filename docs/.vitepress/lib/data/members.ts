/**
 * 站点成员信息：文章 frontmatter 的 `author` 只写名字，其余信息按名字在这里查。
 *
 * ```
 * export const members: Record<string, Member> = {
 * 	'展示名': { github: 'GitHub 用户名', avatar: '图片链接', link: '跳转链接', contact: '联系方式', email: '邮箱' },
 * }
 * ```
 *
 * 字段都可以省略：省略 github 时没有 GitHub 头像与个人页；省略 link 时胶囊默认跳
 * GitHub 个人页（没有 github 就不可点击）；悬停标签按 contact > GitHub 用户名 > email 取值。
 */

export interface Member {
	/** GitHub 用户名：头像兜底用 `github.com/<用户名>.png`，也是胶囊默认的跳转目标 */
	github?: string
	/** 显式头像图片链接，优先级高于 GitHub 头像 */
	avatar?: string
	/** 点击作者胶囊时打开的链接；不填默认 GitHub 个人页 */
	link?: string
	/** 联系方式标签：悬停作者胶囊时展示的纯文本，如 QQ、微信；不填时回退显示 GitHub 用户名、邮箱 */
	contact?: string
	/** 联系邮箱：contact 的兜底之一；写 `a@b.com` 或 `mailto:a@b.com` 都行 */
	email?: string
}

export const members: Record<string, Member> = {
	// 组织账号：文章没写 author 时的兜底作者
	'NKUwiki-Group': { github: 'NKUwiki' },
	'Cure': { github: 'Cure2004', contact: '1352862815@qq.com' },
}
