<script setup lang="ts">
import { initialsAvatar } from '@nkuwiki/theme/lib/data/authors.ts'
/**
 * 项目成员网格：用于「关于我们」等页面展示成员/贡献者卡片。
 *
 * 数据来自站点侧 members 表（docs/.vitepress/data/members.ts，含联系方式，
 * 不随主题包分发），因此本组件放站点侧而非主题包。
 * 头像优先级与作者胶囊一致：显式 avatar > GitHub 头像 > 本地首字兜底图；
 * 网络头像加载失败时也退到首字图。
 */
import { computed, reactive } from 'vue'
import { members } from '../../data/members.ts'

const props = defineProps<{ /** 不展示的成员名，如仅作兜底的组织账号 */ exclude?: string[] }>()

const list = computed(() =>
	Object.entries(members)
		.filter(([name]) => !props.exclude?.includes(name))
		.map(([name, member]) => {
			const github = member.github || ''
			return {
				name,
				github,
				avatar: member.avatar || (github ? `https://github.com/${github}.png` : ''),
				fallback: initialsAvatar(name),
				link: member.link || (github ? `https://github.com/${github}` : ''),
				contact: member.contact || member.email?.replace(/^mailto:/, '') || '',
			}
		}),
)

/** 网络头像加载失败的名字集合，失败后改用本地首字图 */
const broken = reactive<Record<string, boolean>>({})
</script>

<template>
<div class="member-grid">
	<article v-for="person in list" :key="person.name" class="member-card">
		<img
			v-if="person.avatar && !broken[person.name]"
			class="member-avatar"
			:src="person.avatar"
			:alt="`${person.name} 的头像`"
			width="56"
			height="56"
			loading="lazy"
			@error="broken[person.name] = true"
		>
		<span v-else class="member-avatar member-avatar-fallback" aria-hidden="true">{{ [...person.name][0] }}</span>
		<span class="member-name">{{ person.name }}</span>
		<span v-if="person.contact" class="member-contact">{{ person.contact }}</span>
		<a
			v-if="person.link"
			class="member-link"
			:href="person.link"
			target="_blank"
			rel="noopener noreferrer"
			:aria-label="`${person.name} 的 GitHub`"
			:title="`${person.name} 的 GitHub`"
		>
			<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
				<path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82A7.65 7.65 0 0 1 8 3.87c.68 0 1.36.09 2 .26 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
			</svg>
		</a>
	</article>
</div>
</template>

<style scoped>
.member-grid {
	display: grid;
	grid-template-columns: repeat(4, minmax(0, 1fr));
	gap: 8px;
	margin: 24px 0;
}

.member-card {
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 4px;
	min-height: 132px;
	padding: 12px 8px;
	border: 1px solid var(--vp-c-divider);
	border-radius: var(--wiki-radius, 8px);
	background: var(--vp-c-bg-soft);
	text-align: center;
	transition: border-color 0.2s ease;
}

.member-card:hover {
	border-color: var(--vp-c-brand-1);
}

.member-avatar {
	width: 56px;
	height: 56px;
	margin-bottom: 4px;
	border-radius: 50%;
	object-fit: cover;
}

.member-avatar-fallback {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	background: var(--vp-c-brand-1);
	font-size: 22px;
	font-weight: 700;
	color: #FFF;
}

.member-name {
	font-size: 15px;
	font-weight: 600;
	line-height: 1.4;
	color: var(--vp-c-text-1);
}

.member-contact {
	font-size: 12px;
	line-height: 1.4;
	word-break: break-all;
	color: var(--vp-c-text-3);
}

.member-link {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	margin-top: 4px;
	color: var(--vp-c-brand-1);
	transition: color 0.15s ease;
}

.member-link:hover {
	color: var(--vp-c-brand-2);
}

@media (max-width: 640px) {
	.member-grid {
		grid-template-columns: 1fr;
	}
}

@media (min-width: 641px) and (max-width: 960px) {
	.member-grid {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}
}
</style>
