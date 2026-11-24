import type { Article } from '@nkuwiki/theme/lib/types.ts'

/**
 * 搜索意图标题映射：把「军训」「选课」这类极短标题补成能被人搜到的完整标题。
 *
 * key 必须是文章的 permalink，写法与 permalink 完全一致（含末尾斜杠与否）。
 * 匹配失败不会报错、页面只是退回短标题，所以由 assertSeoTitleMapMatches
 * 在构建期强制校验，避免改了 permalink 之后映射静默失效。
 *
 * 标题主体控制在 22 个汉字左右：品牌后缀由 titleTemplate 统一拼一次，
 * 主体过长会让 SERP 里的后半段被省略号截掉。主体里不要重复站点名。
 */
export const seoTitleMap: Record<string, string> = {
	// 新生入学
	'/pages/Preparation': '南开大学新生入学准备清单：证件档案与行李物品',
	'/pages/MilitaryTraining': '南开大学新生军训指南：时间、项目与注意事项',
	'/pages/Transportation': '南开大学新生报到交通指南：校区路线与接站',
	'/pages/SchoolLife': '南开大学新生日常生活指南：宿舍、食堂与校园卡',
	'/pages/OrganizationRelationship': '南开大学新生团组织关系转接流程与注意事项',
	'/pages/UndergraduateMajors': '南开大学本科招生大类与对应学院一览',
	'/pages/Anti-Fraud': '南开大学新生反诈防骗指南：常见骗局与应对',
	'/pages/QuestionAndAnswer': '南开大学新生常见问题解答（Q&A）',
	// 浅谈学习
	'/pages/GPA': '南开大学学分绩点、综测评优与推免保研指南',
	'/pages/Grades': '南开大学成绩与挂科：补考、重修与绩点影响',
	'/pages/Curriculum': '南开大学课程安排：学期设置与上课时间',
	'/pages/CourseSelection': '南开大学选课指南：选课流程与避坑经验',
	'/pages/StudentStatus': '南开大学学号学籍、二次选拔与转专业流程',
	'/pages/Textbooks': '南开大学教材获取指南：购书渠道与二手书',
	'/pages/Contests': '南开大学竞赛与证书：学科竞赛与考证建议',
	'/pages/MajorGuide': '南开大学专业指南：各学院专业介绍与去向',
	// 群汇总
	'/pages/hobbygroup': '南开大学兴趣群汇总：动漫、游戏与运动社群',
	'/pages/fellowvillagers': '南开大学老乡群汇总：各省市地区 QQ 群号',
	'/pages/association/': '南开大学学生组织与社团汇总：招新与联系方式',
	'/pages/labs': '南开大学实验室汇总：课题组方向与加入方式',
	// 校园生活
	'/pages/Food': '南开大学食堂与周边美食推荐（八里台/津南）',
	'/pages/Anecdote': '南开大学校园趣闻与冷知识合集',
	'/pages/Feedback': '南开大学反馈与舆论渠道：意见反映途径',
	'/pages/CampusLifeOverview': '南开大学校园生活概览：衣食住行总览',
	'/pages/Life': '南开大学在校生活指南：宿舍、澡堂与洗衣',
	'/pages/Delivery': '南开大学快递与外卖指南：取件点与配送范围',
	'/pages/Nearby': '南开大学周边去处：商圈、景点与休闲推荐',
	'/pages/CampusEmail': '南开大学学生邮箱申请与使用教程',
	'/pages/Apps': '南开大学常用 App：校园卡、教务与生活必备',
	// 校园建筑（一楼一篇，标题多带校区以区分同名建筑）
	'/pages/TeachingBuildings': '南开大学教学楼索引：八里台与津南校区',
	'/pages/MainBuilding': '南开大学主楼：位置、教室与办事地点',
	'/pages/SecondMainTeachingBuilding': '南开大学第二主教学楼：位置与教室分布',
	'/pages/TeachingBuilding4': '南开大学第四教学楼：位置、教室与课程分布',
	'/pages/TeachingBuilding5': '南开大学第五教学楼：位置、教室与课程分布',
	'/pages/LiberalArtsInnovationBuilding': '南开大学文科创新楼：位置与使用指南',
	'/pages/CombinedTeachingCenter': '南开大学组合教学中心：教室与上课地点',
	'/pages/CentralLaboratory': '南开大学中心实验室：位置与实验课程',
	'/pages/AVEducationCenter': '南开大学电教中心：位置与多媒体教室',
	'/pages/BalitaiLabBuilding': '南开大学综合实验楼（八里台）：实验室分布',
	'/pages/JinnanLabBuilding': '南开大学综合实验楼（津南）：实验室分布',
	'/pages/JinnanTeachingBuildingC': '南开大学公共教学楼 C 区：教室与上课分布',
	'/pages/JinnanTeachingBuildingD': '南开大学公共教学楼 D 区：教室与上课分布',
	'/pages/ElectronicInfoLabCenter': '南开大学电子信息实验教学中心介绍',
	// 计算机知识（通用教程，不带校名）
	'/pages/writing-guidelines/': '中文网页写作排版规范：中英混排与标点用法',
	'/pages/wsl-install/': 'WSL 安装教程：在 Windows 上安装 Linux 子系统',
	'/pages/linux-commands/': 'Linux 常用命令速查：文件、权限与网络',
	'/pages/markdown-basic/': 'Markdown 基础语法教程：标题、列表与链接',
	'/pages/markdown-extended/': 'Markdown 扩展语法：表格、高亮、提示容器与思维导图',
	'/pages/MarkdownGuide/': '本站特有的 Markdown 语法：马克笔、注释与正文组件',
	'/pages/MarkdownEditors/': 'Markdown 编辑软件对比：Typora 与 Obsidian',
	'/pages/MarkdownCheatsheet/': 'Markdown 语法速查表：一页掌握常用写法',
	// 贡献与其他
	'/pages/Contributing/': '南开知识库贡献指南：写作规范与投稿流程',
	'/pages/ContributionMethods/': '贡献方式：GitHub PR、投稿与反馈渠道',
	'/pages/AboutUs': '关于我们：项目组介绍、成员与联系方式',
	'/pages/SiteFeatures/': '站点功能说明：卡片、画廊与地图用法',
	'/pages/FriendshipLinks/': '南开大学友情链接与兄弟院校 Wiki 合集',
}

/**
 * 页面 `<title>` 与结构化数据 headline 共用的标题。
 *
 * 命中 seoTitleMap 时用补全后的长标题；社团/组织详情页的标题多是「红学社」
 * 这类专有名词，统一补上学校名（已经以「南开」开头的跳过，避免「南开大学南开女足」）。
 */
export function seoTitleFor(article: { url: string, title: string, folders: string[] }) {
	const mapped = seoTitleMap[article.url]
	if (mapped)
		return mapped
	if (article.folders.includes('组织详情') && !article.title.startsWith('南开'))
		return `南开大学${article.title}`
	return article.title
}

/** 非文章页（索引页与 404）的标题覆盖与 noindex：这些页面没有 frontmatter 正文可提取。 */
export const standaloneSeo: Record<string, { title?: string, noindex?: boolean }> = {
	'archives/index.md': { title: '最近更新：南开校园知识库修订记录' },
	'categories/index.md': { title: '文章分类：浏览南开大学校园知识库全部专题' },
	'tags/index.md': { title: '标签：按主题检索南开大学校园知识库' },
	'map.md': { title: '校园地图：南开大学八里台与津南校区点位导览' },
	'404.md': { noindex: true },
}

/**
 * seoTitleMap 靠 permalink 字符串匹配，permalink 一改映射就会静默失效
 * （页面标题退回短标题，且不会有任何报错），因此在构建期直接校验。
 */
export function assertSeoTitleMapMatches(articles: Pick<Article, 'url'>[]) {
	const urls = new Set(articles.map(article => article.url))
	const unknown = Object.keys(seoTitleMap).filter(url => !urls.has(url))
	if (unknown.length)
		throw new Error(`seoTitleMap 中的链接没有对应文章，映射不会生效：${unknown.join(', ')}`)
}

// ================= 页面 <head> 生成 =================

/**
 * VitePress 注入 `<head>` 的标签元组。
 *
 * 刻意不 import vitepress 的 HeadConfig：本模块要能被单测直接调用，
 * 依赖 vite 运行时会让测试变重；两者结构一致，赋值处由类型检查兜住。
 */
export type HeadTag = [tag: string, attrs: Record<string, string>, innerHTML?: string]

/** 文章页需要参与 SEO 的字段（Article 的子集，避免把整个扫描结果传进来） */
export interface SeoArticle {
	url: string
	title: string
	folders: string[]
	tags: string[]
	date: string
	lastUpdated: string
	empty: boolean
}

export interface PageSeoInput {
	/** 站点正式地址，尾斜杠可有可无 */
	siteUrl: string
	/** 页面路径：文章为 permalink，直通页为去掉 .md / index.md 的输出路径 */
	pagePath: string
	/** 拼好 titleTemplate 的页面标题 */
	pageTitle: string
	/** og:title：frontmatter 自带 titleTemplate 时展开后的值 */
	ogTitle: string
	description: string
	/** 文章信息，非文章页传 null/undefined */
	article?: SeoArticle | null
	/** 构建期解析好的作者列表（page.frontmatter.authors） */
	authors?: Array<{ name?: string }> | null
	/** 没有具名作者时 JSON-LD 里用的组织名 */
	fallbackAuthor: string
	is404?: boolean
	isHome?: boolean
	/** 直通页的 noindex（standaloneSeo 里声明的不索引页） */
	noindex?: boolean
}

/**
 * 把 frontmatter 的裸日期补成 ISO 8601。
 *
 * `2026-09-01` 这种没有时区的写法直接塞进 og:article 与 JSON-LD 时，
 * 部分抓取方会判为无效值；解析不了的原样返回，宁可格式不完美也不要丢日期。
 */
export function isoDate(value: string) {
	const time = new Date(value)
	return Number.isNaN(time.getTime()) ? value : time.toISOString()
}

/**
 * 生成一个页面的 SEO `<head>` 标签。
 *
 * 原先这段逻辑内联在 config.mts 的 transformPageData 里（连同页面数据改写约 300 行），
 * 既没法单测、也只能靠构建后肉眼验收。抽成纯函数后，canonical 拼接、
 * og:title 的模板展开、JSON-LD 的作者类型这些容易写错的地方都由 tests/seo.test.ts 覆盖。
 *
 * 只负责标签，不改动 page 对象——页面数据的写入仍留在 config 里。
 */
export function pageSeoHead(input: PageSeoInput): HeadTag[] {
	const { siteUrl, pageTitle, ogTitle, description, article, fallbackAuthor } = input
	const base = siteUrl.replace(/\/+$/, '')
	// 文章 permalink 恒带前导斜杠，直通页（categories/index.md → "categories/"、
	// map.md → "map"）则形态不一；与去尾斜杠的域名直接拼接会拼出
	// freshnkuer.wiki categories 这种不存在的地址，canonical 与 og:url 一起失效。
	// 这里统一剥前导斜杠后用 "/" 连接。
	const pageUrl = `${base}/${input.pagePath.replace(/^\//, '')}`

	// 404 不参与索引，也不需要 canonical / 社交卡片
	if (input.is404)
		return [['meta', { name: 'robots', content: 'noindex, nofollow' }]]

	// 社交卡片统一用这张 1200×630 的默认大图（尺寸与 og-default.png 实际像素一致，
	// 平台据此预留版位，写错会拉伸）
	const ogImage = `${base}/og-default.png`
	// 卡片比 <title> 多一个品牌尾巴：站外分享时标题里的「| NKUwiki」容易被平台切掉，
	// 图片替代文本里补上更稳。首页标题主体本身就叫「NKUwiki」，无条件追加会得到
	// 「NKUwiki… · NKUwiki」，所以先判重。
	const ogImageAlt = /nkuwiki/i.test(ogTitle) ? ogTitle : `${ogTitle} · NKUwiki`

	const head: HeadTag[] = [
		['link', { rel: 'canonical', href: pageUrl }],
		['meta', { property: 'og:title', content: ogTitle }],
		['meta', { property: 'og:description', content: description }],
		['meta', { property: 'og:url', content: pageUrl }],
		['meta', { property: 'og:image', content: ogImage }],
		['meta', { property: 'og:image:width', content: '1200' }],
		['meta', { property: 'og:image:height', content: '630' }],
		['meta', { property: 'og:image:alt', content: ogImageAlt }],
		['meta', { property: 'og:type', content: article ? 'article' : 'website' }],
		// twitter:image 不会被任何平台从 og:image 推导：只写 og:image 时 X 卡片会退回
		// 无图样式，summary_large_image 也就白设了
		['meta', { name: 'twitter:card', content: 'summary_large_image' }],
		['meta', { name: 'twitter:image', content: ogImage }],
		['meta', { name: 'twitter:image:alt', content: ogImageAlt }],
		// max-image-preview:large 让 Google 结果页可以用大缩略图（默认只有 small/none）
		['meta', { name: 'robots', content: 'index, follow, max-image-preview:large' }],
	]

	if (article) {
		const articleAuthor = input.authors?.[0]?.name
		// collectAuthors 在文章没写 author 时会回退成组织名，那不是一个自然人，
		// 标成 Person 反而误导（「NKUwiki-Group」被当成作者姓名）
		const isNamedAuthor = Boolean(articleAuthor) && articleAuthor !== fallbackAuthor
		// article:* 只在 og:type=article 时有意义，Facebook / LinkedIn 读它判断发布时间与分区
		if (article.date)
			head.push(['meta', { property: 'article:published_time', content: isoDate(article.date) }])
		const modifiedTime = article.lastUpdated || article.date
		if (modifiedTime)
			head.push(['meta', { property: 'article:modified_time', content: isoDate(modifiedTime) }])
		// 分区取最外层分类（「群汇总」），子目录留给 JSON-LD 的 articleSection
		if (article.folders[0])
			head.push(['meta', { property: 'article:section', content: article.folders[0] }])
		for (const tag of article.tags.slice(0, 6))
			head.push(['meta', { property: 'article:tag', content: tag }])
		head.push(['script', { type: 'application/ld+json' }, JSON.stringify({
			'@context': 'https://schema.org',
			'@type': 'Article',
			// headline 与 <title> 主体保持一致，否则结构化数据与页面标题对不上
			'headline': pageTitle,
			'description': description,
			// Article 的 image 是必填：缺了这条结构化数据基本拿不到富结果。
			// publisher 不给 logo 是刻意的——favicon 是 1540×1760 非正方形，
			// Google 要求 logo 为 1:1，硬塞会被判不合格，不如不写。
			'image': { '@type': 'ImageObject', 'url': ogImage, 'width': 1200, 'height': 630 },
			'datePublished': article.date ? isoDate(article.date) : undefined,
			'dateModified': modifiedTime ? isoDate(modifiedTime) : undefined,
			// 有站内成员名就标 Person，没有则回退组织
			'author': isNamedAuthor
				? { '@type': 'Person', 'name': articleAuthor }
				: { '@type': 'Organization', 'name': fallbackAuthor },
			'publisher': { '@type': 'Organization', 'name': 'NKUwiki-Group', 'url': `${base}/` },
			'articleSection': article.folders.join(' - '),
			'mainEntityOfPage': { '@type': 'WebPage', '@id': pageUrl },
			'inLanguage': 'zh-CN',
		})])
		// 只有 frontmatter、没有正文的占位页不索引：收录进去就是薄内容
		if (article.empty)
			head.push(['meta', { name: 'robots', content: 'noindex, nofollow' }])
	}

	if (input.noindex)
		head.push(['meta', { name: 'robots', content: 'noindex, nofollow' }])

	// 站点级 WebSite 结构化数据只给首页：每页都挂一份会把「这是哪一站」的信号打散
	if (input.isHome) {
		head.push(['script', { type: 'application/ld+json' }, JSON.stringify({
			'@context': 'https://schema.org',
			'@type': 'WebSite',
			'name': 'NKUwiki',
			'alternateName': ['NKUwiki', 'nkuwiki', 'NKU wiki', '南开wiki', '南开 wiki', '南开维基', '南开大学 wiki', '南开大学维基'],
			'url': `${base}/`,
			'description': description,
			'inLanguage': 'zh-CN',
			'publisher': {
				'@type': 'Organization',
				'name': 'NKUwiki-Group',
				'url': `${base}/`,
			},
		})])
	}

	return head
}
