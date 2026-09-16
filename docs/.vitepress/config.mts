import type { MarkdownRenderer } from 'vitepress'
import { fileURLToPath } from 'node:url'
import markmapPlugin from '@vitepress-plugin/markmap'
import { defineConfig } from 'vitepress'
import { cardlist } from './cardlist.ts'
import { buildTree, outputPath, scanArticles } from './catalog.ts'
import { repoUrl, siteUrl } from './site.ts'

const articles = scanArticles()
const base = ''
const description = 'NKUwiki（南开 wiki、南开维基）是南开大学学生共同维护的非官方校园知识库，收录新生入学、学习、校园生活、群组等指南。'
function topicMatch(slug: string, ...folders: string[]) {
	const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
	const paths = articles.filter(article => folders.includes(article.folders[0])).flatMap(article => [article.url.replace(/\/$/, ''), `/${article.source.replace(/\.md$/, '')}`]).map(escape)
	return `^(?:/topics/(?:${slug})|${paths.join('|')})/?$`
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
			{ text: '新生入学', link: '/topics/newcomers/', activeMatch: topicMatch('newcomers', '新生入学') },
			{ text: '浅谈学习', link: '/topics/study/', activeMatch: topicMatch('study', '浅谈学习') },
			{ text: '校园生活', link: '/topics/life/', activeMatch: topicMatch('life', '校园生活') },
			{ text: '群汇总', link: '/topics/groups/', activeMatch: topicMatch('groups', '群汇总') },
			{ text: '全部目录', link: '/categories/' },
			{ text: '探索', activeMatch: `${topicMatch('computing', '计算机知识专题')}|^/(categories|tags|archives)(/|$)`, items: [
				{ text: '文章分类', link: '/categories/' },
				{ text: '标签', link: '/tags/' },
				{ text: '最近更新', link: '/archives/' },
			] },
			{ text: '参与共建', link: '/pages/BasicContribution/', activeMatch: topicMatch('contribute', '贡献与其他') },
		],
		sidebar,
		search: { provider: 'local', options: {
			async _render(source, env, md) {
				const article = articles.find(item => item.source === env.relativePath || outputPath(item.url) === env.relativePath)
				const html = await md.renderAsync(source, env)
				if (!article || article.hasHeading)
					return html
				return `<h1 id="article-title">${md.utils.escapeHtml(article.title)}</h1>\n${html}`
			},
			locales: { root: { translations: {
				button: { buttonText: '搜索文档', buttonAriaLabel: '搜索文档' },
				modal: { displayDetails: '显示详情', resetButtonTitle: '清除搜索', backButtonTitle: '关闭搜索', noResultsText: '没有找到相关结果', footer: { selectText: '选择', navigateText: '切换', closeText: '关闭' } },
			} } },
		} },
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
			Object.assign(page.frontmatter, { title: article.title, breadcrumbs: article.folders, categories: article.categories, tags: article.tags, articleHeader: !article.hasHeading, empty: article.empty })
		}
	},
})
