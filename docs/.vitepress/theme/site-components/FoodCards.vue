<script setup lang="ts">
import { createModalFocus } from '@nkuwiki/theme/theme/composables/modalA11y.ts'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { FOOD_CAMPUS, FOOD_CATEGORIES, FOODS, getFoodCategoryLabel, getFoodPhotos } from '../../data/food-data.js'
import { campusOptionsFor, categoryOptionsFor, keepCategory, normalizeCategory as normalizeCategoryOf } from './food-filter.js'
import {
	decorateRatings,
	destroyTwikoo,
	foodUrl,
	getTwikoo,
	hydrateMyRatings,
	installRatingInjector,
	loadRatings,
	myRatings,
	ratingState,
	registerAliases,
	setMyRating,
	submitRatingOnly,
	twikooEnvId,
} from './food-rating.js'
import FoodContribute from './FoodContribute.vue'

interface FoodItem {
	id: string
	name: string
	category?: string
	campus?: string
	location?: string
	price?: string
	tags?: string[]
	recommend?: string
	/** 简短描述：卡片上显示 */
	desc?: string
	/** 详细介绍：只在详情弹窗里显示 */
	detail?: string
	cover?: string
	gallery?: string[]
	photos?: string[]
	/** 食堂卡：来源实拍（B 站合集），详情里列出，卡片上不显示 */
	shots?: Array<{ bvid: string, date: string, meal?: string }>
	shotCount?: number
	/** 历史旧 id：id 更换过时填在这里，旧评分仍会计入平均分 */
	aliases?: string[]
}

/**
 * 美食卡片墙（参考 QUT wiki 同名功能）：分类筛选 + 校区过滤 + 关键词搜索 +
 * 详情弹窗（人均 / 推荐菜 / 多图 / Twikoo 评论），评分借 Twikoo 评论存储。
 * 数据在站点侧 docs/.vitepress/data/food-data.js 维护（主题包不反向依赖站点数据）。
 */
const foods = computed<FoodItem[]>(() => FOODS as FoodItem[])

const currentCampus = ref('all')
const currentCategory = ref('all')
const keyword = ref('')

const active = ref<FoodItem | null>(null)
/** 详情里图片轮播的当前张（与全屏查看器各自独立，点开查看器时从这张开始） */
const carouselIndex = ref(0)
const viewerOpen = ref(false)
const viewerIndex = ref(0)
/**
 * 详情里的「基于这条投稿」面板开着时，本组件的 Esc / Tab 处理要让位：
 * 两个弹层各自监听 document，不让位就会一按 Esc 把底下这层也关掉。
 */
const contributeOpen = ref(false)
/**
 * 加载失败的封面（按图片地址记）。失败时退回「首字占位」而不是把 <img> 藏起来：
 * 藏起来只剩一块白底，看上去就像「卡片没有图」；占位至少还能认出是哪道菜。
 * 按地址记而不是按卡片，是因为一条视频的多道菜共用一张封面。
 */
const brokenCovers = ref<Set<string>>(new Set())
const commentMount = ref<HTMLElement>()
const commentSlot = ref<HTMLElement>()
/** 主图下方的缩略图条：换张时要把选中的那格滚进视野 */
const thumbStrip = ref<HTMLElement>()
const commentLoading = ref(false)
const commentFailed = ref(false)
const ratingOnlySubmitting = ref(false)
const ratingOnlyMessage = ref('')

let observer: MutationObserver | null = null
let decorateTimer: number | undefined
let removeInjector: (() => void) | null = null
/** 挂在评论区容器上的 click 监听，关闭弹窗时要一并摘掉（否则每开关一次多一个） */
let slotDecorateHandler: (() => void) | null = null

/** 详情弹窗与内嵌图片查看器的无障碍外壳（role/焦点移入/Tab 循环/关闭还原） */
const modalFocus = createModalFocus()
const dialogEl = ref<HTMLElement>()
const viewerEl = ref<HTMLElement>()
/**
 * 弹窗开关的焦点管理。两个 watcher 都必须 `flush: 'post'`：
 * dialogEl / viewerEl 是 v-if 里的模板 ref，默认的 pre-flush 会在**渲染前**跑，
 * 那时 ref 还是上一次的值（关着的时候是 undefined），交给 onOpen 等于没交 ——
 * 实测焦点会留在背后的卡片链接上，读屏用户根本不知道弹出了一层。
 *
 * active 上另加 prev 判断：只有「从无到有」才算新开一层。卡片在弹窗开着时
 * 换不了（遮罩挡着），但深链、以及未来任何 item → item 的切换都不该再压一层。
 */
watch(active, (item, prev) => {
	if (item && !prev)
		modalFocus.onOpen(dialogEl.value)
	else if (!item && prev)
		modalFocus.onClose()
}, { flush: 'post' })

// 两级嵌套天然可用：查看器打开时记录的触发元素正是弹窗里的图片按钮，
// 关闭查看器焦点正好回到那张图上（触发元素是栈，不会把详情那层消费掉）
watch(viewerOpen, (open) => {
	if (open) {
		modalFocus.onOpen(viewerEl.value)
	}
	else {
		modalFocus.onClose()
		// 在查看器里翻过页，关闭后让轮播停在同一张，两处不会各说各话
		if (active.value)
			carouselIndex.value = viewerIndex.value
	}
}, { flush: 'post' })

/**
 * 轮播换张后：把对应缩略图滚到中间，并把焦点交给新的当前格。
 *
 * 两个坑：
 * 1. 只改缩略图条自己的 scrollLeft，不用 scrollIntoView —— 后者会连带把外层
 *    弹窗（甚至页面）一起滚，键盘翻页时能明显看到整块内容往上跳一下。
 * 2. `offsetLeft` 是相对最近的 positioned 祖先（这里是 .nku-food-dialog），
 *    不是相对缩略图条本身，所以 .nku-food-thumbs 必须自带 `position: relative`，
 *    否则每次都多滚一个 dialog-body 的 padding，格子会被推出视野。
 */
watch(carouselIndex, async () => {
	await nextTick()
	const strip = thumbStrip.value
	if (!strip)
		return
	const thumb = strip.querySelector<HTMLElement>('.nku-food-thumb.active')
	if (!thumb)
		return
	// roving tabindex：只有当前格能 Tab 进来，所以翻页后要主动把焦点搬过去，
	// 否则焦点会留在已经变成 tabindex="-1" 的旧格子上
	const focused = document.activeElement
	if (focused instanceof HTMLElement && strip.contains(focused) && focused !== thumb)
		thumb.focus({ preventScroll: true })
	const left = thumb.offsetLeft - (strip.clientWidth - thumb.offsetWidth) / 2
	strip.scrollTo({ left: Math.max(0, left), behavior: 'smooth' })
})

const campusOptions = computed(() => campusOptionsFor(foods.value, FOOD_CAMPUS))

/** 未登记的分类统一归为 'other' */
function normalizeCategory(key?: string) {
	return normalizeCategoryOf(FOOD_CATEGORIES, key)
}

/**
 * 搜索索引：每条目一份归一化后的可搜索文本，随数据一次性建好。
 * foods 是静态数据（FOODS 常量），没必要每敲一个键就把 148 条的名称 /
 * 描述 / 地点 / 标签重新拼一遍字符串。分类填的是**展示名**（「一食堂一楼」）
 * 而不是 key（canteen-yi-1f）——没人会去搜 key，但会搜「商圈」。
 */
let searchIndex: { source: FoodItem[], map: Map<string, string> } | null = null
function searchIndexOf(list: FoodItem[]) {
	if (searchIndex?.source !== list) {
		const map = new Map<string, string>()
		for (const item of list) {
			map.set(item.id, [
				item.name,
				item.desc,
				item.location,
				getFoodCategoryLabel(item.category),
				...(item.tags || []),
			].filter(Boolean).join(' ').toLowerCase())
		}
		searchIndex = { source: list, map }
	}
	return searchIndex.map
}

const filtered = computed(() => {
	const kw = keyword.value.trim().toLowerCase()
	const haystack = searchIndexOf(foods.value)
	return foods.value.filter((item) => {
		if (currentCampus.value !== 'all' && item.campus !== currentCampus.value)
			return false
		// 未定义分类统一归到 'other'，与 groups / categoryOptions 的口径一致，
		// 否则「其他」这个筛选入口点下去什么都筛不到
		if (currentCategory.value !== 'all' && normalizeCategory(item.category) !== currentCategory.value)
			return false
		if (kw && !haystack.get(item.id)!.includes(kw))
			return false
		return true
	})
})

/**
 * 空态文案按「是什么原因筛空的」给：只有关键词没命中时才让人换词，
 * 校区 / 分类组合出来的空页换词是没用的。
 * （分类 chip 只列当前校区真有卡片的分类、切校区还会复位，所以非关键词的空页
 *   只剩「校区选窄了」一种成因，一句话带过即可。）
 */
const emptyMessage = computed(() => {
	if (filtered.value.length)
		return ''
	if (keyword.value.trim())
		return `没有匹配「${keyword.value.trim()}」的美食，换个关键词试试。`
	return '当前筛选条件下没有卡片，换个校区或分类看看。'
})

/** 分类排序权重：未知分类（'other'）排到最后，而不是因为 indexOf 得 -1 排到最前 */
function rank(order: string[], key: string) {
	const at = order.indexOf(key)
	return at < 0 ? order.length : at
}

const groups = computed(() => {
	const order = FOOD_CATEGORIES.map(category => category.key)
	const map = new Map<string, FoodItem[]>()
	for (const item of filtered.value) {
		const key = normalizeCategory(item.category)
		if (!map.has(key))
			map.set(key, [])
		map.get(key)!.push(item)
	}
	return [...map.entries()]
		.sort((a, b) => rank(order, a[0]) - rank(order, b[0]))
		.map(([key, list]) => ({
			key,
			label: FOOD_CATEGORIES.find(category => category.key === key)?.label || '其他',
			list,
		}))
})

/**
 * 分类 chip 跟着校区走：两校区食堂名字完全不同，列着对方校区的楼层只会点出空白。
 * 计数也是当前校区的（规则见 food-filter.js，投稿助手的下拉共用同一套口径）。
 */
const categoryOptions = computed(() => categoryOptionsFor(foods.value, FOOD_CATEGORIES, currentCampus.value))

const activePhotos = computed<string[]>(() => getFoodPhotos(active.value))
/** 轮播当前张：索引可能因切换卡片而越界，取模兜住，模板里不必再判空 */
const carouselPhoto = computed(() => activePhotos.value[carouselIndex.value] || '')
const activeRating = computed(() => (active.value ? ratingState[active.value.id] : null))
/** 来源实拍：食堂卡才有，详情里列最近几条并链到 B 站 */
const activeShots = computed(() => active.value?.shots || [])
const activeShotCount = computed(() => active.value?.shotCount || activeShots.value.length)

function stateOf(item: FoodItem) {
	return ratingState[item.id] || { sum: 0, count: 0, avg: 0, loaded: false, loading: false }
}

function campusLabel(key?: string) {
	return (key && FOOD_CAMPUS[key]) || ''
}

function ratingOf(item: FoodItem) {
	return myRatings[item.id] || 0
}

function avgStars(item: FoodItem) {
	const state = stateOf(item)
	return state.count ? Math.round(state.avg) : 0
}

function onPick(item: FoodItem, value: number) {
	setMyRating(item.id, ratingOf(item) === value ? 0 : value)
}

/**
 * 封面图按条目缓存：模板里一张卡要取三次（v-if / :src / @error），
 * photoList() 每次都新建数组，148 张卡每次都重算一遍没必要。数据是静态的，
 * 缓存不会过期；「图挂了」的降级走 brokenCovers，不经这里。
 */
const coverCache = new Map<string, string>()
function coverOf(item: FoodItem) {
	const cached = coverCache.get(item.id)
	if (cached !== undefined)
		return cached
	const cover = getFoodPhotos(item)[0] || ''
	coverCache.set(item.id, cover)
	return cover
}

function onCoverError(src: string) {
	if (brokenCovers.value.has(src))
		return
	brokenCovers.value = new Set(brokenCovers.value).add(src)
}

function scheduleDecorate() {
	if (decorateTimer)
		window.clearTimeout(decorateTimer)
	// 这里必须包一层箭头函数，不能写成 setTimeout(decorateRatings, 120, commentSlot.value)：
	// 定时器参数是「调度时」求值的，120ms 内弹窗若已关闭，就会拿着已卸载的节点白跑一遍
	// eslint-disable-next-line e18e/prefer-timer-args
	decorateTimer = window.setTimeout(() => decorateRatings(commentSlot.value), 120)
}

/** 弹窗与 ?food=<id> 查询参数双向同步：深链可直接展开对应店铺，也方便分享 */
function syncFoodQuery(id: string | null) {
	const url = new URL(window.location.href)
	if (id)
		url.searchParams.set('food', id)
	else
		url.searchParams.delete('food')
	// 保留既有 history.state：搜索弹窗往里写了 'wiki:search' 标记，
	// 关搜索时靠它决定要不要 history.back()，被置成 null 就丢了。
	// 沙箱 iframe（预览面板）里 replaceState 可能抛 SecurityError——地址栏同步
	// 只是锦上添花，不能让它把「打开弹窗」这件事带崩（MapView 同款容错）
	try {
		history.replaceState({ ...history.state }, '', url)
	}
	catch { /* noop */ }
}

/**
 * 每次打开弹窗领一个新的代次号。
 * Twikoo 首次要动态 import（近 1MB），等它回来的这段时间里用户可能已经
 * 按 Esc / 点遮罩关掉弹窗，或点了另一家店——续体若照常往下跑，就会把
 * MutationObserver 挂到已卸载的节点上（从此再也没人 disconnect），
 * 并对同一个容器重复 init 出两套评论区。
 */
let openToken = 0

async function openDialog(item: FoodItem) {
	const token = ++openToken
	active.value = item
	carouselIndex.value = 0
	viewerOpen.value = false
	viewerIndex.value = 0
	syncFoodQuery(item.id)
	document.body.style.overflow = 'hidden'

	loadRatings([item.id], { force: true })

	if (!twikooEnvId) {
		commentFailed.value = true
		return
	}

	commentLoading.value = true
	commentFailed.value = false
	ratingOnlyMessage.value = ''
	await nextTick()

	const mountPoint = commentMount.value
	const slot = commentSlot.value
	if (!mountPoint || !slot) {
		// 别把 commentLoading 留在 true：那会一直显示「评论加载中……」
		// 并永久禁用「只提交评分」按钮
		commentLoading.value = false
		return
	}

	try {
		const twikoo = await getTwikoo()
		if (token !== openToken || !active.value)
			return
		await twikoo.init({
			envId: twikooEnvId,
			el: mountPoint,
			path: foodUrl(item.id),
			lang: 'zh-CN',
		})
		await nextTick()
		if (token !== openToken || !active.value)
			return
		// 评论区在「加载更多 / 切换排序」后会整体重绘，MutationObserver 兜底重打徽章
		observer?.disconnect()
		observer = new MutationObserver(scheduleDecorate)
		observer.observe(slot, { childList: true, subtree: true })
		if (slotDecorateHandler)
			slot.removeEventListener('click', slotDecorateHandler)
		slotDecorateHandler = scheduleDecorate
		slot.addEventListener('click', slotDecorateHandler)
		// 弹窗打开时主评论框可能已渲染完成，直接挂注入器；晚渲染也无妨，
		// 「只提交评分」走的是实时查询，不依赖这一步
		removeInjector?.()
		removeInjector = installRatingInjector(slot, () => (active.value ? ratingOf(active.value) : 0))
		decorateRatings(slot)
		commentLoading.value = false
	}
	catch (error) {
		console.error('美食评论初始化失败：', error)
		commentFailed.value = true
		commentLoading.value = false
	}
}

async function submitOnlyRating() {
	const item = active.value
	if (!item || !ratingOf(item) || ratingOnlySubmitting.value)
		return
	ratingOnlySubmitting.value = true
	ratingOnlyMessage.value = ''
	try {
		// 提交最长要轮询 ~7 秒，期间用户完全可能按 Esc 关掉弹窗：
		// 后面的分支不能再读 active.value（已为 null），一律用缓存下来的 id
		const result = await submitRatingOnly(commentSlot.value, () => (active.value ? ratingOf(active.value) : 0))
		if (result.ok) {
			ratingOnlyMessage.value = '评分已提交，列表刷新后会更新统计。'
			await loadRatings([item.id], { force: true })
		}
		else if (result.reason === 'meta') {
			ratingOnlyMessage.value = '请先在下方评论框填写昵称和邮箱。'
		}
		else if (result.reason === 'comment') {
			ratingOnlyMessage.value = '评论框已有文字；如需评分加评论，请直接使用评论区的发送按钮（发送前会自动带上星星）。'
		}
		else if (result.reason === 'sending') {
			ratingOnlyMessage.value = '正在提交，请稍候。'
		}
		else if (result.reason === 'submit') {
			ratingOnlyMessage.value = result.message || '评分提交失败，请稍后重试。'
		}
		else if (result.reason === 'timeout') {
			ratingOnlyMessage.value = '提交结果未确认，请刷新页面后查看是否提交成功。'
		}
		else {
			ratingOnlyMessage.value = '评分组件尚未加载完成，请稍后重试。'
		}
	}
	finally {
		// 必须放在 finally：任何一步抛错都会让按钮永远卡在「提交中…」
		ratingOnlySubmitting.value = false
	}
}

function closeDialog() {
	active.value = null
	contributeOpen.value = false
	// 递增代次：让仍在等待 Twikoo 回来的那次 openDialog 自行放弃
	openToken++
	viewerOpen.value = false
	syncFoodQuery(null)
	observer?.disconnect()
	observer = null
	if (decorateTimer)
		window.clearTimeout(decorateTimer)
	removeInjector?.()
	removeInjector = null
	if (slotDecorateHandler && commentSlot.value) {
		commentSlot.value.removeEventListener('click', slotDecorateHandler)
	}
	slotDecorateHandler = null
	destroyTwikoo(commentSlot.value)
	document.body.style.overflow = ''
}

function openViewer(index: number) {
	if (!activePhotos.value.length)
		return
	viewerIndex.value = index
	viewerOpen.value = true
}

/** 详情内的轮播翻页：到头回绕，与全屏查看器同一套手感 */
function stepCarousel(step: number) {
	const count = activePhotos.value.length
	if (count < 2)
		return
	carouselIndex.value = (carouselIndex.value + step + count) % count
}

function changeViewer(step: number) {
	const count = activePhotos.value.length
	if (count < 2)
		return
	viewerIndex.value = (viewerIndex.value + step + count) % count
}

function onKeydown(event: KeyboardEvent) {
	if (!active.value)
		return
	// 投稿面板开着时，Esc 与 Tab 归它管（它自己判断按哪一层关）
	if (contributeOpen.value)
		return
	if (event.key === 'Escape') {
		if (viewerOpen.value)
			viewerOpen.value = false
		else closeDialog()
	}
	else if (event.key === 'Tab') {
		// 焦点陷阱限定当前所处的弹层：查看器开着时循环查看器，否则循环详情弹窗
		modalFocus.trap(event, viewerOpen.value ? viewerEl.value : dialogEl.value)
		return
	}
	else if (viewerOpen.value && event.key === 'ArrowLeft') {
		changeViewer(-1)
	}
	else if (viewerOpen.value && event.key === 'ArrowRight') {
		changeViewer(1)
	}
	else if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && !isTypingTarget(event.target)) {
		// 查看器没开时，左右键翻详情里的轮播；在评论框里打字时不能抢方向键
		stepCarousel(event.key === 'ArrowLeft' ? -1 : 1)
	}
	else {
		return
	}
	event.preventDefault()
}

/** 焦点在输入控件里时，方向键属于光标移动，不该被轮播截走 */
function isTypingTarget(target: EventTarget | null) {
	if (!(target instanceof HTMLElement))
		return false
	return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

// 换校区后，原先选中的分类可能在新校区根本不存在（八里台「一食堂二楼」→ 津南），
// 这时把筛选收回「全部」，否则页面上是一条空列表 + 一个已经消失的选中态
watch(currentCampus, () => {
	currentCategory.value = keepCategory(categoryOptions.value, currentCategory.value)
})

watch([currentCampus, currentCategory], () => loadRatings(filtered.value.map(item => item.id)))

onMounted(() => {
	document.addEventListener('keydown', onKeydown)
	// 本地评分记录只在此刻（客户端）补入：SSR 阶段 myRatings 恒为空，
	// 避免服务端 0 星 / 客户端 N 星的 hydration 不匹配
	hydrateMyRatings()
	// 登记旧 id 别名：改过 id 的店铺，历史评分仍计入平均分
	const aliasMap: Record<string, string[]> = {}
	for (const item of foods.value) {
		if (item.aliases?.length)
			aliasMap[item.id] = item.aliases
	}
	registerAliases(aliasMap)
	loadRatings(foods.value.map(item => item.id))
	// 深链：/pages/Food?food=<id> 直接展开对应店铺（Twikoo 后台「详情」
	// 经站点侧改写会落到这里）；别名 id 也能命中（兼容换过 id 的店铺）
	const requestedId = new URLSearchParams(window.location.search).get('food')
	const requested = requestedId
		? foods.value.find(item => item.id === requestedId)
		|| foods.value.find(item => item.aliases?.includes(requestedId))
		: null
	if (requested) {
		void openDialog(requested)
	}
	else if (requestedId) {
		// id 已改名又没配 aliases 时，点开就是毫无反应、地址栏还挂着旧参数，
		// 清掉并给出提示
		console.warn(`[FoodCards] ?food=${requestedId} 未匹配到任何店铺`)
		syncFoodQuery(null)
	}
})

onBeforeUnmount(() => {
	document.removeEventListener('keydown', onKeydown)
	observer?.disconnect()
	if (decorateTimer)
		window.clearTimeout(decorateTimer)
	removeInjector?.()
	if (slotDecorateHandler && commentSlot.value)
		commentSlot.value.removeEventListener('click', slotDecorateHandler)
	slotDecorateHandler = null
	destroyTwikoo(commentSlot.value)
	document.body.style.overflow = ''
	modalFocus.restoreIfOpen()
})
</script>

<template>
<section class="nku-food">
	<div class="nku-food-toolbar">
		<!-- 校区 / 搜索 / 投稿放在分类之前：先定「在哪个校区」，下面的分类才列得准 -->
		<div class="nku-food-filters">
			<select v-if="campusOptions.length > 1" v-model="currentCampus" class="nku-food-select" aria-label="选择校区">
				<option value="all">
					全部校区
				</option>
				<option v-for="campus in campusOptions" :key="campus.key" :value="campus.key">
					{{ campus.label }}
				</option>
			</select>
			<input v-model="keyword" class="nku-food-search" type="search" aria-label="搜索美食名称、地点或标签" placeholder="搜索名称、地点或标签">
			<FoodContribute />
		</div>
		<div class="nku-food-chips">
			<button
				v-for="category in categoryOptions"
				:key="category.key"
				class="nku-food-chip"
				:class="{ active: currentCategory === category.key }"
				type="button"
				@click="currentCategory = category.key"
			>
				{{ category.label }}<span class="nku-food-chip-count">{{ category.count }}</span>
			</button>
		</div>
	</div>

	<!-- 空态是常驻的 role=status 区域：跟文案一起 v-if 进去的话，部分读屏根本不播报。
	:empty 让没话说的时候把自己收成零高度，不占地方（Vue 的空插值是零长度文本节点，
	按 CSS 规范不算内容，:empty 仍能命中） -->
	<p class="nku-food-empty" role="status">
		{{ emptyMessage }}
	</p>

	<div v-for="group in groups" :key="group.key" class="nku-food-group">
		<h3 class="nku-food-group-title">
			{{ group.label }}
		</h3>
		<div class="nku-food-grid">
			<article v-for="item in group.list" :key="item.id" class="nku-food-card" @click="openDialog(item)">
				<a class="nku-food-cover" href="#" @click.stop.prevent="openDialog(item)">
					<img v-if="coverOf(item) && !brokenCovers.has(coverOf(item))" :src="coverOf(item)" :alt="item.name" loading="lazy" @error="onCoverError(coverOf(item))">
					<span v-else class="nku-food-cover-fallback">{{ item.name.slice(0, 1) }}</span>
					<!-- 校区压在图上：两校区同屏时，卡片混在一列里，靠它一眼分清 -->
					<span v-if="campusLabel(item.campus)" class="nku-food-cover-campus">{{ campusLabel(item.campus) }}</span>
				</a>
				<div class="nku-food-card-body">
					<a class="nku-food-name" href="#" @click.stop.prevent="openDialog(item)">{{ item.name }}</a>
					<div class="nku-food-card-tags">
						<span v-if="item.location" class="nku-food-tag place">{{ item.location }}</span>
						<span v-for="tag in (item.tags || []).slice(0, 3)" :key="tag" class="nku-food-tag">{{ tag }}</span>
					</div>
					<p v-if="item.desc" class="nku-food-desc">
						{{ item.desc }}
					</p>

					<!-- 只显示「大家的平均分」，不放打分星星：两种星星挨着，看不出哪排是已有的分 -->
					<div class="nku-food-card-meta">
						<span
							class="nku-food-avg"
							:title="stateOf(item).count ? `平均 ${stateOf(item).avg.toFixed(1)} 分，${stateOf(item).count} 人评分` : '暂无评分'"
						>
							<span class="nku-food-stars">
								<span v-for="n in 5" :key="n" :class="{ on: n <= avgStars(item) }">★</span>
							</span>
							<span class="nku-food-avg-text">
								{{ stateOf(item).count ? stateOf(item).avg.toFixed(1) : '暂无' }}
								<template v-if="stateOf(item).count">（{{ stateOf(item).count }}）</template>
							</span>
						</span>
						<button class="nku-food-comment-btn" type="button" @click.stop="openDialog(item)">
							评价<template v-if="stateOf(item).count">
								· {{ stateOf(item).count }}
							</template>
						</button>
					</div>
				</div>
			</article>
		</div>
	</div>

	<Teleport to="body">
		<div v-if="active" class="nku-food-modal" @click.self="closeDialog">
			<div ref="dialogEl" class="nku-food-dialog" role="dialog" aria-modal="true" :aria-label="active.name">
				<button class="nku-food-dialog-close" type="button" aria-label="关闭" @click="closeDialog">
					&times;
				</button>

				<header class="nku-food-dialog-head">
					<h2>{{ active.name }}</h2>
					<div class="nku-food-dialog-badges">
						<span v-if="active.campus" class="nku-food-badge">{{ campusLabel(active.campus) }}</span>
						<span v-if="active.location" class="nku-food-badge ghost">{{ active.location }}</span>
						<span v-for="tag in active.tags || []" :key="tag" class="nku-food-badge ghost">{{ tag }}</span>
					</div>
				</header>

				<div class="nku-food-dialog-body">
					<!-- 首屏：左侧轮播 + 右侧图文信息。轮播限高、图下挂缩略图条，把纵向空间让给下面的评价 -->
					<div class="nku-food-hero" :class="{ 'is-text-only': !activePhotos.length }">
						<div v-if="activePhotos.length" class="nku-food-gallery">
							<div class="nku-food-carousel">
								<button class="nku-food-slide" type="button" :aria-label="`查看 ${active.name} 的大图`" @click="openViewer(carouselIndex)">
									<Transition name="nku-food-fade" mode="out-in">
										<img :key="carouselPhoto" :src="carouselPhoto" :alt="active.name">
									</Transition>
								</button>
								<template v-if="activePhotos.length > 1">
									<button class="nku-food-slide-nav prev" type="button" aria-label="上一张" @click.stop="stepCarousel(-1)">
										&#10094;
									</button>
									<button class="nku-food-slide-nav next" type="button" aria-label="下一张" @click.stop="stepCarousel(1)">
										&#10095;
									</button>
									<span class="nku-food-slide-counter">{{ carouselIndex + 1 }} / {{ activePhotos.length }}</span>
								</template>
							</div>

							<!-- 缩略图条：横向滚动，20 张图也只占一行，点格子直接跳到那张 -->
							<div
								v-if="activePhotos.length > 1"
								ref="thumbStrip"
								class="nku-food-thumbs"
								role="group"
								aria-label="图片缩略图"
							>
								<button
									v-for="(photo, index) in activePhotos"
									:key="photo"
									type="button"
									class="nku-food-thumb"
									:class="{ active: index === carouselIndex }"
									:aria-label="`第 ${index + 1} 张`"
									:aria-current="index === carouselIndex ? 'true' : undefined"
									:tabindex="index === carouselIndex ? 0 : -1"
									@click="carouselIndex = index"
								>
									<img :src="photo" :alt="`${active.name} 第 ${index + 1} 张`" loading="lazy">
								</button>
							</div>
						</div>

						<div class="nku-food-hero-info">
							<div class="nku-food-hero-facts">
								<p v-if="active.desc" class="nku-food-hero-desc">
									{{ active.desc }}
								</p>
								<p v-if="active.detail" class="nku-food-hero-detail">
									{{ active.detail }}
								</p>

								<dl v-if="active.price || active.recommend" class="nku-food-meta">
									<template v-if="active.price">
										<dt>人均</dt>
										<dd>{{ active.price }}</dd>
									</template>
									<template v-if="active.recommend">
										<dt>推荐</dt>
										<dd>{{ active.recommend }}</dd>
									</template>
								</dl>
							</div>

							<div class="nku-food-hero-actions">
								<FoodContribute :source="active" @open-change="contributeOpen = $event" />
								<span class="nku-food-muted">信息有误或想补图？基于这条改</span>
							</div>
						</div>
					</div>

					<!-- 打分与评论合成一张卡：星星选好紧接着就能写两句，不用在弹窗上下两处来回跳 -->
					<section class="nku-food-comments">
						<div class="nku-food-comments-head">
							<h3>评价</h3>
							<span
								class="nku-food-rate-summary"
								:title="activeRating?.count ? `平均 ${activeRating.avg.toFixed(1)} 分，${activeRating.count} 人评分` : '暂无评分'"
							>
								<span class="nku-food-stars">
									<span v-for="n in 5" :key="n" :class="{ on: n <= Math.round(activeRating?.avg || 0) }">★</span>
								</span>
								<strong>{{ activeRating?.count ? activeRating.avg.toFixed(1) : '暂无' }}</strong>
								<span class="nku-food-muted">{{ activeRating?.count ? `${activeRating.count} 人评分` : '来打第一个分' }}</span>
							</span>
						</div>

						<!-- 一行打分条：星星选好后既可直接提交，也会自动带进下面的评论 -->
						<div class="nku-food-rate">
							<span class="nku-food-rate-mine">
								<span class="nku-food-muted">我的</span>
								<span class="nku-food-stars pickable">
									<button
										v-for="n in 5"
										:key="n"
										type="button"
										:class="{ on: n <= ratingOf(active) }"
										:aria-label="`打 ${n} 分`"
										@click="onPick(active, n)"
									>★</button>
								</span>
								<span v-if="ratingOf(active)" class="nku-food-muted">{{ ratingOf(active) }} 分</span>
							</span>
							<button
								class="nku-food-rate-only"
								type="button"
								:disabled="!ratingOf(active) || ratingOnlySubmitting || commentLoading"
								@click="submitOnlyRating"
							>
								{{ ratingOnlySubmitting ? '提交中…' : '只提交评分' }}
							</button>
							<span class="nku-food-rate-hint">选好星星再写评论，发送时会自动带上评分</span>
						</div>
						<p v-if="ratingOnlyMessage" class="nku-food-rating-message">
							{{ ratingOnlyMessage }}
						</p>

						<p v-if="commentLoading" class="nku-food-muted">
							评论加载中……
						</p>
						<p v-else-if="!twikooEnvId" class="nku-food-muted">
							未配置 Twikoo 服务，评论功能暂不可用。
						</p>
						<p v-else-if="commentFailed" class="nku-food-muted">
							评论加载失败，请稍后重试。
						</p>
						<div ref="commentSlot" class="nku-food-comment-slot">
							<div ref="commentMount" :key="active.id" />
						</div>
					</section>

					<!-- 来源实拍收进折叠面板：默认展开就是一长串日期，占掉的高度比它的价值大 -->
					<details v-if="activeShots.length" class="nku-food-source">
						<summary>
							来源实拍<span class="nku-food-muted">共 {{ activeShotCount }} 条 · B 站合集「南开食堂天天吃」</span>
						</summary>
						<ul class="nku-food-source-list">
							<li v-for="shot in activeShots.slice(0, 8)" :key="shot.bvid">
								<a :href="`https://www.bilibili.com/video/${shot.bvid}`" target="_blank" rel="noopener">
									{{ shot.date }}<template v-if="shot.meal"> · {{ shot.meal }}</template>
								</a>
							</li>
						</ul>
						<p v-if="activeShotCount > 8" class="nku-food-muted">
							另有 {{ activeShotCount - 8 }} 条更早的实拍
						</p>
					</details>
				</div>
			</div>

			<div v-if="viewerOpen" ref="viewerEl" class="nku-food-viewer" role="dialog" aria-modal="true" :aria-label="`${active.name} 图片查看`" @click.self="viewerOpen = false">
				<button class="nku-food-viewer-close" type="button" aria-label="关闭" @click="viewerOpen = false">
					&times;
				</button>
				<button
					v-if="activePhotos.length > 1"
					class="nku-food-viewer-nav prev"
					type="button"
					aria-label="上一张"
					@click.stop="changeViewer(-1)"
				>
					&#10094;
				</button>
				<img class="nku-food-viewer-img" :src="activePhotos[viewerIndex]" :alt="active.name" @click.stop>
				<button
					v-if="activePhotos.length > 1"
					class="nku-food-viewer-nav next"
					type="button"
					aria-label="下一张"
					@click.stop="changeViewer(1)"
				>
					&#10095;
				</button>
				<span class="nku-food-viewer-counter">{{ viewerIndex + 1 }} / {{ activePhotos.length }}</span>
			</div>
		</div>
	</Teleport>
</section>
</template>

<style scoped>
.nku-food {
	margin: 16px 0;
}

/* 两行：第一行校区 / 搜索 / 投稿，第二行分类 chip。
   分类数量随校区变化，和上面那行挤在同一排时换行位置不可控，索性分层 */
.nku-food-toolbar {
	display: flex;
	flex-direction: column;
	gap: 10px;
	margin-bottom: 16px;
}

.nku-food-chips {
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
}

.nku-food-chip {
	display: inline-flex;
	align-items: center;
	gap: 4px;
	padding: 3px 10px;
	border: 1px solid var(--vp-c-divider);
	border-radius: 14px;
	background: var(--vp-c-bg-soft);
	font-size: 13px;
	color: var(--vp-c-text-2);
	transition: color var(--wiki-duration-collapse) var(--wiki-ease-out), border-color var(--wiki-duration-collapse) var(--wiki-ease-out), background var(--wiki-duration-collapse) var(--wiki-ease-out);
	cursor: pointer;
}

.nku-food-chip:hover {
	border-color: var(--vp-c-brand-1);
	color: var(--vp-c-brand-1);
}

.nku-food-chip.active {
	border-color: var(--vp-c-brand-1);
	background: var(--vp-c-brand-soft);
	color: var(--vp-c-brand-1);
}

.nku-food-chip-count {
	opacity: 0.7;
	font-size: 12px;
}

.nku-food-filters {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 8px;
}

.nku-food-select,
.nku-food-search {
	height: 32px;
	padding: 0 10px;
	border: 1px solid var(--vp-c-divider);
	border-radius: 8px;
	outline: none;
	background: var(--vp-c-bg);
	font-size: 13px;
	color: var(--vp-c-text-1);
}

.nku-food-search {
	/* 弹性宽度：窄屏时自己换行，不再写死 190px */
	flex: 1 1 160px;
	width: auto;
	min-width: 0;
	max-width: 280px;
}

.nku-food-select:focus,
.nku-food-search:focus {
	border-color: var(--vp-c-brand-1);
}

.nku-food-empty {
	padding: 32px 0;
	text-align: center;
	color: var(--vp-c-text-3);
}

/* 常驻的读屏播报区：没话要说时靠 :empty 收成零高度，不撑出 64px 空白 */
.nku-food-empty:empty {
	display: none;
}

.nku-food-group {
	margin-bottom: 28px;
}

.nku-food-group-title {
	/* 作用域属性选择器（0,2,0）已能压过 .vp-doc h3（0,1,1），无需 !important */
	margin: 0 0 12px;
	padding-bottom: 6px;
	border-bottom: 2px solid var(--vp-c-divider);
	font-size: 18px;
}

.nku-food-grid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(216px, 1fr));
	gap: 16px;
}

.nku-food-card {
	display: flex;
	flex-direction: column;
	overflow: hidden;
	border: 1px solid var(--vp-c-divider);
	border-radius: 12px;
	background: var(--vp-c-bg-soft);
	/* 整卡可点开详情：光标提示可点，键盘用户仍走标题链接（Enter 同样开弹窗） */
	transition: box-shadow var(--wiki-duration-collapse) var(--wiki-ease-out), transform var(--wiki-duration-collapse) var(--wiki-ease-out);
	cursor: pointer;
}

.nku-food-card:hover {
	box-shadow: 0 2px 16px rgb(0 0 0 / 0.1);
	transform: translateY(-2px);
}

.nku-food-cover {
	display: block;
	position: relative;
	overflow: hidden;
	aspect-ratio: 4 / 3;
	background: var(--vp-c-bg);
}

/* 校区压在封面左上角：两校区同屏、卡片混排时靠它一眼分清，也不占正文的横向空间 */
.nku-food-cover-campus {
	position: absolute;
	top: 8px;
	left: 8px;
	padding: 1px 8px;
	border-radius: 999px;
	background: rgb(0 0 0 / 0.55);
	backdrop-filter: blur(2px);
	font-size: 11px;
	line-height: 1.7;
	color: #FFF;
	pointer-events: none;
}

.nku-food-cover img {
	width: 100%;
	height: 100%;
	margin: 0;
	/* 封面图 hover 放大：时长走 drawer 档。图片的 transform 缩放由 GPU 处理，
	动画期间浏览器会自动把带过渡的元素提升到合成层，不必常驻 will-change */
	transition: transform var(--wiki-duration-drawer) var(--wiki-ease-out);
	object-fit: cover;
}

.nku-food-card:hover .nku-food-cover img {
	transform: scale(1.05);
}

.nku-food-cover-fallback {
	display: flex;
	align-items: center;
	justify-content: center;
	opacity: 0.35;
	height: 100%;
	font-size: 40px;
	font-weight: 700;
	color: var(--vp-c-brand-1);
}

.nku-food-card-body {
	display: flex;
	flex: 1;
	flex-direction: column;
	gap: 6px;
	padding: 10px 12px 12px;
}

.nku-food-name {
	font-size: 15px;
	font-weight: 600;
	line-height: 1.4;
	word-break: break-word;
	text-decoration: none;
	color: var(--vp-c-text-1);
}

.nku-food-name:hover {
	color: var(--vp-c-brand-1);
}

.nku-food-card-tags {
	display: flex;
	flex-wrap: wrap;
	gap: 4px;
}

.nku-food-tag {
	padding: 0 7px;
	border: 1px solid var(--vp-c-divider);
	border-radius: 999px;
	font-size: 11.5px;
	line-height: 1.7;
	color: var(--vp-c-text-2);
}

/* 地点标签用品牌色浅底：它是「去哪吃」，和口味标签不是一类信息 */
.nku-food-tag.place {
	border-color: var(--vp-c-brand-soft);
	background: var(--vp-c-brand-soft);
	color: var(--vp-c-brand-1);
}

/* 简介固定两行：卡片高度要齐，也避免一条长文案把整行卡片顶高 */
.nku-food-desc {
	display: -webkit-box;
	overflow: hidden;
	margin: 0;
	font-size: 12.5px;
	-webkit-line-clamp: 2;
	line-height: 1.55;
	color: var(--vp-c-text-2);
	-webkit-box-orient: vertical;
}

.nku-food-stars {
	display: inline-flex;
	gap: 1px;
	font-size: 14px;
	line-height: 1;
	color: var(--vp-c-text-3);
}

.nku-food-stars .on {
	color: var(--vp-c-brand-1);
}

.nku-food-stars.pickable button {
	padding: 0;
	border: 0;
	background: transparent;
	font-size: inherit;
	line-height: 1;
	color: inherit;
	transition: transform var(--wiki-duration-fast) var(--wiki-ease-out), color var(--wiki-duration-fast) var(--wiki-ease-out);
	cursor: pointer;
}

.nku-food-stars.pickable button.on {
	color: var(--vp-c-brand-1);
}

.nku-food-stars.pickable button:hover {
	transform: scale(1.15);
}

.nku-food-avg {
	display: inline-flex;
	align-items: center;
	gap: 6px;
}

.nku-food-avg-text {
	font-size: 12.5px;
	color: var(--vp-c-text-2);
}

/* 评分在左、评价按钮在右；窄卡放不下时按钮换到下一行，靠 margin-left:auto 仍靠右 */
.nku-food-card-meta {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: space-between;
	gap: 6px;
	margin-top: auto;
	padding-top: 8px;
	border-top: 1px solid var(--vp-c-divider);
}

.nku-food-card-meta .nku-food-comment-btn {
	margin-left: auto;
}

.nku-food-comment-btn {
	padding: 3px 10px;
	border: 1px solid var(--vp-c-brand-1);
	border-radius: 12px;
	background: transparent;
	font-size: 12.5px;
	color: var(--vp-c-brand-1);
	transition: background var(--wiki-duration-collapse) var(--wiki-ease-out), color var(--wiki-duration-collapse) var(--wiki-ease-out);
	cursor: pointer;
}

.nku-food-comment-btn:hover {
	background: var(--vp-c-brand-1);
	color: var(--vp-c-bg);
}

.nku-food-modal {
	display: flex;
	align-items: center;
	justify-content: center;
	position: fixed;
	inset: 0;
	padding: 24px;
	background: rgb(0 0 0 / 0.55);
	z-index: 9998;
}

.nku-food-dialog {
	display: flex;
	flex-direction: column;
	position: relative;
	overflow: hidden;
	width: min(900px, 100%);
	max-height: 90vh;
	border-radius: 14px;
	box-shadow: 0 12px 40px rgb(0 0 0 / 0.3);
	background: var(--vp-c-bg);
}

.nku-food-dialog-close {
	position: absolute;
	top: 10px;
	right: 12px;
	width: 34px;
	height: 34px;
	border: 0;
	border-radius: 50%;
	background: var(--vp-c-bg-soft);
	font-size: 22px;
	line-height: 1;
	color: var(--vp-c-text-2);
	cursor: pointer;
	z-index: 2;
}

.nku-food-dialog-close:hover {
	color: var(--vp-c-danger-1);
}

.nku-food-dialog-head {
	padding: 18px 52px 14px 22px;
	border-bottom: 1px solid var(--vp-c-divider);
}

/* 弹窗 Teleport 到 body，不在 .vp-doc 作用域内，无需覆盖文档样式 */
.nku-food-dialog-head h2 {
	margin: 0;
	padding: 0;
	border: 0;
	font-size: 21px;
}

.nku-food-dialog-badges {
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
	margin-top: 8px;
}

.nku-food-badge {
	display: inline-block;
	padding: 1px 8px;
	border: 1px solid var(--vp-c-brand-soft);
	border-radius: 12px;
	background: var(--vp-c-brand-soft);
	font-size: 11.5px;
	font-weight: 500;
	line-height: 1.5;
	color: var(--vp-c-brand-1);
}

.nku-food-badge.ghost {
	border-color: var(--vp-c-divider);
	background: transparent;
	color: var(--vp-c-text-2);
}

.nku-food-dialog-body {
	flex: 1;
	overflow-y: auto;
	padding: 18px 22px 24px;
}

/* 首屏「轮播 · 信息」两栏。轮播限高、右栏按中线对齐，整块比原来的「大图 + 缩略图条」矮一截 */
.nku-food-hero {
	display: grid;
	grid-template-columns: minmax(0, 0.94fr) minmax(0, 1fr);
	align-items: stretch;
	gap: 16px;
	margin-bottom: 14px;
}

.nku-food-hero.is-text-only {
	grid-template-columns: minmax(0, 1fr);
}

.nku-food-gallery {
	display: flex;
	flex-direction: column;
	gap: 8px;
	min-width: 0;
}

.nku-food-carousel {
	position: relative;
	overflow: hidden;
	border: 1px solid var(--vp-c-divider);
	border-radius: 10px;
	background: var(--vp-c-bg-soft);
}

/* 画框固定 16:10、最高 240px：以前 4:3 撑满整列宽，光图片就 300px 高 */
.nku-food-slide {
	display: block;
	width: 100%;
	height: 240px;
	padding: 0;
	border: 0;
	background: transparent;
	cursor: zoom-in;
}

.nku-food-slide img {
	display: block;
	width: 100%;
	height: 100%;
	margin: 0;
	object-fit: cover;
}

/* 时长走令牌：base.css 的 prefers-reduced-motion 块是把 --wiki-duration* 压成 0s
   来实现全局降级的，硬编码毫秒数不会跟着归零 */
.nku-food-fade-enter-active,
.nku-food-fade-leave-active {
	transition: opacity var(--wiki-duration) var(--wiki-ease-out);
}

.nku-food-fade-enter-from,
.nku-food-fade-leave-to {
	opacity: 0;
}

.nku-food-slide-nav {
	display: flex;
	align-items: center;
	justify-content: center;
	position: absolute;
	top: 50%;
	width: 30px;
	height: 30px;
	padding: 0;
	border: 0;
	border-radius: 50%;
	background: rgb(0 0 0 / 0.42);
	font-size: 13px;
	line-height: 1;
	color: #FFF;
	transform: translateY(-50%);
	transition: background var(--wiki-duration-fast) var(--wiki-ease-out);
	cursor: pointer;
}

.nku-food-slide-nav:hover {
	background: rgb(0 0 0 / 0.66);
}

.nku-food-slide-nav.prev {
	left: 8px;
}

.nku-food-slide-nav.next {
	right: 8px;
}

.nku-food-slide-counter {
	position: absolute;
	right: 8px;
	bottom: 8px;
	padding: 1px 8px;
	border-radius: 999px;
	background: rgb(0 0 0 / 0.5);
	font-size: 11.5px;
	line-height: 1.6;
	color: #FFF;
}

/* 主图下方的缩略图条：横向滚动一行，20 张图也不撑高弹窗，点格子直达那张。
   position: relative 不能删 —— 居中滚动要用 thumb.offsetLeft，而它是相对
   最近 positioned 祖先算的，没有它就变成相对 .nku-food-dialog，偏一整个 padding */
.nku-food-thumbs {
	display: flex;
	gap: 6px;
	position: relative;
	overflow-x: auto;
	padding-bottom: 4px;
	scroll-snap-type: x proximity;
	scrollbar-width: thin;
}

/* 格子定宽定高：跟着张数变宽会让「20 张」的弹窗比「2 张」的高出一截 */
.nku-food-thumb {
	flex: 0 0 auto;
	overflow: hidden;
	opacity: 0.62;
	width: 62px;
	height: 46px;
	padding: 0;
	border: 1px solid var(--vp-c-divider);
	border-radius: 6px;
	background: var(--vp-c-bg-soft);
	transition: opacity var(--wiki-duration-fast) var(--wiki-ease-out), border-color var(--wiki-duration-fast) var(--wiki-ease-out);
	scroll-snap-align: center;
	cursor: pointer;
}

.nku-food-thumb:hover {
	opacity: 0.9;
}

.nku-food-thumb.active {
	opacity: 1;
	border-color: var(--vp-c-brand-1);
}

.nku-food-thumb img {
	display: block;
	width: 100%;
	height: 100%;
	margin: 0;
	object-fit: cover;
}

.nku-food-hero-info {
	display: flex;
	flex-direction: column;
	gap: 12px;
	min-width: 0;
}

.nku-food-hero-facts {
	display: flex;
	flex-direction: column;
	gap: 10px;
	min-width: 0;
}

.nku-food-hero-desc {
	margin: 0;
	font-size: 14px;
	line-height: 1.7;
	color: var(--vp-c-text-2);
}

/* 详细介绍只放在详情里，压成小一号的补充说明，不再单独占一个标题段 */
.nku-food-hero-detail {
	margin: 0;
	font-size: 12.5px;
	line-height: 1.7;
	color: var(--vp-c-text-3);
}

.nku-food-meta {
	display: grid;
	grid-template-columns: auto 1fr;
	gap: 4px 14px;
	margin: 0;
	font-size: 13.5px;
}

.nku-food-meta dt {
	white-space: nowrap;
	color: var(--vp-c-text-3);
}

.nku-food-meta dd {
	margin: 0;
	color: var(--vp-c-text-1);
}

/* 信息栏拉满高度，文字贴顶、投稿按钮贴底，和左侧缩略图条底边齐平 */
.nku-food-hero-actions {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 8px;
	margin-top: auto;
}

.nku-food-hero-actions .nku-food-muted {
	font-size: 12px;
}

/* 来源实拍折叠：默认只有一行标题，展开才铺日期药丸 */
.nku-food-source {
	margin-top: 14px;
	padding-top: 12px;
	border-top: 1px solid var(--vp-c-divider);
	font-size: 13px;
}

.nku-food-source summary {
	font-size: 13.5px;
	font-weight: 500;
	color: var(--vp-c-text-1);
	cursor: pointer;
}

.nku-food-source summary .nku-food-muted {
	margin-left: 8px;
	font-weight: 400;
}

/* 实拍出处：日期一条一个药丸，链到 B 站原视频 */
.nku-food-source-list {
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
	margin: 8px 0;
	padding: 0;
	list-style: none;
}

.nku-food-source-list a {
	display: inline-block;
	padding: 2px 9px;
	border: 1px solid var(--vp-c-divider);
	border-radius: 999px;
	font-size: 12px;
	text-decoration: none;
	color: var(--vp-c-text-2);
	transition: border-color var(--wiki-duration-fast) var(--wiki-ease-out), color var(--wiki-duration-fast) var(--wiki-ease-out);
}

.nku-food-source-list a:hover {
	border-color: var(--vp-c-brand-1);
	color: var(--vp-c-brand-1);
}

/* 打分条贴在评论区顶部：一行放下「我的评分 + 只提交评分」，
   底色调浅一档跟评论区卡片区分开，看着像同一个模块的输入区 */
.nku-food-rate {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 6px 10px;
	padding: 8px 12px;
	border: 1px solid var(--vp-c-divider);
	border-radius: 10px;
	background: var(--vp-c-bg);
	font-size: 13px;
}

.nku-food-rate-mine {
	display: inline-flex;
	align-items: center;
	gap: 6px;
}

.nku-food-rate-summary {
	display: inline-flex;
	align-items: center;
	gap: 6px;
}

.nku-food-rate-summary strong {
	font-size: 16px;
	color: var(--vp-c-brand-1);
}

/* 提示语靠右，和左边的星星、右边的按钮在一行里站住；窄屏折行后另起一整行 */
.nku-food-rate-hint {
	margin-left: auto;
	font-size: 12px;
	color: var(--vp-c-text-3);
}

.nku-food-rate-only {
	padding: 2px 8px;
	border: 1px solid var(--vp-c-brand-1);
	border-radius: 10px;
	background: transparent;
	font-size: 11.5px;
	color: var(--vp-c-brand-1);
	cursor: pointer;
}

.nku-food-rate-only:hover:not(:disabled) {
	background: var(--vp-c-brand-1);
	color: var(--vp-c-bg);
}

.nku-food-rate-only:disabled {
	border-color: var(--vp-c-divider);
	color: var(--vp-c-text-3);
	cursor: not-allowed;
}

.nku-food-rating-message {
	margin: 8px 0 0;
	font-size: 12.5px;
	line-height: 1.5;
	color: var(--vp-c-text-2);
}

.nku-food-muted {
	font-size: 12.5px;
	color: var(--vp-c-text-3);
}

/* 评论做成独立卡片并提到简介下面：这是弹窗里最该先看到的内容 */
.nku-food-comments {
	margin-top: 16px;
	padding: 14px 16px 16px;
	border: 1px solid var(--vp-c-divider);
	border-radius: 12px;
	background: var(--vp-c-bg-soft);
}

.nku-food-comments-head {
	display: flex;
	flex-wrap: wrap;
	align-items: baseline;
	justify-content: space-between;
	gap: 4px 8px;
	margin-bottom: 10px;
	padding-bottom: 8px;
	border-bottom: 1px solid var(--vp-c-divider);
}

.nku-food-comments-head h3 {
	margin: 0;
	padding: 0;
	border: 0;
	font-size: 17px;
}

/* 弹窗 Teleport 到 body，评论正文拿不到 .vp-doc 的图片约束：不限制的话
   评论里一张表情就能撑到 300px 高，整段评论跟着变成一堵墙 */
.nku-food-comment-slot :deep(img) {
	height: auto;
	max-width: 100%;
	max-height: 200px;
}

.nku-food-viewer {
	display: flex;
	align-items: center;
	justify-content: center;
	position: fixed;
	inset: 0;
	background: rgb(0 0 0 / 0.85);
	z-index: 10000;
}

.nku-food-viewer-img {
	max-width: 92vw;
	max-height: 90vh;
	margin: 0;
	object-fit: contain;
}

.nku-food-viewer-close {
	position: absolute;
	top: 16px;
	right: 20px;
	width: 40px;
	height: 40px;
	border: 0;
	border-radius: 50%;
	background: rgb(255 255 255 / 0.15);
	font-size: 24px;
	color: #FFF;
	cursor: pointer;
}

.nku-food-viewer-nav {
	position: absolute;
	top: 50%;
	width: 48px;
	height: 48px;
	border: 1px solid var(--vp-c-brand-1);
	border-radius: 50%;
	background: rgb(255 255 255 / 0.88);
	font-size: 20px;
	color: var(--vp-c-brand-1);
	transform: translateY(-50%);
	cursor: pointer;
}

.nku-food-viewer-nav.prev {
	left: 20px;
}

.nku-food-viewer-nav.next {
	right: 20px;
}

.nku-food-viewer-counter {
	position: absolute;
	top: 28px;
	left: 50%;
	font-size: 13px;
	color: rgb(255 255 255 / 0.65);
	transform: translateX(-50%);
}

@media (max-width: 720px) {
	.nku-food-modal {
		padding: 0;
	}

	.nku-food-dialog {
		width: 100%;
		height: 100vh;
		max-height: 100vh;
		border-radius: 0;
	}

	/* 手机上「图左 · 信息右」会挤成两窄列，直接改成上下排 */
	.nku-food-hero {
		grid-template-columns: minmax(0, 1fr);
		gap: 12px;
	}

	/* 单栏时图占满整宽，240px 定高在窄屏会裁掉两边，改回跟着宽度走 */
	.nku-food-slide {
		height: auto;
		aspect-ratio: 16 / 10;
	}

	/* 触屏没有 hover 提示，翻页按钮放大一点才好点 */
	.nku-food-slide-nav {
		width: 34px;
		height: 34px;
		font-size: 14px;
	}

	/* 窄屏上打分条会折行，提示语靠右会孤零零挂在半行，改成独占一行 */
	.nku-food-rate-hint {
		flex-basis: 100%;
		margin-left: 0;
	}

	.nku-food-comments {
		padding: 12px 12px 14px;
	}

	.nku-food-dialog-body {
		padding: 12px 14px 22px;
	}

	.nku-food-dialog-head {
		padding: 16px 48px 12px 16px;
	}

	.nku-food-search {
		max-width: none;
	}

	.nku-food-filters {
		width: 100%;
	}
}
</style>

<style>
/* [rating:n] 徽章：注入到 Twikoo 渲染的评论里，不在本组件作用域内，需全局样式 */
.nku-food-rating-badge {
	display: inline-block;
	margin-right: 6px;
	font-size: 13px;
	letter-spacing: 1px;
	vertical-align: baseline;
	color: var(--vp-c-brand-1);
}
</style>
