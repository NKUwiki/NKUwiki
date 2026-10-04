/**
 * 站点成员信息：文章 frontmatter 的 `author` 只写名字，其余信息按名字在这里查。
 *
 * 本文件属于站点数据（含联系方式等站点资产），不随主题包分发；
 * 字段格式与虚拟示例见主题包内的 members.example.ts。
 *
 * 字段都可以省略：省略 github 时没有 GitHub 头像与个人页；省略 link 时胶囊默认跳
 * GitHub 个人页（没有 github 就不可点击）；悬停标签按 contact > GitHub 用户名 > email 取值。
 */
import type { Member } from '@nkuwiki/theme/lib/types.ts'

export const members: Record<string, Member> = {
	Cure: { github: 'Cure2004', contact: '1352862815@qq.com' },
	hht421: { github: 'hht421' },
}

/**
 * frontmatter 未声明 author 时的兜底显示名。有意不指向上面任何条目：
 * 未署名文章只显示这个裸名字（无 GitHub、无头像、不可点击），
 * 鼓励作者在 frontmatter 里署名。
 */
export const fallbackAuthor = 'NKUwiki-Group'
