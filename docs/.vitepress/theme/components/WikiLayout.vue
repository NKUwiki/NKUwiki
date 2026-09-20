<script setup lang="ts">
import { useData, withBase } from 'vitepress'
import DefaultTheme from 'vitepress/theme-without-fonts'
import { defineAsyncComponent, onMounted, watch } from 'vue'
import ArticleMeta from './ArticleMeta.vue'
import SiteIcon from './SiteIcon.vue'

// 搜索组件按需加载：MiniSearch 与弹窗代码不进首屏主包
const WikiSearch = defineAsyncComponent(() => import('./WikiSearch.vue'))

const { isDark } = useData()
onMounted(() => {
	watch(isDark, (dark) => {
		document.querySelectorAll<HTMLLinkElement>('link[data-wiki-icon]').forEach(link => link.href = withBase(dark ? '/favicon-dark.svg' : '/favicon-light.svg'))
	}, { immediate: true })
})
</script>

<template>
<DefaultTheme.Layout>
	<template #nav-bar-title-before>
		<SiteIcon class="site-icon" />
	</template>
	<template #nav-bar-content-after>
		<WikiSearch />
	</template>
	<template #nav-screen-content-after>
		<WikiSearch screen />
	</template>
	<template #sidebar-nav-before>
		<a class="directory-trigger" :href="withBase('/categories/')">全部目录</a>
	</template>
	<template #doc-before>
		<ArticleMeta />
	</template>
</DefaultTheme.Layout>
</template>
