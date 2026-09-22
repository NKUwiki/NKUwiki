/** 文章作者：只来自 frontmatter 的 `author` 声明，按声明顺序展示。 */
export interface Author {
	/** 显示名 */
	name: string
	/** 邮箱，仅用于展示 */
	email?: string
	/** 主页链接；frontmatter 不再提供，目前只有组织兜底账号使用 */
	url?: string
	/** 头像地址；没有显式填写时就是本地生成的首字图 */
	avatar?: string
	/** 显式头像加载失败时替换使用的本地首字图 */
	fallback?: string
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
	tree: DirectoryItem[]
	categories: CategoryCount[]
	tags: TaxonomyCount[]
}

export type IndexMode = 'archives' | 'categories' | 'tags'
