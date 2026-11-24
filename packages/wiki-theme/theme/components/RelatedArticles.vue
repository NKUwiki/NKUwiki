<script setup lang="ts">
import { useData, withBase } from 'vitepress'
import { computed } from 'vue'

/**
 * 相关文章：构建期由 lib/content/related.ts 算好（TF-IDF 余弦），
 * 每页只下发前 5 条的 url / title / folders，客户端零计算。
 * 数据注在 frontmatter.related 上，没有相关文章的页面不渲染。
 */
interface RelatedItem {
	url: string
	title: string
	folders: string[]
}

const { frontmatter } = useData()

const items = computed<RelatedItem[]>(() => {
	const value = frontmatter.value.related
	if (!Array.isArray(value))
		return []
	// 防御前端脏数据：构建期写入的是纯对象，但 frontmatter 也允许手写覆盖
	return value.filter((item): item is RelatedItem =>
		item && typeof item.url === 'string' && typeof item.title === 'string' && Array.isArray(item.folders))
})
</script>

<template>
<!-- 包一层 vp-doc 容器（与 GitHistory 一致）：doc-after 插槽本身在 .vp-doc 之外，
     包上后 h2 才能拿到标准标题样式（分割线、字号、悬停锚点），不必自行复刻 -->
<div v-if="items.length" class="vp-doc">
	<section class="wiki-related" aria-label="相关文章">
		<h2 id="相关文章">
			<a class="header-anchor" href="#相关文章" aria-label="Permalink to &quot;相关文章&quot;" />
			相关文章
		</h2>
		<ul class="wiki-related-list">
			<li v-for="item in items" :key="item.url">
				<a class="wiki-related-link" :href="withBase(item.url)">
					<span class="wiki-related-name">{{ item.title }}</span>
					<span v-if="item.folders.length" class="wiki-related-folder">{{ item.folders.join(' · ') }}</span>
				</a>
			</li>
		</ul>
	</section>
</div>
</template>

<style scoped>
/* 类名统一 wiki-related- 前缀：组件在主题包内，不受样式冲突守卫检查，
   一旦与全局裸选择器同名会静默多出边框背景（本站被 .sidebar-top 坑过） */
.wiki-related-list {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
	gap: 0.5rem;

	/* 祖先有 .vp-doc，必须显式清掉正文列表的标记与缩进 */
	margin: 0.75rem 0 0;
	padding: 0;
	list-style: none;
}

.wiki-related-list > li {
	margin: 0;
}

.wiki-related-link {
	display: flex;
	flex-direction: column;
	gap: 0.15rem;
	height: 100%;
	padding: 0.6rem 0.8rem;

	/* .vp-doc a 会带品牌色与下划线，这里恢复成卡片样式 */
	border: 1px solid var(--vp-c-divider);
	border-radius: var(--wiki-radius);
	text-decoration: none;
	color: inherit;
	transition:
		border-color var(--wiki-duration) var(--wiki-ease-out),
		background-color var(--wiki-duration) var(--wiki-ease-out);
}

.wiki-related-link:hover {
	border-color: var(--vp-c-brand-3);
	background-color: var(--vp-c-bg-soft);
}

.wiki-related-name {
	font-size: 0.9rem;
	font-weight: 500;
	line-height: 1.4;
	color: var(--vp-c-text-1);
}

.wiki-related-folder {
	font-size: 0.75rem;
	line-height: 1.3;
	color: var(--vp-c-text-3);
}
</style>
