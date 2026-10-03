import type { Article, CategoryCount } from '../types.ts'
import { NO_ORDER, orderOf } from './order.ts'

/**
 * 分类用完整层级路径表示，来源有两个（见 catalog.ts）：
 *
 * 1. 文章所在目录：`03.群汇总/05.组织详情/电影协会.md` → `群汇总/组织详情`；
 * 2. frontmatter 的 `categories`，层级只由缩进表示：
 *
 * ```yaml
 * categories:
 *   - 群汇总
 *     - 组织详情
 * ```
 *
 * YAML 会把这段缩进解析成一行「群汇总 - 组织详情」，所以解析时按「 - 」拆回层级，
 * 再拼成站内使用的完整路径「群汇总/组织详情」。没有缩进的多条就是同级分类：
 *
 * ```yaml
 * categories:
 *   - 群汇总
 *   - 校园生活
 * ```
 *
 * 上级和更深路径都写上时两条都算，文章会同时出现在这两个分类里。
 */
function segments(value: string): string[] {
	return value.split(/\s+-\s+/)
}

/** frontmatter 的 categories 字段 → 去重后的完整分类路径。 */
export function categoryPaths(value: unknown): string[] {
	const entries: unknown[] = Array.isArray(value) ? value : [value]
	const paths = entries
		.filter((entry): entry is string => typeof entry === 'string')
		.map(entry => segments(entry).map(segment => segment.trim()).filter(Boolean).join('/'))
		.filter(Boolean)
	return [...new Set(paths)]
}

/** 分类的上级路径：「群汇总/组织详情」→「群汇总」，顶层分类返回空串。 */
export function categoryParent(path: string): string {
	return path.split('/').slice(0, -1).join('/')
}

/** 分类自身的名字：「群汇总/组织详情」→「组织详情」。 */
export function categoryLeaf(path: string): string {
	return path.split('/').pop() || path
}

/** 某个分类的下一级分类，顺序沿用分类列表（写了 order 的在前，其余文章多的在前）。 */
export function categoryChildren(categories: CategoryCount[], parent: string): CategoryCount[] {
	return categories.filter(category => categoryParent(category.path) === parent)
}

/** 路径上的所有上级分类：「a/b/c」→「a」「a/b」。 */
function ancestors(path: string): string[] {
	const parts = path.split('/')
	return parts.slice(1).map((_, index) => parts.slice(0, index + 1).join('/'))
}

/**
 * 汇总分类树。
 *
 * 每个节点只统计分类路径完全等于它的文章，不会把子分类的文章累加到上级，
 * 所以点进上级分类只会看到自己声明的文章；写了上级也写了子分类的文章两处都会出现。
 * 只有子分类、自己还没有直属文章的中间层级也会保留节点，方便逐级点进去。
 *
 * 每个节点还会记一个 order：取该分类（含所有子分类）里文章 order 的最小值，
 * 与侧栏目录取「目录内文章 order 最小值」的口径一致，这样筛选栏、子分类条目、
 * 侧栏三处的先后顺序是同一个。没写 order 的分类仍按文章数、再按路径名排。
 */
export function collectCategories(articles: Article[]): CategoryCount[] {
	const counts = new Map<string, number>()
	const orders = new Map<string, number>()
	for (const article of articles) {
		const order = orderOf(article.order)
		for (const path of article.categories) {
			counts.set(path, (counts.get(path) || 0) + 1)
			const parents = ancestors(path)
			for (const parent of parents) {
				if (!counts.has(parent))
					counts.set(parent, 0)
			}
			if (order === NO_ORDER)
				continue
			// 子分类写了 order 时上级也跟着提前，和侧栏目录的表现保持一致
			for (const target of [path, ...parents])
				orders.set(target, Math.min(orders.get(target) ?? NO_ORDER, order))
		}
	}
	return [...counts]
		.map(([path, count]) => ({ name: categoryLeaf(path), path, count, order: orders.get(path) }))
		.sort((a, b) => orderOf(a.order) - orderOf(b.order) || b.count - a.count || a.path.localeCompare(b.path, 'zh-CN', { numeric: true }))
}

/**
 * 把 URL 里的分类参数解析成完整路径。
 *
 * 优先精确匹配；只写末级名字的链接（例如 `?category=组织详情`）在这个名字唯一时
 * 仍然指向那条分类，只有同名分类存在歧义时才原样返回。
 */
export function resolveCategory(categories: CategoryCount[], value: string): string {
	const target = value.trim()
	if (!target || categories.some(category => category.path === target))
		return target
	const matched = categories.filter(category => category.name === target)
	return matched.length === 1 ? matched[0].path : target
}
