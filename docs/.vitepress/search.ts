import type { SearchDoc, SearchSection } from './searchCore.ts'
// 构建期搜索索引：扫描全部条目，抽取标题、章节与正文纯文本，生成 SearchDoc[]。
// 客户端经 search.data.ts 懒加载这份数据，再用 MiniSearch + searchCore 的分词建索引。
import type { Article } from './types.ts'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import matter from 'gray-matter'
import { docsRoot, scanArticles } from './catalog.ts'

/** 单篇正文截断上限：足够覆盖最长条目，防止个别超大页面撑爆索引体积。 */
const MAX_TEXT_LENGTH = 20000

/** 去掉围栏代码块的标记行（保留代码内容本身，命令等也是可搜内容）。 */
const FENCE_LINE = /^[ \t]*(?:```|~~~)[^\n]*$/gm

/** 行内元素清理：链接取文字、图片与裸链接丢弃、HTML 标签剥离、强调与行内代码去标记。 */
function stripInline(line: string): string {
	return line
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/`([^`]*)`/g, '$1')
		.replace(/!\[[^\]]*\]\([^)]*\)/g, '')
		.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1')
		.replace(/^\s*\[[^\]]+\]:\s*\S+\s*$/g, '')
		.replace(/https?:\/\/\S+/g, '')
		.replace(/<\/?[a-z][^>]*>/gi, '')
		.replace(/(\*\*|\*|__|_|~~)/g, '')
		.replace(/\$\$?([^$]*)\$\$?/g, '$1')
		.trim()
}

/** 表格行 → 单元格文字；对齐行（| :---: |）整行丢弃。 */
function stripTableRow(line: string): string {
	if (/^[\s:|-]+$/.test(line))
		return ''
	return line.replace(/\|/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * markdown → 纯正文 + 章节目录。
 * markmap 块整体跳过；::: 容器只去标记、保留内部内容（cardlist 表格里的群名、备注因此可搜）。
 * sections 记录每个标题在最终纯文本中的偏移，供结果摘要标注所在章节与跳转定位。
 */
export function extractBody(content: string): { text: string, sections: SearchSection[] } {
	const prepared = content
		.replace(/^:::markmap[^\S\n]*\n[\s\S]*?^:::[^\S\n]*$/gm, '')
		.replace(/^[ \t]*:::.*$/gm, '')
		.replace(FENCE_LINE, '')
	const lines = prepared.split(/\r?\n/)
	const sections: SearchSection[] = []
	let text = ''
	for (const line of lines) {
		const heading = line.match(/^[ \t]{0,3}(#{1,6})[ \t]+(\S.*)$/)
		if (heading) {
			// 行尾的闭合 # 序列不属于标题文字
			const title = stripInline(heading[2].replace(/[ \t]+#+$/, ''))
			sections.push({ t: title, o: text.length })
			// 标题文本本身也计入正文：偏移可自洽回取，章节名同样可被搜到
			text += `${title}\n`
			continue
		}
		// 列表标记只去符号（标题的编号要保留，跳转定位依赖它与渲染后的标题文本一致）
		const cleaned = stripInline(
			/^\s*>/.test(line)
				? line.replace(/^\s*>\s?/, '')
				: /^\s*\|/.test(line)
					? stripTableRow(line)
					: line.replace(/^(\s*)([-*+]|\d+[.)])(\s+)/, '$1$3'),
		)
		if (!cleaned)
			continue
		if (text.length >= MAX_TEXT_LENGTH)
			break
		text += `${cleaned}\n`
	}
	text = text.trimEnd()
	return { text: text.slice(0, MAX_TEXT_LENGTH), sections: sections.filter(section => section.o <= text.length) }
}

function toDoc(article: Article, content: string): SearchDoc {
	const { text, sections } = extractBody(content)
	return {
		id: article.url,
		title: article.title,
		headings: sections.map(section => section.t).join(' '),
		tags: [...article.categories, ...article.tags].join(' '),
		text,
		sections,
		folders: article.folders,
		categoriesList: article.categories,
		tagsList: article.tags,
		lastUpdated: article.lastUpdated || article.date,
	}
}

/** 扫描 docs/ 下全部编号目录条目，生成搜索文档（空条目跳过）。 */
export function buildSearchDocs(root = docsRoot): SearchDoc[] {
	return scanArticles(root)
		.filter(article => !article.empty)
		.map(article => toDoc(article, matter(readFileSync(join(root, article.source), 'utf8')).content))
}
