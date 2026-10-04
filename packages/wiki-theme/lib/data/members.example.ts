/**
 * 成员表格式示例（虚拟数据，不可直接使用）。
 *
 * 作者解析不内置任何站点成员：站点侧提供数据文件（如 docs/.vitepress/data/members.ts），
 * 在 config.mts 里通过 AuthorLookup 传给 collectAuthors：
 *
 *   import { members, fallbackAuthor } from './data/members.ts'
 *
 *   page.frontmatter.authors = collectAuthors(page.frontmatter.author, {
 *     members,
 *     fallbackName: fallbackAuthor,
 *   })
 *
 * 条目结构（`Member` 接口在 @nkuwiki/theme/lib/types.ts）：
 *
 *   export const members: Record<string, Member> = {
 *     '展示名': { github: 'GitHub 用户名', avatar: '图片链接', link: '跳转链接', contact: '联系方式', email: '邮箱' },
 *   }
 *
 * 字段都可以省略：省略 github 时没有 GitHub 头像与个人页；省略 link 时胶囊默认跳
 * GitHub 个人页（没有 github 就不可点击）；悬停标签按 contact > GitHub 用户名 > email 取值。
 */
import type { Member } from '../types.ts'

export const members: Record<string, Member> = {
	// 组织账号：文章没写 author 时的兜底作者（键含连字符，引号不可省）
	'Org-Account': { github: 'your-org' },
	'示例成员': { github: 'someone', contact: 'QQ：123456789' },
}

/** frontmatter 未声明 author 时的兜底组织账号名，必须能在上面 members 里查到 */
export const fallbackAuthor = 'Org-Account'
