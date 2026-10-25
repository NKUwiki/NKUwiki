/**
 * 图片上传器的纯函数层：文件名清洗、文章编号分层解析、目录树构建、去重命名。
 *
 * 刻意不依赖任何 Cloudflare 类型，Node 侧的单元测试（tests/uploader-*.test.ts）
 * 直接 import 本文件验证核心规则；分层规则必须与主站 docs/public/img/ 的
 * 「栏目编号/文章编号/」两级结构保持一致，两边都改时需要同步评审。
 */

/** 现有图片目录里与文章无关的特殊前缀（作者头像等），上传 UI 的目录选择器不提供它 */
export const NON_ARTICLE_DIRS = ['authors'] as const

/** 目录/文件名段里禁止出现的字符（Windows 保留字符 + 路径分隔符；\p{Cc} 覆盖全部控制符） */
const FORBIDDEN = /[/\\:*?"<>|\p{Cc}]/gu

/**
 * 清洗上传文件名：保留中文名（图床链接与 docs/public/img 的现有命名一致），
 * 去掉路径分隔与非法字符、首尾的点和空格；清洗后为空则回退 unnamed。
 */
export function sanitizeFileName(name: string): string {
	// 只取最后一段：浏览器 File.name 一般没有路径，但拖拽/粘贴来源不可控
	const base = name.split(/[/\\]/).pop() ?? ''
	const cleaned = base.replace(FORBIDDEN, '').trim().replace(/^[.\s]+|[.\s]+$/g, '')
	return cleaned || 'unnamed'
}

/** 文件名按码元截断（R2 key 上限 1024 字节，给目录前缀留足余量） */
export function truncateFileName(name: string, maxChars = 120): string {
	return name.length <= maxChars ? name : `${name.slice(0, maxChars)}…`
}

/**
 * 归一并校验目标目录（如 '03/03'、'authors'），非法返回 null。
 * 规则：段不能为空 / . / .. / 下划线开头（下划线前缀是图床自身的 _pending、_meta），
 * 段内只允许 Unicode 字母数字与 . - _，且不以点或连字符开头。
 */
export function normalizeDir(dir: string): string | null {
	const segments = dir.trim().replace(/^\/+|\/+$/g, '').split('/').filter(Boolean)
	if (!segments.length)
		return null
	for (const segment of segments) {
		if (segment === '.' || segment === '..' || segment.startsWith('_'))
			return null
		if (!/^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u.test(segment))
			return null
	}
	return segments.join('/')
}

/**
 * 上传器只管理桶里 img/ 子树（键布局镜像 docs/public，站内引用 /img/... 与
 * CDN 链接一一对应）：目标目录统一补 img/ 前缀，幂等。空串归到 img/ 根。
 */
export function toManagedDir(dir: string): string | null {
	const trimmed = dir.trim()
	const clean = trimmed ? normalizeDir(trimmed) : ''
	if (clean === null)
		return null
	if (clean === '')
		return 'img'
	if (clean === 'img' || clean.startsWith('img/'))
		return clean
	return `img/${clean}`
}

/** docs 下文章源文件的编号分层解析结果 */
export interface ParsedArticlePath {
	groupCode: string
	groupName: string
	articleCode: string
	articleName: string
}

/**
 * 解析主站文章路径 → 图片目录层级：
 *   docs/05.校园生活/09.美食.md → { 05, 校园生活, 09, 美食 }，对应图片存 05/09/。
 * 只认「两位编号.名称」的两级 .md；README、下划线文件、深一层直通页都不是文章。
 */
export function parseArticleDocPath(path: string): ParsedArticlePath | null {
	const match = path.match(/^docs\/(\d{2})\.([^/]+)\/(\d{2})\.([^/]+)\.md$/)
	if (!match)
		return null
	return { groupCode: match[1], groupName: match[2], articleCode: match[3], articleName: match[4] }
}

/** 上传目录选择器用的目录树节点 */
export interface CatalogArticle {
	code: string
	name: string
	/** 对应图片目录：05/09 */
	dir: string
}

export interface CatalogGroup {
	code: string
	name: string
	children: CatalogArticle[]
}

/** 从仓库文件路径列表构建「栏目 → 文章」目录树（去重、按编号排序） */
export function buildCatalog(paths: string[]): CatalogGroup[] {
	const groups = new Map<string, CatalogGroup>()
	for (const path of paths) {
		const parsed = parseArticleDocPath(path)
		if (!parsed)
			continue
		let group = groups.get(parsed.groupCode)
		if (!group) {
			group = { code: parsed.groupCode, name: parsed.groupName, children: [] }
			groups.set(parsed.groupCode, group)
		}
		const dir = `${parsed.groupCode}/${parsed.articleCode}`
		if (!group.children.some(child => child.dir === dir))
			group.children.push({ code: parsed.articleCode, name: parsed.articleName, dir })
	}
	return [...groups.values()]
		.sort((a, b) => a.code.localeCompare(b.code))
		.map(group => ({ ...group, children: group.children.sort((a, b) => a.code.localeCompare(b.code)) }))
}

/**
 * 同目录同名但内容不同时的改名策略：插入内容哈希前 6 位。
 * 图.jpg + 新内容 → 图-a1b2c3.jpg，肉眼可辨、多次上传同一新图也稳定落到同一名字。
 */
export function dedupeTargetName(name: string, sha256: string): string {
	const dot = name.lastIndexOf('.')
	if (dot <= 0)
		return `${name}-${sha256.slice(0, 6)}`
	return `${name.slice(0, dot)}-${sha256.slice(0, 6)}${name.slice(dot)}`
}

/** 上传结果的判定：同名同内容复用（deduped）、同名不同内容改名（renamed）、直接入库（stored） */
export type StoreKind = 'stored' | 'deduped' | 'renamed'

/** 单文件 SHA-256（hex）。Workers 与 Node 19+ 的 globalThis.crypto 都提供 subtle */
export async function sha256Hex(data: ArrayBuffer): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', data)
	return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

/** base64 → 字节（上传请求体里的文件内容）。大文件分块避免 String.fromCharCode 爆栈 */
export function base64ToBytes(base64: string): Uint8Array {
	const binary = atob(base64)
	const bytes = new Uint8Array(binary.length)
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
	return bytes
}
