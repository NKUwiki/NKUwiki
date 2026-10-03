<script setup lang="ts">
import { useData } from 'vitepress'
import { computed, ref } from 'vue'
import historyData from '../../history.json'
import { repoUrl } from '../../lib/data/site'

interface CommitEntry {
	hash: string
	message: string
	author: string
	github: string | null
	date: string
}

const { page, frontmatter } = useData()

// history.json 由 scripts/gen-history.mjs 在 dev / build 前生成，键为相对 docs 的源文档路径。
// 客户端路由里的 relativePath 是 rewrites 改写后的虚拟路径（如 pages/BasicContribution/index.md），
// 因此优先使用 transformPageData 写入 frontmatter 的真实源路径，未改写的页面回退到 relativePath。
const commits = computed<CommitEntry[]>(() => {
	const source = frontmatter.value.sourcePath
	const path = typeof source === 'string' && source ? source : page.value.relativePath
	if (!path)
		return []
	return (historyData as Record<string, CommitEntry[]>)[path] ?? []
})

const lastCommit = computed(() => commits.value[0] ?? null)
const lastEdited = computed(() => lastCommit.value ? formatRelative(lastCommit.value.date) : '')

/** 排序切换：默认按时间倒序（最新在前），点击图标改为正序（旧提交在前） */
const isDescending = ref(true)
const isOpen = ref(false)
const sortedCommits = computed(() => isDescending.value ? commits.value : [...commits.value].reverse())

function toggleSort() {
	// 与参考实现一致：仅在列表展开时可切换，折叠时点击无反馈容易让人以为控件失灵
	if (isOpen.value)
		isDescending.value = !isDescending.value
}

function formatDate(iso: string): string {
	const date = new Date(iso)
	if (Number.isNaN(date.getTime()))
		return iso
	const pad = (value: number) => String(value).padStart(2, '0')
	return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 折叠栏用相对时间（「4 个月前」），展开列表仍用精确时间 */
function formatRelative(iso: string): string {
	const date = new Date(iso)
	if (Number.isNaN(date.getTime()))
		return iso
	const diffMinutes = Math.round((date.getTime() - Date.now()) / 60000)
	const rtf = new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' })
	if (Math.abs(diffMinutes) < 60)
		return rtf.format(diffMinutes, 'minute')
	const diffHours = Math.round(diffMinutes / 60)
	if (Math.abs(diffHours) < 24)
		return rtf.format(diffHours, 'hour')
	const diffDays = Math.round(diffHours / 24)
	if (Math.abs(diffDays) < 30)
		return rtf.format(diffDays, 'day')
	const diffMonths = Math.round(diffDays / 30)
	if (Math.abs(diffMonths) < 12)
		return rtf.format(diffMonths, 'month')
	return rtf.format(Math.round(diffDays / 365), 'year')
}
</script>

<template>
<!-- 包一层 vp-doc 容器（同 SJTU 主题 AppFooter 的做法）：
     doc-after 插槽本身在 .vp-doc 之外，包上后标题才能拿到标准 h2 样式
     （分割线、24px、悬停显示 # 锚点），无需自行复刻样式 -->
<div v-if="commits.length" class="vp-doc">
	<section class="git-history" aria-label="页面历史">
		<h2 id="页面历史">
			<a class="header-anchor" href="#页面历史" aria-label="Permalink to &quot;页面历史&quot;" />
			页面历史
		</h2>
		<details class="git-history-details" @toggle="isOpen = ($event.target as HTMLDetailsElement).open">
			<summary class="git-history-summary">
				<span class="git-history-summary-main">
					<!-- 与 Nolebase GitChangelog 同一个图标（octicon history-16），直接内联以免依赖插件内部的 UnoCSS 类 -->
					<svg class="git-history-icon" viewBox="0 0 16 16" aria-hidden="true">
						<path d="m.427 1.927 1.215 1.215a8.002 8.002 0 1 1-1.6 5.685.75.75 0 1 1 1.493-.154 6.5 6.5 0 1 0 1.18-4.458l1.358 1.358A.25.25 0 0 1 3.896 6H.25A.25.25 0 0 1 0 5.75V2.104a.25.25 0 0 1 .427-.177M7.75 4a.75.75 0 0 1 .75.75v2.992l2.028.812a.75.75 0 0 1-.557 1.392l-2.5-1A.75.75 0 0 1 7 8.25v-3.5A.75.75 0 0 1 7.75 4" />
					</svg>
					<span>最后编辑于 {{ lastEdited }}</span>
				</span>
				<span class="git-history-summary-action">
					<button
						type="button"
						class="git-history-sort"
						:disabled="!isOpen"
						:title="isDescending ? '当前：最新提交在前，点击切换为最早在前' : '当前：最早提交在前，点击切换为最新在前'"
						:aria-label="isDescending ? '按时间倒序排列，点击切换为正序' : '按时间正序排列，点击切换为倒序'"
						@click.prevent.stop="toggleSort"
					>
						<svg v-if="isDescending" class="git-history-sort-icon" viewBox="0 0 16 16" aria-hidden="true">
							<path d="M0 4.25a.75.75 0 0 1 .75-.75h7.5a.75.75 0 0 1 0 1.5H.75A.75.75 0 0 1 0 4.25m0 4a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 0 1.5H.75a.75.75 0 0 1-.75-.75m0 4a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5H.75a.75.75 0 0 1-.75-.75M13.5 10h2.25a.25.25 0 0 1 .177.427l-3 3a.25.25 0 0 1-.354 0l-3-3A.25.25 0 0 1 9.75 10H12V3.75a.75.75 0 0 1 1.5 0z" />
						</svg>
						<svg v-else class="git-history-sort-icon" viewBox="0 0 16 16" aria-hidden="true">
							<path d="m12.927 2.573 3 3A.25.25 0 0 1 15.75 6H13.5v6.75a.75.75 0 0 1-1.5 0V6H9.75a.25.25 0 0 1-.177-.427l3-3a.25.25 0 0 1 .354 0M0 12.25a.75.75 0 0 1 .75-.75h7.5a.75.75 0 0 1 0 1.5H.75a.75.75 0 0 1-.75-.75m0-4a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 0 1.5H.75A.75.75 0 0 1 0 8.25m0-4a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5H.75A.75.75 0 0 1 0 4.25" />
						</svg>
					</button>
					查看完整历史
				</span>
				<svg class="git-history-chevron" viewBox="0 0 16 16" aria-hidden="true">
					<path d="M12.78 5.22a.749.749 0 0 1 0 1.06l-4.25 4.25a.749.749 0 0 1-1.06 0L3.22 6.28a.749.749 0 1 1 1.06-1.06L8 8.939l3.72-3.719a.749.749 0 0 1 1.06 0Z" />
				</svg>
			</summary>
			<ul class="git-history-list">
				<li v-for="commit in sortedCommits" :key="commit.hash" class="git-history-item">
					<span class="git-history-hash-block">
						<a
							class="git-history-hash"
							:href="`${repoUrl}/commit/${commit.hash}`"
							target="_blank"
							rel="noopener noreferrer"
							:title="`查看提交 ${commit.hash}`"
						>{{ commit.hash }}</a>
					</span>
					<span class="git-history-message" :title="commit.message">{{ commit.message }}</span>
					<span class="git-history-meta">
						<a
							v-if="commit.github"
							class="git-history-author"
							:href="`https://github.com/${commit.github}`"
							target="_blank"
							rel="noopener noreferrer"
							:title="`${commit.author} 的 GitHub 主页`"
						>{{ commit.author }}</a>
						<span v-else class="git-history-author">{{ commit.author }}</span>
						<span class="git-history-time">于 {{ formatDate(commit.date) }}</span>
					</span>
				</li>
			</ul>
		</details>
	</section>
</div>
</template>

<style scoped>
.git-history-details {
	overflow: hidden;
	border: 1px solid var(--vp-c-divider);
	border-radius: var(--wiki-radius);
	background: var(--vp-c-bg-soft);
	/* 悬停时整框描边渐变到品牌色（动效参照 Nolebase GitChangelog：color ease-in-out 200ms） */
	transition: border-color ease-in-out, background-color ease-in-out;
	transition-duration: 200ms;
}

.git-history-details:hover {
	border-color: color-mix(in srgb, var(--vp-c-brand-1) 45%, var(--vp-c-divider));
}

/* details 收起时彻底隐藏列表：给子元素显式设置 display 后，
   部分浏览器不再应用默认的收起隐藏，导致收起状态下列表仍占位，
   把框撑高一截并在底部露出列表边缘 */
.git-history-details:not([open]) .git-history-list {
	display: none;
}

.git-history-summary {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 16px;
	/* vp-doc 容器会给 summary 带 1rem 上下外边距，重置掉以免撑高折叠条 */
	margin: 0;
	padding: 14px 16px;
	font-size: 14px;
	color: var(--vp-c-text-2);
	transition: color ease-in-out;
	transition-duration: 200ms;
	list-style: none;
	cursor: pointer;
	user-select: none;
}

.git-history-summary::-webkit-details-marker {
	display: none;
}

.git-history-summary-main,
.git-history-summary-action {
	display: inline-flex;
	align-items: center;
	gap: 8px;
}

.git-history-summary-main {
	font-weight: 600;
	color: var(--vp-c-text-1);
	transition: color ease-in-out;
	transition-duration: 200ms;
}

.git-history-summary-action {
	margin-left: auto;
	font-size: 13px;
	font-weight: 400;
	color: var(--vp-c-text-3);
	transition: color ease-in-out;
	transition-duration: 200ms;
}

/* 悬停时整条摘要（含图标）渐变到品牌色 */
.git-history-summary:hover,
.git-history-summary:hover .git-history-summary-main,
.git-history-summary:hover .git-history-summary-action,
.git-history-summary:hover .git-history-chevron {
	color: var(--vp-c-brand-1);
}

/* 标题不加任何定制：完全沿用 .vp-doc h2 默认样式（含悬停显示的 # 锚点） */

.git-history-icon {
	flex: 0 0 auto;
	width: 16px;
	height: 16px;
	fill: currentColor;
}

/* 排序切换按钮：仅是个去掉默认样式的图标按钮 */
.git-history-sort {
	display: inline-flex;
	align-items: center;
	padding: 0;
	border: 0;
	background: none;
	font: inherit;
	color: inherit;
	cursor: pointer;
}

.git-history-sort:disabled {
	opacity: 0.6;
	cursor: default;
}

.git-history-sort-icon {
	width: 14px;
	height: 14px;
	fill: currentColor;
}

.git-history-chevron {
	flex: 0 0 auto;
	width: 16px;
	height: 16px;
	color: var(--vp-c-text-3);
	fill: currentColor;
	transition: transform 0.2s ease, color ease-in-out 0.2s;
}

.git-history-details[open] .git-history-chevron {
	transform: rotate(180deg);
}

.git-history-list {
	display: flex;
	flex-direction: column;
	gap: 10px;
	overflow-y: auto;
	max-height: 22rem;
	margin: 0;
	padding: 2px 16px 14px;
	list-style: none;
}

.git-history-item {
	display: flex;
	flex-wrap: wrap;
	align-items: baseline;
	gap: 4px 10px;
	font-size: 13px;
	line-height: 1.6;
}

.git-history-hash-block {
	display: inline-flex;
	flex: 0 0 auto;
	align-items: center;
	padding: 3px 7px;
	border: 1px solid var(--vp-c-divider);
	border-radius: 5px;
	background: var(--vp-c-bg);
	line-height: 1;
}

.git-history-hash {
	font-family: var(--vp-font-family-mono);
	font-size: 12px;
	text-decoration: none;
	color: var(--vp-c-brand-1);
	transition: color 0.15s;
}

.git-history-hash:hover {
	color: var(--vp-c-brand-2);
}

.git-history-message {
	flex: 1 1 auto;
	overflow: hidden;
	min-width: 12rem;
	white-space: nowrap;
	text-overflow: ellipsis;
	color: var(--vp-c-text-1);
}

.git-history-meta {
	display: inline-flex;
	flex-shrink: 0;
	align-items: baseline;
	gap: 6px;
	margin-left: auto;
	font-size: 12px;
	color: var(--vp-c-text-3);
}

.git-history-author {
	text-decoration: none;
	color: var(--vp-c-text-2);
}

a.git-history-author:hover {
	text-decoration: underline;
	color: var(--vp-c-brand-1);
}

.git-history-time {
	white-space: nowrap;
}
</style>
