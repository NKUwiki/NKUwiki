<script setup lang="ts">
import {
	NolebaseEnhancedReadabilitiesMenu,
	NolebaseEnhancedReadabilitiesScreenMenu,
} from '@nolebase/vitepress-plugin-enhanced-readabilities/client'
import { NolebaseGitChangelog } from '@nolebase/vitepress-plugin-git-changelog/client'
import { useData, useRoute, withBase } from 'vitepress'
import DefaultTheme from 'vitepress/theme-without-fonts'
import { computed, defineAsyncComponent, onMounted, watch } from 'vue'
import ArticleAuthors from './ArticleAuthors.vue'
import ArticleMeta from './ArticleMeta.vue'
import SidebarToggle from './SidebarToggle.vue'
import SiteIcon from './SiteIcon.vue'
import '@nolebase/vitepress-plugin-enhanced-readabilities/client/style.css'
import '@nolebase/vitepress-plugin-git-changelog/client/style.css'

// 搜索组件按需加载：MiniSearch 与弹窗代码不进首屏主包
const WikiSearch = defineAsyncComponent(() => import('./WikiSearch.vue'))

const { frontmatter, isDark } = useData()
const route = useRoute()
// 按路由 key 强制重建组件，切页后文件历史随之刷新
const changelogKey = computed(() => route.path)
onMounted(() => {
	watch(isDark, (dark) => {
		document.querySelectorAll<HTMLLinkElement>('link[data-wiki-icon]').forEach(link => link.href = withBase(dark ? '/favicon-dark.svg' : '/favicon-light.svg'))
	}, { immediate: true })
})
</script>

<template>
<DefaultTheme.Layout>
	<!-- 目录收起后，左边缘浮一个按钮把它放回来 -->
	<template #layout-top>
		<SidebarToggle class="wiki-sidebar-toggle-floating" />
	</template>
	<template #nav-bar-title-before>
		<SiteIcon class="site-icon" />
	</template>
	<template #nav-bar-content-before>
		<WikiSearch />
	</template>
	<template #nav-bar-content-after>
		<NolebaseEnhancedReadabilitiesMenu />
	</template>
	<template #nav-screen-content-after>
		<WikiSearch screen />
		<NolebaseEnhancedReadabilitiesScreenMenu />
	</template>
	<template #sidebar-nav-before>
		<div class="sidebar-top">
			<a class="directory-trigger" :href="withBase('/categories/')">全部分类</a>
			<SidebarToggle />
		</div>
	</template>
	<template #doc-before>
		<ArticleMeta />
	</template>
	<template #doc-footer-before>
		<ArticleAuthors />
	</template>
	<!-- 文件历史：frontmatter 设 hideChangelog: true 可隐藏单篇 -->
	<template #doc-after>
		<NolebaseGitChangelog v-if="frontmatter.hideChangelog !== true" :key="changelogKey" />
	</template>
</DefaultTheme.Layout>
</template>
