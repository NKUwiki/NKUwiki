<script setup lang="ts">
import { useData } from 'vitepress'
import { computed } from 'vue'
import historyData from '../../history.json'
import { repoUrl } from '../../site'

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
const lastEdited = computed(() => lastCommit.value ? formatDate(lastCommit.value.date) : '')

function formatDate(iso: string): string {
	const date = new Date(iso)
	if (Number.isNaN(date.getTime()))
		return iso
	const pad = (value: number) => String(value).padStart(2, '0')
	return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
</script>

<template>
<section v-if="commits.length" class="git-history" aria-label="页面历史">
	<h2 id="页面历史" class="git-history-title">
		<svg class="git-history-title-icon" viewBox="0 0 16 16" aria-hidden="true">
			<path d="M11.93 8.5a4.002 4.002 0 0 1-7.86 0H.75a.75.75 0 0 1 0-1.5h3.32a4.002 4.002 0 0 1 7.86 0h3.32a.75.75 0 0 1 0 1.5Zm-1.43-.75a2.5 2.5 0 1 0-5 0 2.5 2.5 0 0 0 5 0Z" />
		</svg>
		页面历史
	</h2>
	<details class="git-history-details">
		<summary class="git-history-summary">
			<span class="git-history-summary-main">
				<span>最后编辑于 {{ lastEdited }}</span>
			</span>
			<span class="git-history-summary-action">查看完整历史</span>
			<svg class="git-history-chevron" viewBox="0 0 16 16" aria-hidden="true">
				<path d="M12.78 5.22a.749.749 0 0 1 0 1.06l-4.25 4.25a.749.749 0 0 1-1.06 0L3.22 6.28a.749.749 0 1 1 1.06-1.06L8 8.939l3.72-3.719a.749.749 0 0 1 1.06 0Z" />
			</svg>
		</summary>
		<ul class="git-history-list">
			<li v-for="commit in commits" :key="commit.hash" class="git-history-item">
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
</template>

<style scoped>
.git-history-details {
	overflow: hidden;
	border: 1px solid var(--vp-c-divider);
	border-radius: var(--wiki-radius);
	background: var(--vp-c-bg-soft);
}

.git-history-summary {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 16px;
	padding: 14px 16px;
	font-size: 14px;
	color: var(--vp-c-text-2);
	list-style: none;
	cursor: pointer;
	user-select: none;
}

.git-history-summary::-webkit-details-marker {
	display: none;
}

.git-history-summary:hover {
	color: var(--vp-c-brand-1);
}

.git-history-summary-main,
.git-history-summary-action {
	display: inline-flex;
	align-items: center;
	gap: 8px;
}

.git-history-summary-main {
	font-weight: 600;
}

.git-history-summary-action {
	margin-left: auto;
	font-size: 13px;
	font-weight: 400;
	color: var(--vp-c-text-3);
}

/* 区块标题与「本文作者」标题同款：小号、带品牌色图标，弱于正文大标题 */
.git-history {
	margin-top: 40px;
}

.git-history-title {
	display: flex;
	align-items: center;
	gap: 6px;
	margin: 0 0 14px;
	padding: 0;
	border: 0;
	font-size: 14px;
	font-weight: 600;
	line-height: 20px;
	color: var(--vp-c-text-1);
}

.git-history-title-icon {
	flex: 0 0 auto;
	width: 14px;
	height: 14px;
	color: var(--vp-c-brand-1);
	fill: currentColor;
}

.git-history-chevron {
	flex: 0 0 auto;
	width: 16px;
	height: 16px;
	color: var(--vp-c-text-3);
	fill: currentColor;
	transition: transform 0.2s ease;
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
