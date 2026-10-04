<script setup lang="ts">
import { withBase } from 'vitepress'
import { computed, ref } from 'vue'
import SiteIcon from './SiteIcon.vue'

const props = defineProps<{ qq?: string, avatar?: string, name?: string }>()
const index = ref(0)
const broken = ref(false)

/** 候选头像按优先级排列：手动指定 > QQ 群号自动头像 */
const candidates = computed(() => [...new Set([
	props.avatar ? withBase(props.avatar) : '',
	props.qq ? `https://p.qlogo.cn/gh/${props.qq}/${props.qq}/100/` : '',
].filter(Boolean))])

const src = computed(() => broken.value ? '' : candidates.value[index.value] || '')

/** 上一级加载失败自动顺延到下一级，全部失败才显示默认图标 */
function onError() {
	if (index.value + 1 < candidates.value.length)
		index.value++
	else
		broken.value = true
}
</script>

<template>
<div class="group-avatar" aria-hidden="true">
	<!-- 模糊背景层不绑 error：两层共用同一候选 src，都绑会让回退链一跳两级 -->
	<img v-if="src" class="card-blur" :src="src" alt="" loading="lazy">
	<img v-if="src" class="card-avatar" :src="src" :alt="name || ''" loading="lazy" @error="onError">
	<span v-else class="card-avatar card-avatar-fallback"><SiteIcon /></span>
</div>
</template>
