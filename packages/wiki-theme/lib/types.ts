/**
 * 文章作者：显示名来自 frontmatter 的 `author`，其余信息按名字到成员表查询，
 * 在构建期（config.transformPageData）合并成这里的完整字段，按声明顺序展示。
 */
export interface Author {
	/** 显示名 */
	name: string
	/** 点击作者胶囊时打开的链接：显式 link > GitHub 个人页；都没有时胶囊不可点击 */
	link?: string
	/** 悬停作者胶囊时展示的联系方式标签：显式 contact > GitHub 用户名 > 邮箱；全都没有时不弹 */
	contact?: string
	/** 头像地址：显式 avatar 链接 > GitHub 头像 > 本地首字图，构建期已按优先级解析好 */
	avatar: string
	/** 本地首字图：头像加载失败时替换使用 */
	fallback: string
}

/**
 * 成员表条目：站点侧数据文件（如 docs/.vitepress/data/members.ts）按名字提供，
 * `collectAuthors` 用它补全只写名字的 author。所有字段都可以省略。
 * 数据文件示例见同目录 members.example.ts。
 */
export interface Member {
	/** GitHub 用户名：头像兜底用 `github.com/<用户名>.png`，也是胶囊默认的跳转目标 */
	github?: string
	/** 显式头像图片链接，优先级高于 GitHub 头像 */
	avatar?: string
	/** 点击作者胶囊时打开的链接；不填默认 GitHub 个人页 */
	link?: string
	/** 联系方式标签：悬停作者胶囊时展示的纯文本，如 QQ、微信；不填时回退显示 GitHub 用户名、邮箱 */
	contact?: string
	/** 联系邮箱：contact 的兜底之一；写 `a@b.com` 或 `mailto:a@b.com` 都行 */
	email?: string
}

/** 站点注入的作者解析依据：成员表 + frontmatter 未声明 author 时的兜底账号名。 */
export interface AuthorLookup {
	members: Record<string, Member>
	/** 兜底组织账号名，必须能在 members 里查到才有补全效果 */
	fallbackName: string
}

export interface Article {
	source: string
	url: string
	title: string
	folders: string[]
	categories: string[]
	tags: string[]
	date: string
	lastUpdated: string
	lastUpdatedTime: number
	hasHeading: boolean
	empty: boolean
	/** 正文字数：中日韩按字计，其余按词计，代码块与公式不计入 */
	wordCount: number
	/** 由 wordCount 换算的预计阅读分钟数；没有正文时为 0 */
	readingMinutes: number
	/** frontmatter 的 order：同级排序用，数字越小越靠前；没有写时为空 */
	order?: number
}

export interface DirectoryItem {
	text: string
	link?: string
	collapsed?: boolean
	items?: DirectoryItem[]
}

export interface TaxonomyCount {
	name: string
	count: number
}

/** 分类：一条完整层级路径，以及直接属于它的文章数（不含子分类）。 */
export interface CategoryCount {
	/** 当前层级的名字，例如「组织详情」 */
	name: string
	/** 完整路径，用 / 连接，例如「群汇总/组织详情」，同时用作筛选参数 */
	path: string
	/** 直接属于该分类的文章数，子分类的文章不计入 */
	count: number
	/** 分类的排序值 = 该分类下文章 order 的最小值；没有文章写 order 时为空 */
	order?: number
}

export interface Activity {
	source: string
	title: string
	date: string
	end?: string
	campus?: string
	venue?: string
	link?: string
	description?: string
	body?: string
	html?: string
}

export interface Catalog {
	articles: Article[]
	categories: CategoryCount[]
	tags: TaxonomyCount[]
}

export type IndexMode = 'archives' | 'categories' | 'tags'
