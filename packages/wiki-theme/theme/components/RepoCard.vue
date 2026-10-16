<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

/**
 * GitHub 仓库卡片：markdown 里写 <RepoCard repo="vuejs/vitepress" />。
 * 功能对齐 plume 主题的 RepoCard：星标/Fork k 格式化、主语言色点、License、
 * Public/Archived 可见性徽章、fullname/组织识别；
 * 但数据层不走 plume 的第三方代理 API，而是直连 GitHub 官方 API +
 * localStorage 缓存 24h（官方 API 每 IP 每小时仅 60 次匿名额度，缓存避免刷限流）。
 * 接口失败（限流/断网）时降级为普通链接卡片。
 */
const props = withDefaults(defineProps<{
	/** 仓库，格式 owner/repo */
	repo: string
	/** 是否显示完整仓库名 owner/repo；缺省时组织仓库显示全名、个人仓库只显示仓库名（对齐 plume） */
	fullname?: boolean
}>(), { fullname: undefined })

interface RepoInfo {
	html_url: string
	name: string
	full_name: string
	description: string | null
	stargazers_count: number
	forks_count: number
	language: string | null
	archived: boolean
	visibility: string
	owner?: { avatar_url?: string, type?: string }
	license?: { name?: string, spdx_id?: string } | null
}

/** 常见语言色点（GitHub 语言色系的常用子集，REST API 不返回颜色，未收录的用灰点） */
const LANG_COLORS: Record<string, string> = {
	'JavaScript': '#f1e05a',
	'TypeScript': '#3178c6',
	'Vue': '#41b883',
	'Python': '#3572A5',
	'Java': '#b07219',
	'C++': '#f34b7d',
	'C': '#555555',
	'C#': '#178600',
	'Go': '#00ADD8',
	'Rust': '#dea584',
	'PHP': '#4F5D95',
	'Ruby': '#701516',
	'Shell': '#89e051',
	'HTML': '#e34c26',
	'CSS': '#563d7c',
	'Swift': '#F05138',
	'Kotlin': '#A97BFF',
	'Dart': '#00B4AB',
}

const CACHE_KEY = 'wiki:repo-card-cache'
const CACHE_TTL = 24 * 60 * 60 * 1000

const info = ref<RepoInfo | null>(null)
const failed = ref(false)

const fallbackUrl = computed(() => `https://github.com/${props.repo}`)
const safeRepo = computed(() => props.repo.replace(/[^\w./-]/g, ''))

/** 显示名：fullname 为 true 或 owner 是组织（未显式传 fullname）时显示 owner/repo */
const displayName = computed(() => {
	if (info.value == null)
		return safeRepo.value
	const showFull = props.fullname ?? info.value.owner?.type === 'Organization'
	return showFull ? info.value.full_name : info.value.name
})

const visibilityLabel = computed(() => {
	if (info.value == null)
		return ''
	const v = (info.value.visibility || 'public').replace(/^./, ch => ch.toUpperCase())
	return info.value.archived ? `${v} · archived` : v
})

function formatCount(num: number): number | string {
	return num < 1000 ? num : `${(num / 1000).toFixed(1)}k`
}

const starsLabel = computed(() => info.value ? formatCount(info.value.stargazers_count) : '')
const forksLabel = computed(() => info.value ? formatCount(info.value.forks_count) : '')

const licenseLabel = computed(() => {
	const spdx = info.value?.license?.spdx_id
	return spdx && spdx !== 'NOASSERTION' ? spdx : info.value?.license?.name || ''
})

function readCache(key: string): RepoInfo | null {
	try {
		const parsed: unknown = JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}')
		if (parsed && typeof parsed === 'object' && key in parsed) {
			const entry = (parsed as Record<string, { info?: RepoInfo, updatedAt?: number }>)[key]
			if (entry?.info?.name && Date.now() - (entry.updatedAt ?? 0) <= CACHE_TTL)
				return entry.info
		}
	}
	catch {}
	return null
}

function writeCache(key: string, value: RepoInfo) {
	try {
		const parsed: unknown = JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}')
		const store = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>
		store[key] = { info: value, updatedAt: Date.now() }
		localStorage.setItem(CACHE_KEY, JSON.stringify(store))
	}
	catch {}
}

let controller: AbortController | undefined

onUnmounted(() => {
	// 请求还没回来就切页时取消，别白耗 GitHub API 配额
	controller?.abort()
})

onMounted(async () => {
	const key = safeRepo.value
	const cached = readCache(key)
	if (cached) {
		info.value = cached
		return
	}
	controller = new AbortController()
	const timer = setTimeout(() => controller?.abort(), 8000)
	try {
		const res = await fetch(`https://api.github.com/repos/${key}`, {
			signal: controller.signal,
			headers: { Accept: 'application/vnd.github+json' },
		})
		if (!res.ok)
			throw new Error(String(res.status))
		const data = await res.json() as RepoInfo
		info.value = data
		writeCache(key, data)
	}
	catch {
		failed.value = true
	}
	finally {
		// 必须放 finally：fetch 直接 reject（网络错误、被 abort）时会跳过
		// try 末尾那句 clearTimeout，8 秒定时器就留在事件循环里了
		clearTimeout(timer)
	}
})
</script>

<template>
<a
	class="wiki-repo-card" :class="{ 'wiki-repo-card--simple': failed }"
	:href="info?.html_url ?? fallbackUrl" target="_blank" rel="noopener noreferrer"
>
	<span v-if="info?.owner?.avatar_url" class="wiki-repo-card-avatar" aria-hidden="true">
		<img :src="info.owner.avatar_url" alt="" loading="lazy">
	</span>
	<span v-else-if="!failed" class="wiki-repo-card-avatar" aria-hidden="true">
		<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" /></svg>
	</span>
	<span class="wiki-repo-card-body">
		<span class="wiki-repo-card-name">
			{{ displayName }}
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M7 17L17 7" /><path d="M8 7h9v9" /></svg>
			<span v-if="info" class="wiki-repo-card-visibility" :class="{ archived: info.archived }">{{ visibilityLabel }}</span>
		</span>
		<span v-if="info?.description" class="wiki-repo-card-desc">{{ info.description }}</span>
		<span v-else-if="failed" class="wiki-repo-card-desc">GitHub 仓库</span>
		<span v-if="info" class="wiki-repo-card-meta">
			<span v-if="info.language" class="wiki-repo-card-lang">
				<span class="dot" :style="{ background: LANG_COLORS[info.language] ?? '#8b949e' }" />{{ info.language }}
			</span>
			<span class="wiki-repo-card-stat" :aria-label="`Star 数 ${info.stargazers_count}`">
				<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z" /></svg>
				{{ starsLabel }}
			</span>
			<span class="wiki-repo-card-stat" :aria-label="`Fork 数 ${info.forks_count}`">
				<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M5 5.372v.878c0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75v-.878a2.25 2.25 0 1 1 1.5 0v.878a2.25 2.25 0 0 1-2.25 2.25h-1.5v2.128a2.251 2.251 0 1 1-1.5 0V8.5h-1.5A2.25 2.25 0 0 1 3.5 6.25v-.878a2.25 2.25 0 1 1 1.5 0ZM5 3.25a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Zm6.75.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm-3 8.75a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Z" /></svg>
				{{ forksLabel }}
			</span>
			<span v-if="licenseLabel" class="wiki-repo-card-stat">
				<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 13.5h7M8.01 1v12.06M1.5 3.5h3l1.5-1h4l1.5 1h3M.5 10L3 4.48L5.5 10C4 11 2 11 .5 10m10 0L13 4.48L15.5 10c-1.5 1-3.5 1-5 0" /></svg>
				{{ licenseLabel }}
			</span>
		</span>
	</span>
</a>
</template>

<style scoped>
.wiki-repo-card {
	display: flex;
	gap: 0.75rem;
	max-width: 30rem;
	margin: 0.75rem 0;
	padding: 0.75rem 0.875rem;
	border: 1px solid var(--vp-c-divider);
	border-radius: 10px;
	background: var(--vp-c-bg-soft);
	color: inherit;
	transition: border-color 0.25s, box-shadow 0.25s;
}

.wiki-repo-card:hover {
	border-color: var(--vp-c-brand-1);
	box-shadow: var(--vp-shadow-1);
	text-decoration: none;
}

.wiki-repo-card-avatar {
	flex: none;
	width: 36px;
	height: 36px;
	color: var(--vp-c-text-2);
}

.wiki-repo-card-avatar img,
.wiki-repo-card-avatar svg {
	width: 100%;
	height: 100%;
	border-radius: 8px;
}

.wiki-repo-card-body {
	display: flex;
	flex: 1;
	flex-direction: column;
	gap: 0.25rem;
	min-width: 0;
}

.wiki-repo-card-name {
	display: flex;
	align-items: center;
	gap: 0.375rem;
	min-width: 0;
	font-weight: 600;
	color: var(--vp-c-brand-1);
}

.wiki-repo-card-name svg {
	flex: none;
	opacity: 0.6;
	width: 0.8em;
	height: 0.8em;
}

.wiki-repo-card-visibility {
	flex: none;
	margin-left: auto;
	padding: 0 0.5rem;
	border: 1px solid var(--vp-c-divider);
	border-radius: 22px;
	font-size: 0.7rem;
	font-weight: 400;
	line-height: 1.5;
	color: var(--vp-c-text-2);
}

.wiki-repo-card-visibility.archived {
	border-color: var(--vp-c-warning-2);
	color: var(--vp-c-warning-1);
}

.wiki-repo-card-desc {
	display: -webkit-box;
	overflow: hidden;
	font-size: 0.85rem;
	-webkit-line-clamp: 2;
	color: var(--vp-c-text-2);
	-webkit-box-orient: vertical;
}

.wiki-repo-card-meta {
	display: flex;
	flex-wrap: wrap;
	gap: 0.25rem 1rem;
	font-size: 0.8rem;
	color: var(--vp-c-text-3);
}

.wiki-repo-card-stat,
.wiki-repo-card-lang {
	display: flex;
	align-items: center;
	gap: 0.25rem;
}

.wiki-repo-card-stat svg {
	width: 0.85em;
	height: 0.85em;
}

.wiki-repo-card-lang .dot {
	width: 0.7em;
	height: 0.7em;
	border-radius: 50%;
}
</style>
