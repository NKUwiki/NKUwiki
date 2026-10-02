<script setup lang="ts">
import { useData } from 'vitepress'
import { repoUrl } from '../../site'

const { page } = useData()
</script>

<template>
<main class="wiki-wide">
	<div class="wiki-article-content vp-doc">
		<Content />
	</div>
	<footer class="wide-footer">
		<a :href="`${repoUrl}/blame/main/docs/${page.filePath}`">源代码</a>
		<time v-if="page.lastUpdated" :datetime="new Date(page.lastUpdated).toISOString()">最后修改于：{{ new Date(page.lastUpdated).toISOString().slice(0, 10) }}</time>
	</footer>
</main>
</template>
