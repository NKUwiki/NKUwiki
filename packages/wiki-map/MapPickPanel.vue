<script setup lang="ts">
/**
 * 地图坐标拾取面板 —— 维护地图数据时用的小工具，由 MapView 在 URL 带 `?pick=1`
 * 时渲染（对齐参考站 wiki.ncepuinfo.cc 的 `?pick=1` 拾取模式，并往前多做一步：
 * 它只给坐标，这里连信息一起收，直接产出可以粘进数据文件的完整条目）。
 *
 * 工作流：点击地图拾取坐标 → 填名称/分类 → 复制生成的数据条 → 粘进
 * 站点的 map-data.js 的 BUILDINGS 数组。
 *
 * 数据条的格式刻意与现有条目**逐字符对齐**（2 空格缩进、双引号键值、coord 数组
 * 换行、6 位小数）：现有 BUILDINGS 是从 CQUMAPS 转换来的 JSON 风格，新条目跟着它
 * 走，粘进去后整个文件才是同一种样子。
 *
 * 组件不碰地图本身，坐标由父级通过 coord 传入；只有「切换校区」需要通知父级，
 * 因此走 campusChange 事件。
 */
import { computed, onUnmounted, ref, watch } from 'vue'
import { buildBuildingSnippet, formatCoord, nextBuildingId } from './pick-snippet.js'

/** 地图数据里的一个点位（只用到这里涉及的字段，避免与站点数据结构强耦合） */
interface PickBuilding {
	id?: string
	name?: string
	coord?: number[]
}
interface PickCategory { label?: string }
interface PickCampus { id: string, name?: string }

const props = withDefaults(defineProps<{
	/** 拾取到的坐标 [经度, 纬度]（GCJ-02），未拾取时为 null */
	coord?: number[] | null
	/** 现有全部点位，用于推算下一个可用序号、并提示附近已有点位 */
	buildings?: PickBuilding[]
	/** CATEGORY_CONFIG：{ key: { label, color } } */
	categories?: Record<string, PickCategory>
	/** CAMPUS_CONFIG：{ id: { id, name } } */
	campuses?: Record<string, PickCampus>
	/** 地图当前所在校区，作为校区下拉的初始值 */
	defaultCampus?: string
}>(), {
	coord: null,
	buildings: () => [],
	categories: () => ({}),
	campuses: () => ({}),
	defaultCampus: '',
})

const emit = defineEmits<{ campusChange: [id: string], close: [] }>()

const name = ref('')
const category = ref('')
const campusId = ref(props.defaultCampus || Object.keys(props.campuses)[0] || '')
const idOverride = ref('')
const desc = ref('')
const photosText = ref('')
const article = ref('')
const collapsed = ref(false)
const copied = ref(false)
const copyFailed = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | undefined

const categoryOptions = computed(() =>
	Object.entries(props.categories).map(([key, cfg]) => ({ key, label: cfg?.label || key })),
)

const campusOptions = computed(() =>
	Object.values(props.campuses).map(c => ({ id: c.id, name: c.name || c.id })),
)

/** 与地图校区保持同步（用户在页面顶部切了校区时跟进） */
watch(() => props.defaultCampus, (next) => {
	if (next && next !== campusId.value)
		campusId.value = next
})

/**
 * 下一个可用 ID（`{校区}_{分类}_{两位序号}`），逻辑见 pick-snippet.js。
 * 序号不是取数组长度（删过条目就会撞号），而是扫同前缀的最大编号 +1。
 */
const autoId = computed(() => nextBuildingId(props.buildings, campusId.value, category.value))

const finalId = computed(() => idOverride.value.trim() || autoId.value)

/** 坐标统一保留 6 位小数（与现有数据一致） */
const coordPair = computed(() => formatCoord(props.coord))

const photoList = computed(() =>
	photosText.value.split('\n').map(s => s.trim()).filter(Boolean),
)

/**
 * 拾取点附近已有点位：密集区域容易重复标注，
 * 用经纬度差换算出的米数提示（1e-5 度 ≈ 1.1m 纬度 / ~0.85m 经度，够用）。
 * 写成 for 循环而非链式 map/filter：链式在中途返回 null 时，
 * 后续 sort 的参数类型收窄不出来。
 */
const nearby = computed<{ name: string, dist: number }[]>(() => {
	const base = props.coord
	if (!base)
		return []
	const lng = Number(base[0])
	const lat = Number(base[1])
	if (!Number.isFinite(lng) || !Number.isFinite(lat))
		return []
	const out: { name: string, dist: number }[] = []
	for (const b of props.buildings) {
		const c = b?.coord
		if (!Array.isArray(c) || c.length !== 2)
			continue
		const bx = Number(c[0])
		const by = Number(c[1])
		if (!Number.isFinite(bx) || !Number.isFinite(by))
			continue
		const dist = Math.hypot((bx - lng) * 85000, (by - lat) * 111000)
		if (dist < 25)
			out.push({ name: b.name || b.id || '未命名点位', dist })
	}
	return out.sort((a, b) => a.dist - b.dist).slice(0, 4)
})

const missing = computed(() => {
	const list = []
	if (!coordPair.value)
		list.push('坐标')
	if (!name.value.trim())
		list.push('名称')
	if (!category.value)
		list.push('分类')
	if (!campusId.value)
		list.push('校区')
	return list
})

/** 生成可直接粘贴的完整数据条（格式细节见 pick-snippet.js，那里可被测试直接调用） */
const snippet = computed(() => buildBuildingSnippet({
	id: finalId.value,
	name: name.value.trim(),
	category: category.value,
	campusId: campusId.value,
	coord: props.coord,
	desc: desc.value,
	photos: photoList.value,
	article: article.value,
}))

async function copySnippet() {
	if (!snippet.value)
		return
	try {
		await navigator.clipboard.writeText(snippet.value)
		copied.value = true
		copyFailed.value = false
		clearTimeout(copiedTimer)
		copiedTimer = setTimeout(() => {
			copied.value = false
		}, 1600)
	}
	catch {
		// 非 https 或权限被拒时 clipboard 会抛错：退回让用户手动选中
		copyFailed.value = true
	}
}

function reset() {
	name.value = ''
	category.value = ''
	idOverride.value = ''
	desc.value = ''
	photosText.value = ''
	article.value = ''
	copied.value = false
	copyFailed.value = false
}

function onCampusChange() {
	emit('campusChange', campusId.value)
}

onUnmounted(() => {
	clearTimeout(copiedTimer)
})
</script>

<template>
<div class="map-pick-panel" :class="{ 'is-collapsed': collapsed }">
	<header class="pick-head">
		<span class="pick-title">坐标拾取</span>
		<button class="pick-toggle" type="button" :aria-expanded="!collapsed" @click="collapsed = !collapsed">
			{{ collapsed ? '展开' : '收起' }}
		</button>
		<button class="pick-close" type="button" aria-label="退出坐标拾取" title="退出坐标拾取（Shift+P）" @click="emit('close')">
			<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
		</button>
	</header>

	<div v-if="!collapsed" class="pick-body">
		<p class="pick-hint">
			点击地图拾取坐标（GCJ-02），拖动标记可微调。按 <kbd>Shift</kbd>+<kbd>P</kbd> 可随时开关此面板。
		</p>

		<div class="pick-coord" :class="{ empty: !coordPair }">
			<template v-if="coordPair">
				<span><b>经度</b> {{ coordPair[0] }}</span>
				<span><b>纬度</b> {{ coordPair[1] }}</span>
			</template>
			<span v-else>尚未拾取坐标</span>
		</div>

		<p v-if="nearby.length" class="pick-nearby">
			附近已有：<span v-for="(n, i) in nearby" :key="n.name">{{ n.name }}（{{ Math.round(n.dist) }}m）<template v-if="i < nearby.length - 1">、</template></span>
		</p>

		<label class="pick-field">
			<span>名称 <i>*</i></span>
			<input v-model="name" type="text" placeholder="如图书馆、第二主教学楼">
		</label>

		<label class="pick-field">
			<span>分类 <i>*</i></span>
			<select v-model="category">
				<option value="">
					请选择
				</option>
				<option v-for="c in categoryOptions" :key="c.key" :value="c.key">
					{{ c.label }}（{{ c.key }}）
				</option>
			</select>
		</label>

		<label class="pick-field">
			<span>校区 <i>*</i></span>
			<select v-model="campusId" @change="onCampusChange">
				<option v-for="c in campusOptions" :key="c.id" :value="c.id">
					{{ c.name }}
				</option>
			</select>
		</label>

		<label class="pick-field">
			<span>ID</span>
			<input v-model="idOverride" type="text" :placeholder="autoId || '先选分类与校区'">
		</label>

		<label class="pick-field">
			<span>描述</span>
			<textarea v-model="desc" rows="2" placeholder="一句话说明这个点位" />
		</label>

		<label class="pick-field">
			<span>图片路径<em>每行一个</em></span>
			<textarea v-model="photosText" rows="2" placeholder="/map/pic/xxx.png" />
		</label>

		<label class="pick-field">
			<span>关联文章</span>
			<input v-model="article" type="text" placeholder="/pages/xxx/#锚点">
		</label>

		<div v-if="missing.length" class="pick-missing">
			还差：{{ missing.join('、') }}
		</div>

		<pre v-if="snippet" class="pick-snippet">{{ snippet }}</pre>
		<p v-else class="pick-snippet pick-snippet--empty">
			填齐上面的必填项后，这里会生成可直接粘贴的数据条。
		</p>

		<div class="pick-actions">
			<button class="pick-btn primary" type="button" :disabled="!snippet" @click="copySnippet">
				{{ copied ? '已复制' : '复制数据条' }}
			</button>
			<button class="pick-btn" type="button" @click="reset">
				清空
			</button>
		</div>
		<p v-if="copyFailed" class="pick-warn">
			浏览器拒绝了剪贴板访问，请手动选中上面的文本复制。
		</p>
		<p class="pick-foot">
			粘贴位置：<code>docs/.vitepress/data/map-data.js</code> 的 <code>BUILDINGS</code> 数组内。
			加在中间直接粘；加在数组最末（<code>]</code> 之前）要把最后一行的逗号去掉。
		</p>
	</div>
</div>
</template>

<style scoped>
.map-pick-panel {
	display: flex;
	flex-direction: column;
	position: absolute;
	overflow: hidden;
	top: 12px;
	right: 12px;
	width: 320px;
	max-height: calc(100% - 24px);
	border: 1px solid var(--vp-c-divider);
	border-radius: 12px;
	box-shadow: 0 4px 20px rgb(15 23 42 / 0.16);
	background: var(--vp-c-bg);
	z-index: 30;
}

.map-pick-panel.is-collapsed {
	width: auto;
}

.pick-head {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 9px 12px;
	border-bottom: 1px solid var(--vp-c-divider);
	background: var(--vp-c-bg-soft);
}

.pick-title {
	flex: 1;
	font-size: 13px;
	font-weight: 600;
	color: var(--vp-c-text-1);
}

.pick-toggle {
	padding: 2px 8px;
	border: 1px solid var(--vp-c-divider);
	border-radius: 6px;
	background: var(--vp-c-bg);
	font-size: 12px;
	color: var(--vp-c-text-2);
	cursor: pointer;
}

.pick-toggle:hover {
	border-color: var(--vp-c-brand-1);
	color: var(--vp-c-brand-1);
}

.pick-close {
	display: flex;
	align-items: center;
	justify-content: center;
	padding: 3px;
	border: 1px solid transparent;
	border-radius: 6px;
	background: none;
	line-height: 0;
	color: var(--vp-c-text-2);
	cursor: pointer;
}

.pick-close:hover {
	border-color: var(--vp-c-divider);
	color: var(--vp-c-danger-1);
}

.pick-hint kbd {
	padding: 1px 4px;
	border: 1px solid var(--vp-c-divider);
	border-radius: 4px;
	background: var(--vp-c-bg);
	font-family: inherit;
	font-size: 11px;
}

.pick-body {
	display: flex;
	flex-direction: column;
	gap: 9px;
	overflow-y: auto;
	padding: 12px;
}

.pick-hint {
	margin: 0;
	font-size: 12px;
	line-height: 1.6;
	color: var(--vp-c-text-2);
}

.pick-coord {
	display: flex;
	flex-wrap: wrap;
	gap: 4px 12px;
	padding: 7px 9px;
	border-radius: 8px;
	background: var(--vp-c-bg-soft);
	font-family: var(--vp-font-family-mono);
	font-size: 12px;
	color: var(--vp-c-text-1);
}

.pick-coord.empty {
	color: var(--vp-c-text-3);
}

.pick-coord b {
	margin-right: 4px;
	font-weight: 500;
	color: var(--vp-c-text-2);
}

.pick-nearby {
	margin: 0;
	padding: 6px 9px;
	border-radius: 8px;
	background: var(--vp-c-warning-soft);
	font-size: 12px;
	line-height: 1.6;
	color: var(--vp-c-text-1);
}

.pick-field {
	display: flex;
	flex-direction: column;
	gap: 4px;
}

.pick-field > span {
	font-size: 12px;
	color: var(--vp-c-text-2);
}

.pick-field > span i {
	font-style: normal;
	color: var(--vp-c-danger-1);
}

.pick-field > span em {
	margin-left: 6px;
	font-size: 11px;
	font-style: normal;
	color: var(--vp-c-text-3);
}

.pick-field input,
.pick-field select,
.pick-field textarea {
	width: 100%;
	padding: 6px 8px;
	border: 1px solid var(--vp-c-divider);
	border-radius: 7px;
	background: var(--vp-c-bg);
	font-family: inherit;
	font-size: 13px;
	color: var(--vp-c-text-1);
}

.pick-field textarea {
	line-height: 1.5;
	resize: vertical;
}

.pick-field input:focus,
.pick-field select:focus,
.pick-field textarea:focus {
	border-color: var(--vp-c-brand-1);
	outline: none;
}

.pick-missing {
	font-size: 12px;
	color: var(--vp-c-warning-1, var(--vp-c-text-2));
}

.pick-snippet {
	overflow: auto;
	max-height: 220px;
	margin: 0;
	padding: 9px 10px;
	border-radius: 8px;
	background: var(--vp-c-bg-alt, var(--vp-c-bg-soft));
	font-family: var(--vp-font-family-mono);
	font-size: 11.5px;
	line-height: 1.55;
	/* 长描述/长路径一律折行：横向滚动看不全，而这个框的价值就在于一眼确认内容 */
	white-space: pre-wrap;
	word-break: break-word;
	color: var(--vp-c-text-1);
}

.pick-snippet--empty {
	white-space: normal;
	color: var(--vp-c-text-3);
}

.pick-actions {
	display: flex;
	gap: 8px;
}

.pick-btn {
	flex: 1;
	padding: 7px 10px;
	border: 1px solid var(--vp-c-divider);
	border-radius: 8px;
	background: var(--vp-c-bg);
	font-size: 13px;
	color: var(--vp-c-text-1);
	cursor: pointer;
}

.pick-btn.primary {
	border-color: transparent;
	background: var(--vp-c-brand-1);
	color: #FFF;
}

.pick-btn.primary:disabled {
	opacity: 0.5;
	cursor: not-allowed;
}

.pick-warn {
	margin: 0;
	font-size: 12px;
	color: var(--vp-c-danger-1);
}

.pick-foot {
	margin: 0;
	font-size: 11.5px;
	line-height: 1.6;
	color: var(--vp-c-text-3);
}

.pick-foot code {
	font-size: 11px;
}

@media (max-width: 48rem) {
	.map-pick-panel {
		right: 12px;
		left: 12px;
		width: auto;
		max-height: 60%;
	}
}
</style>
