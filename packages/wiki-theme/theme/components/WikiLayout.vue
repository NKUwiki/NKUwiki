<script setup lang="ts">
import {
	NolebaseEnhancedReadabilitiesMenu,
	NolebaseEnhancedReadabilitiesScreenMenu,
} from '@nolebase/vitepress-plugin-enhanced-readabilities/client'
import { useData, useRoute, withBase } from 'vitepress'
import DefaultTheme from 'vitepress/theme-without-fonts'
import { computed, onMounted, watch } from 'vue'
import AnnouncementBar from './AnnouncementBar.vue'
import ArticleAuthors from './ArticleAuthors.vue'
import BackTop from './BackTop.vue'
import GitHistory from './GitHistory.vue'
import ImagePreview from './ImagePreview.vue'
import PrintButton from './PrintButton.vue'
import SidebarToggle from './SidebarToggle.vue'
import SiteIcon from './SiteIcon.vue'
import WaterMark from './WaterMark.vue'
import '@nolebase/vitepress-plugin-enhanced-readabilities/client/style.css'

// <WikiSearch/> 由站点侧薄壳注册为全局异步组件（searchDocs 依赖站点侧 data loader），
// 这里不直接 import，避免主题包反向依赖站点数据层

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
	<!-- 公告横条固定在视口顶部，下方区域按 --vp-layout-top-height 让位 -->
	<template #layout-top>
		<AnnouncementBar />
		<SidebarToggle class="wiki-sidebar-toggle-floating" />
		<BackTop />
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
	<template #doc-footer-before>
		<ArticleAuthors />
	</template>
	<!-- 右侧目录面板顶部：「打印本页」入口（打印排版由 base.css 的 @media print 承担） -->
	<template #aside-top>
		<PrintButton />
	</template>
	<!-- 文件历史：frontmatter 设 hideChangelog: true 可隐藏单篇 -->
	<template #doc-after>
		<GitHistory v-if="frontmatter.hideChangelog !== true" :key="changelogKey" />
	</template>
</DefaultTheme.Layout>
<!-- 图片预览：文档级 click 委托唤起，Teleport 到 body，全站唯一实例 -->
<ImagePreview />
<!-- 全局水印：斜向平铺站名，frontmatter 设 watermark: false 可单页关闭 -->
<WaterMark />
</template>
