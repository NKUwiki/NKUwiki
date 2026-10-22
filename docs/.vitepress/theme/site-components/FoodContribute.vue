<script setup lang="ts">
/**
 * 美食投稿助手 —— 在页面上填完信息，先看卡片长什么样，再生成能粘进 food-data.js 的数据条。
 *
 * 与地图的坐标拾取（?pick=1）是同一类工具：把「维护数据」这件事搬到网页上做，
 * 用户不用克隆仓库、不用懂格式。区别是美食条目没有坐标，所以这里没有拾取环节，
 * 只有「填字段 → 预览 → 复制／提 issue」。
 *
 * 传了 source（详情弹窗里的「基于这条投稿」）就把那条的信息整条搬进表单：
 * 原名原地点原分类 = 修订这一条，id 沿用；改了名称或地点就是新条目，id 重新算。
 * 数据条格式与 id 规则见 food-snippet.js（纯函数，可测）。本组件只负责表单与交互。
 */
import { createModalFocus } from '@nkuwiki/theme/theme/composables/modalA11y.ts'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { FOOD_CAMPUS, FOOD_CATEGORIES, FOODS } from '../../data/food-data.js'
import {
	buildFoodIssueUrl,
	buildFoodSnippet,
	draftFromFood,
	findExactDuplicate,
	findSimilarFoods,
	isCanteenCategory,
	isSameFood,
	suggestFoodId,
} from './food-snippet.js'

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
	detail?: string
	cover?: string
	gallery?: string[]
	photos?: string[]
}

const props = defineProps<{ source?: FoodItem | null }>()
// 事件名用 camelCase 声明，模板里写 @open-change 监听（Vue 会自动转成 kebab-case）
const emit = defineEmits<{ openChange: [value: boolean] }>()

const foods = FOODS as FoodItem[]
const categories = FOOD_CATEGORIES as Array<{ key: string, label: string, campus?: string }>
const campusMap = FOOD_CAMPUS as Record<string, string>

const open = ref(false)
/** 预览区两个页签：先看卡片像不像，再拿数据条 */
const tab = ref<'card' | 'code'>('card')
const dialogEl = ref<HTMLElement>()
const modalFocus = createModalFocus()

const name = ref('')
// 分类已按楼层拆开，没有「默认就对」的那一项 —— 空着让用户自己选，避免默认值是错的
const category = ref('')
const campus = ref('balitai')
const location = ref('')
const price = ref('')
const tagsText = ref('')
const recommend = ref('')
const desc = ref('')
const detail = ref('')
const photosText = ref('')
const idOverride = ref('')
const copied = ref(false)
const copyFailed = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | undefined

/**
 * 分类下拉跟着校区走：八里台的楼层在津南并不存在，列出来只会投出一条两边都对不上的记录。
 * 不限校区的分类（校外商圈）两个校区都列。
 */
const categoryOptions = computed(() => categories.filter(item => !item.campus || !campus.value || item.campus === campus.value))
const campusOptions = Object.entries(campusMap).map(([key, label]) => ({ key, label }))

/** 已有地点的去重清单，给地点输入框做候选（不强制，新商圈也能直接填） */
const locationOptions = computed(() => {
	const seen = new Set<string>()
	for (const food of foods) {
		if (food.location) {
			seen.add(food.location)
		}
	}
	return [...seen]
})

const tagList = computed(() => tagsText.value.split(/[,，、\s]+/).map(s => s.trim()).filter(Boolean))
const photoList = computed(() => photosText.value.split('\n').map(s => s.trim()).filter(Boolean))

/** 自动建议的 id，以及哪些字缺拼音（缺了会变成 u70e4 这种，提示用户手改） */
const suggestion = computed(() => suggestFoodId({
	name: name.value,
	category: category.value,
	location: location.value,
}, foods))

/**
 * 名称 / 分类 / 地点都没改，说明是在修订传入的那一条 —— 这时必须沿用旧 id。
 * 换了 id 等于给同一道菜再开一张卡，历史评论（/food/<id>）会留在旧卡上。
 */
const sameAsSource = computed(() => Boolean(props.source) && isSameFood({
	name: name.value,
	category: category.value,
	location: location.value,
}, props.source))

const finalId = computed(() => idOverride.value.trim() || (sameAsSource.value && props.source ? props.source.id : suggestion.value.id))

const snippet = computed(() => buildFoodSnippet({
	id: finalId.value,
	name: name.value,
	category: category.value,
	campus: campus.value,
	location: location.value,
	price: price.value,
	tags: tagList.value,
	recommend: recommend.value,
	desc: desc.value,
	detail: detail.value,
	cover: photoList.value[0] || '',
	gallery: photoList.value.slice(1),
}))

/** 正在修订原条目时把原条目自己排除掉；改名成新记录后，它会作为「相似的已有条目」出现 */
const similar = computed(() => findSimilarFoods({ name: name.value }, foods)
	.filter(food => !(sameAsSource.value && food.id === props.source?.id)))

/** 同名同地点：多半是重复投稿，比「相似」更强的提示（正在修订原条目时不必提示） */
const duplicate = computed(() => (sameAsSource.value
	? undefined
	: findExactDuplicate({ name: name.value, location: location.value }, foods)))

const missing = computed(() => {
	const list: string[] = []
	if (!name.value.trim())
		list.push('名称')
	if (!category.value)
		list.push('分类')
	if (!campus.value)
		list.push('校区')
	if (!location.value.trim())
		list.push('地点')
	return list
})

const idWarning = computed(() => {
	if (idOverride.value.trim() || sameAsSource.value || !suggestion.value.missing.length)
		return ''
	return `「${suggestion.value.missing.join('')}」没有拼音，id 里会变成 u${suggestion.value.missing[0]?.codePointAt(0)?.toString(16)} 这种形式，建议手动改一下`
})

const issueUrl = computed(() => snippet.value
	? buildFoodIssueUrl({
			name: name.value,
			category: category.value,
			categoryLabel: categories.find(item => item.key === category.value)?.label,
			campus: campus.value,
			campusLabel: campusMap[campus.value],
			location: location.value,
			price: price.value,
			tags: tagList.value,
			recommend: recommend.value,
			desc: desc.value,
			detail: detail.value,
		}, snippet.value)
	: '')

/* ── 卡片预览：照卡片墙的形态画一张，字段还没填就显示占位 ── */
const previewCover = computed(() => photoList.value[0] || '')
const previewCampus = computed(() => campusMap[campus.value] || '')
const previewCategory = computed(() => categories.find(item => item.key === category.value)?.label || '')
const previewTags = computed(() => tagList.value.slice(0, 3))

/**
 * 选到食堂楼层就把地点同步成同一个值 —— 食堂卡的分类与地点本来就是同一件事，
 * 让人再手打一遍只会打出错别字，而错别字会直接落进 id（评论主键）。
 * 顺带把校区也定成该分类所属的校区：楼层本身已经说明了在哪，再让人选一次就是给错配留口子。
 */
function onCategoryChange() {
	const picked = categories.find(item => item.key === category.value)
	if (!picked)
		return
	if (picked.campus && campus.value !== picked.campus)
		campus.value = picked.campus
	if (!isCanteenCategory(category.value) || !picked.label)
		return
	// 地点是空的，或者填的是另一个楼层（刚换了分类），才覆盖；自己填的店名不动
	const isAnotherPlace = categories.some(item => item.label === location.value)
	if (!location.value.trim() || isAnotherPlace)
		location.value = picked.label
}

// 反向：先改校区时，原来选的分类若不属于新校区就清空，避免带出一个看不见的选项
watch(campus, () => {
	if (category.value && !categoryOptions.value.some(item => item.key === category.value))
		category.value = ''
})

/** 把一条现有卡片的信息搬进表单 */
function prefillFromSource(item: FoodItem) {
	const draft = draftFromFood(item)
	name.value = draft.name
	category.value = draft.category
	campus.value = draft.campus || 'balitai'
	location.value = draft.location
	price.value = draft.price
	tagsText.value = draft.tags.join('、')
	recommend.value = draft.recommend
	desc.value = draft.desc
	detail.value = draft.detail
	photosText.value = draft.photos.join('\n')
	idOverride.value = ''
	copied.value = false
	copyFailed.value = false
}

function openPanel() {
	if (props.source) {
		prefillFromSource(props.source)
	}
	else {
		// 没带 source 时表单是接着上次的内容的（故意留草稿），但「已复制」这种
		// 一次性反馈不能留着，否则重新打开时按钮还显示着上次的勾
		copied.value = false
		copyFailed.value = false
	}
	tab.value = 'card'
	open.value = true
}

function closePanel() {
	open.value = false
}

/**
 * 页签的左右方向键（ARIA tab 模式）：只有当前页签进得了 Tab 序列，
 * 其余靠方向键。两个页签无所谓「上一个 / 下一个」，左右都当切换用；
 * 切完要把焦点也搬到新页签上，否则焦点留在已经 tabindex="-1" 的旧按钮上。
 */
function stepTab() {
	tab.value = tab.value === 'card' ? 'code' : 'card'
	void nextTick(() => {
		dialogEl.value?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus()
	})
}

/**
 * 打开时锁背景滚动，关闭时还原成**打开前**的值。
 * 不能一律清成 ''：从详情弹窗里点开时详情已经锁过一次，这里再锁一次、
 * 关闭时清空，详情还开着背景却能滚了。记住原值再还原才对得上。
 */
let prevBodyOverflow = ''

watch(open, async (isOpen) => {
	emit('openChange', isOpen)
	if (isOpen) {
		prevBodyOverflow = document.body.style.overflow
		document.body.style.overflow = 'hidden'
		await nextTick()
		modalFocus.onOpen(dialogEl.value)
	}
	else {
		document.body.style.overflow = prevBodyOverflow
		modalFocus.onClose()
	}
})

function onKeydown(event: KeyboardEvent) {
	if (!open.value)
		return
	if (event.key === 'Escape') {
		event.preventDefault()
		// 只关自己这一层：详情弹窗是另一套监听，真要关它得再按一次。
		// 两个监听都挂在 document 上，stopPropagation 只挡得住别的**节点**、
		// 拦不住同一节点上的另一个监听，必须 stopImmediatePropagation
		// （此前只靠 FoodCards 里 contributeOpen 标志的时序兜底，太脆）。
		event.stopImmediatePropagation()
		closePanel()
		return
	}
	modalFocus.trap(event, dialogEl.value)
}

// 监听挂载时再加：SSR 阶段没有 document，写在 setup 顶层会直接抛 ReferenceError
onMounted(() => document.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => {
	document.removeEventListener('keydown', onKeydown)
	clearTimeout(copiedTimer)
	modalFocus.restoreIfOpen()
})

async function copySnippet() {
	if (!snippet.value)
		return
	const text = snippet.value
	try {
		// 优先用异步剪贴板；iframe / 非 https 下会被拒，退回老办法
		if (navigator.clipboard?.writeText) {
			await navigator.clipboard.writeText(text)
		}
		else {
			throw new Error('no clipboard api')
		}
		copied.value = true
		copyFailed.value = false
		clearTimeout(copiedTimer)
		copiedTimer = setTimeout(() => {
			copied.value = false
		}, 1600)
	}
	catch {
		const area = document.createElement('textarea')
		area.value = text
		// 必须留在文档流里才选得中，所以挪到视口外而不是 display:none
		area.style.position = 'fixed'
		area.style.top = '-1000px'
		document.body.appendChild(area)
		area.select()
		const ok = document.execCommand('copy')
		document.body.removeChild(area)
		copied.value = ok
		copyFailed.value = !ok
	}
}

function resetForm() {
	name.value = ''
	// 校区回到默认、分类清空：分类是必填项又没有「默认就对」的一项，
	// 留着上一次选的楼层，用户改个名字就复制，会 quietly 投出一条错分类的记录
	campus.value = 'balitai'
	category.value = ''
	location.value = ''
	price.value = ''
	tagsText.value = ''
	recommend.value = ''
	desc.value = ''
	detail.value = ''
	photosText.value = ''
	idOverride.value = ''
	copied.value = false
	copyFailed.value = false
}
</script>

<template>
<span class="nku-food-contribute">
	<button class="nku-food-contribute-btn" type="button" @click="openPanel">
		{{ source ? '＋ 基于这条投稿' : '＋ 投稿一条' }}
	</button>

	<Teleport to="body">
		<div v-if="open" class="nku-food-modal" @click.self="closePanel">
			<div ref="dialogEl" class="nku-food-dialog nku-food-contribute-panel" role="dialog" aria-modal="true" aria-label="投稿美食">
				<button class="nku-food-dialog-close" type="button" aria-label="关闭" @click="closePanel">
					&times;
				</button>

				<div class="nku-food-dialog-head">
					<h2>{{ source ? '基于这条投稿' : '投稿一条美食' }}</h2>
					<p class="nku-food-contribute-sub">
						<template v-if="source">
							已带入「{{ source.name }}」的现有信息。名称、分类、地点都不动就算修订这一条（id 保持 <code>{{ source.id }}</code>）；改了名称或地点就是一条新记录。
						</template>
						<template v-else>
							不用注册、不用懂代码：填好左边，右边会实时画出卡片的样子，确认无误再复制数据条。
						</template>
					</p>
				</div>

				<div class="nku-food-contribute-body">
					<form class="nku-food-contribute-form" @submit.prevent>
						<label class="nku-food-field">
							<span>名称 <i>*</i></span>
							<input v-model="name" type="text" placeholder="如 老陶包子铺、烤鸭饭" data-autofocus>
						</label>
						<p v-if="duplicate" class="nku-food-contribute-hint warn">
							「{{ duplicate.name }}」在{{ duplicate.location }}已经有一条了（id: <code>{{ duplicate.id }}</code>）—— 除非是另一家店，否则不用重复投稿。
						</p>
						<p v-else-if="similar.length" class="nku-food-contribute-hint warn">
							已有相似的条目，先看看是不是重复了：{{ similar.map(item => item.name).join('、') }}
						</p>

						<div class="nku-food-field-row">
							<label class="nku-food-field">
								<span>校区 <i>*</i></span>
								<select v-model="campus">
									<option v-for="item in campusOptions" :key="item.key" :value="item.key">
										{{ item.label }}
									</option>
								</select>
							</label>
							<label class="nku-food-field">
								<span>分类 <i>*</i></span>
								<select v-model="category" @change="onCategoryChange">
									<option value="" disabled>
										请选择分类
									</option>
									<option v-for="item in categoryOptions" :key="item.key" :value="item.key">
										{{ item.label }}
									</option>
								</select>
							</label>
						</div>

						<label class="nku-food-field">
							<span>地点 <i>*</i></span>
							<input v-model="location" type="text" list="nku-food-locations" placeholder="如 西南村、鲁能城、一食堂一楼">
							<datalist id="nku-food-locations">
								<option v-for="item in locationOptions" :key="item" :value="item" />
							</datalist>
						</label>

						<div class="nku-food-field-row">
							<label class="nku-food-field">
								<span>人均</span>
								<input v-model="price" type="text" placeholder="如 ¥15-25">
							</label>
							<label class="nku-food-field">
								<span>标签<em>逗号分隔</em></span>
								<input v-model="tagsText" type="text" placeholder="如 包子、现做">
							</label>
						</div>

						<label class="nku-food-field">
							<span>推荐菜</span>
							<input v-model="recommend" type="text" placeholder="最值得点的那一两样">
						</label>

						<label class="nku-food-field">
							<span>简介<em>卡片上显示，一两句</em></span>
							<textarea v-model="desc" rows="2" placeholder="如 一食堂一楼的烤鸭饭，皮脆肉嫩，15 元管饱" />
						</label>

						<label class="nku-food-field">
							<span>详细介绍<em>只在详情页显示</em></span>
							<textarea v-model="detail" rows="3" placeholder="档口位置、出餐时间、份量、踩雷提醒…… 想写多细都行" />
						</label>

						<label class="nku-food-field">
							<span>图片链接<em>每行一个，第一张作封面</em></span>
							<textarea v-model="photosText" rows="2" placeholder="https://... （可选，用图床链接）" />
						</label>

						<label class="nku-food-field">
							<span>
								ID
								<em v-if="sameAsSource">沿用原条目的 id</em>
								<em v-else>自动生成，一般不用改</em>
							</span>
							<input v-model="idOverride" type="text" :placeholder="finalId || '填完名称和地点后自动生成'">
						</label>
						<p v-if="idWarning" class="nku-food-contribute-hint warn">
							{{ idWarning }}
						</p>
					</form>

					<div class="nku-food-contribute-preview">
						<div class="nku-food-preview-tabs" role="tablist" aria-label="预览方式">
							<button
								id="nku-food-tab-card"
								class="nku-food-preview-tab"
								:class="{ active: tab === 'card' }"
								type="button"
								role="tab"
								aria-controls="nku-food-panel-card"
								:aria-selected="tab === 'card'"
								:tabindex="tab === 'card' ? 0 : -1"
								@click="tab = 'card'"
								@keydown.left.prevent="stepTab"
								@keydown.right.prevent="stepTab"
							>
								卡片预览
							</button>
							<button
								id="nku-food-tab-code"
								class="nku-food-preview-tab"
								:class="{ active: tab === 'code' }"
								type="button"
								role="tab"
								aria-controls="nku-food-panel-code"
								:aria-selected="tab === 'code'"
								:tabindex="tab === 'code' ? 0 : -1"
								@click="tab = 'code'"
								@keydown.left.prevent="stepTab"
								@keydown.right.prevent="stepTab"
							>
								数据条
							</button>
						</div>

						<div
							v-if="tab === 'card'"
							id="nku-food-panel-card"
							class="nku-food-preview-panel"
							role="tabpanel"
							aria-labelledby="nku-food-tab-card"
						>
							<article class="nku-food-preview-card">
								<div class="nku-food-preview-cover">
									<img v-if="previewCover" :src="previewCover" alt="">
									<span v-else class="nku-food-preview-cover-fallback">{{ (name || '美').slice(0, 1) }}</span>
									<span v-if="previewCampus" class="nku-food-preview-campus">{{ previewCampus }}</span>
								</div>
								<div class="nku-food-preview-body">
									<strong class="nku-food-preview-name">{{ name || '名称' }}</strong>
									<div class="nku-food-preview-tags">
										<span v-if="location" class="place">{{ location }}</span>
										<span v-for="tag in previewTags" :key="tag">{{ tag }}</span>
										<span v-if="!location && !previewTags.length" class="placeholder">地点 / 标签</span>
									</div>
									<p class="nku-food-preview-desc">
										{{ desc || '一句话简介会显示在这里' }}
									</p>
									<div class="nku-food-preview-foot">
										<span class="nku-food-preview-score">★★★★★ <em>暂无评分</em></span>
										<span class="nku-food-preview-btn">评价</span>
									</div>
								</div>
							</article>
							<p class="nku-food-contribute-hint">
								详情页另显示：简介 + 详细介绍、人均与推荐菜、全部实拍图、历史评论。分类 {{ previewCategory || '（未选）' }} 决定它落在哪个分组里。
							</p>
						</div>

						<div
							v-else
							id="nku-food-panel-code"
							class="nku-food-preview-panel"
							role="tabpanel"
							aria-labelledby="nku-food-tab-code"
						>
							<pre v-if="snippet" class="nku-food-snippet">{{ snippet }}</pre>
							<p v-else class="nku-food-snippet empty">
								填完名称、校区、分类、地点这些必填项，这里会出现可直接粘贴的代码。
							</p>
						</div>

						<p v-if="tab === 'code' && missing.length" class="nku-food-contribute-hint">
							还差：{{ missing.join('、') }}
						</p>

						<div class="nku-food-contribute-actions">
							<button class="nku-food-contribute-copy" type="button" :disabled="!snippet" @click="copySnippet">
								{{ copied ? '已复制' : '复制数据条' }}
							</button>
							<a
								v-if="issueUrl"
								class="nku-food-contribute-issue"
								:href="issueUrl"
								target="_blank"
								rel="noopener"
							>去 GitHub 提 issue</a>
						</div>
						<p v-if="copyFailed" class="nku-food-contribute-hint warn">
							浏览器拒绝了剪贴板访问，请手动选中上面的代码复制。
						</p>

						<ol class="nku-food-contribute-steps">
							<li>复制上面的数据条；</li>
							<li>贴到页面底部的留言区（注明「美食投稿」），或点「去 GitHub 提 issue」；</li>
							<li>维护者会把它并进 <code>food-data.js</code>，卡片随即出现。</li>
						</ol>

						<button class="nku-food-contribute-reset" type="button" @click="resetForm">
							清空重填
						</button>
					</div>
				</div>
			</div>
		</div>
	</Teleport>
</span>
</template>

<style scoped>
.nku-food-contribute-btn {
	padding: 3px 10px;
	border: 1px dashed var(--vp-c-divider);
	border-radius: 14px;
	background: transparent;
	font-size: 13px;
	color: var(--vp-c-text-2);
	transition: color var(--wiki-duration-collapse) var(--wiki-ease-out), border-color var(--wiki-duration-collapse) var(--wiki-ease-out);
	cursor: pointer;
}

.nku-food-contribute-btn:hover {
	border-color: var(--vp-c-brand-1);
	color: var(--vp-c-brand-1);
}

/* 弹窗外壳沿用 FoodCards 的 .nku-food-modal / .nku-food-dialog 视觉，
   那两个类在 FoodCards 里是 scoped，这里只能各自实现一份。
   z-index 高于详情弹窗（9998）与图片查看器（10000）：从详情里点开时，
   投稿面板必须压在它们上面 */
.nku-food-modal {
	display: flex;
	align-items: center;
	justify-content: center;
	position: fixed;
	inset: 0;
	padding: 24px;
	background: rgb(0 0 0 / 0.55);
	z-index: 10005;
}

.nku-food-dialog {
	display: flex;
	flex-direction: column;
	position: relative;
	overflow: hidden;
	width: min(920px, 100%);
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
	padding: 18px 52px 12px 22px;
	border-bottom: 1px solid var(--vp-c-divider);
}

.nku-food-dialog-head h2 {
	margin: 0;
	font-size: 18px;
	line-height: 1.4;
}

.nku-food-contribute-sub {
	margin: 6px 0 0;
	font-size: 13px;
	line-height: 1.6;
	color: var(--vp-c-text-2);
}

.nku-food-contribute-sub code {
	padding: 1px 4px;
	border-radius: 4px;
	background: var(--vp-c-bg-soft);
	font-size: 12px;
}

.nku-food-contribute-body {
	display: grid;
	grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
	gap: 22px;
	overflow-y: auto;
	padding: 16px 22px 22px;
}

.nku-food-contribute-form {
	display: flex;
	flex-direction: column;
	gap: 10px;
}

.nku-food-field {
	display: flex;
	flex-direction: column;
	gap: 4px;
	font-size: 13px;
	color: var(--vp-c-text-2);
}

.nku-food-field > span {
	display: flex;
	align-items: baseline;
	gap: 6px;
}

.nku-food-field i {
	font-style: normal;
	color: var(--vp-c-danger-1);
}

.nku-food-field em {
	margin-left: auto;
	font-size: 12px;
	font-style: normal;
	color: var(--vp-c-text-3);
}

.nku-food-field input,
.nku-food-field select,
.nku-food-field textarea {
	width: 100%;
	padding: 6px 9px;
	border: 1px solid var(--vp-c-divider);
	border-radius: 8px;
	outline: none;
	background: var(--vp-c-bg);
	font-family: inherit;
	font-size: 13px;
	color: var(--vp-c-text-1);
}

.nku-food-field input:focus,
.nku-food-field select:focus,
.nku-food-field textarea:focus {
	border-color: var(--vp-c-brand-1);
}

.nku-food-field textarea {
	line-height: 1.5;
	resize: vertical;
}

.nku-food-field-row {
	display: grid;
	grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
	gap: 10px;
}

.nku-food-contribute-hint {
	margin: 0;
	font-size: 12px;
	line-height: 1.6;
	color: var(--vp-c-text-3);
}

.nku-food-contribute-hint.warn {
	color: var(--vp-c-danger-1);
}

.nku-food-contribute-preview {
	display: flex;
	flex-direction: column;
	gap: 10px;
	min-width: 0;
}

.nku-food-preview-tabs {
	display: flex;
	gap: 4px;
	padding: 3px;
	border-radius: 9px;
	background: var(--vp-c-bg-soft);
}

/* 页签面板：原来 article 与提示语是预览容器的两个弹性子项，靠外层 gap 撑开；
   包一层面板后这个间距得在这层补回来，否则提示语会贴到卡片上 */
.nku-food-preview-panel {
	display: flex;
	flex-direction: column;
	gap: 10px;
	min-width: 0;
}

.nku-food-preview-tab {
	flex: 1;
	padding: 5px 10px;
	border: 0;
	border-radius: 7px;
	background: transparent;
	font-size: 12.5px;
	color: var(--vp-c-text-2);
	transition: background var(--wiki-duration-collapse) var(--wiki-ease-out), color var(--wiki-duration-collapse) var(--wiki-ease-out);
	cursor: pointer;
}

.nku-food-preview-tab.active {
	box-shadow: 0 1px 3px rgb(0 0 0 / 0.08);
	background: var(--vp-c-bg);
	font-weight: 600;
	color: var(--vp-c-text-1);
}

/* 预览卡照卡片墙的形态画，尺寸也按卡片墙的最小卡宽来，
   这样「两行简介、标签换行」这些细节在预览里就能看出来 */
.nku-food-preview-card {
	display: flex;
	flex-direction: column;
	overflow: hidden;
	max-width: 260px;
	border: 1px solid var(--vp-c-divider);
	border-radius: 12px;
	background: var(--vp-c-bg-soft);
}

.nku-food-preview-cover {
	display: block;
	position: relative;
	overflow: hidden;
	aspect-ratio: 4 / 3;
	background: var(--vp-c-bg);
}

.nku-food-preview-cover img {
	display: block;
	width: 100%;
	height: 100%;
	object-fit: cover;
}

.nku-food-preview-cover-fallback {
	display: flex;
	align-items: center;
	justify-content: center;
	opacity: 0.35;
	height: 100%;
	font-size: 40px;
	font-weight: 700;
	color: var(--vp-c-brand-1);
}

.nku-food-preview-campus {
	position: absolute;
	top: 8px;
	left: 8px;
	padding: 1px 8px;
	border-radius: 999px;
	background: rgb(0 0 0 / 0.55);
	backdrop-filter: blur(2px);
	font-size: 11px;
	line-height: 1.6;
	color: #FFF;
}

.nku-food-preview-body {
	display: flex;
	flex-direction: column;
	gap: 6px;
	padding: 10px 12px 12px;
}

.nku-food-preview-name {
	font-size: 15px;
	font-weight: 600;
	line-height: 1.4;
	word-break: break-word;
	color: var(--vp-c-text-1);
}

.nku-food-preview-tags {
	display: flex;
	flex-wrap: wrap;
	gap: 4px;
}

.nku-food-preview-tags span {
	padding: 0 7px;
	border: 1px solid var(--vp-c-divider);
	border-radius: 999px;
	font-size: 11.5px;
	line-height: 1.7;
	color: var(--vp-c-text-2);
}

.nku-food-preview-tags span.place {
	border-color: var(--vp-c-brand-soft);
	background: var(--vp-c-brand-soft);
	color: var(--vp-c-brand-1);
}

.nku-food-preview-tags span.placeholder {
	border-style: dashed;
	color: var(--vp-c-text-3);
}

.nku-food-preview-desc {
	display: -webkit-box;
	overflow: hidden;
	margin: 0;
	font-size: 12.5px;
	-webkit-line-clamp: 2;
	line-height: 1.55;
	color: var(--vp-c-text-2);
	-webkit-box-orient: vertical;
}

.nku-food-preview-foot {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: space-between;
	gap: 6px;
	padding-top: 6px;
	border-top: 1px solid var(--vp-c-divider);
}

.nku-food-preview-score {
	font-size: 13px;
	letter-spacing: 1px;
	color: var(--vp-c-divider);
}

.nku-food-preview-score em {
	font-size: 11.5px;
	font-style: normal;
	letter-spacing: 0;
	color: var(--vp-c-text-3);
}

.nku-food-preview-btn {
	padding: 2px 9px;
	border: 1px solid var(--vp-c-brand-1);
	border-radius: 12px;
	font-size: 12px;
	color: var(--vp-c-brand-1);
}

.nku-food-snippet {
	overflow: auto;
	margin: 0;
	padding: 12px;
	border: 1px solid var(--vp-c-divider);
	border-radius: 10px;
	background: var(--vp-c-bg-soft);
	font-family: var(--vp-font-family-mono);
	font-size: 12px;
	line-height: 1.6;
	white-space: pre;
	color: var(--vp-c-text-1);
	tab-size: 2;
}

.nku-food-snippet.empty {
	font-family: inherit;
	font-size: 13px;
	white-space: normal;
	color: var(--vp-c-text-3);
}

.nku-food-contribute-actions {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
}

.nku-food-contribute-copy,
.nku-food-contribute-issue,
.nku-food-contribute-reset {
	padding: 6px 14px;
	border: 1px solid var(--vp-c-divider);
	border-radius: 8px;
	background: var(--vp-c-bg);
	font-size: 13px;
	text-decoration: none;
	color: var(--vp-c-text-1);
	cursor: pointer;
}

.nku-food-contribute-copy {
	border-color: var(--vp-c-brand-1);
	background: var(--vp-c-brand-soft);
	font-weight: 500;
	color: var(--vp-c-brand-1);
}

.nku-food-contribute-copy:disabled {
	opacity: 0.5;
	cursor: not-allowed;
}

.nku-food-contribute-issue:hover,
.nku-food-contribute-reset:hover {
	border-color: var(--vp-c-brand-1);
	color: var(--vp-c-brand-1);
}

.nku-food-contribute-steps {
	margin: 0;
	padding-left: 18px;
	font-size: 12px;
	line-height: 1.7;
	color: var(--vp-c-text-3);
}

.nku-food-contribute-steps code {
	padding: 1px 4px;
	border-radius: 4px;
	background: var(--vp-c-bg-soft);
	font-size: 11px;
}

.nku-food-contribute-reset {
	align-self: flex-start;
}

@media (max-width: 768px) {
	.nku-food-modal {
		padding: 12px;
	}

	.nku-food-contribute-body {
		grid-template-columns: minmax(0, 1fr);
	}

	.nku-food-field-row {
		grid-template-columns: minmax(0, 1fr);
	}

	.nku-food-preview-card {
		max-width: none;
	}
}
</style>
