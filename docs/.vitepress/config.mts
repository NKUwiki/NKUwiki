import type { MarkdownRenderer } from 'vitepress'
import { existsSync, readFileSync } from 'node:fs'
// 显式导入而非直接用全局：ESLint 的 node/prefer-global/process 要求如此
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { cardlist } from '@nkuwiki/theme/lib/content/cardlist.ts'
import { buildTree, excerptFromContent, getArticleContent, outputPath, scanArticles } from '@nkuwiki/theme/lib/content/catalog.ts'
import { flink } from '@nkuwiki/theme/lib/content/flink.ts'
import { collectAuthors } from '@nkuwiki/theme/lib/data/authors.ts'
import { annotation } from '@nkuwiki/theme/lib/markdown/annotation.ts'
import { codeTitle } from '@nkuwiki/theme/lib/markdown/code-title.ts'
import { imageSizePlugin } from '@nkuwiki/theme/lib/markdown/image-size.ts'
import { mark } from '@nkuwiki/theme/lib/markdown/mark.ts'
import { plot } from '@nkuwiki/theme/lib/markdown/plot.ts'
import { steps } from '@nkuwiki/theme/lib/markdown/steps.ts'
import { timeline } from '@nkuwiki/theme/lib/markdown/timeline.ts'
import { replaceAssets } from '@nkuwiki/theme/lib/vite/replace-assets.ts'
import markmapPlugin from '@vitepress-plugin/markmap'
import { defineConfig } from 'vitepress'
import { announcement } from './data/announcement.ts'
import { fallbackAuthor, members } from './data/members.ts'
import { repoUrl, siteUrl, watermarkSubtitle } from './data/site.ts'

/** gen-history.mjs 生成的每页 Git 提交历史（键为相对 docs 的源文档路径） */
interface CommitEntry {
	hash: string
	message: string
	author: string
	github: string | null
	date: string
}
// history.json 不随 git 分发（被 .gitignore 排除），由 pnpm dev/build 脚本前置的
// gen:history 生成；直接调 vitepress CLI 时可能还不存在，兜底为空对象（页面历史为空，不阻塞构建）。
const gitHistory: Record<string, CommitEntry[]> = existsSync(fileURLToPath(new URL('./history.json', import.meta.url)))
	? JSON.parse(readFileSync(fileURLToPath(new URL('./history.json', import.meta.url)), 'utf8'))
	: {}

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
/* 拼资源地址：base 可能是 ''（当前自定义域名根部署），将来若改成 '/xxx/' 带尾斜杠，
   直接写 `${base}/a.png` 会拼成双斜杠。这里统一剥掉尾斜杠。 */
const assetUrl = (path: string) => `${base.replace(/\/+$/, '')}/${path}`
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

// 资源外链替换（构建期）：设置 WIKI_ASSETS_BASE 后，产物里的本地资源路径会改写到该域名。
// 未设置时两个入口都是恒等操作，产物逐字节不变。详见 lib/vite/replace-assets.ts。
// skip：/assets/ 下是 VitePress 自己打包的产物，文件名带构建哈希（如
// inter-roman-latin.q5rAVC0E.woff2），每次构建都变、桶里永远追不平，
// 改写到图床必 404 —— 这类资源继续由 Pages 直出。（实测唯一实例是内置 Inter 字体。）
// 不要改成「只改写 docs/public 里存在的文件」：正文允许引用只存在于图床的图片。
const assets = replaceAssets({
	siteBase: base,
	skip: '^/assets/',
	image: process.env.WIKI_ASSETS_BASE || '',
	media: process.env.WIKI_ASSETS_BASE || '',
})

export default defineConfig({
	base,
	lang: 'zh-CN',
	title: 'NKUwiki',
	// 搜索结果里的「页面名 | 后缀」：后缀带上定位词，命中「南开 + 知识库」类搜索词
	titleTemplate: ':title | NKUwiki - 南开校园知识库',
	description,
	cleanUrls: true,
	lastUpdated: false,
	srcExclude: ['activity/**'],
	rewrites: source => rewrites.get(source) || source,
	head: [
		// favicon 写成绝对路径：相对路径（favicon-light.svg）在资源外链替换时匹配不到
		// （插件只认以 / 开头的站内路径），加一个斜杠即可被正确改写
		['link', { 'rel': 'icon', 'type': 'image/svg+xml', 'href': assetUrl('favicon-light.svg'), 'media': '(prefers-color-scheme: light)', 'data-wiki-icon': '' }],
		['link', { 'rel': 'icon', 'type': 'image/svg+xml', 'href': assetUrl('favicon-dark.svg'), 'media': '(prefers-color-scheme: dark)', 'data-wiki-icon': '' }],
		// manifest 也写成绝对路径：相对路径在深层页面（cleanUrls 下 /pages/xxx）
		// 会按当前目录解析而 404。文件在 docs/public 下，public 是原样拷贝的、
		// 不经过 rollup 打包，所以插件看不到它——里面的图标路径始终指向站点，
		// 文件也一直在站内，切图床后照旧从 Pages 取。
		['link', { rel: 'manifest', href: assetUrl('manifest.webmanifest') }],
		['meta', { property: 'og:locale', content: 'zh_CN' }],
		['meta', { name: 'keywords', content: 'NKUwiki,nkuwiki,南开wiki,南开 wiki,南开维基,南开大学维基,南开大学wiki,南开大学,校园知识库,新生入学,校园生活' }],
		['meta', { name: 'author', content: 'NKUwiki-Group' }],
		['meta', { property: 'og:site_name', content: 'NKUwiki' }],
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
			{ text: '校园地图', link: '/map/' },
			{ text: '参与共建', link: '/categories/?category=贡献与其他', activeMatch: categoryMatch('贡献与其他') },
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
		// 站点常量编译期注入主题包（包内 lib/data/site.ts、announcement.ts 消费；
		// config 自身走 Node 侧直接 import）。公告是对象，需双重序列化成
		// JSON 字符串字面量，包内再 JSON.parse（site.ts 的字符串值只需一层）
		define: {
			__SITE_URL__: JSON.stringify(siteUrl),
			__REPO_URL__: JSON.stringify(repoUrl),
			__WATERMARK_SUBTITLE__: JSON.stringify(watermarkSubtitle),
			__ANNOUNCEMENT__: JSON.stringify(JSON.stringify(announcement)),
		},
		base,
		plugins: [
			markmapPlugin({ containerHeight: 500 }),
			stripMarkmapInjection(),
			// 资源外链替换：把产物里的本地资源路径（/img/foo.png、/favicon-light.svg 等）改写到
			// 网络存储地址。未设置 WIKI_ASSETS_BASE 时插件空转，产物逐字节不变，可放心常驻；
			// 迁移时把 docs/public 整个目录上传到对象存储，再带上该变量重新构建即可，
			// 内容里的本地路径无需改动（详见 lib/vite/replace-assets.ts 顶部说明）。
			assets.plugin,
		],
		build: {
			// 剩余超 500KB 的 chunk 都已核实无害：chunks/metadata 是站点数据
			// （侧栏树按文章序列化 149 份，gzip 后仅 ~21KB），chunks/markmap.es
			// 是懒加载的脑图依赖（当前没有页面用到，不会被下载）。
			chunkSizeWarningLimit: 1400,
		},
		// Nolebase 系列的 client 包直接引用 .vue 文件，SSR 外部化时 Node 无法加载，需一并打包；
		// @nkuwiki/theme 是 workspace 源码包（.ts/.vue），同样不能被 SSR 外部化
		ssr: {
			noExternal: [
				'@nolebase/vitepress-plugin-enhanced-readabilities',
				'@nolebase/ui',
				'@nkuwiki/theme',
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
			// <flink> 数据块 → FriendLinks 卡片（友链数据在 md 中直接编辑）
			flink(md)
			// 行内注释 {^...}、隐秘文本 !!...!!、代码块标题 title="..."、
			// 本地图片构建期注入宽高防 CLS（组件在主题包全局注册，见 theme/index.ts）
			annotation(md)
			plot(md)
			mark(md)
			codeTitle(md)
			steps(md)
			timeline(md)
			imageSizePlugin(md, fileURLToPath(new URL('../', import.meta.url)))
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
	// 最终 HTML 的 <head>（favicon、字体 preload）是 VitePress 在 bundle 之后拼出来的，
	// Vite 插件的 generateBundle 够不到，靠这个钩子补上，与 assets.plugin 配合使用
	transformHtml: code => assets.transformHtml(code),
	// 按页注入 SEO 元数据：canonical、og/twitter 卡片、文章页 Article 结构化数据。
	// 站点级 head 只保留 og:site_name 与 WebSite JSON-LD，页级数据在这里生成，
	// 否则分享出去的都是首页标题与首页地址。
	transformPageData(page) {
		const article = articles.find(item => item.source === page.relativePath || outputPath(item.url) === page.relativePath)
		// 页面规范地址：文章用 permalink，直通页（map.md、categories/index.md 等）按
		// 输出路径去掉 .md / index.md；404 页不参与（单独 noindex）
		const is404 = page.relativePath === '404.md'
		const pagePath = article ? article.url : page.relativePath.replace(/(^|\/)index\.md$/, '$1').replace(/\.md$/, '')
		// article.url 恒带前导斜杠，直通页的 pagePath 则形态不一（categories/index.md →
		// "categories/"、map.md → "map"），与去尾斜杠的域名直接拼接会拼出
		// freshnkuer.wiki categories 这种不存在的地址——canonical 与 og:url 一起失效，
		// 这里统一剥前导斜杠后用 "/" 连接
		const pageUrl = `${siteUrl.replace(/\/$/, '')}/${pagePath.replace(/^\//, '')}`

		if (is404) {
			page.frontmatter.head ??= []
			page.frontmatter.head.push(['meta', { name: 'robots', content: 'noindex' }])
			return
		}

		const pageTitle = article?.title ?? (page.frontmatter.title as string | undefined) ?? 'NKUwiki · 南开大学校园知识库'
		// 页面描述三级兜底：frontmatter description → 正文首段（构建期从扫描缓存提取）→ 全站文案。
		// scanArticles 在 config 顶层已执行，正文缓存可直接复用（避免二次读盘）。
		const bodyDescription = article ? excerptFromContent(getArticleContent(article.source) ?? '') : ''
		const pageDescription = (page.frontmatter.description as string | undefined) || bodyDescription || description
		const head: [string, Record<string, string>, string?][] = [
			['link', { rel: 'canonical', href: pageUrl }],
			['meta', { property: 'og:title', content: pageTitle }],
			['meta', { property: 'og:description', content: pageDescription }],
			['meta', { property: 'og:url', content: pageUrl }],
			['meta', { property: 'og:image', content: `${siteUrl.replace(/\/$/, '')}/og-default.png` }],
			['meta', { property: 'og:type', content: article ? 'article' : 'website' }],
			// og:image 是 1200×630 大图：文章页用 summary_large_image 分享效果更好，
			// 非文章页（地图、分类索引）没有专属大图，维持 summary
			['meta', { name: 'twitter:card', content: article ? 'summary_large_image' : 'summary' }],
		]

		if (article) {
			page.title = article.title
			page.lastUpdated = article.lastUpdatedTime || undefined
			Object.assign(page.frontmatter, { title: article.title, breadcrumbs: article.folders, tags: article.tags, empty: article.empty, wordCount: article.wordCount, readingMinutes: article.readingMinutes })
			// 页尾作者列表：按 frontmatter 声明的 author 生成，构建期算好后随页面数据下发；
			// 成员表是站点数据，显式注入给主题包的纯函数
			page.frontmatter.authors = collectAuthors(page.frontmatter.author, { members, fallbackName: fallbackAuthor })
			const articleAuthor = (page.frontmatter.authors as Array<{ name?: string }> | undefined)?.[0]?.name
			head.push(['script', { type: 'application/ld+json' }, JSON.stringify({
				'@context': 'https://schema.org',
				'@type': 'Article',
				'headline': article.title,
				'description': pageDescription,
				'datePublished': article.date || undefined,
				'dateModified': article.lastUpdated || undefined,
				'author': { '@type': 'Organization', 'name': articleAuthor || 'NKUwiki-Group' },
				'mainEntityOfPage': { '@type': 'WebPage', '@id': pageUrl },
				'inLanguage': 'zh-CN',
			})])
		}

		page.frontmatter.head ??= []
		page.frontmatter.head.push(...head)

		// Git 提交历史按页注入：history.json 全量约 138KB，静态打进主题入口包的话
		// 每个页面都要下载全站提交，按页注入后单页只有自己的几条。
		// 文章页的键是源路径（sourcePath 同源），直通页（map.md 等）用 relativePath。
		page.frontmatter.pageHistory = gitHistory[article?.source || page.relativePath] ?? []
	},
})
