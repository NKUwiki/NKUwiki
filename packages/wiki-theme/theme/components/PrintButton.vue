<script setup lang="ts">
/**
 * 「打印本页」按钮：挂在文章右侧目录面板顶部（aside-top），点击唤起浏览器打印。
 * 打印时的排版裁剪（隐藏导航/侧栏/浮层、正文占满页宽）由 base.css 的 @media print 承担，
 * 这里只负责入口；窄屏没有 aside，按钮随之隐藏（移动端走浏览器自带打印菜单）。
 */
function print() {
	window.print()
}
</script>

<template>
<button class="wiki-print-button" type="button" @click="print">
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
		<path d="M6 9V3h12v6" />
		<path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
		<rect x="6" y="14" width="12" height="8" rx="1" />
	</svg>
	打印本页
</button>
</template>

<style>
.wiki-print-button {
	display: flex;
	align-items: center;
	gap: 0.375rem;
	width: 100%;
	margin-bottom: 0.75rem;
	padding: 0.375rem 0.75rem;
	border: 1px solid var(--vp-c-divider);
	border-radius: 8px;
	background: var(--vp-c-bg);
	font-size: 0.8rem;
	color: var(--vp-c-text-2);
	transition: color var(--wiki-duration) var(--wiki-ease-out), border-color var(--wiki-duration) var(--wiki-ease-out);
	cursor: pointer;
}

.wiki-print-button:hover {
	border-color: var(--vp-c-brand-1);
	color: var(--vp-c-brand-1);
}

.wiki-print-button svg {
	width: 1em;
	height: 1em;
}
</style>
