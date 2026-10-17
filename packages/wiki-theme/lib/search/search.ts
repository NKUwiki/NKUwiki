// 构建期搜索索引：扫描全部条目，抽取标题、章节与正文纯文本，生成 SearchDoc[]。
// 客户端经 search.data.ts 懒加载这份数据，再用 MiniSearch + searchCore 的分词建索引。
import type { Article } from '../types.ts'
import type { SearchDoc, SearchSection } from './searchCore.ts'
import { docsRoot, getArticleContent, scanArticles } from '../content/catalog.ts'

/**
 * 正文收录上限：超过后只继续收集标题章节，正文行跳过。
 * 全站仅 3 篇教程类文章超 6K，标题检索（「仅标题」模式）完全不受影响，
 * 只有这 3 篇的尾部正文不参与全文检索——换来索引 gzip 体积 -8K。
 */
const MAX_BODY_LENGTH = 6000

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
 * 围栏代码块保留内容（命令等也是可搜内容），但块内行不当标题：shell/yaml/c 的
 * `# 注释`、md 教程页示例的 `# 标题` 会冒充真标题，污染章节索引与跳转定位。
 * sections 记录每个标题在最终纯文本中的偏移，供结果摘要标注所在章节与跳转定位。
 */
export function extractBody(content: string): { text: string, sections: SearchSection[] } {
	const prepared = content
		.replace(/^:::markmap[^\S\n]*\n[\s\S]*?^:::[^\S\n]*$/gm, '')
		.replace(/^[ \t]*:::.*$/gm, '')
	const lines = prepared.split(/\r?\n/)
	const sections: SearchSection[] = []
	let text = ''
	/** 当前所在的围栏标记（``` 或 ~~~）；null 表示不在围栏内 */
	let fence: string | null = null
	for (const line of lines) {
		const fenceMarker = line.match(/^[ \t]*(```|~~~)/)
		if (fenceMarker) {
			// 同种标记视为闭合；围栏内出现的另一种标记只是内容
			if (fence === null)
				fence = fenceMarker[1]!
			else if (fenceMarker[1] === fence)
				fence = null
			continue
		}
		const heading = fence === null
			? line.match(/^[ \t]{0,3}(#{1,6})[ \t]+(\S.*)$/)
			: null
		if (heading) {
			// 行尾的闭合 # 序列不属于标题文字
			const title = stripInline(heading[2].replace(/[ \t]+#+$/, ''))
			sections.push({ t: title, o: text.length })
			// 标题文本本身也计入正文：偏移可自洽回取，章节名同样可被搜到
			text += `${title}\n`
			continue
		}
		// 列表与引用标记保留（归一为 "- "/" >" 前缀）：分词时它们会被丢弃、不影响检索，
		// 却能让搜索摘要按原文排版还原列表与引用块（标题的编号要保留，跳转定位依赖它与渲染后的标题文本一致）
		const cleaned = stripInline(
			/^\s*>/.test(line)
				? line.replace(/^(\s*)>\s?/, '$1> ')
				: /^\s*\|/.test(line)
					? stripTableRow(line)
					: line.replace(/^(\s*)([-*+]|\d+[.)])(\s+)/, '$1$2 '),
		)
		if (!cleaned)
			continue
		// 正文行超限只跳过本行，不 break：后面的标题章节仍要收集（仅标题模式可搜）
		if (text.length >= MAX_BODY_LENGTH)
			continue
		text += `${cleaned}\n`
	}
	text = text.trimEnd()
	return { text, sections: sections.filter(section => section.o <= text.length) }
}

function toDoc(article: Article, content: string): SearchDoc {
	const { text, sections } = extractBody(content)
	return {
		id: article.url,
		title: article.title,
		text,
		sections,
		folders: article.folders,
		categoriesList: article.categories,
		tagsList: article.tags,
	}
}

/** 扫描 docs/ 下全部编号目录条目，生成搜索文档（空条目跳过）。 */
export function buildSearchDocs(root = docsRoot): SearchDoc[] {
	return scanArticles(root)
		.filter(article => !article.empty)
		// 正文直接取 scanArticles 的解析缓存，避免二次读盘与 frontmatter 解析
		.map(article => toDoc(article, getArticleContent(article.source) ?? ''))
}
