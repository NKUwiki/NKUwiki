<script setup lang="ts">
import { withBase } from 'vitepress'
import HoverMedia from './HoverMedia.vue'

// 本站内的图片路径（/img/...）统一经 withBase 拼接 base；外部链接原样保留。
interface FriendLink { name: string, image: string, url: string, description: string, tag: string, qr?: boolean, preview?: boolean }

const links: FriendLink[] = [
	{ name: '南开大学', image: '/img/10/10/南开大学WX头像.jpg', url: 'http://weixin.qq.com/r/mp/-3VFXTHEM2xMrXU_9yDt', description: '允公允能，日新月异。这里是南开大学官微，百年南开欢迎你~', tag: '校园媒体', qr: true },
	{ name: 'NKUstudy', image: '/img/10/10/NK-study头像.jpg', url: 'https://nkustudy.top/', description: 'NKUStudy 是一个面向课程资料整理、课程导航与教师评价的轻量级站点，旨在帮助同学更方便地查找、整理和分享课程相关信息。', tag: '校友项目' },
	{ name: 'NCEPUwiki', image: '/img/10/10/NCEPUwiki头像.svg', url: 'https://wiki.ncepuinfo.cc/', description: '华北电力大学学生共同维护的非官方校园知识库', tag: '兄弟院校' },
	{ name: 'NKUMC文档站', image: '/img/10/10/NKUMC文档站头像.png', url: 'https://docs.voxelnku.net/', description: '本站建立的目的是集中存放教程与Wiki类内容，助力新人了解游戏与社区，帮助新任社团干部快速学习社团运作与管理、掌握基本运维经验；同时为智能体南姬提供知识库语料，探索AI面向社区成员答疑解惑、节省人力的可能。', tag: '校友项目' },
	{ name: '青理Wiki', image: '/img/10/10/青理Wiki头像.png', url: 'https://wiki.quters.top/', description: '青理生活指南(青理Wiki)是由青岛理工大学学生自发维护的一个面向青岛理工大学学生的生活指南，旨在为新生和在校生提供便捷的生活信息和资源。', tag: '兄弟院校' },
].map(link => ({ ...link, image: withBase(link.image), url: link.url.startsWith('/') ? withBase(link.url) : link.url }))
</script>

<template>
<p class="friend-intro">
	连接创作者、社区与知识库。
</p>
<div class="friend-list">
	<article v-for="link in links" :key="link.name" class="friend-link-card">
		<img class="card-blur" :src="link.image" alt="" loading="lazy">
		<component :is="link.qr || link.preview ? 'div' : 'a'" class="friend-card-main" :href="link.qr || link.preview ? undefined : link.url" :target="link.qr || link.preview ? undefined : '_blank'" rel="noreferrer">
			<img class="card-avatar" :src="link.image" :alt="link.name" loading="lazy">
			<h2>{{ link.name }}</h2>
			<p>{{ link.description }}</p>
			<span class="card-badges">{{ link.tag }}</span>
			<HoverMedia v-if="link.qr || link.preview" :src="link.url" :kind="link.qr ? 'qr' : 'image'" :label="link.qr ? '微信扫码关注' : `查看${link.name}图片`" /><span v-else class="friend-card-visit">访问 ↗</span>
		</component>
	</article>
</div>
</template>
