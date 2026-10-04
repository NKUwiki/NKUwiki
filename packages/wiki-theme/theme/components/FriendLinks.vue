<script setup lang="ts">
import { withBase } from 'vitepress'
import HoverMedia from './HoverMedia.vue'
import SiteIcon from './SiteIcon.vue'

// 卡片数据由 md 里的 <flink> 块提供（lib/content/flink.ts 解析后注入），
// 编辑友链请改 md，不要在这里硬编码；本组件只负责卡片样式。
interface FriendLink { name: string, image?: string, url: string, description?: string, tag?: string, qr?: boolean, preview?: boolean }

const props = defineProps<{ links?: FriendLink[] }>()

// 本站内的图片路径（/img/...）统一经 withBase 拼接 base；外部链接原样保留。
const links: FriendLink[] = (props.links ?? []).map(link => ({
	...link,
	image: link.image ? withBase(link.image) : undefined,
	url: link.url.startsWith('/') ? withBase(link.url) : link.url,
}))
</script>

<template>
<div class="friend-list">
	<article v-for="link in links" :key="link.name" class="friend-link-card">
		<img v-if="link.image" class="card-blur" :src="link.image" alt="" loading="lazy">
		<component :is="link.qr || link.preview ? 'div' : 'a'" class="friend-card-main" :href="link.qr || link.preview ? undefined : link.url" :target="link.qr || link.preview ? undefined : '_blank'" rel="noreferrer">
			<img v-if="link.image" class="card-avatar" :src="link.image" :alt="link.name" loading="lazy">
			<span v-else class="card-avatar card-avatar-fallback"><SiteIcon /></span>
			<h2>{{ link.name }}</h2>
			<p>{{ link.description }}</p>
			<span v-if="link.tag" class="card-badges">{{ link.tag }}</span>
			<HoverMedia v-if="link.qr || link.preview" :src="link.url" :kind="link.qr ? 'qr' : 'image'" :label="link.qr ? '微信扫码关注' : `查看${link.name}图片`" /><span v-else class="friend-card-visit">访问 ↗</span>
		</component>
	</article>
</div>
</template>
