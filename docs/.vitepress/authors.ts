import type { Author } from './types.ts'
import { repoUrl } from './site.ts'

const EMAIL_RE = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/

/**
 * 清理邮箱：去掉 `mailto:` 前缀、引号包裹和首尾空白；不是合法邮箱时返回空串。
 *
 * frontmatter 里常用 `mailto:` 表示联系方式，邮箱也可能被引号包裹。
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

/** 没有显式头像时使用的本地兜底图：姓名首字 + 由姓名决定的稳定色相，不依赖任何外部服务。 */
export function initialsAvatar(name: string): string {
	const trimmed = name.trim()
	const initial = [...trimmed][0] || '?'
	let hue = 0
	for (const char of trimmed)
		hue = (hue * 31 + (char.codePointAt(0) || 0)) % 360
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="32" fill="hsl(${hue} 45% 62%)"/><text x="32" y="32" fill="#fff" font-family="system-ui,sans-serif" font-size="28" text-anchor="middle" dominant-baseline="central">${escapeXml(initial)}</text></svg>`
	return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

/**
 * 把 frontmatter 的 `author` 归一化成作者列表。
 *
 * 只支持一种写法：数组，元素是 `{ name, email, avatar }` 对象。
 *
 * ```
 * author:
 *   - name: 示例作者
 *     email: mailto:author@example.com
 *   - name: 示例编者
 *     email: editor@example.com
 *     avatar: https://img.example.com/avatar.png
 * ```
 *
 * `name` 必填（缺了整条忽略）；`email` 可直接写邮箱或写成 `mailto:`；`avatar` 是图片地址。
 * 字符串、单个对象、数组里的字符串元素都不再支持，会被忽略。
 */
export function frontmatterAuthors(value: unknown): Author[] {
	if (!Array.isArray(value))
		return []
	const authors: Author[] = []
	for (const item of value) {
		if (!item || typeof item !== 'object')
			continue
		const { name, email, avatar } = item as Record<string, unknown>
		const displayName = typeof name === 'string' ? name.trim() : ''
		if (!displayName)
			continue
		authors.push({
			name: displayName,
			email: cleanEmail(email) || undefined,
			avatar: typeof avatar === 'string' && avatar.trim() ? avatar.trim() : undefined,
		})
	}
	return authors
}

/** 补全展示用字段：邮箱规范化、头像与本地首字兜底图。 */
function resolveAuthor(author: Author): Author {
	const fallback = initialsAvatar(author.name)
	return {
		name: author.name,
		email: cleanEmail(author.email) || undefined,
		url: author.url?.trim() || undefined,
		avatar: author.avatar || fallback,
		fallback,
	}
}

/** 汇总一篇文章的作者：只取 frontmatter 声明的 `author`，没有声明时回退到组织账号。 */
export function collectAuthors(author: unknown): Author[] {
	const authors = frontmatterAuthors(author).map(resolveAuthor)
	return authors.length ? authors : [resolveAuthor({ name: 'NKUwiki-Group', url: repoUrl })]
}
