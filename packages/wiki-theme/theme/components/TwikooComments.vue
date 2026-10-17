<script setup lang="ts">
import { useData } from 'vitepress'
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { destroyTwikoo } from '../composables/twikoo.ts'

/**
 * Twikoo 评论区：挂在 doc-after，位于正文之后、页面历史之前。
 *
 * 组件自带三重门控，任一不满足整体不渲染（接口处于预留状态，零开销）：
 * - 构建期环境变量 VITE_TWIKOO_ENV_ID 未设置——后端（腾讯云 Cloudbase 或自建）尚未部署；
 * - frontmatter 设 comments: false——单篇关闭；
 * - home / page 布局——首页、地图这类非文章页。
 * 开启方式与环境变量见站点功能说明「评论与在线编辑」一节。
 */
const COMMENT_ENV_ID = import.meta.env.VITE_TWIKOO_ENV_ID as string | undefined
const COMMENT_EXCLUDED_LAYOUTS = ['home', 'page']

const { frontmatter } = useData()

const enabled = computed(() =>
	Boolean(COMMENT_ENV_ID)
	&& frontmatter.value.comments !== false
	&& !COMMENT_EXCLUDED_LAYOUTS.includes((frontmatter.value.layout ?? '') as string),
)

const container = ref<HTMLElement>()
const failed = ref(false)

// Twikoo 加载时会访问浏览器全局对象，不能进 SSR：动态 import 保证只在客户端执行，
// Vite 同时把它拆成独立 chunk，仅评论区真的出现时才会下载。
onMounted(async () => {
	if (!enabled.value || !container.value)
		return
	await nextTick()
	const twikoo = await import('twikoo')
	// 动态 import 首次要走网络下载 chunk，期间用户可能已切页导致组件卸载、
	// 容器 ref 被置空——必须在拿到模块后再查一次，否则 init(el: null) 会报错
	if (!enabled.value || !container.value)
		return
	try {
		await twikoo.init({ envId: COMMENT_ENV_ID as string, el: container.value, lang: 'zh-CN' })
	}
	catch (error) {
		failed.value = true
		console.error('Twikoo 初始化失败：', error)
	}
})

// WikiLayout 用 :key="route.path" 挂本组件：每进一篇新文章都会卸载重建。
// twikoo.init 挂上的 Vue app 及其 document 捕获级 click 监听不会随 DOM 移除
// 而消失（见 composables/twikoo.ts 的说明），不手动销毁就会逐篇泄漏。
// 放在 onBeforeUnmount：此时模板 ref 尚未被置空。
onBeforeUnmount(() => {
	destroyTwikoo(container.value)
})
</script>

<template>
<!-- 包一层 vp-doc 容器（同 GitHistory 的做法）：doc-after 插槽本身在 .vp-doc 之外，
包上后标题才能拿到标准 h2 样式（分割线、24px），无需自行复刻样式 -->
<div v-if="enabled" class="vp-doc">
	<section class="twikoo-comments" aria-label="评论">
		<h2 id="评论">
			<a class="header-anchor" href="#评论" aria-label="Permalink to &quot;评论&quot;" />
			评论
		</h2>
		<div ref="container" />
		<p v-if="failed" class="twikoo-comments-error">
			评论加载失败，请稍后重试。
		</p>
	</section>
</div>
</template>

<style scoped>
.twikoo-comments-error {
	font-size: 0.875rem;
	color: var(--vp-c-danger-1);
}
</style>
