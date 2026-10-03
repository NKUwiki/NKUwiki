import type { MarkdownRenderer } from 'vitepress'
import { fileURLToPath } from 'node:url'
import markmapPlugin from '@vitepress-plugin/markmap'
import { defineConfig } from 'vitepress'
import { collectAuthors } from './authors.ts'
import { cardlist } from './cardlist.ts'
import { buildTree, outputPath, scanArticles } from './catalog.ts'
import { repoUrl, siteUrl } from './site.ts'

/**
 * markmap 插件会往 VitePress 客户端入口（client/app/index）静态注入
 * `import markmap from '@vitepress-plugin/markmap/markmap'`，把 markmap-lib/d3/KaTeX
 * 全量同步打进每个页面都要下载的主包。这里在其后把注入的 import 删掉，
 * 全局组件改由 theme/index.ts 的 defineAsyncComponent 按需注册（仅脑图页下载）。
 */
function stripMarkmapInjection() {
	const injectedImport = `import markmap from '@vitepress-plugin/markmap/markmap';`
	const injectedStyle = `import '@vitepress-plugin/markmap/style.css';`
	return {
		name: 'wiki-strip-markmap-injection',
		enforce: 'post',
		transform(code: string, id: string) {
			if (!id.includes('/client/app/index') || !code.includes(injectedImport))
				return null
			return {
				code: code.replace(`${injectedImport}\n`, '').replace(`${injectedStyle}\n`, ''),
				map: null,
			}
		},
	}
}

const articles = scanArticles()
const base = ''
const description = 'NKUwiki（南开校园 wiki、南开维基）是南开大学学生共同维护的非官方校园知识库，收录新生入学、学习、校园生活、群组等指南。'

/** 把一段块内容插到 frontmatter（若在）之后、正文最前面。 */
function prependToBody(source: string, block: string) {
	const frontmatter = source.match(/^(-{3,}\r?\n[\s\S]*?\r?\n-{3,}\r?\n?)/)
	return frontmatter ? frontmatter[1] + block + source.slice(frontmatter[1].length) : block + source
}

/** 某个目录下所有文章的路由，用来给「参与共建」这类导航项做高亮 */
function categoryMatch(...folders: string[]) {
	const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
	const paths = articles.filter(article => folders.includes(article.folders[0])).flatMap(article => [article.url.replace(/\/$/, ''), `/${article.source.replace(/\.md$/, '')}`]).map(escape)
	return `^(?:${paths.join('|')})/?$`
}
const rewrites = new Map(articles.map(article => [article.source, outputPath(article.url)]))
const sidebar = Object.fromEntries(articles.map(article => [article.url, [
	// 侧栏是整站目录：所有分类都列出，默认只展开当前文章所在的分类路径，
	// 其余分类保持折叠（点分类标题可展开，图标在标题左侧）
	...buildTree(articles, 0, article.folders),
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
			{ text: '计算机知识', link: '/categories/?category=计算机知识' },
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
		footer: {
			message: `由南开大学学生共同维护的非官方校园知识库`,
			copyright: 'Copyright © 2026 <a href="https://github.com/NKUwiki/NKUwiki" style="color:inherit;">NKUwiKi</a><br>本站内容采用 <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh-hans" style="color:inherit;">CC BY-NC-SA 4.0</a> 声明',
		},
	},
	vite: {
		base,
		plugins: [
			markmapPlugin({ containerHeight: 500 }),
			stripMarkmapInjection(),
		],
		build: {
			// 剩余超 500KB 的 chunk 都已核实无害：chunks/metadata 是站点数据
			// （侧栏树按文章序列化 149 份，gzip 后仅 ~21KB），chunks/markmap.es
			// 是懒加载的脑图依赖（当前没有页面用到，不会被下载）。
			chunkSizeWarningLimit: 1400,
		},
		resolve: { alias: { '@': fileURLToPath(new URL('./', import.meta.url)) } },
		// Nolebase 系列的 client 包直接引用 .vue 文件，SSR 外部化时 Node 无法加载，需一并打包
		ssr: {
			noExternal: [
				'@nolebase/vitepress-plugin-enhanced-readabilities',
			],
		},
	},
	markdown: {
		config: (md) => {
			// VitePress 生产构建会对同一实例重复应用本配置，重入会嵌套包裹 renderer 规则（水印出现两份）
			const instance = md as MarkdownRenderer & { configured?: boolean }
			if (instance.configured)
				return
			instance.configured = true
			cardlist(md)
			// 文章元信息（分类/标题/字数/标签）整体由 ArticleMeta 组件渲染，构建期注入正文最前。
			// 标题不再以 Markdown 一级标题插入：组件内的标题与字数同行排版，全站标题统一来自
			// frontmatter（正文不应再自带一级标题，历史遗留的 18 处已清理）。
			// wikiTitleInserted 标记防止卡片容器嵌套解析时重复插入。
			md.core.ruler.before('block', 'article-title', (state) => {
				if (state.env.wikiTitleInserted)
					return
				const article = articles.find(item => item.source === state.env.relativePath || outputPath(item.url) === state.env.relativePath)
				state.env.wikiTitleInserted = true
				if (article)
					state.src = prependToBody(state.src, '<ArticleMeta />\n\n')
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
			Object.assign(page.frontmatter, { title: article.title, breadcrumbs: article.folders, categories: article.categories, tags: article.tags, empty: article.empty, wordCount: article.wordCount, readingMinutes: article.readingMinutes, sourcePath: article.source })
			// 页尾作者列表：按 frontmatter 声明的 author 生成，构建期算好后随页面数据下发
			page.frontmatter.authors = collectAuthors(page.frontmatter.author)
		}
	},
})
