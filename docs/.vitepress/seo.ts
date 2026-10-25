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
	'/pages/markdown-extended/': 'Markdown 扩展语法：表格、公式与脚注',
	'/pages/MarkdownGuide/': '本站特有的 Markdown 语法：卡片与标注',
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
