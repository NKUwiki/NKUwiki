<script setup lang="ts">
import sidebarFoldIcon from '@iconify-icons/ri/sidebar-fold-line'
import sidebarUnfoldIcon from '@iconify-icons/ri/sidebar-unfold-line'
import { Icon } from '@iconify/vue'
import { sidebarCollapsed, toggleSidebarCollapsed } from '../composables/sidebar'
</script>

<template>
<button
	class="wiki-sidebar-toggle"
	type="button"
	:title="sidebarCollapsed ? '展开左侧目录' : '收起左侧目录'"
	:aria-label="sidebarCollapsed ? '展开左侧目录' : '收起左侧目录'"
	:aria-expanded="!sidebarCollapsed"
	aria-controls="VPSidebarNav"
	@click="toggleSidebarCollapsed"
>
	<!-- 两个图标都渲染、在同一个网格单元里叠放，由 CSS 按侧栏状态交叉淡入并旋转，
	比 v-if 瞬间换一个 SVG 多一重方向感（收起与展开各转一个方向）；
	可访问名由按钮自身的 aria-label 承担，图标对读屏隐藏。 -->
	<Icon :icon="sidebarFoldIcon" class="toggle-icon toggle-icon-fold" aria-hidden="true" />
	<Icon :icon="sidebarUnfoldIcon" class="toggle-icon toggle-icon-unfold" aria-hidden="true" />
</button>
</template>
