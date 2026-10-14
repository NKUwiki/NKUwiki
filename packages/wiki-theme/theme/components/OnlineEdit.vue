<script setup lang="ts">
import { useData } from 'vitepress'
import { computed } from 'vue'

/**
 * 「在线编辑本页」入口：深链到 webObsidian 在线编辑平台（https://github.com/xnohat/webobsidian）
 * 的当前页编辑器，读者改完可在平台内直接提交 PR。
 *
 * 接口处于预留状态：构建期环境变量 VITE_EDITOR_URL 未设置（平台尚未部署）时整体不渲染；
 * frontmatter 设 edit: false 可单篇关闭。开启方式见站点功能说明「评论与在线编辑」一节。
 */
const EDITOR_BASE = import.meta.env.VITE_EDITOR_URL as string | undefined

const { frontmatter, page } = useData()

const editUrl = computed(() => {
	if (!EDITOR_BASE || frontmatter.value.edit === false)
		return ''
	// filePath 是真实源码路径（相对 docs/，不受 rewrites 影响——VitePress 自家的
	// edit-link 也用它）；relativePath 在站点启用 rewrites 后是 /pages/… 的路由路径，
	// 指向的是仓库里不存在的虚拟文件，深链会落空
	const rel = page.value.filePath
	if (!rel)
		return ''
	// 深链格式与参考实现（QUT wiki）一致：平台地址 + /note/ + 逐段编码的路径。
	// 逐段编码保证中文目录名（如 05.计算机知识）在 URL 里安全。
	return `${EDITOR_BASE.replace(/\/+$/, '')}/note/${rel.split('/').map(encodeURIComponent).join('/')}`
})
</script>

<template>
<div v-if="editUrl" class="online-edit">
	<a class="online-edit-link" :href="editUrl" target="_blank" rel="noopener noreferrer" title="在 webObsidian 在线编辑器中打开本页">
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
			<path d="M12 20h9" />
			<path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
		</svg>
		在线编辑本页
	</a>
</div>
</template>

<style scoped>
.online-edit-link {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	padding: 3px 10px;
	border: 1px solid var(--vp-c-divider);
	border-radius: 999px;
	background: var(--vp-c-bg-soft);
	font-size: 13px;
	font-weight: 500;
	line-height: 20px;
	text-decoration: none;
	color: var(--vp-c-text-1);
	transition: border-color ease-in-out, color ease-in-out;
}

.online-edit-link:hover {
	border-color: var(--vp-c-brand-1);
	color: var(--vp-c-brand-1);
}

.online-edit-link svg {
	width: 14px;
	height: 14px;
}
</style>
