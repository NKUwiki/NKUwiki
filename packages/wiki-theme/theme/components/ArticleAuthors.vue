<script setup lang="ts">
import type { Author } from '../../lib/types.ts'
import { useData } from 'vitepress'
import { computed } from 'vue'
import ArticleAuthorPill from './ArticleAuthorPill.vue'

const { frontmatter } = useData()
/** 由 config.transformPageData 写入：frontmatter 声明的作者，成员信息已在构建期按名字合并。 */
const authors = computed<Author[]>(() => Array.isArray(frontmatter.value.authors) ? frontmatter.value.authors as Author[] : [])
</script>

<template>
<ul v-if="authors.length" class="article-authors" aria-label="本文作者">
	<li v-for="(author, index) in authors" :key="`${author.name}-${author.link || index}`" class="article-author-item">
		<!-- 悬停展示 contact 联系方式标签（纯 CSS tooltip）；没填 contact 就只是胶囊本身 -->
		<ArticleAuthorPill :author="author" />
	</li>
</ul>
</template>
