import type { MarkdownRenderer } from 'vitepress'
import { fileURLToPath } from 'node:url'
import markmapPlugin from '@vitepress-plugin/markmap'
import { defineConfig } from 'vitepress'
import { collectAuthors } from './authors.ts'
import { cardlist } from './cardlist.ts'
import { buildTree, docsRoot, outputPath, scanArticles } from './catalog.ts'
import { repoUrl, siteUrl } from './site.ts'

const articles = scanArticles()
const base = ''
const description = 'NKUwiki（南开 wiki、南开维基）是南开大学学生共同维护的非官方校园知识库，收录新生入学、学习、校园生活、群组等指南。'

/** 标题文字来自 frontmatter，转义行内语法，避免标题里的符号被当成 Markdown。 */
function escapeTitleText(title: string) {
	return title.replace(/[\\`*_[\]<>&]/g, '\\$1')
}

/** 把一级标题拼在正文最前面（frontmatter 若还在，则接在其后）。 */
function prependTitleHeading(source: string, title: string) {
	const heading = `# ${escapeTitleText(title)}\n\n`
	const frontmatter = source.match(/^(-{3,}\r?\n[\s\S]*?\r?\n-{3,}\r?\n?)/)
	return frontmatter ? frontmatter[1] + heading + source.slice(frontmatter[1].length) : heading + source
}

/** 某个目录下所有文章的路由，用来给「参与共建」这类导航项做高亮 */
function categoryMatch(...folders: string[]) {
	const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
	const paths = articles.filter(article => folders.includes(article.folders[0])).flatMap(article => [article.url.replace(/\/$/, ''), `/${article.source.replace(/\.md$/, '')}`]).map(escape)
	return `^(?:${paths.join('|')})/?$`
}
const rewrites = new Map(articles.map(article => [article.source, outputPath(article.url)]))
const sidebar = Object.fromEntries(articles.map(article => [article.url, [
	...buildTree(articles.filter(other => other.folders[0] === article.folders[0])),
]]))

export default defineConfig({
	base,
	lang: 'zh-CN',
	title: 'NKUwiki',
	description,
	cleanUrls: true,
	lastUpdated: false,
	srcExclude: ['activity/**'],
	rewrites: source => rewrites.get(source) || source,
	head: [
		['link', { rel: 'stylesheet', href: 'https://s4.zstatic.net/npm/inter-ui@4.1.1/inter-variable.css' }],
		['link', { rel: 'stylesheet', href: 'https://s4.zstatic.net/npm/inter-ui@4.1.1/inter.css' }],
		['link', { 'rel': 'icon', 'type': 'image/svg+xml', 'href': `${base}favicon-light.svg`, 'media': '(prefers-color-scheme: light)', 'data-wiki-icon': '' }],
		['link', { 'rel': 'icon', 'type': 'image/svg+xml', 'href': `${base}favicon-dark.svg`, 'media': '(prefers-color-scheme: dark)', 'data-wiki-icon': '' }],
		['meta', { name: 'keywords', content: 'NKUwiki,nkuwiki,南开wiki,南开 wiki,南开维基,南开大学维基,南开大学wiki,南开大学,校园知识库,新生入学,校园生活' }],
		['meta', { name: 'author', content: 'NKUwiki-Group' }],
		['meta', { property: 'og:site_name', content: 'NKUwiki' }],
		['meta', { property: 'og:type', content: 'website' }],
		['meta', { property: 'og:title', content: 'NKUwiki · 南开大学校园知识库' }],
		['meta', { property: 'og:description', content: description }],
		['meta', { property: 'og:url', content: siteUrl }],
		['script', { type: 'application/ld+json' }, JSON.stringify({
			'@context': 'https://schema.org',
			'@type': 'WebSite',
			'name': 'NKUwiki',
			'alternateName': ['NKUwiki', 'nkuwiki', 'NKU wiki', '南开wiki', '南开 wiki', '南开维基', '南开大学 wiki', '南开大学维基'],
			'url': siteUrl,
			'inLanguage': 'zh-CN',
		})],
	],
	sitemap: { hostname: siteUrl },
	themeConfig: {
		nav: [
			{ text: '新生入学', link: '/categories/?category=新生入学' },
			{ text: '浅谈学习', link: '/categories/?category=浅谈学习' },
			{ text: '校园生活', link: '/categories/?category=校园生活' },
			{ text: '群汇总', link: '/categories/?category=群汇总' },
			{ text: '全部分类', link: '/categories/' },
			{ text: '参与共建', link: '/pages/BasicContribution/', activeMatch: categoryMatch('贡献与其他') },
		],
		sidebar,
		// 站内搜索由自建组件承担（theme/components/WikiSearch.vue + search.ts 构建期索引）：
		// 内置 localSearch 的 MiniSearch 默认分词不识别中文，正文整句成一个词元，无法按词命中。
		socialLinks: [{ icon: 'github', link: repoUrl }],
		externalLinkIcon: true,
		langMenuLabel: '切换语言',
		sidebarMenuLabel: '专题目录',
		darkModeSwitchLabel: '主题',
		lightModeSwitchTitle: '切换到浅色模式',
		darkModeSwitchTitle: '切换到深色模式',
		returnToTopLabel: '返回顶部',
		outline: { level: [2, 3], label: '本页目录' },
		docFooter: { prev: '上一篇', next: '下一篇' },
		editLink: { pattern: `${repoUrl}/blame/main/docs/:path`, text: '源代码' },
		lastUpdated: { text: '最后更新于', formatOptions: { dateStyle: 'medium' } },
		footer: { message: '由南开大学学生共同维护的非官方校园知识库', copyright: `© 2026–${new Date().getFullYear()} NKUwiki-Group · MIT License` },
	},
	vite: { base, plugins: [markmapPlugin({ containerHeight: 500 })], resolve: { alias: { '@': fileURLToPath(new URL('./', import.meta.url)) } } },
	markdown: {
		config: (md) => {
			// VitePress 生产构建会对同一实例重复应用本配置，重入会嵌套包裹 renderer 规则（水印出现两份）
			const instance = md as MarkdownRenderer & { configured?: boolean }
			if (instance.configured)
				return
			instance.configured = true
			cardlist(md)
			// 正文没有一级标题时，用 frontmatter 的 title 生成标准 Markdown 一级标题拼到正文最前（拥有标准锚点与 .vp-doc 样式）。
			// wikiTitleInserted 标记防止卡片容器嵌套解析时重复插入。
			md.core.ruler.before('block', 'article-title', (state) => {
				if (state.env.wikiTitleInserted)
					return
				const article = articles.find(item => item.source === state.env.relativePath || outputPath(item.url) === state.env.relativePath)
				if (!article || article.hasHeading) {
					state.env.wikiTitleInserted = true
					return
				}
				state.src = prependTitleHeading(state.src, article.title)
				state.env.wikiTitleInserted = true
			})
			const headingClose = md.renderer.rules.heading_close
			md.renderer.rules.heading_close = (tokens, index, options, env, self) => {
				const decoration = tokens[index].tag === 'h2' ? '<span class="heading-wordmark" aria-hidden="true"></span>' : ''
				return decoration + (headingClose?.(tokens, index, options, env, self) ?? self.renderToken(tokens, index, options))
			}
		},
		languageAlias: { gitignore: 'text' },
		math: true,
		container: { tipLabel: '提示', warningLabel: '注意', dangerLabel: '警告', infoLabel: '信息', detailsLabel: '详细信息' },
	},
	transformPageData(page) {
		const article = articles.find(item => item.source === page.relativePath || outputPath(item.url) === page.relativePath)
		if (article) {
			page.title = article.title
			page.lastUpdated = article.lastUpdatedTime || undefined
			Object.assign(page.frontmatter, { title: article.title, breadcrumbs: article.folders, categories: article.categories, tags: article.tags, empty: article.empty })
			// 页尾作者列表：frontmatter 与 Git 提交历史合并去重，构建期算好后随页面数据下发
			page.frontmatter.authors = collectAuthors(article.source, page.frontmatter.author, docsRoot)
		}
	},
})
