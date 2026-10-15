<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { FOOD_CAMPUS, FOOD_CATEGORIES, FOODS, getFoodPhotos } from '../../data/food-data.js'
import {
	decorateRatings,
	destroyTwikoo,
	foodUrl,
	getTwikoo,
	installRatingInjector,
	loadRatings,
	myRatings,
	ratingState,
	setMyRating,
	submitRatingOnly,
	twikooEnvId,
} from './food-rating.js'

interface FoodItem {
	id: string
	name: string
	category?: string
	campus?: string
	location?: string
	price?: string
	tags?: string[]
	recommend?: string
	desc?: string
	cover?: string
	gallery?: string[]
	photos?: string[]
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
const viewerOpen = ref(false)
const viewerIndex = ref(0)
const commentMount = ref<HTMLElement>()
const commentSlot = ref<HTMLElement>()
const commentLoading = ref(false)
const commentFailed = ref(false)
const ratingOnlySubmitting = ref(false)
const ratingOnlyMessage = ref('')

let observer: MutationObserver | null = null
let decorateTimer: number | undefined
let removeInjector: (() => void) | null = null

const campusOptions = computed(() => {
	const keys = [...new Set(foods.value.map(item => item.campus).filter(Boolean))] as string[]
	return keys.map(key => ({ key, label: FOOD_CAMPUS[key] || key }))
})

const filtered = computed(() => {
	const kw = keyword.value.trim().toLowerCase()
	return foods.value.filter((item) => {
		if (currentCampus.value !== 'all' && item.campus !== currentCampus.value)
			return false
		if (currentCategory.value !== 'all' && item.category !== currentCategory.value)
			return false
		if (kw) {
			const hay = [item.name, item.desc, item.location, item.category, ...(item.tags || [])]
				.filter(Boolean)
				.join(' ')
				.toLowerCase()
			if (!hay.includes(kw))
				return false
		}
		return true
	})
})

const groups = computed(() => {
	const order = FOOD_CATEGORIES.map(category => category.key)
	const map = new Map<string, FoodItem[]>()
	for (const item of filtered.value) {
		const key = order.includes(item.category || '') ? item.category! : 'other'
		if (!map.has(key))
			map.set(key, [])
		map.get(key)!.push(item)
	}
	return [...map.entries()]
		.sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
		.map(([key, list]) => ({
			key,
			label: FOOD_CATEGORIES.find(category => category.key === key)?.label || '其他',
			list,
		}))
})

const categoryOptions = computed(() => {
	const counts = new Map<string, number>()
	for (const item of foods.value) {
		const key = item.category || 'other'
		counts.set(key, (counts.get(key) || 0) + 1)
	}
	return [
		{ key: 'all', label: '全部', count: foods.value.length },
		...FOOD_CATEGORIES.filter(category => counts.has(category.key)).map(category => ({
			key: category.key,
			label: category.label,
			count: counts.get(category.key)!,
		})),
	]
})

const activePhotos = computed<string[]>(() => getFoodPhotos(active.value))
const activeRating = computed(() => (active.value ? ratingState[active.value.id] : null))

function stateOf(item: FoodItem) {
	return ratingState[item.id] || { sum: 0, count: 0, avg: 0, loaded: false, loading: false }
}

function categoryLabel(key?: string) {
	return FOOD_CATEGORIES.find(category => category.key === key)?.label || '其他'
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

function coverOf(item: FoodItem) {
	return getFoodPhotos(item)[0] || ''
}

function hideBroken(event: Event) {
	(event.currentTarget as HTMLElement).style.display = 'none'
}

function scheduleDecorate() {
	if (decorateTimer)
		window.clearTimeout(decorateTimer)
	decorateTimer = window.setTimeout(decorateRatings, 120, commentSlot.value)
}

async function openDialog(item: FoodItem) {
	active.value = item
	viewerOpen.value = false
	viewerIndex.value = 0
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
	if (!mountPoint || !slot)
		return

	try {
		const twikoo = await getTwikoo()
		await twikoo.init({
			envId: twikooEnvId,
			el: mountPoint,
			path: foodUrl(item.id),
			lang: 'zh-CN',
		})
		await nextTick()
		// 评论区在「加载更多 / 切换排序」后会整体重绘，MutationObserver 兜底重打徽章
		observer?.disconnect()
		observer = new MutationObserver(scheduleDecorate)
		observer.observe(slot, { childList: true, subtree: true })
		slot.addEventListener('click', scheduleDecorate)
		// 弹窗打开时主评论框可能已渲染完成，直接挂注入器；晚渲染也无妨，
		// 「只提交评分」走的是实时查询，不依赖这一步
		removeInjector?.()
		removeInjector = installRatingInjector(slot, () => ratingOf(active.value!) || 0)
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
	if (!active.value || !ratingOf(active.value) || ratingOnlySubmitting.value)
		return
	ratingOnlySubmitting.value = true
	ratingOnlyMessage.value = ''
	const result = await submitRatingOnly(commentSlot.value, () => ratingOf(active.value!))
	if (result.ok) {
		ratingOnlyMessage.value = '评分已提交，列表刷新后会更新统计。'
		await loadRatings([active.value.id], { force: true })
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
	else {
		ratingOnlyMessage.value = '评分组件尚未加载完成，请稍后重试。'
	}
	ratingOnlySubmitting.value = false
}

function closeDialog() {
	active.value = null
	viewerOpen.value = false
	observer?.disconnect()
	observer = null
	if (decorateTimer)
		window.clearTimeout(decorateTimer)
	removeInjector?.()
	removeInjector = null
	destroyTwikoo(commentSlot.value)
	document.body.style.overflow = ''
}

function openViewer(index: number) {
	if (!activePhotos.value.length)
		return
	viewerIndex.value = index
	viewerOpen.value = true
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
	if (event.key === 'Escape') {
		if (viewerOpen.value)
			viewerOpen.value = false
		else closeDialog()
	}
	else if (viewerOpen.value && event.key === 'ArrowLeft') {
		changeViewer(-1)
	}
	else if (viewerOpen.value && event.key === 'ArrowRight') {
		changeViewer(1)
	}
	else {
		return
	}
	event.preventDefault()
}

watch([currentCampus, currentCategory], () => loadRatings(filtered.value.map(item => item.id)))

onMounted(() => {
	document.addEventListener('keydown', onKeydown)
	loadRatings(foods.value.map(item => item.id))
})

onBeforeUnmount(() => {
	document.removeEventListener('keydown', onKeydown)
	observer?.disconnect()
	if (decorateTimer)
		window.clearTimeout(decorateTimer)
	removeInjector?.()
	destroyTwikoo(commentSlot.value)
	document.body.style.overflow = ''
})
</script>

<template>
<section class="nku-food">
	<div class="nku-food-toolbar">
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
		<div class="nku-food-filters">
			<select v-if="campusOptions.length > 1" v-model="currentCampus" class="nku-food-select">
				<option value="all">
					全部校区
				</option>
				<option v-for="campus in campusOptions" :key="campus.key" :value="campus.key">
					{{ campus.label }}
				</option>
			</select>
			<input v-model="keyword" class="nku-food-search" type="search" placeholder="搜索名称、地点或标签">
		</div>
	</div>

	<p v-if="!filtered.length" class="nku-food-empty">
		没有匹配的美食，换个关键词试试。
	</p>

	<div v-for="group in groups" :key="group.key" class="nku-food-group">
		<h3 class="nku-food-group-title">
			{{ group.label }}
		</h3>
		<div class="nku-food-grid">
			<article v-for="item in group.list" :key="item.id" class="nku-food-card">
				<a class="nku-food-cover" href="#" @click.stop.prevent="openDialog(item)">
					<img v-if="coverOf(item)" :src="coverOf(item)" :alt="item.name" loading="lazy" @error="hideBroken">
					<span v-else class="nku-food-cover-fallback">{{ item.name.slice(0, 1) }}</span>
				</a>
				<div class="nku-food-card-body">
					<a class="nku-food-name" href="#" @click.prevent="openDialog(item)">{{ item.name }}</a>
					<p v-if="item.location" class="nku-food-location">
						{{ item.location }}
					</p>

					<div class="nku-food-score">
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
					</div>

					<div class="nku-food-card-foot">
						<span class="nku-food-myrating" title="点击打分，在弹窗中提交后生效">
							<button
								v-for="n in 5"
								:key="n"
								type="button"
								class="nku-food-star-btn"
								:class="{ on: n <= ratingOf(item) }"
								:aria-label="`打 ${n} 分`"
								@click="onPick(item, n)"
							>★</button>
						</span>
						<button class="nku-food-comment-btn" type="button" @click="openDialog(item)">
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
			<div class="nku-food-dialog" role="dialog" aria-modal="true" :aria-label="active.name">
				<button class="nku-food-dialog-close" type="button" aria-label="关闭" @click="closeDialog">
					&times;
				</button>

				<div class="nku-food-dialog-head">
					<h2>{{ active.name }}</h2>
					<div class="nku-food-dialog-tags">
						<span class="nku-food-badge">{{ categoryLabel(active.category) }}</span>
						<span v-if="active.campus" class="nku-food-badge ghost">{{ campusLabel(active.campus) }}</span>
						<span v-for="tag in active.tags || []" :key="tag" class="nku-food-badge ghost">{{ tag }}</span>
					</div>
				</div>

				<div class="nku-food-dialog-body">
					<dl class="nku-food-meta">
						<template v-if="active.location">
							<dt>美食地点</dt>
							<dd>{{ active.location }}</dd>
						</template>
						<template v-if="active.price">
							<dt>人均</dt>
							<dd>{{ active.price }}</dd>
						</template>
						<template v-if="active.recommend">
							<dt>推荐</dt>
							<dd>{{ active.recommend }}</dd>
						</template>
					</dl>

					<p v-if="active.desc" class="nku-food-dialog-desc">
						{{ active.desc }}
					</p>

					<div v-if="activePhotos.length" class="nku-food-photos">
						<button
							v-for="(photo, index) in activePhotos"
							:key="photo"
							class="nku-food-photo"
							type="button"
							@click="openViewer(index)"
						>
							<img :src="photo" :alt="`${active.name} 图片 ${index + 1}`" loading="lazy">
						</button>
					</div>

					<div class="nku-food-rating-block">
						<div class="nku-food-rating-summary">
							<span class="nku-food-stars large">
								<span v-for="n in 5" :key="n" :class="{ on: n <= Math.round(activeRating?.avg || 0) }">★</span>
							</span>
							<strong>{{ activeRating?.count ? activeRating.avg.toFixed(1) : '暂无评分' }}</strong>
							<span v-if="activeRating?.count" class="nku-food-muted">{{ activeRating.count }} 人评分</span>
							<span v-else class="nku-food-muted">来打第一个分</span>
						</div>
						<div class="nku-food-rating-picker">
							<span class="nku-food-muted">我的评分</span>
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
							<button
								class="nku-food-rate-only"
								type="button"
								:disabled="!ratingOf(active) || ratingOnlySubmitting || commentLoading"
								@click="submitOnlyRating"
							>
								{{ ratingOnlySubmitting ? '提交中…' : '只提交评分' }}
							</button>
						</div>
						<p v-if="ratingOnlyMessage" class="nku-food-rating-message">
							{{ ratingOnlyMessage }}
						</p>
					</div>

					<div class="nku-food-comments">
						<h3>历史评论</h3>
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
					</div>
				</div>
			</div>

			<div v-if="viewerOpen" class="nku-food-viewer" @click.self="viewerOpen = false">
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

.nku-food-toolbar {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: space-between;
	gap: 10px 16px;
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
	transition: color 0.2s, border-color 0.2s, background 0.2s;
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
	width: 190px;
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
	transition: box-shadow 0.2s, transform 0.2s;
}

.nku-food-card:hover {
	box-shadow: 0 2px 16px rgb(0 0 0 / 0.1);
	transform: translateY(-2px);
}

.nku-food-cover {
	display: block;
	overflow: hidden;
	aspect-ratio: 4 / 3;
	background: var(--vp-c-bg);
}

.nku-food-cover img {
	width: 100%;
	height: 100%;
	margin: 0;
	transition: transform 0.4s ease;
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

.nku-food-location {
	margin: 0;
	font-size: 12.5px;
	line-height: 1.4;
	color: var(--vp-c-text-3);
}

.nku-food-score {
	display: flex;
	align-items: center;
	gap: 6px;
}

.nku-food-stars,
.nku-food-myrating {
	display: inline-flex;
	gap: 1px;
	font-size: 14px;
	line-height: 1;
	color: var(--vp-c-text-3);
}

.nku-food-stars .on {
	color: var(--vp-c-brand-1);
}

.nku-food-stars.large {
	font-size: 18px;
}

.nku-food-stars.pickable button,
.nku-food-star-btn {
	padding: 0;
	border: 0;
	background: transparent;
	font-size: inherit;
	line-height: 1;
	color: inherit;
	transition: transform 0.15s, color 0.15s;
	cursor: pointer;
}

.nku-food-stars.pickable button.on,
.nku-food-star-btn.on {
	color: var(--vp-c-brand-1);
}

.nku-food-stars.pickable button:hover,
.nku-food-star-btn:hover {
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

.nku-food-card-foot {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
	margin-top: auto;
	padding-top: 8px;
	border-top: 1px solid var(--vp-c-divider);
}

.nku-food-comment-btn {
	padding: 3px 10px;
	border: 1px solid var(--vp-c-brand-1);
	border-radius: 12px;
	background: transparent;
	font-size: 12.5px;
	color: var(--vp-c-brand-1);
	transition: background 0.2s, color 0.2s;
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
	width: min(880px, 100%);
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
	padding: 18px 52px 12px 20px;
	border-bottom: 1px solid var(--vp-c-divider);
}

/* 弹窗 Teleport 到 body，不在 .vp-doc 作用域内，无需覆盖文档样式 */
.nku-food-dialog-head h2 {
	margin: 0;
	padding: 0;
	border: 0;
	font-size: 20px;
}

.nku-food-dialog-tags {
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
	padding: 16px 20px 24px;
}

.nku-food-meta {
	display: grid;
	grid-template-columns: auto 1fr;
	gap: 6px 12px;
	margin: 0 0 12px;
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

.nku-food-dialog-desc {
	margin: 0 0 16px;
	font-size: 14px;
	line-height: 1.7;
	color: var(--vp-c-text-2);
}

.nku-food-photos {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
	gap: 8px;
	margin-bottom: 16px;
}

.nku-food-photo {
	overflow: hidden;
	padding: 0;
	border: 1px solid var(--vp-c-divider);
	border-radius: 8px;
	background: var(--vp-c-bg-soft);
	cursor: zoom-in;
}

.nku-food-photo img {
	display: block;
	width: 100%;
	height: 100%;
	aspect-ratio: 4 / 3;
	margin: 0;
	object-fit: cover;
}

.nku-food-rating-block {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: space-between;
	gap: 10px 20px;
	margin-bottom: 20px;
	padding: 12px 14px;
	border: 1px solid var(--vp-c-divider);
	border-radius: 10px;
	background: var(--vp-c-bg-soft);
}

.nku-food-rating-summary,
.nku-food-rating-picker {
	display: flex;
	align-items: center;
	gap: 8px;
	font-size: 13.5px;
}

.nku-food-rating-summary strong {
	font-size: 16px;
	color: var(--vp-c-brand-1);
}

.nku-food-rate-only {
	padding: 3px 9px;
	border: 1px solid var(--vp-c-brand-1);
	border-radius: 12px;
	background: transparent;
	font-size: 12px;
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
	flex-basis: 100%;
	margin: 0;
	font-size: 12.5px;
	line-height: 1.5;
	color: var(--vp-c-text-2);
}

.nku-food-muted {
	font-size: 12.5px;
	color: var(--vp-c-text-3);
}

.nku-food-comments h3 {
	margin: 0 0 8px;
	padding: 0;
	border: 0;
	font-size: 16px;
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

	.nku-food-search {
		width: 100%;
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
