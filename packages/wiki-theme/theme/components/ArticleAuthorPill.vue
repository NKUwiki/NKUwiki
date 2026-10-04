<script setup lang="ts">
import type { Author } from '../../lib/types.ts'
import AuthorAvatar from './AuthorAvatar.vue'

defineProps<{ author: Author }>()
</script>

<template>
<!-- 有 link（显式指定或 GitHub 个人页）时是链接，都没有时只是个不可点的徽章；
     填了 contact 时悬停/聚焦显示纯 CSS tooltip（data-tip），无需 tippy 运行时 -->
<component
	:is="author.link ? 'a' : 'span'"
	class="article-author-pill"
	:href="author.link"
	:target="author.link ? '_blank' : undefined"
	:rel="author.link ? 'noopener noreferrer' : undefined"
	:data-tip="author.contact || undefined"
	:aria-label="author.contact ? `${author.name}（联系方式：${author.contact}）` : undefined"
>
	<AuthorAvatar :name="author.name" :avatar="author.avatar" :fallback="author.fallback" />
	<span class="article-author-name">{{ author.name }}</span>
</component>
</template>
