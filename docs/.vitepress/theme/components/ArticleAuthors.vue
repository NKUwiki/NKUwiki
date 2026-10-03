<script setup lang="ts">
import type { Author } from '../../types.ts'
import { useData } from 'vitepress'
import { computed } from 'vue'
import { Tippy } from 'vue-tippy'
import ArticleAuthorPill from './ArticleAuthorPill.vue'
import 'tippy.js/dist/tippy.css'

const { frontmatter } = useData()
/** 由 config.transformPageData 写入：frontmatter 声明的作者，成员信息已在构建期按名字合并。 */
const authors = computed<Author[]>(() => Array.isArray(frontmatter.value.authors) ? frontmatter.value.authors as Author[] : [])

const appendTo = () => document.body
</script>

<template>
<ul v-if="authors.length" class="article-authors" aria-label="本文作者">
	<li v-for="(author, index) in authors" :key="`${author.name}-${author.link || index}`" class="article-author-item">
		<!-- 悬停展示 contact 联系方式标签（tippy，主题 wiki）；没填 contact 就只是胶囊本身 -->
		<Tippy v-if="author.contact" :content="author.contact" theme="wiki" :append-to="appendTo" :max-width="320" placement="top">
			<ArticleAuthorPill :author="author" />
		</Tippy>
		<ArticleAuthorPill v-else :author="author" />
	</li>
</ul>
</template>
