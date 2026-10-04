import type { Author, AuthorLookup, Member } from '../types.ts'

const EMAIL_RE = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/

/**
 * 清理跳转链接：去引号包裹与首尾空白；裸邮箱自动补 `mailto:` 前缀。
 *
 * frontmatter 里常被引号包裹，也可能直接写邮箱地址；不是字符串或空串时返回空串。
 */
export function cleanLink(value: unknown): string {
	if (typeof value !== 'string')
		return ''
	const link = value.trim().replace(/^[“”"'<]+|[“”"'>]+$/g, '').trim()
	if (!link)
		return ''
	return EMAIL_RE.test(link) && !/^mailto:/i.test(link) ? `mailto:${link}` : link
}

/**
 * 清理邮箱：去掉 `mailto:` 前缀、引号包裹和首尾空白，只留裸邮箱做展示文本；
 * 不是合法邮箱（或不是字符串）时返回空串。
 */
export function cleanEmail(value: unknown): string {
	if (typeof value !== 'string')
		return ''
	const email = value.trim().replace(/^mailto:/i, '').replace(/^[“”"'<]+|[“”"'>]+$/g, '').trim()
	return EMAIL_RE.test(email) ? email : ''
}

function escapeXml(value: string): string {
	return value.replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`)
}

/** 没有可用头像时的本地兜底图：姓名首字 + 由姓名决定的稳定色相，不依赖任何外部服务。 */
export function initialsAvatar(name: string): string {
	const trimmed = name.trim()
	const initial = [...trimmed][0] || '?'
	let hue = 0
	for (const char of trimmed)
		hue = (hue * 31 + (char.codePointAt(0) || 0)) % 360
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="32" fill="hsl(${hue} 45% 62%)"/><text x="32" y="32" fill="#fff" font-family="system-ui,sans-serif" font-size="28" text-anchor="middle" dominant-baseline="central">${escapeXml(initial)}</text></svg>`
	return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

/** frontmatter 里一位作者的原始声明：名字必填，其余字段可省略。 */
export interface RawAuthor {
	name: string
	link?: string
	contact?: string
	email?: string
	avatar?: string
	github?: string
}

/**
 * 把 frontmatter 的 `author` 归一化成作者列表。
 *
 * 支持两种写法，可以混用：
 *
 * ```yaml
 * # 只写名字：GitHub、头像、联系方式按名字到注入的成员表里查
 * author: [Cure, NKUwiki-Group]
 *
 * # 对象写法：不进成员文件的客串作者就地补字段，写了的会覆盖成员文件里的同名信息
 * author:
 *   - name: 客串作者
 *     github: someones
 *     avatar: https://img.example.com/avatar.png
 *     link: https://blog.example.com
 *     contact: QQ：123456789
 *     email: guest@example.com
 * ```
 *
 * `name` 必填（字符串元素本身就是名字），缺了整条忽略。
 * `contact` 没写时悬停标签依次回退显示 GitHub 用户名、邮箱（见 resolveAuthor）。
 */
export function frontmatterAuthors(value: unknown): RawAuthor[] {
	if (!Array.isArray(value))
		return []
	const authors: RawAuthor[] = []
	for (const item of value) {
		if (typeof item === 'string') {
			const name = item.trim()
			if (name)
				authors.push({ name })
			continue
		}
		if (!item || typeof item !== 'object')
			continue
		const { name, link, contact, email, avatar, github } = item as Record<string, unknown>
		const displayName = typeof name === 'string' ? name.trim() : ''
		if (!displayName)
			continue
		authors.push({
			name: displayName,
			link: cleanLink(link) || undefined,
			contact: typeof contact === 'string' && contact.trim() ? contact.trim() : undefined,
			email: cleanEmail(email) || undefined,
			avatar: typeof avatar === 'string' && avatar.trim() ? avatar.trim() : undefined,
			github: typeof github === 'string' && github.trim() ? github.trim() : undefined,
		})
	}
	return authors
}

/**
 * 合并成员表信息，补全展示字段。
 *
 * - 跳转链接 `link`：frontmatter > members > GitHub 个人页；
 * - 悬停标签 `contact`：显式 contact（frontmatter > members）> GitHub 用户名 > 邮箱，
 *   全都没有时悬停不弹；
 * - 头像 `avatar`：显式链接（frontmatter > members）> GitHub 头像（`github.com/<用户名>.png`）> 首字母兜底图。
 */
function resolveAuthor(raw: RawAuthor, lookup: AuthorLookup): Author {
	const member: Member | undefined = lookup.members[raw.name]
	const github = raw.github || member?.github || ''
	const email = cleanEmail(raw.email || member?.email)
	const link = raw.link || member?.link || (github ? `https://github.com/${github}` : undefined)
	const fallback = initialsAvatar(raw.name)
	const avatar = raw.avatar || member?.avatar || (github ? `https://github.com/${github}.png` : '') || fallback
	return {
		name: raw.name,
		link,
		contact: raw.contact || member?.contact || github || email || undefined,
		avatar,
		fallback,
	}
}

/**
 * 汇总一篇文章的作者：只取 frontmatter 声明的 `author`（纯名字或对象），
 * 没有声明时回退到 lookup.fallbackName 指定的组织账号。
 *
 * 成员表由站点侧注入（AuthorLookup），本模块不感知任何站点数据。
 */
export function collectAuthors(author: unknown, lookup: AuthorLookup): Author[] {
	const authors = frontmatterAuthors(author).map(raw => resolveAuthor(raw, lookup))
	return authors.length ? authors : [resolveAuthor({ name: lookup.fallbackName }, lookup)]
}
