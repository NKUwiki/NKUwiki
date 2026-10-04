<script setup lang="ts">
import { withBase } from 'vitepress'

interface AppCardItem {
	text?: string
	icon?: string
	desc?: string
	link?: string
}

const props = withDefaults(defineProps<{
	links: AppCardItem[]
	/** 网格列宽下限（CSS 长度），列数随容器宽度自适应 */
	width?: string
	/** 名称的最大行数，超出省略 */
	textLines?: number
	/** 简介的最大行数；false 表示不限制 */
	descLines?: number | false
}>(), {
	width: '12em',
	textLines: 2,
	descLines: false,
})

// 站内图片路径（/img/...）统一经 withBase 拼接 base；外部链接原样保留。
const links = props.links.map(item => ({
	...item,
	icon: item.icon?.startsWith('/') ? withBase(item.icon) : item.icon,
}))

/** url 只放行站内相对路径与 http(s) 外链，拦掉 javascript: 等危险协议（与 flink.ts 同规则） */
function safeLink(value?: string) {
	if (!value)
		return undefined
	if (/^(?:\/|\.\/|\.\.\/|#)/.test(value))
		return value.startsWith('//') ? undefined : value
	try {
		const url = new URL(value)
		return url.protocol === 'https:' || url.protocol === 'http:' ? value : undefined
	}
	catch {
		return undefined
	}
}

const isExternal = (value?: string) => safeLink(value)?.startsWith('http') ?? false
</script>

<template>
<div class="app-cards" :style="{ '--col-width': width }">
	<component
		:is="safeLink(item.link) ? 'a' : 'span'"
		v-for="(item, index) in links"
		:key="index"
		class="link card"
		:href="safeLink(item.link)"
		:target="isExternal(item.link) ? '_blank' : undefined"
		:rel="isExternal(item.link) ? 'noopener noreferrer' : undefined"
	>
		<img v-if="item.icon" class="icon" :src="item.icon" alt="">
		<span v-else-if="item.text" class="icon icon-fallback" aria-hidden="true">{{ item.text.slice(0, 1) }}</span>
		<span v-if="item.text || item.desc" class="body">
			<span v-if="item.text" class="text-ellipsis content" :style="{ '--lines': textLines }">{{ item.text }}</span>
			<span v-if="item.desc" class="text-ellipsis link-desc" :style="descLines ? { '--lines': descLines } : undefined">{{ item.desc }}</span>
		</span>
	</component>
</div>
</template>
