<script setup>
/**
 * 校园地图（NKU Maps）：组件与样式完全取自 QUT-WiKi 的 MapView（青岛理工大学 Wiki），
 * 相对上游的适配：导航外链来源参数改为 NKUwiki；校区轮廓数据的键换为南开校区；
 * 移除步行路径规划（AMap.Walking，站点用不到，且插件会额外消耗路径规划服务配额）；
 * 定位走浏览器原生 Geolocation，WGS84 → GCJ02 用本地公式转换（不再调高德
 * 坐标转换接口 AMap.convertFrom，也不加载实际未使用的 AMap.Geolocation 插件）。
 *
 * 点位与密钥数据不随主题包分发：由站点侧通过 data prop 注入
 * （NKUwiki 的数据在 docs/.vitepress/data/map-data.js），
 * 字段格式与必备导出见同目录 map-data.example.js。
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import MapPickPanel from './MapPickPanel.vue'
import { createChipsScroll } from './chips-scroll.js'
import { clampTipCenterX } from './hover-tip.js'
import { createBuildingSearch } from './search.js'
import { campusAnchor, normalizeZoom, tierForZoom, tierOf } from './lod.js'

const props = defineProps({
	/** 地图数据对象，导出字段与 map-data.example.js 一致 */
	data: { type: Object, required: true },
})

/* lod-change：档位（或标点数量）变了才抛，供站点侧做调试面板 / 提示条；
   zoom-change：每一帧缩放都抛（0.1 精度去重），只想看数值的地方用它 ——
   lod-change 只在跨档时来一次，拿它显示 zoom 会一直卡在跨档那一刻的值。
   组件自身都不消费这两个事件，缺了也不影响渲染 */
const emit = defineEmits(['lod-change', 'zoom-change'])

/* 与数据文件的导出同名解构：正文代码与「数据内联在包里」的旧版完全一致 */
const {
	BUILDINGS,
	CAMPUS_CONFIG,
	CATEGORY_CONFIG,
	CATEGORY_ICON_PATHS,
	FILTER_LIST,
	AMAP_KEY,
	AMAP_SECURITY_JS_CODE,
	MAP_DISPLAY,
} = props.data

/* 校区边界：{ 校区 key: [环, 环...] }，环是 [[经度, 纬度], ...]（GCJ02）。
   数据放在站点侧（NKUwiki 是 campus-boundary.js，由 OSM 生成），
   组件只负责画。缺失时退化为「不画边界」，不影响其余功能。 */
const POLYGONS = props.data.POLYGONS || {}

const PIN_SIZE = 28
const PIN_SCALE = { idle: 1, hover: 1.3, selected: 1.4 }
/* 档位 1（远景）不画分类标点，只画一个代表整个校区的标点：它比分类标点
   大一圈，字号也提一档。尺寸写在这里而不是 CSS，是因为 AMap.Marker 的
   offset 要按它算锚点（见 createMarkerPin 的注释） */
const CAMPUS_PIN_SIZE = 44
/* 高德官方内置样式：normal 标准 / dark 夜间 */
const MAP_STYLES = { light: 'amap://styles/normal', dark: 'amap://styles/dark' }

/* 小屏断点，与样式里的 @media (max-width: 1024px) 保持一致。
   小屏下左侧卡片不再做成抽屉，而是同一张卡片直接浮在地图左上角，
   于是「默认收起」这件事必须在脚本里按断点决定 */
const MOBILE_QUERY = '(max-width: 1024px)'

function isMobileViewport() {
	/* SSR（构建期渲染 HTML）里没有 window，一律按桌面处理；
	   客户端挂载后再按真实断点纠正（见 onMounted） */
	return typeof window !== 'undefined' && window.matchMedia(MOBILE_QUERY).matches
}

/** 窗口跨 1024px 断点（缩放 / 平板旋转）：小屏收起、桌面展开 */
function onMobileQueryChange(event) {
	sidebarCollapsed.value = event.matches
}

/* ================= 标点配色 =================
 * 每个分类一个颜色（站点侧 CATEGORY_CONFIG[category].color），标点、列表图标、
 * 详情卡图标共用同一套色，保证「看到什么颜色就是什么分类」。
 * 未命中的分类回落到中性灰，不至于画出一个刺眼的默认色。 */
const FALLBACK_PIN_COLOR = '#64748B'
/* 选中态：同一色相压暗一档靠 scale + 描边强调，避免换色后认不出是哪个分类 */
const SELECTED_MIX_RATIO = 0.28

function categoryColor(category) {
	return (CATEGORY_CONFIG[category] || {}).color || FALLBACK_PIN_COLOR
}

/* 详情卡上的两个「归属」标签：校区名与分类名。
   都从各自配置里取显示名（与标点、列表、筛选药丸同一份数据源），
   未命中时分别回落「其他」与空串（校区声明缺失就整枚标签不渲染）。 */
function categoryLabel(category) {
	return (CATEGORY_CONFIG[category] || {}).label || '其他'
}

function campusLabel(campusId) {
	return CAMPUS_CONFIG[campusId]?.name || ''
}

/** 把 #RRGGBB 按比例压向黑色（amount 0~1），用于选中态加深 */
function shade(hex, amount) {
	const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim())
	if (!m)
		return hex
	const num = Number.parseInt(m[1], 16)
	const mix = v => Math.round(v * (1 - amount))
	return `rgb(${mix((num >> 16) & 255)}, ${mix((num >> 8) & 255)}, ${mix(num & 255)})`
}

/* ================= 状态 ================= */
const mapEl = ref(null)
/* 衬底层容器：同一块区域上的第二个地图实例 */
const poiMapEl = ref(null)
/* 衬底的跟随层（高德容器的父节点）。交互期间这里会被写 transform，
   把整层贴到主地图的视野上——见「校外 POI 衬底的跟随」一节 */
const poiLayerEl = ref(null)
let map = null
/* 校外 POI 衬底（高德自己的 POI 点）。它是「同一套底图 + 多一个 point 要素」，
   铺在主地图下面，主地图再用 setMask 把校区外遮成透明，POI 就从这层透出来。
   实测 setMask 遮掉的区域是透明的（不是白色），这招才成立。 */
let poiMap = null
let AMap = null
const mapReady = ref(false)
const mapError = ref('')

const currentCampus = ref('n')
const currentCategory = ref('all')
/* 当前生效的缩放档位。初值取中间档：各校区 CAMPUS_CONFIG 的默认 zoom
   代进 tierForZoom 恒等于 2，与 initMap 后的实际渲染一致，不会闪一下 */
const currentTier = ref(2)
const searchKeyword = ref('')
/** 左侧卡片收起成小卡片：只留校区 / 搜索 / 分类三行，隐藏点位列表。
 *  初始值固定为 false（SSR 产物与首帧一致，避免水合不匹配），
 *  小屏在 onMounted 里直接置为收起 */
const sidebarCollapsed = ref(false)

/* ---- 坐标拾取模式（URL 带 ?pick=1 时启用，供维护地图数据用；见 MapPickPanel） ---- */
const pickMode = ref(false)
/** 拾取到的坐标 [经度, 纬度]，GCJ-02 */
const pickedCoord = ref(null)
/** 拾取点标记：可拖动微调，拖动结束回写坐标 */
let pickMarker = null
const selected = ref(null)
const hoverTip = ref(null)
const locationDialogOpen = ref(false)
const locationDialogBackdrop = ref(null)
const locating = ref(false)
const locationError = ref('')
const locationReady = ref(false)
const detailCardEl = ref(null)
const detailCardHeight = ref(0)
const photoViewer = ref(false)
const photoViewerIndex = ref(0)
/* 两个模态面板的根元素：焦点陷阱与「关闭后归还焦点」都要用（见下面的模态焦点管理） */
const viewerEl = ref(null)
const locationDialogEl = ref(null)

const markerCache = new Map()
/* 档位 1 的校区标点：「八里台校区 / 津南校区」，代表整个校区范围。
 * 两个校区各一个（两校区同时在图上，低缩放时能一起看到），按 campusId 存。
 * 单独立一个 Map 而不是塞进 markerCache：它们不是数据里的点位，没有 id、
 * 不参与筛选与搜索，也不该被「选中某个点位」那套逻辑改状态。 */
let campusPinCache = new Map()
let polygonsRef = null
/* 遮罩用的原始路径：换校区时由 renderPolygons 一并更新（遮罩只认 paths，
   不认 Polygon 对象，见 MASK_OUTSIDE 的注释） */
let lastBoundaryPaths = []
let locationMarker = null
let locationWatchId = null
let searchTimer = null
let hoverCloseTimer = null
let destroyFlag = false
let visualViewport = null
let detailResizeObserver = null
/** 移动端断点监听：挂载时定一次初值，之后跟随窗口跨断点变化（旋屏 / 缩放） */
let mobileQuery = null

/* ================= 派生数据 ================= */
/* 点位搜索引擎：覆盖全部 BUILDINGS，一次构建；校区/分类过滤在其结果上继续 */
const buildingSearch = createBuildingSearch(BUILDINGS)

/** 左侧列表的数据源：只罗列当前校区（切校区 = 换一份列表） */
const campusBuildings = computed(() =>
	BUILDINGS.filter(b => b.campusId === currentCampus.value),
)

const filteredBuildings = computed(() => {
	const kw = searchKeyword.value.trim().toLowerCase()
	const matched = kw ? buildingSearch(kw) : null
	return campusBuildings.value.filter((b) => {
		if (currentCategory.value !== 'all' && b.category !== currentCategory.value)
			return false
		if (matched && !matched.has(b.id))
			return false
		return true
	})
})

/**
 * 地图标点的数据源：两个校区同时显示，所以**不按校区筛**。
 *
 * 只有「列表」是按校区切的 —— 切校区不改变图上有什么，只改变看哪儿、
 * 以及左边那份清单。搜索与分类仍然作用于地图：不然搜出来只剩列表一条、
 * 图上还杵着 97 个，两边对不上。
 */
const searchedBuildings = computed(() => {
	const kw = searchKeyword.value.trim().toLowerCase()
	const matched = kw ? buildingSearch(kw) : null
	return BUILDINGS.filter((b) => {
		if (currentCategory.value !== 'all' && b.category !== currentCategory.value)
			return false
		if (matched && !matched.has(b.id))
			return false
		return true
	})
})

/* 筛选 + 缩放分级后仍保留选中的建筑 */
const markerBuildings = computed(() => {
	/* 分级只作用于地图标点，左侧列表始终是全集：
	   否则「搜到一个点、列表里看得到、地图上却没有」，用户会当成 bug */
	const list = searchedBuildings.value.filter(b => tierOf(b) <= currentTier.value)
	if (!selected.value || list.some(b => b.id === selected.value.id))
		return list
	return [...list, selected.value]
})

const campusName = computed(() => CAMPUS_CONFIG[currentCampus.value]?.name || '')
/** 搜索框占位文案带上当前校区：卡片里同时放着校区切换，写清搜的是哪儿 */
const searchPlaceholder = computed(() => campusName.value ? `搜索${campusName.value}的地点` : '搜索地点')
const selectedPhotos = computed(() => buildingPhotos(selected.value))
const currentViewerPhoto = computed(() => selectedPhotos.value[photoViewerIndex.value] || '')
const isDark = () => document.documentElement.classList.contains('dark')

function buildingPhotos(building) {
	if (!building)
		return []
	const photos = Array.isArray(building.photos) ? building.photos.filter(Boolean) : []
	return photos.length ? photos : (building.photo ? [building.photo] : [])
}

function openPhotoViewer(index = 0) {
	if (!selectedPhotos.value.length)
		return
	photoViewerIndex.value = index
	photoViewer.value = true
}

function closePhotoViewer() {
	photoViewer.value = false
}

function changeViewerPhoto(step) {
	const count = selectedPhotos.value.length
	if (count < 2)
		return
	photoViewerIndex.value = (photoViewerIndex.value + step + count) % count
}

/** 焦点在可编辑控件里时，Esc 与单键快捷键都归控件自己：那是「取消输入」的语义 */
function isEditingTarget(target) {
	return target instanceof HTMLElement
		&& (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')
}

/* ================= 模态面板的焦点管理 =================
 * 图片查看器与定位说明都写着 role="dialog" aria-modal="true"，但此前只有视觉
 * 上的「模态」：焦点仍能 Tab 到背后的侧栏与导航条，读屏用户听到的也还是整页。
 * 这里补三件事：打开时把焦点移进面板、面板内 Tab 循环、关闭时把焦点还回去。
 *
 * 不用 <dialog>.showModal()：它会新建一层 top-layer 并改变布局与层叠上下文，
 * 而这两个面板的定位、Teleport 与 Transition 都是按普通元素写的，换过去等于
 * 把样式重做一遍，收益只有焦点管理这一项 —— 自己写反而更容易控制。
 */
const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
/** 打开面板前的焦点落点，关闭时归还（可能是列表项，也可能已因换校区被卸载） */
let focusBeforeDialog = null

/** 当前打开的面板：查看器盖在定位说明之上，先认它 */
function activeDialogEl() {
	if (photoViewer.value && currentViewerPhoto.value)
		return viewerEl.value
	if (locationDialogOpen.value)
		return locationDialogEl.value
	return null
}

/**
 * 面板内可聚焦的元素。
 * 不能按 offsetParent 判可见：查看器是 position: fixed，其子元素的 offsetParent
 * 恒为 null，那样会把所有按钮都当成隐藏的。getClientRects 只看行盒，才准。
 */
function focusableIn(el) {
	return [...el.querySelectorAll(FOCUSABLE_SELECTOR)]
		.filter(node => node.getClientRects().length > 0)
}

function openDialogFocus(el) {
	if (!el)
		return
	focusBeforeDialog = document.activeElement instanceof HTMLElement ? document.activeElement : null
	/* 面板自身 tabindex="-1"：焦点落在容器上，读屏会先念 aria-label / 标题，
	   比直接跳到「关闭」按钮更完整 */
	el.focus({ preventScroll: true })
}

function restoreDialogFocus() {
	const target = focusBeforeDialog
	focusBeforeDialog = null
	if (!target)
		return
	/* 检查放到 DOM 更新之后：关闭面板的那一刻，打开它的元素可能正被卸载
	   （例如切校区连着清掉选中），此时把焦点还过去只会落到 body 上 */
	nextTick(() => {
		if (target.isConnected)
			target.focus({ preventScroll: true })
	})
}

/** Tab / Shift+Tab 在面板内首尾相接；返回 true 表示已接管 */
function trapDialogTab(event) {
	const el = activeDialogEl()
	if (!el)
		return false
	const items = focusableIn(el)
	if (!items.length) {
		event.preventDefault()
		el.focus({ preventScroll: true })
		return true
	}
	const first = items[0]
	const last = items[items.length - 1]
	const current = document.activeElement
	if (current === el) {
		event.preventDefault()
		const next = event.shiftKey ? last : first
		next.focus({ preventScroll: true })
		return true
	}
	if (!el.contains(current)) {
		event.preventDefault()
		first.focus({ preventScroll: true })
		return true
	}
	if (event.shiftKey && current === first) {
		event.preventDefault()
		last.focus({ preventScroll: true })
		return true
	}
	if (!event.shiftKey && current === last) {
		event.preventDefault()
		first.focus({ preventScroll: true })
		return true
	}
	return false
}

/* 进出场各管一次焦点。两个面板不会同时开（定位说明铺满整屏），
   所以共用一份 focusBeforeDialog 是安全的。
   两个面板都是 v-if 渲染，watch 回调里 ref 还是 null —— 必须等一个 tick
   再取，否则焦点永远移不进去（这是这套逻辑最容易写错的地方） */
watch(photoViewer, (open) => {
	if (open)
		nextTick(() => openDialogFocus(viewerEl.value))
	else
		restoreDialogFocus()
})

watch(locationDialogOpen, (open) => {
	if (open)
		nextTick(() => openDialogFocus(locationDialogEl.value))
	else
		restoreDialogFocus()
})

/**
 * 全局键盘：按「一层一层退」的顺序处理，最上面那层先吃事件。
 *
 * 1. 全屏图片查看器：Esc 关，方向键翻
 * 2. 定位权限弹窗（`aria-modal` 的模态框）：Esc 等价于「暂不定位」
 * 3. 详情卡：Esc 关闭
 *
 * 之前只处理了查看器那一层，结果是「图能 Esc 关、卡片和弹窗不能」——三个
 * 同源的关闭动作有三种行为。卡片与弹窗这层都要判可编辑目标：搜索框里按
 * Esc 是取消输入，顺手把卡片关掉会像「打字把面板打没了」。
 */
function onGlobalKeydown(event) {
	/* Tab 先交给焦点陷阱：面板开着时「焦点出不去」是整块屏幕的约束，
	   比下面那几层「由内向外退」更靠前 */
	if (event.key === 'Tab' && trapDialogTab(event))
		return
	if (photoViewer.value) {
		if (event.key === 'Escape')
			closePhotoViewer()
		else if (event.key === 'ArrowLeft')
			changeViewerPhoto(-1)
		else if (event.key === 'ArrowRight')
			changeViewerPhoto(1)
		else return
		event.preventDefault()
		return
	}
	if (event.key !== 'Escape')
		return
	if (locationDialogOpen.value) {
		cancelLocationRequest()
		event.preventDefault()
		return
	}
	if (!selected.value || isEditingTarget(event.target))
		return
	clearSelection()
	event.preventDefault()
}

/* ================= 校区边界多边形（GCJ02，可选）
 * 数据从 data.POLYGONS 注入（见上方解构处的说明）。
 * 暂无数据时留空，不影响地图使用。
 * ================= */
/* 边界配色取站点主色（南开紫），与分类色区分开：它不是「一个地点」，是范围。
   两套皮肤各配一版——深色底上 27% 明度的紫几乎看不见，得换成提亮档；
   描边衬底同理（浅色底用白衬底，深色底用黑衬底），否则白线在夜间图里
   会反过来盖住紫线，看起来像一条白色虚线。 */
function boundaryStyles() {
	const dark = isDark()
	return {
		line: {
			fillColor: dark ? '#D8A8C8' : '#711A5F',
			fillOpacity: dark ? 0.06 : 0.07,
			strokeColor: dark ? '#E9C7DE' : '#711A5F',
			strokeOpacity: 0.9,
			strokeStyle: 'dashed',
			strokeWeight: 2,
		},
		/* 描边衬底（casing）：底图上有深色水系、也有浅色楼块，单画一条虚线
		   在暗底或彩色底上都会糊掉。铺一条更粗的实线垫在下面，等于给线加
		   一圈对比底；衬底不填色（fillOpacity 0），否则校内那层淡紫会被
		   叠成两倍。 */
		halo: {
			fillColor: dark ? '#000000' : '#FFFFFF',
			fillOpacity: 0,
			strokeColor: dark ? '#000000' : '#FFFFFF',
			strokeOpacity: dark ? 0.45 : 0.75,
			strokeWeight: 5,
			strokeStyle: 'solid',
		},
	}
}

/* 非当前校区的边界：要让「另一个校区也在图上」，但不能抢主角。
   只画一条细虚线，不填色、不铺衬底 —— 那圈白/黑衬底是给遮罩洞沿遮丑用的，
   另一个校区不在洞沿上，铺了只会变成两条并行线。 */
function boundaryStylesDim() {
	const dark = isDark()
	return {
		fillOpacity: 0,
		strokeColor: dark ? '#E9C7DE' : '#711A5F',
		strokeOpacity: dark ? 0.4 : 0.3,
		strokeStyle: 'dashed',
		strokeWeight: 1.5,
	}
}

/* 校区外遮成透明（给「校外显示高德 POI、校内保持现状」这件事打底）。
 *
 * 为什么是透明而不是压暗：主地图（这一层）用 setMask 把校区以外挖掉、露出
 * 垫在下面的 poiMap（同一套底图，只是多了高德的 point 要素）。所以校外的
 * 高德 POI 是**原生渲染**的，不是我们拿接口一条条画的。实测两点：
 *   - 必须传原始路径数组（map.setMask(paths)）。传 AMap.Polygon 对象数组时，
 *     整张图连校内一起被盖住，洞没挖出来；
 *   - 遮掉的区域是**透明**的（容器背景能透出来），不是白色。早先以为它盖白，
 *     是因为当时的容器底色本来就是白的。
 * 边界用粗虚线 + 衬底压在洞沿上，正好把两层的接缝盖住。 */
const MASK_OUTSIDE = true

/* ================= 缩放分级（LOD） =================
 * 97 个点位全量常显，在默认缩放（八里台 17 / 津南 16）下密集处会糊成一片，
 * 也盖住了校区轮廓。按缩放分三档：
 *   1 远景：地标 / 校门 / 图书馆 —— 回答「这个校区有什么」
 *   2 默认：再加食堂、行政、教学、交通 —— 回答「日常去哪」
 *   3 近景：全部，含学院楼、宿舍、运动场
 * 规则本身（分类映射、阈值换算）放在 ./lod.js：它是纯函数，能被 Node
 * 直接验算，也能单测；组件这边只留「读状态、重渲染」。
 */

/* ================= 高德地图加载 ================= */
function loadAMap() {
	return new Promise((resolve, reject) => {
		if (window.AMap)
			return resolve(window.AMap)
		/* 2021 年后申请的 key 需要安全密钥，必须在 SDK 脚本加载前设置 */
		window._AMapSecurityConfig = {
			securityJsCode: AMAP_SECURITY_JS_CODE,
		}
		window.__NKUMapReady = () => {
			if (window.AMap)
				resolve(window.AMap)
			else reject(new Error('高德地图 SDK 已响应，但没有提供地图对象'))
		}
		const script = document.createElement('script')
		script.async = true
		script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(AMAP_KEY)}&callback=__NKUMapReady`
		script.onerror = () => reject(new Error('高德地图 SDK 加载失败'))
		document.head.appendChild(script)
		setTimeout(() => reject(new Error('高德地图 SDK 加载超时')), 15000)
	})
}

/* ================= 坐标转换（本地计算：外链导航 + 浏览器定位上图） ================= */
const X_PI = (Math.PI * 3000) / 180
const AXIS = 6378245
const ECCENTRICITY = 0.006693421622965943

function gcj02ToBd09([lng, lat]) {
	const z = Math.sqrt(lng * lng + lat * lat) + 0.00002 * Math.sin(lat * X_PI)
	const theta = Math.atan2(lat, lng) + 0.000003 * Math.cos(lng * X_PI)
	return [z * Math.cos(theta) + 0.0065, z * Math.sin(theta) + 0.006]
}

function transformLat(lng, lat) {
	let v = -100 + 2 * lng + 3 * lat + 0.2 * lat * lat + 0.1 * lng * lat + 0.2 * Math.sqrt(Math.abs(lng))
	v += ((20 * Math.sin(6 * lng * Math.PI) + 20 * Math.sin(2 * lng * Math.PI)) * 2) / 3
	v += ((20 * Math.sin(lat * Math.PI) + 40 * Math.sin((lat / 3) * Math.PI)) * 2) / 3
	v += ((160 * Math.sin((lat / 12) * Math.PI) + 320 * Math.sin((lat * Math.PI) / 30)) * 2) / 3
	return v
}

function transformLng(lng, lat) {
	let v = 300 + lng + 2 * lat + 0.1 * lng * lng + 0.1 * lng * lat + 0.1 * Math.sqrt(Math.abs(lng))
	v += ((20 * Math.sin(6 * lng * Math.PI) + 20 * Math.sin(2 * lng * Math.PI)) * 2) / 3
	v += ((20 * Math.sin(lng * Math.PI) + 40 * Math.sin((lng / 3) * Math.PI)) * 2) / 3
	v += ((150 * Math.sin((lng / 12) * Math.PI) + 300 * Math.sin((lng / 30) * Math.PI)) * 2) / 3
	return v
}

function gcj02ToWgs84([lng, lat]) {
	const dLat = transformLat(lng - 105, lat - 35)
	const dLng = transformLng(lng - 105, lat - 35)
	const rad = (lat / 180) * Math.PI
	const magic = 1 - ECCENTRICITY * Math.sin(rad) ** 2
	const sqrtMagic = Math.sqrt(magic)
	const aLat = (dLat * 180) / (((AXIS * (1 - ECCENTRICITY)) / (magic * sqrtMagic)) * Math.PI)
	const aLng = (dLng * 180) / ((AXIS / sqrtMagic) * Math.cos(rad) * Math.PI)
	return [lng * 2 - (lng + aLng), lat * 2 - (lat + aLat)]
}

/** WGS84 → GCJ02：gcj02ToWgs84 的正向变换（浏览器定位上图用，本地公式转换省去高德坐标转换接口配额）。 */
function wgs84ToGcj02([lng, lat]) {
	const dLat = transformLat(lng - 105, lat - 35)
	const dLng = transformLng(lng - 105, lat - 35)
	const rad = (lat / 180) * Math.PI
	const magic = 1 - ECCENTRICITY * Math.sin(rad) ** 2
	const sqrtMagic = Math.sqrt(magic)
	const aLat = (dLat * 180) / (((AXIS * (1 - ECCENTRICITY)) / (magic * sqrtMagic)) * Math.PI)
	const aLng = (dLng * 180) / ((AXIS / sqrtMagic) * Math.cos(rad) * Math.PI)
	return [lng + aLng, lat + aLat]
}

/* ================= Lucide 分类图标（marker / 列表 / 详情卡用） ================= */
function categoryIconMarkup(category, size = 14) {
	const paths = CATEGORY_ICON_PATHS[category] || ''
	return (
		`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`
	)
}

/* ================= 导航链接（5 平台） ================= */
function navigationLinksFor(b) {
	const [lng, lat] = b.coord
	const [bdLng, bdLat] = gcj02ToBd09(b.coord)
	const [wgsLng, wgsLat] = gcj02ToWgs84(b.coord)
	const name = encodeURIComponent(b.name)
	return [
		{ id: 'amap', label: '高德', href: `https://uri.amap.com/marker?position=${lng},${lat}&name=${name}&src=NKUwiki&coordinate=gaode&callnative=1` },
		{ id: 'baidu', label: '百度', href: `https://api.map.baidu.com/marker?location=${bdLat},${bdLng}&title=${name}&content=${name}&output=html&src=webapp.NKUwiki` },
		{ id: 'tencent', label: '腾讯', href: `https://apis.map.qq.com/uri/v1/marker?marker=coord:${lat},${lng};title:${name};addr:${name}&referer=NKUwiki` },
		{ id: 'apple', label: 'Apple', href: `https://maps.apple.com/?ll=${wgsLat},${wgsLng}&q=${name}` },
	]
}

function updateLocation(position) {
	if (destroyFlag || !map || !AMap || !position)
		return
	locationReady.value = true
	if (locationMarker) {
		locationMarker.setPosition(position)
	}
	else {
		locationMarker = new AMap.Marker({
			position,
			content: '<div class="qut-location-marker" aria-label="我的位置"><svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2c-3.87 0-7 3.13-7 7 0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7Z" fill="#e53935" stroke="rgba(255,255,255,0.9)" stroke-width="1" stroke-linejoin="round"/><circle cx="12" cy="8" r="2" fill="#fff"/><path d="M8.5 15.5c.35-2.1 1.65-3.5 3.5-3.5s3.15 1.4 3.5 3.5" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round"/></svg></div>',
			offset: new AMap.Pixel(-14, -28),
			zIndex: 100,
		})
		map.add(locationMarker)
	}
}

function recenterLocation() {
	if (!map || !locationMarker)
		return
	map.setCenter(locationMarker.getPosition())
}

function onBrowserLocation(position) {
	if (destroyFlag)
		return
	// 浏览器返回 WGS84，高德地图底图使用 GCJ02；本地公式转换，不调高德坐标转换接口。
	const gcj = wgs84ToGcj02([position.coords.longitude, position.coords.latitude])
	const wasReady = locationReady.value
	locationError.value = ''
	updateLocation(gcj)
	if (!wasReady)
		map.setCenter(gcj)
}

function onBrowserLocationError() {
	locating.value = false
	if (!locationReady.value)
		locationError.value = '无法获取当前位置，请检查浏览器的位置权限后重试。'
}

function finishLocationRequest() {
	locationDialogOpen.value = false
	// Hide the permission explainer synchronously. Edge rejects permission
	// requests while a full-screen overlay is still visually present.
	if (locationDialogBackdrop.value)
		locationDialogBackdrop.value.style.display = 'none'
	if (!map || !AMap || !navigator.geolocation) {
		locationError.value = '当前浏览器不支持定位功能。'
		return
	}
	if (locationWatchId != null)
		navigator.geolocation.clearWatch(locationWatchId)
	locating.value = true
	locationError.value = ''
	// 先用一次性定位触发授权，再开启持续监听，兼容 Edge 移动端的授权时序。
	navigator.geolocation.getCurrentPosition(
		(position) => {
			locating.value = false
			onBrowserLocation(position)
			locationWatchId = navigator.geolocation.watchPosition(
				onBrowserLocation,
				onBrowserLocationError,
				{ enableHighAccuracy: true, maximumAge: 0, timeout: 10000 },
			)
		},
		onBrowserLocationError,
		{ enableHighAccuracy: true, maximumAge: 0, timeout: 10000 },
	)
}

function requestLocation() {
	if (locationDialogOpen.value || locating.value)
		return
	locationDialogOpen.value = true
}

function cancelLocationRequest() {
	locationDialogOpen.value = false
}

function updateBrowserBottomInset() {
	if (!window.visualViewport)
		return
	const viewport = window.visualViewport
	const visibleBottom = viewport.offsetTop + viewport.height
	const browserInset = Math.max(0, window.innerHeight - visibleBottom)
	document.documentElement.style.setProperty('--qut-browser-bottom-inset', `${browserInset}px`)
}

function startVisualViewportObserver() {
	visualViewport = window.visualViewport
	if (!visualViewport)
		return
	updateBrowserBottomInset()
	visualViewport.addEventListener('resize', updateBrowserBottomInset)
	visualViewport.addEventListener('scroll', updateBrowserBottomInset)
	window.addEventListener('resize', updateBrowserBottomInset)
}

function stopVisualViewportObserver() {
	if (visualViewport) {
		visualViewport.removeEventListener('resize', updateBrowserBottomInset)
		visualViewport.removeEventListener('scroll', updateBrowserBottomInset)
	}
	window.removeEventListener('resize', updateBrowserBottomInset)
	document.documentElement.style.removeProperty('--qut-browser-bottom-inset')
	visualViewport = null
}

watch(selected, async (building) => {
	detailResizeObserver?.disconnect()
	detailCardHeight.value = 0
	if (!building)
		return
	await nextTick()
	if (!detailCardEl.value)
		return
	detailCardHeight.value = detailCardEl.value.offsetHeight
	detailResizeObserver = new ResizeObserver(([entry]) => {
		detailCardHeight.value = entry.borderBoxSize?.[0]?.blockSize || entry.contentRect.height
	})
	detailResizeObserver.observe(detailCardEl.value)
})

/* ================= 地图初始化 ================= */
/**
 * 是否再开一个地图实例做「校外 POI 衬底」。
 *
 * 两个 AMap 实例 = 两套瓦片请求 + 两块 canvas，代价是实打实的；而这层提供的
 * 只是「校外也显示高德原生 POI」这件锦上添花的事。小屏（≤1024px，手机上还会
 * 叠加地址栏伸缩引发的高频 resize）与低内存设备上不值得，直接退化成单层：
 * 底图自己带 point 要素，校外照样有 POI 名称，只是不再由我们这层单独控制。
 *
 * navigator.deviceMemory 只有 Chromium 系有（Firefox / Safari 返回 undefined），
 * 认不出来就按「够用」处理，别把桌面误判成低端机。
 */
function usePoiBackdrop() {
	if (typeof window === 'undefined')
		return false
	if (isMobileViewport())
		return false
	const memory = navigator.deviceMemory
	return !(typeof memory === 'number' && memory < 4)
}

function initMap() {
	const campus = CAMPUS_CONFIG[currentCampus.value]
	/* 底图要素：point 就是高德下发的 POI 点（某某楼、某店铺这类建筑名），
	   与我们自己标注的点位重名且打架，默认关掉，只留底色/道路/建筑轮廓。
	   showLabel 单独管文字标注（道路名、行政区名），关掉连路名一起没。
	   两者都由站点侧 MAP_DISPLAY 控制，未配置时用下面的默认值。

	   唯一例外是不建衬底（小屏 / 低内存）：这时校外的 POI 只能由底图自己提供，
	   于是把 point 加回来 —— 重名打架是「城内有重复标注」，总比校外一片空白好。 */
	const display = MAP_DISPLAY || {}
	const poiBackdrop = usePoiBackdrop()
	const features = (display.showPoi === true || !poiBackdrop)
		? ['bg', 'point', 'road', 'building']
		: ['bg', 'road', 'building']
	map = new AMap.Map(mapEl.value, {
		center: campus.coord,
		zoom: campus.zoom,
		mapStyle: MAP_STYLES[isDark() ? 'dark' : 'light'],
		features,
		showLabel: display.showLabels !== false,
		viewMode: '2D',
		scrollWheel: true,
	})
	/* 衬底层建不出来（或按上面的规则不建）时宁可退化回单层地图：下面 applyMask
	   会因为 !poiMap 而不挖空，否则校外会变成一片透明（看到页面底色），
	   比没有 POI 更糟 */
	if (poiBackdrop) {
		try { initPoiMap(campus, features, display) }
		catch (e) { console.warn('[MapView] 校外 POI 衬底初始化失败，退化为单层地图：', e) }
	}
	/* 衬底跟随：视野一动就开逐帧循环（见「校外 POI 衬底的跟随」），
	   停手后再归位一次。这里只挂开关，重活都在循环里 */
	map.on('mapmove', onViewChanged)
	map.on('zoomchange', onViewChanged)
	map.on('moveend', armFollowStop)
	map.on('zoomend', armFollowStop)
	/* 基准点要在衬底建好之后取：ensureProbe 用主图的投影取量尺 */
	ensureProbe()
	/* 高德地图点击：拾取模式下取坐标。注意与点位标点的 click 不冲突——
	   标点自带 click 监听（选中），点标点时事件不会冒泡到地图 click */
	map.on('click', onMapPickClick)
	/* 缩放分级：zoomchange 在滚轮里一次能连发十几回，真正的降噪在 syncTier
	   里做（只跨档才写响应式状态），这里只管接上。zoomend 再补一次：
	   惯性/动画的最后一帧不一定落成干净的目标值，收尾时以官方终值为准 */
	map.on('zoomchange', onZoomChange)
	map.on('zoomend', onZoomChange)
	/* 传 currentCampus 的 key 而不是 campus.id：数据条目里的 id 字段是可选的
	   （示例数据就没有），POLYGONS 与 campusId 都按对象的 key 引用 */
	renderPolygons()
	mapReady.value = true
	/* 首帧同步一次：initMap 用的 zoom 就是校区默认值，正常落在 2 档，
	   但数据侧若把默认 zoom 调过、或落地时带了别的缩放，这里能纠回来 */
	syncTier(true)
	/* 再校一次衬底：两个实例各自初始化，容器尺寸取整可能差零头，
	   这里按真实投影量一遍，差多少补多少（对齐时不会写 transform） */
	applyPoiFollow()
}

/**
 * 校外 POI 衬底：与主地图同一个中心、缩放、样式，唯一区别是要素里多了 point。
 *
 * 手势全部关掉、容器也 pointer-events: none —— 它只是「校外那半张图」的底，
 * 手势必须始终落在主地图上，否则拖动会在两层之间来回切换。
 *
 * 但 `zoomEnable` **必须留 true**：高德连程序化缩放也一起拦。设成 false 时
 * `setZoomAndCenter` 只挪中心、不换 zoom（实测 z 卡在初始值），于是
 * settlePoiView 永远归不了位，CSS 补间越补越离谱（实测缩到 0.32 倍还在缩小）。
 * 用户手势进不来靠的是 `scrollWheel` / `touchZoom` / `doubleClickZoom` 与
 * `pointer-events: none`，不必靠 zoomEnable 兜。
 */
function initPoiMap(campus, baseFeatures, display) {
	if (!poiMapEl.value)
		return
	poiMap = new AMap.Map(poiMapEl.value, {
		center: campus.coord,
		zoom: campus.zoom,
		mapStyle: MAP_STYLES[isDark() ? 'dark' : 'light'],
		/* 用 Set 去重：站点侧把 showPoi 打开时 features 里已经有 point 了 */
		features: [...new Set([...baseFeatures, 'point'])],
		showLabel: display.showLabels !== false,
		viewMode: '2D',
		dragEnable: false,
		doubleClickZoom: false,
		scrollWheel: false,
		rotateEnable: false,
		pitchEnable: false,
		keyboardEnable: false,
		touchZoom: false,
	})
}

/* ================= 校外 POI 衬底的跟随 =================
 *
 * 衬底与主图是两个独立的 AMap 实例：各自一套 canvas、各自调度重绘。
 * 早先靠 mapmove / zoomchange 逐次调用 poiMap.setZoomAndCenter 去追，
 * 有两个治不好的毛病：
 *
 *   1. 滚轮一次能派发十几个事件，每次都排一次重排，调用会积压，衬底越拖
 *      越落后 —— 肉眼就是「两层分离、卡顿」；
 *   2. 缩放的过渡动画在两层里是两条独立时间线，中间帧必然错位。
 *
 * 现在改成：交互期间衬底**一次地图 API 都不调**，整层套一个 CSS transform
 * （平移 + 等比缩放）贴到主图视野上。纯合成层操作，不重排不重绘、跟主图
 * 同一帧出画，天生不会错位。
 *
 * 缩放比与平移量都不读 getZoom()/getCenter()，而是取两个固定地理点，分别算
 * 它们**在主图**和**在衬底**里的像素位置 —— 那是两层这一帧真正画出来的位置，
 * 缩放动画跑到一半也是准的，衬底自己的视野滞后多少都不影响。设两点 A、B
 * （ma/pa 分别表示在主图、衬底里的像素）：
 *
 *     s  = |mB - mA| / |pB - pA|
 *     dx = mAx - pAx * s    dy = mAy - pAy * s
 *
 * 也就是「绕容器原点缩放 s 倍，再平移 (dx,dy)」，正好是 CSS 的
 * translate(dx,dy) scale(s)（配 transform-origin: 0 0）。AB 相距约 1km，
 * Mercator 的纬度非线性在这个尺度只有 1e-4 量级，可以忽略。
 *
 * 每帧从**两层的真实投影**重算，而不是「假设衬底已经跟上了」：归位时
 * 衬底调完 setZoomAndCenter 是异步落位的（实测有明显延迟），只要按它当下的
 * 真实视野补间，画面就纹丝不动地等它追上来，不会闪。
 *
 * 纯 CSS 只能拉伸已有瓦片，看不到新区域。所以跑远了要「归位」
 * （settlePoiView）：把衬底真实视野设成主图当前视野，让瓦片跟上。阈值取
 * 0.6 屏 / 半级缩放 —— 高德会预取视野外一圈瓦片，这个范围内拉伸不会露白。
 */

/* 两点采样：取同一纬度上相距约 1km 的两点。它们只是量尺，位置不参与运算，
   只有两段像素距离的比值有意义，所以初始化后不用再动 */
let poiProbe = null
/* 逐帧循环的句柄（0 表示没在跑） */
let followRaf = 0
/* 停手后的归位定时器 */
let followStopTimer = 0
/* 上次归位的时间戳：归位后衬底要追一会儿，这段时间别再重复归位 */
let lastSettleAt = 0

/** 像素对象取值：AMap.Pixel 有 getX()，不同版本也可能只给 x */
function pixelX(p) { return typeof p.getX === 'function' ? p.getX() : p.x }
function pixelY(p) { return typeof p.getY === 'function' ? p.getY() : p.y }

/** 取量尺两点。用当前视野中心向东西各 0.006 经度（约 1km） */
function ensureProbe() {
	if (poiProbe || !map)
		return
	const center = map.getCenter()
	if (!center)
		return
	poiProbe = {
		a: new AMap.LngLat(center.lng - 0.006, center.lat),
		b: new AMap.LngLat(center.lng + 0.006, center.lat),
	}
}

/**
 * 按两层**各自当下的真实投影**，把衬底层贴到主图上。
 * 返回是否已经贴合（两层视野一致）——跟随循环据此决定能不能收工。
 */
function applyPoiFollow() {
	if (!map || !poiMap || !poiLayerEl.value)
		return false
	ensureProbe()
	if (!poiProbe)
		return false
	const mAx = map.lngLatToContainer(poiProbe.a)
	const mBx = map.lngLatToContainer(poiProbe.b)
	const pAx = poiMap.lngLatToContainer(poiProbe.a)
	const pBx = poiMap.lngLatToContainer(poiProbe.b)
	if (!mAx || !mBx || !pAx || !pBx)
		return false
	const dMain = Math.hypot(pixelX(mBx) - pixelX(mAx), pixelY(mBx) - pixelY(mAx))
	const dPoi = Math.hypot(pixelX(pBx) - pixelX(pAx), pixelY(pBx) - pixelY(pAx))
	if (!dMain || !dPoi)
		return false
	const s = dMain / dPoi
	const dx = pixelX(mAx) - pixelX(pAx) * s
	const dy = pixelY(mAx) - pixelY(pAx) * s
	const el = poiLayerEl.value
	/* 已经贴合（两层视野一致）就别再挂一个 scale(1) 的合成层：
	   那会让文字走一遍重采样，边缘发虚。容差取 0.3px / 2e-4 —— 再小就是
	   两个实例容器尺寸取整的固有零头，追它反而要一直挂着一层合成 */
	const aligned = Math.abs(s - 1) < 2e-4 && Math.abs(dx) < 0.3 && Math.abs(dy) < 0.3
	if (aligned) {
		if (el.style.transform)
			el.style.transform = ''
	}
	else {
		el.style.transform =
			`translate3d(${dx.toFixed(2)}px, ${dy.toFixed(2)}px, 0) scale(${s.toFixed(6)})`
	}
	/* 拉太远：要么露出没加载过的区域，要么糊得明显，该让衬底的瓦片跟上了。
	   归位后它会异步落位，这里给 260ms 冷却，免得连环触发 */
	const size = map.getSize()
	const w = size ? (size.width ?? size.getWidth?.() ?? 0) : 0
	const h = size ? (size.height ?? size.getHeight?.() ?? 0) : 0
	const limit = Math.max(w, h, 1) * 0.6
	const now = performance.now()
	if (now - lastSettleAt > 260
		&& (Math.abs(dx) > limit || Math.abs(dy) > limit || Math.abs(Math.log2(s)) > 0.5)) {
		settlePoiView()
	}
	return aligned
}

/**
 * 归位：把衬底的真实视野设成主图当前视野，让它的瓦片跟上。
 * 刻意**不清 transform** —— setZoomAndCenter 不是同步生效的，清早了画面会
 * 回跳一下；保持不动，下一帧 applyPoiFollow 会按衬底的真实投影重算，
 * 等它自己追上，transform 自然归零。
 */
function settlePoiView() {
	if (!map || !poiMap)
		return
	const center = map.getCenter()
	const zoom = map.getZoom()
	if (!center || zoom == null)
		return
	try { poiMap.setZoomAndCenter(zoom, center, true) }
	catch (e) { try { poiMap.setZoomAndCenter(zoom, center) } catch (e2) { /* noop */ } }
	lastSettleAt = performance.now()
}

/* 视野停了之后的收尾状态：先归位，再等两层贴合了才退出循环。
   归位是异步生效的，这期间循环必须继续跑——否则那几帧没人补间，会闪 */
let followDraining = false
/* 兜底：衬底万一一直追不上，也不能让逐帧循环常驻 */
let followDeadline = 0

function stopFollowLoop() {
	if (followRaf) {
		cancelAnimationFrame(followRaf)
		followRaf = 0
	}
}

function startFollowLoop() {
	/* 没有衬底就别开循环：applyPoiFollow 会一直返回 false，而 followDraining
	   平时也是 false —— 循环会以 60fps 空转，直到页面被关掉。小屏降级后
	   这是常态路径，不能再靠「反正 poiMap 一定存在」这个假设 */
	if (followRaf || !map || !poiMap)
		return
	const step = () => {
		const aligned = applyPoiFollow()
		if (followDraining && (aligned || performance.now() > followDeadline)) {
			followRaf = 0
			return
		}
		followRaf = requestAnimationFrame(step)
	}
	followRaf = requestAnimationFrame(step)
}

/** 停手（moveend / zoomend）后延迟收尾：连续滚轮会被下一次视野变化取消 */
function armFollowStop() {
	if (followStopTimer)
		clearTimeout(followStopTimer)
	followStopTimer = setTimeout(() => {
		followStopTimer = 0
		followDraining = true
		followDeadline = performance.now() + 1500
		settlePoiView()
	}, 140)
}

/** 视野变了：立刻补一次（与视野更新同一刻，别等下一帧），再开逐帧循环兜底 */
function onViewChanged() {
	followDraining = false
	if (followStopTimer) {
		clearTimeout(followStopTimer)
		followStopTimer = 0
	}
	/* 同步这一下很关键：mapmove 派发时视野刚更新、canvas 还没重绘，
	   此刻写进去的 transform 会和主图这一帧的画面一起合成 */
	applyPoiFollow()
	startFollowLoop()
	armFollowStop()
}

/** 清干净跟随状态（销毁 / 重建地图前调用） */
function resetPoiFollow() {
	if (followStopTimer) {
		clearTimeout(followStopTimer)
		followStopTimer = 0
	}
	stopFollowLoop()
	followDraining = false
	followDeadline = 0
	lastSettleAt = 0
	poiProbe = null
	if (poiLayerEl.value)
		poiLayerEl.value.style.transform = ''
}

/**
 * 画全部校区的边界。当前校区是主角（填淡紫 + 粗虚线 + 白色衬底），
 * 另一个校区只留一条细虚线，表示「它也在这张图上」。
 *
 * 遮罩只挖**当前校区**的洞：两个校区相距二十多公里，正常缩放下一屏只
 * 看得见一个；实测 `setMask` 也做不到两个互不相交的洞（第二个环会被当成
 * 第一个环的内环，切出一块碎三角）。真要同时挖两个，只能拿一个大外框把
 * 两地都圈进去，那样连中间的市区都不再透出高德 POI，得不偿失。
 */
function renderPolygons() {
	if (polygonsRef) {
		try { map.remove(polygonsRef) }
		catch (e) { /* noop */ }
		polygonsRef = null
	}
	if (!map) {
		resetMask()
		return
	}
	const shapes = []
	/* 遮罩要的是「当前校区」的原始路径，不是 Polygon 对象（见 MASK_OUTSIDE） */
	let maskPaths = []
	for (const campusId of Object.keys(CAMPUS_CONFIG)) {
		/* 只认「至少 3 个点」的环：一两个点的残环画出来是一条线，
		   多半是数据生成时被截断了，静默跳过比在图上画根乱线好 */
		const paths = (POLYGONS[campusId] || [])
			.filter(path => Array.isArray(path) && path.length >= 3)
		if (!paths.length)
			continue
		if (campusId === currentCampus.value) {
			maskPaths = paths
			/* 先铺衬底、再压主色线：数组顺序就是绘制顺序，同一 zIndex 下后者在上 */
			const { line: lineStyle, halo: haloStyle } = boundaryStyles()
			shapes.push(...paths.map(path => new AMap.Polygon({
				path,
				...haloStyle,
				zIndex: 1,
				bubble: true,
			})))
			shapes.push(...paths.map(path => new AMap.Polygon({
				path,
				...lineStyle,
				zIndex: 2,
				/* bubble: true 让点击穿透到地图：轮廓不是可点对象，
				   拾取模式下点到边界不能把取坐标这件事拦下来 */
				bubble: true,
			})))
		}
		else {
			const dimStyle = boundaryStylesDim()
			shapes.push(...paths.map(path => new AMap.Polygon({
				path,
				...dimStyle,
				/* 压在主角之下：两条线万一在低缩放时挨近，也是当前校区在上 */
				zIndex: 0,
				bubble: true,
			})))
		}
	}
	if (!shapes.length) {
		resetMask()
		return
	}
	polygonsRef = shapes
	map.add(shapes)
	lastBoundaryPaths = maskPaths
	/* 没有衬底层就不挖空：挖空后外面是透明的，会露出页面底色 */
	if (MASK_OUTSIDE && poiMap && maskPaths.length)
		applyMask()
	else
		resetMask()
}

/* 遮罩相关的两个动作都要容错：setMask 在 2.0 的不同小版本里行为有差异，
   失败也只该退化成「没有遮罩」，不能把整轮渲染打断 */
/** 遮罩此刻是否真的生效：只有设过才需要清，否则单层下每次切校区都会
 *  白调一次 setMask(null)（那是一次整图重绘，会闪一下） */
let maskApplied = false

function applyMask() {
	if (!map || !map.setMask || !lastBoundaryPaths.length)
		return
	try {
		map.setMask(lastBoundaryPaths)
		maskApplied = true
	}
	catch (e) {
		console.warn('[MapView] setMask 失败，已回退为无遮罩：', e)
	}
}

function resetMask() {
	if (!map || !map.setMask || !maskApplied)
		return
	/* 清除遮罩要传 null，**不能传 []**：高德 2.0 把空数组当成「一个空的
	   多边形」去遮，整张图直接变透明 —— 有衬底时看不出来（衬底从下面顶上来），
	   一旦退化成单层（小屏 / 衬底初始化失败）就是一片白，只剩 DOM 层的标点 */
	try {
		map.setMask(null)
		maskApplied = false
	}
	catch (e) { /* noop */ }
}

/* ================= 缩放分级：状态同步 ================= */
/* 上一次抛出的实时 zoom（已折到 0.1）。滚轮缩放一档会来十几帧，
   值没变就别惊动页面 —— 但这个 0.1 的粒度足够让读数跟着动画走 */
let lastZoomShown = null

/**
 * 上报实时 zoom，返回归一到 0.1 的值供调用方继续用。
 *
 * 归一交给 lod.js 的 normalizeZoom（浮点尾巴、档位边界都靠它），这里只做
 * 去重：滚轮缩放一档会来十几帧，值没变就别惊动页面。
 */
function emitZoom(zoom) {
	const v = normalizeZoom(zoom)
	if (v == null)
		return null
	if (v !== lastZoomShown) {
		lastZoomShown = v
		emit('zoom-change', v)
	}
	return v
}

function onZoomChange() {
	syncTier()
}

/**
 * 把「当前 zoom」折算成档位并落状态。
 *
 * force=false 时只有跨档才做标点重排（renderMarkers）：zoomchange 在滚轮
 * 缩放中会被触发十几次，每次都改 currentTier 会让 markerBuildings 白算、
 * renderMarkers 白跑（97 个标点的比对），滚一次滚轮就浪费掉十几轮。
 * 但**实时 zoom 要每帧上报**（emitZoom 自己做去重），否则读数只在跨档时跳。
 *
 * 这里刻意不碰底图要素（map.setFeatures）。试过「远景去掉 building」：
 * 高德 features 只有 bg / point / road / building 四项，没有 landuse、水系
 * 这类面要素，去掉 building 之后整张底图近乎空白，比灰块糊成一片更难看。
 */
function syncTier(force = false) {
	if (!map)
		return
	const zoom = emitZoom(map.getZoom()) ?? map.getZoom()
	const tier = tierForZoom(zoom, CAMPUS_CONFIG[currentCampus.value]?.zoom)
	const changed = tier !== currentTier.value
	currentTier.value = tier
	if (!changed && !force)
		return
	renderMarkers()
	emit('lod-change', {
		/* 跨档那一刻的 zoom。实时读数请订阅 zoom-change，别用这个字段 */
		zoom,
		tier,
		/* 1 档图上是「校区标点」，各校区一个 */
		markers: tier <= 1 ? campusPinCache.size : markerBuildings.value.length,
		/* 两校区同时在图上，分母是全部点位，不是当前校区的 */
		total: BUILDINGS.length,
	})
}

/* ================= marker（缓存 + 增量更新） ================= */
function markerPinMarkup(category) {
	const color = categoryColor(category)
	return (
		`<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" aria-hidden="true" style="display:block;filter:drop-shadow(0 1px 2px rgb(15 23 42 / .2))">`
		/* 颜色直接写进 fill：SVG 表现属性里用 var() 在部分浏览器不生效，
		   这里宁可多传一次真实色值；切换选中态时由 applyPinState 改 style.fill */
		+ `<path d="M12 2c-3.87 0-7 3.13-7 7 0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7Z" fill="${color}" stroke="rgba(255,255,255,0.92)" stroke-width="1.3" stroke-linejoin="round" style="transition:fill 160ms ease"/></svg>`
		+ `<span style="position:absolute;left:50%;top:38%;transform:translate(-50%,-50%);color:#fff;display:grid;place-items:center">${
			categoryIconMarkup(category, 11)
		}</span>`
	)
}

function applyPinState(root, selectedFlag) {
	const body = root.querySelector('[data-map-pin-body]')
	if (!body)
		return
	body.dataset.selected = selectedFlag ? 'true' : 'false'
	body.style.transform = `scale(${selectedFlag ? PIN_SCALE.selected : PIN_SCALE.idle})`
	const base = body.dataset.color || FALLBACK_PIN_COLOR
	const pin = body.querySelector('svg path')
	if (pin)
		pin.style.fill = selectedFlag ? shade(base, SELECTED_MIX_RATIO) : base
	// 名称标签跟着强调：选中时用与标点同源的加深色，未选中清空、交回 CSS 的常规文字色
	// 注意本文件是不带 lang="ts" 的 <script setup>——不能写 querySelector<HTMLElement>()，
	// 那在纯 JS 里会被解析成比较运算，返回值恒为 false，标签色会静默失效
	const label = root.querySelector('.qut-pin-label')
	if (label)
		label.style.color = selectedFlag ? shade(base, SELECTED_MIX_RATIO) : ''
}

function applyPinHover(root, hovered) {
	const body = root.querySelector('[data-map-pin-body]')
	if (!body)
		return
	const selectedFlag = body.dataset.selected === 'true'
	body.style.transform = `scale(${selectedFlag ? PIN_SCALE.selected : hovered ? PIN_SCALE.hover : PIN_SCALE.idle})`
}

function createMarkerPin(building, selectedFlag) {
	const root = document.createElement('div')
	root.className = 'qut-pin-root'
	root.dataset.buildingId = building.id

	const body = document.createElement('div')
	body.dataset.mapPinBody = 'true'
	body.dataset.selected = selectedFlag ? 'true' : 'false'
	/* 记住底色：applyPinState 选中/取消时要据此算加深值 */
	body.dataset.color = categoryColor(building.category)
	body.style.transform = `scale(${selectedFlag ? PIN_SCALE.selected : PIN_SCALE.idle})`
	body.innerHTML = markerPinMarkup(building.category)

	root.appendChild(body)

	/* 常驻名称标签：挂在标点正下方。
	   刻意用绝对定位而不是让它参与布局：AMap.Marker 的 offset 是按 content 容器尺寸
	   算的，标签一旦把容器撑宽，锚点就会整体偏移、标点不再对准真实坐标。
	   绝对定位后容器仍是 28×28，锚点不变，标签溢出容器显示。
	   pointer-events: none —— 密集处标签会互相压住，不设的话后绘制的标签
	   会挡住相邻标点的点击热区。 */
	const label = document.createElement('span')
	label.className = 'qut-pin-label'
	label.textContent = building.name
	root.appendChild(label)

	return root
}

/* ================= 档位 1 的校区标点 =================
 * 远景（≤ 默认 zoom - 2）下整块校区在屏幕上只有几百像素，几十个分类标点
 * 会糊成一团、名字互相压住。这一档改成**每个校区一个**标点代表「被框住的
 * 这块区域」，点它才进校区看细节（见 enterCampus）。
 *
 * 两校区同时显示之后，低缩放下这两个标点会一起出现：当前那个实色、
 * 另一个降一档透明度，点另一个等于切校区。
 *
 * 落点由 campusAnchor 按边界多边形的面积加权重心算，不用 CAMPUS_CONFIG
 * 的 coord —— 那是打开地图时的视野中心，八里台那个点偏东三百多米。
 */
function campusPinColor() {
	/* 深色底图上 27% 明度的紫几乎沉底，提亮一档——与边界线的两套配色同理 */
	return isDark() ? '#C68AB7' : '#711A5F'
}

/* 校区图标（Lucide 的 school）。写死在这里而不走 CATEGORY_ICON_PATHS：
   数据侧的图标表是「分类 → 图标」，没有「校区」这个分类，借某个分类的
   图标会随数据改动而变样 */
function campusIconMarkup(size) {
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 22v-4a2 2 0 1 0-4 0v4"/><path d="m18 10 4 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-8l4-2"/><path d="M18 5v17"/><path d="m4 6 8-4 8 4"/><path d="M6 5v17"/><circle cx="12" cy="9" r="2"/></svg>`
}

function campusPinMarkup() {
	const color = campusPinColor()
	return (
		`<svg xmlns="http://www.w3.org/2000/svg" width="${CAMPUS_PIN_SIZE}" height="${CAMPUS_PIN_SIZE}" viewBox="0 0 24 24" aria-hidden="true" style="display:block;filter:drop-shadow(0 2px 4px rgb(15 23 42 / .28))">`
		/* 与分类标点同一个水滴形，只是放大：一眼能看出「这是同一套标点体系里
		   更高一层的东西」，而不是另一个图层冒出来的徽章 */
		+ `<path d="M12 2c-3.87 0-7 3.13-7 7 0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7Z" fill="${color}" stroke="rgba(255,255,255,0.94)" stroke-width="1.1" stroke-linejoin="round"/></svg>`
		+ `<span style="position:absolute;left:50%;top:38%;transform:translate(-50%,-50%);color:#fff;display:grid;place-items:center">${
			campusIconMarkup(17)
		}</span>`
	)
}

function createCampusPin(campusId, isCurrent) {
	const root = document.createElement('div')
	root.className = isCurrent
		? 'qut-pin-root qut-campus-pin is-current'
		: 'qut-pin-root qut-campus-pin'
	root.dataset.campusId = campusId

	const body = document.createElement('div')
	body.dataset.mapPinBody = 'true'
	body.dataset.color = campusPinColor()
	/* 这里刻意不写 inline transform：分类标点那套 applyPinState 靠改 inline
	   transform 做缩放，校区标点没有选中态，把它留给 CSS 的 :hover */
	body.innerHTML = campusPinMarkup()
	root.appendChild(body)

	const label = document.createElement('span')
	label.className = 'qut-pin-label qut-campus-pin-label'
	label.textContent = CAMPUS_CONFIG[campusId]?.name || ''
	root.appendChild(label)

	return root
}

/**
 * 显示 / 收起校区标点（两个校区各一个）。
 *
 * visible=false 就全部拆掉：2 档以后图上一簇分类标点已经能认出是哪个校区，
 * 再压大标点只会把它们挡住。
 * force=true 用于换皮肤（紫的深浅两套）与换校区（主次要互换）——此时缓存
 * 虽然还在，但已经过期。
 */
function renderCampusPins(visible, force = false) {
	if (!map || !AMap)
		return
	if (!visible || force) {
		for (const [, entry] of campusPinCache) {
			try { map.remove(entry.marker) }
			catch (e) { /* noop */ }
		}
		campusPinCache = new Map()
		if (!visible)
			return
	}
	for (const campusId of Object.keys(CAMPUS_CONFIG)) {
		const isCurrent = campusId === currentCampus.value
		const cached = campusPinCache.get(campusId)
		/* 主次变了要重建：is-current 是建标点时写进 class 的，还带着
		   zIndex 的差别，就地改不如拆了重来（切校区时就是这条在生效） */
		if (cached && cached.current === isCurrent)
			continue
		if (cached) {
			try { map.remove(cached.marker) }
			catch (e) { /* noop */ }
			campusPinCache.delete(campusId)
		}
		const center = campusAnchor(POLYGONS[campusId], CAMPUS_CONFIG[campusId]?.coord)
		if (!center)
			continue
		try {
			const root = createCampusPin(campusId, isCurrent)
			const marker = new AMap.Marker({
				position: center,
				content: root,
				/* 与分类标点同一套锚点：水滴的尖对准坐标 */
				offset: new AMap.Pixel(-CAMPUS_PIN_SIZE / 2, -CAMPUS_PIN_SIZE),
				/* 比分类标点（10）高一点；当前校区再压过另一个校区一头，
				   低缩放时两个都看得见，要有主次 */
				zIndex: isCurrent ? 15 : 14,
			})
			marker.on('click', () => enterCampus(campusId))
			map.add(marker)
			campusPinCache.set(campusId, { marker, root, campusId, current: isCurrent })
		}
		catch (e) {
			// 单条渲染失败不该中断整轮；退化成「1 档没有标点」也不影响用地图
			console.warn('[MapView] 校区标点渲染失败：', campusId, e)
		}
	}
}

/**
 * 点校区标点 = 「打开这块区域」：拉到校区默认 zoom，正好从 1 档落回 2 档，
 * 标点从 1 个变回一簇。
 *
 * 点的是**另一个校区**时，先切校区（左侧列表跟着换），再落视野 —— 这正是
 * 「切换校区只移动视角和换列表」这条约定在 1 档下的入口。
 *
 * 同一校区内用动画：只跨两三级 zoom，动画能把「刚才那个大标点被放大成了
 * 一片点位」讲清楚。跨二十多公里的换校区必须瞬时（否则整张校外图会飞出去），
 * 那条路径由 selectCampus 负责。
 */
function enterCampus(campusId = currentCampus.value) {
	if (!map)
		return
	const config = CAMPUS_CONFIG[campusId]
	const center = campusAnchor(POLYGONS[campusId], config?.coord)
	if (!config || !center)
		return
	if (campusId !== currentCampus.value) {
		selectCampus(campusId, { center, zoom: config.zoom })
		return
	}
	try { map.setZoomAndCenter(config.zoom, center) }
	catch (e) { map.setZoomAndCenter(config.zoom, center, true) }
}

function renderMarkers() {
	if (!map || !AMap)
		return
	/* 1 档只留校区标点：分类标点全部收起。注意 markerBuildings 仍照常按
	   档位过滤（列表、计数都还在用它），这里只是不往图上放 */
	const collapsed = currentTier.value <= 1
	const list = collapsed ? [] : markerBuildings.value
	const visibleIds = new Set(list.map(b => b.id))

	for (const [id, entry] of markerCache) {
		if (visibleIds.has(id))
			continue
		entry.marker.off('click', entry.listeners.click)
		entry.marker.off('mouseover', entry.listeners.mouseover)
		entry.marker.off('mouseout', entry.listeners.mouseout)
		map.remove(entry.marker)
		markerCache.delete(id)
		if (hoverTip.value?.building.id === id)
			hoverTip.value = null
	}

	for (const b of list) {
		if (markerCache.has(b.id)) {
			applyPinState(markerCache.get(b.id).root, b.id === selected.value?.id)
			continue
		}
		try {
			const root = createMarkerPin(b, b.id === selected.value?.id)
			const marker = new AMap.Marker({
				position: b.coord,
				content: root,
				offset: new AMap.Pixel(-PIN_SIZE / 2, -PIN_SIZE),
				zIndex: b.id === selected.value?.id ? 120 : 10,
			})
			const listeners = {
				click: () => onSelect(b),
				mouseover: () => showHoverTip(b, root),
				mouseout: () => hideHoverTip(root),
			}
			marker.on('click', listeners.click)
			marker.on('mouseover', listeners.mouseover)
			marker.on('mouseout', listeners.mouseout)
			map.add(marker)
			markerCache.set(b.id, { marker, root, listeners })
		}
		catch (e) {
			// 单条数据有问题（coord 缺失 / 非法等）只跳过它：不能中断整轮渲染，
			// 更不能被 bootstrap 的 catch 升级成全局「地图不可用」
			console.warn('[MapView] 点位渲染失败，已跳过：', b.id, e)
		}
	}

	/* 收尾再切校区标点：放在这里而不是 syncTier 里，是因为「选中某个点位」
	   也会走一遍 renderMarkers，两处都改容易出现一边显示一边没显示 */
	renderCampusPins(collapsed)
}

/* ================= hover 提示（跟随地图移动） ================= */
/**
 * 算悬停提示的位置。x 必须夹取：提示的 z-index（25）高于左侧悬浮卡片（12），
 * 点位若贴地图左缘，提示会整块压在卡片上（夹取逻辑见 hover-tip.js）。
 * y 仍按标点上方定位（贴顶时不翻转，属既有行为）。
 */
function hoverTipPosition(building) {
	const { x, y } = map.lngLatToContainer(building.coord)
	const cardRight = document.querySelector('.map-sidebar')?.getBoundingClientRect().right ?? 0
	return {
		x: clampTipCenterX({
			x,
			viewWidth: mapEl.value?.clientWidth || 0,
			cardRight,
		}),
		y: y - PIN_SIZE * PIN_SCALE.hover,
	}
}

function showHoverTip(building, root) {
	if (!map)
		return
	clearHoverCloseTimer()
	applyPinHover(root, true)
	hoverTip.value = { building, ...hoverTipPosition(building) }
}

function hideHoverTip(root) {
	applyPinHover(root, false)
	clearHoverCloseTimer()
	hoverCloseTimer = setTimeout(() => { hoverTip.value = null }, 80)
}

function clearHoverCloseTimer() {
	if (hoverCloseTimer) { clearTimeout(hoverCloseTimer); hoverCloseTimer = null }
}

watch(hoverTip, (tip) => {
	if (!tip)
		return
	const sync = () => {
		if (!map || !hoverTip.value || hoverTip.value.building.id !== tip.building.id)
			return
		// 与 showHoverTip 走同一个定位函数，否则拖动地图时提示会滑回卡片上
		const next = hoverTipPosition(tip.building)
		if (hoverTip.value.x === next.x && hoverTip.value.y === next.y)
			return
		hoverTip.value = { building: tip.building, ...next }
	}
	map.on('mapmove', sync)
	map.on('zoomchange', sync)
	return () => {
		map.off('mapmove', sync)
		map.off('zoomchange', sync)
	}
})

/* ================= 选中 ================= */
function onSelect(b) {
	selected.value = b
	photoViewerIndex.value = 0
	if (map) {
		/* 从左侧列表选到的点位可能属于更高档位、此刻地图上没有标点：
		   markerBuildings 会把选中项补回列表，但真正建标点是在这里 */
		renderMarkers()
		for (const [id, entry] of markerCache) {
			const isSelected = id === b.id
			applyPinState(entry.root, isSelected)
			entry.marker.setzIndex(isSelected ? 120 : 10)
		}
		hoverTip.value = null
		/* 1 档图上没有分类标点：先放大到校区默认 zoom（2 档），
		   否则「从列表选了一个点，地图上却什么都没有」。
		   缩放会经 zoomchange → syncTier 把标点放回来，这里不用手动渲染 */
		const base = CAMPUS_CONFIG[currentCampus.value]?.zoom
		if (currentTier.value <= 1 && base) {
			try { map.setZoomAndCenter(base, b.coord) }
			catch (e) { map.setZoomAndCenter(base, b.coord, true) }
		}
		else {
			map.panTo(b.coord)
		}
	}
	/* 小屏选完点位就收起列表：卡片给地图让位，底部详情卡才露得出来 */
	if (isMobileViewport())
		sidebarCollapsed.value = true
	/* 地址栏跟着走：此时复制链接就是「这栋楼」的直达地址 */
	syncDeepLink(b)
	/* 换点位时复位「已复制」：上一栋楼的反馈不该跟着留在新卡片上 */
	resetCopyState()
}

/**
 * 详情卡关掉后，把焦点送到一个「还在、且看得见」的地方。
 *
 * 顺序：同一点位在左侧列表里的按钮 → 搜索框。
 * 小屏选完点位列表会自动收起（`grid-template-rows: 0fr` + overflow hidden），
 * 折叠区里的按钮**仍有布局盒**（`getClientRects()` 不为空，只是被裁掉了），
 * 所以可见性不能按行盒判，得看 `sidebarCollapsed` —— 否则焦点会被送进看不见的
 * 区域，读屏念了名字、屏幕上却没有焦点框。
 */
function focusAfterCardClose(buildingId) {
	let target = null
	if (!sidebarCollapsed.value) {
		for (const item of document.querySelectorAll('#map-building-list .building-item')) {
			if (!(item instanceof HTMLElement) || item.dataset.id !== buildingId)
				continue
			target = item
			break
		}
	}
	/* 列表项不传 preventScroll：列表自身可滚动，选中项在视口外时让浏览器带进来 */
	if (target) {
		target.focus()
		return
	}
	const input = document.querySelector('.sidebar-search input')
	if (input instanceof HTMLElement)
		input.focus({ preventScroll: true })
}

function clearSelection() {
	/* 焦点若在详情卡里（按 Esc 或点关闭按钮），卡片一卸载焦点就掉到 body ——
	   键盘用户会「失去落点」，接着按 Tab 是从整页开头重新走一遍。
	   先把这件事记下来，DOM 更新后交给列表或搜索框（见 focusAfterCardClose） */
	const closingId = selected.value?.id
	const fromCard = !!(detailCardEl.value && detailCardEl.value.contains(document.activeElement))
	closePhotoViewer()
	resetCopyState()
	selected.value = null
	/* 取消选中后，原本因「被选中」而强制显示的高档位标点要收回去 */
	renderMarkers()
	for (const [, entry] of markerCache) {
		applyPinState(entry.root, false)
		entry.marker.setzIndex(10)
	}
	/* 链接也要退回去：留着 id 会让「已关闭」与「地址里还指着一个点」对不上 */
	syncDeepLink(null)
	if (fromCard)
		nextTick(() => focusAfterCardClose(closingId))
}

/**
 * 切换校区 = 移动视角 + 换一份左侧列表。
 *
 * 图上的东西**不跟着变**：两个校区的边界、标点始终都在。跟着变的只有三样：
 * 视野、左侧列表、遮罩挖哪个校区的洞。
 *
 * opts.center / opts.zoom 给「1 档点另一个校区的标点」用 —— 那种场合要落到
 * 边界重心，而不是校区配置里那个视野中心。
 */
function selectCampus(next, opts = {}) {
	if (next === currentCampus.value)
		return
	currentCampus.value = next
	selected.value = null
	/* 选中被清掉，全屏查看器必须一起关：只清 selected 的话 photoViewer 还是 true，
	   下一次选中带图的点位会「自己弹出全屏图」（v-if 是 photoViewer && currentViewerPhoto）。
	   clearSelection() 里已有同样一行，这里补上是为了不依赖「用户点不到」这个巧合 */
	closePhotoViewer()
	/* 选中被清掉，深链也要退：新校区里原来那个 id 已经不代表此刻的视野了。
	   注意 applyDeepLink 会在随后选中点位时把 id 再写回来 */
	syncDeepLink(null)
	currentCategory.value = 'all'
	searchKeyword.value = ''
	/* 悬浮提示也要清：指针不动（键盘切校区）时不会触发 marker mouseout，
	   残留的提示会按旧校区坐标继续定位、还跟着地图飘 */
	clearHoverCloseTimer()
	hoverTip.value = null
	if (map) {
		const c = CAMPUS_CONFIG[next]
		const center = opts.center || c.coord
		const zoom = opts.zoom ?? c.zoom
		/* 换校区是跨城跳转（八里台 ↔ 津南二十多公里），这里刻意不用动画：
		   衬底靠 CSS 补间贴主图，横跨这个距离会看到整张校外图从旧校区
		   飞出去。瞬时落位，再起一轮跟随循环等衬底异步追上 */
		map.setZoomAndCenter(zoom, center, true)
		settlePoiView()
		onViewChanged()
		/* 边界要重画：主次要互换（当前校区填色 + 粗虚线，另一个细虚线），
		   遮罩也要改挖新校区 —— 两件事都在 renderPolygons 里 */
		renderPolygons()
		/* 换校区后档位要跟着重算：两个校区的默认 zoom 不同（17 / 16），
		   而 zoomchange 是异步派发的，等它回来前这一帧会按旧档位渲染。
		   syncTier(true) 顺带把 1 档校区标点的主次换过来 */
		syncTier(true)
	}
}

/* ================= 点位深链（?id=xxx） =================
 * 在这之前，想把某栋楼发给同学只能发地图首页、让对方自己在列表里找。
 * 这里把「选中的点位」同步进地址栏：复制 URL 就是一条直达链接。
 *
 * 两个方向：
 *   落地时读 ?id → 切到它所属校区并选中它；
 *   选中时写 ?id → replaceState（不占用「后退」，否则每点一个点都多一步历史）。
 *
 * 用 id 而不是坐标：坐标会随数据微调失效，而 id 是可读的 slug
 * （main-building 这种），在聊天里被截断也还能认出是哪栋楼。
 */
const DEEP_LINK_KEY = 'id'

function readDeepLinkId() {
	if (typeof window === 'undefined')
		return ''
	return (new URLSearchParams(window.location.search).get(DEEP_LINK_KEY) || '').trim()
}

/** 把当前选中同步进地址栏；传空表示清掉这个参数 */
function syncDeepLink(building) {
	if (typeof window === 'undefined')
		return
	const url = new URL(window.location.href)
	if (building?.id)
		url.searchParams.set(DEEP_LINK_KEY, building.id)
	else
		url.searchParams.delete(DEEP_LINK_KEY)
	if (url.href === window.location.href)
		return
	/* 被嵌在 sandbox iframe 里（预览面板、站内嵌页）时 replaceState 可能抛
	   SecurityError；地址栏同步是锦上添花，不能让它把「选中点位」这件事带崩 */
	try { window.history.replaceState(window.history.state, '', url) }
	catch (e) { /* noop */ }
}

/** 地图就绪后应用链接里的点位；id 对不上就当没写，顺手清掉脏参数 */
function applyDeepLink() {
	const id = readDeepLinkId()
	if (!id)
		return
	const target = BUILDINGS.find(b => b.id === id)
	if (!target) {
		syncDeepLink(null)
		return
	}
	/* 先切校区（换视野 + 换左侧列表）并直接把视野落到点位上：跨城跳转不需要
	   动画，让它从旧校区滑过去反而像卡住了 */
	if (target.campusId && target.campusId !== currentCampus.value && CAMPUS_CONFIG[target.campusId])
		selectCampus(target.campusId, { center: target.coord })
	onSelect(target)
}

/* ---------- 复制链接：让深链「看得见」 ----------
 * 深链做好之后，界面上没有任何一处告诉用户「地址栏就是这栋楼的链接」，
 * 这个功能等于只有知道的人在用。卡片底部补一枚按钮，点一下拿走。
 */
/** idle 原样 / done 已复制 / fail 复制失败（非安全上下文常见） */
const copyState = ref('idle')
let copyStateTimer = null

function resetCopyState() {
	if (copyStateTimer) {
		clearTimeout(copyStateTimer)
		copyStateTimer = null
	}
	copyState.value = 'idle'
}

/** 兜底：http 内网预览 / 老浏览器没有 Clipboard API，走临时 textarea */
function copyByExecCommand(text) {
	try {
		const area = document.createElement('textarea')
		area.value = text
		area.setAttribute('readonly', '')
		/* 必须留在文档流里才选得中，所以挪到视口外、透明，而不是 display: none */
		area.style.cssText = 'position:fixed;top:-1000px;left:0;opacity:0'
		document.body.appendChild(area)
		area.select()
		const ok = document.execCommand('copy')
		document.body.removeChild(area)
		return ok
	}
	catch (e) {
		return false
	}
}

/**
 * 复制当前点位的直达链接。
 *
 * 地址栏里本该已经有了（onSelect → syncDeepLink），但这里仍按 selected 现算：
 * 嵌在 iframe 里时 replaceState 会被拒（上面那个 try/catch 吃了异常），
 * 地址栏可能并没同步上；而用户点的就是这张卡，按卡片算出来的才一定对。
 */
async function copyDeepLink() {
	if (!selected.value)
		return
	const url = new URL(window.location.href)
	url.searchParams.set(DEEP_LINK_KEY, selected.value.id)
	const text = url.href
	let ok = false
	try {
		if (navigator.clipboard?.writeText) {
			await navigator.clipboard.writeText(text)
			ok = true
		}
	}
	catch (e) { ok = false }
	if (!ok)
		ok = copyByExecCommand(text)
	resetCopyState()
	copyState.value = ok ? 'done' : 'fail'
	/* 失败留久一点让人看清，成功后 1.6s 复位即可 */
	copyStateTimer = setTimeout(resetCopyState, ok ? 1600 : 2400)
}

const copyLabel = computed(() => {
	if (copyState.value === 'done')
		return '链接已复制'
	if (copyState.value === 'fail')
		return '复制失败'
	return '复制链接'
})

/* ================= 坐标拾取模式 =================
   维护 map-data.js 用的小工具：?pick=1 打开，点地图取坐标、填信息、
   复制生成的数据条。逻辑集中在 MapPickPanel.vue，这里只负责地图侧的三件事——
   读 URL 开关、接地图 click、放一个可拖动的拾取标记。 */
function initPickMode() {
	// URL 只在客户端可读；SSR 阶段保持关闭，避免服务端渲染出面板
	if (typeof window === 'undefined')
		return
	pickMode.value = new URLSearchParams(window.location.search).get('pick') === '1'
}

/**
 * 开关拾取模式，并把状态同步到 URL 的 pick 参数。
 *
 * 历史栈用 replaceState 而非 pushState：这是一次界面开关，不该占用「后退」——
 * 否则用户点后退会回到上一个 URL 状态、拾取面板却还开着，两边对不上。
 * 同步过去的好处是可以直接书签/分享这个地址，刷新也不丢。
 */
function togglePickMode(on) {
	const next = typeof on === 'boolean' ? on : !pickMode.value
	pickMode.value = next
	if (typeof window !== 'undefined') {
		const url = new URL(window.location.href)
		if (next)
			url.searchParams.set('pick', '1')
		else
			url.searchParams.delete('pick')
		window.history.replaceState(window.history.state, '', url)
	}
	if (!next) {
		// 退出时清掉拾取标记与坐标，下次进来是干净状态
		if (pickMarker && map) {
			try { map.remove(pickMarker) }
			catch (e) { /* noop */ }
		}
		pickMarker = null
		pickedCoord.value = null
	}
}

/** Shift+P 开关拾取（输入框里按 P 就是在打字，不能抢） */
function onPickHotkey(e) {
	if (e.key !== 'P' || !e.shiftKey || e.ctrlKey || e.metaKey || e.altKey)
		return
	const editing = isEditingTarget(e.target)
	if (editing)
		return
	e.preventDefault()
	togglePickMode()
}

function updatePickMarker() {
	if (!map || !AMap || !pickedCoord.value)
		return
	if (!pickMarker) {
		pickMarker = new AMap.Marker({
			position: pickedCoord.value,
			draggable: true,
			cursor: 'move',
			content: '<div class="map-pick-marker" aria-hidden="true"></div>',
			offset: new AMap.Pixel(-7, -7),
			zIndex: 200,
		})
		// 拖动比重新点击更顺手：微调时不必担心又点到别处
		pickMarker.on('dragend', () => {
			const p = pickMarker.getPosition()
			pickedCoord.value = [p.getLng(), p.getLat()]
		})
		map.add(pickMarker)
	}
	else {
		pickMarker.setPosition(pickedCoord.value)
	}
}

function onMapPickClick(e) {
	if (!pickMode.value)
		return
	pickedCoord.value = [e.lnglat.getLng(), e.lnglat.getLat()]
	updatePickMarker()
}

/** 拾取面板里换校区时让地图跟过去（与左侧卡片的校区按钮走同一条路径） */
function onPickCampusChange(id) {
	selectCampus(id)
}

function clearMarkerCache() {
	for (const [, entry] of markerCache) {
		try { map.remove(entry.marker) }
		catch (e) { /* noop */ }
	}
	markerCache.clear()
	/* 校区标点也要一起清：换皮肤要重画（紫有明暗两套），换校区要重排主次 */
	for (const [, entry] of campusPinCache) {
		try { map.remove(entry.marker) }
		catch (e) { /* noop */ }
	}
	campusPinCache = new Map()
}

/** 切换分类筛选（接分类 key，供横排药丸调用） */
function selectCategory(key) {
	currentCategory.value = key
	renderMarkers()
}

/* ================= 分类药丸的横向滚动增强 =================
   17 个分类在 22rem 的卡片里一行放不下，只能横向滚。除了原生方式
   （触控板横滑、滚动条），再补两种桌面更顺手的操作：按住鼠标左右拖动、
   指针停在药丸行上时把滚轮转成横向滚动。只接管鼠标——触摸与触控笔
   交回浏览器，保留移动端原生惯性滚动。
   实现见 ./chips-scroll.js（单独成模块是为了能单测：边界放行、
   Firefox 行单位换算、拖动阈值、拖动后那次 click 的抑制都容易写错而不报错） */
const categoryChipsEl = ref(null)
let chipsScroll = null

function bindCategoryChips() {
	chipsScroll = createChipsScroll(categoryChipsEl.value, window)
	chipsScroll.bind()
}

function unbindCategoryChips() {
	chipsScroll?.unbind()
	chipsScroll = null
}

function onSearchInput() {
	if (searchTimer)
		clearTimeout(searchTimer)
	searchTimer = setTimeout(renderMarkers, 200)
}

function clearSearch() {
	searchKeyword.value = ''
	onSearchInput()
}

/* ================= 主题联动（MutationObserver 监听 html.dark，切换高德官方夜间样式） ================= */
let themeObserver = null

function applyMapTheme() {
	if (!map)
		return
	const dark = document.documentElement.classList.contains('dark')
	const style = MAP_STYLES[dark ? 'dark' : 'light']
	if (map.getMapStyle && map.getMapStyle() !== style) {
		map.setMapStyle(style)
		/* 衬底必须同步换肤，否则校区内是夜间底、校区外还是白天的 */
		if (poiMap && poiMap.setMapStyle)
			poiMap.setMapStyle(style)
		/* 边界的两套配色是跟着皮肤走的（深色底要用提亮紫 + 黑衬底），
		   换皮肤必须重画，否则会留在上一套里 */
		renderPolygons()
		/* 校区标点的紫也分两套（暗底提亮），同样要重画 */
		renderCampusPins(currentTier.value <= 1, true)
	}
}

function startThemeObserver() {
	themeObserver = new MutationObserver(() => applyMapTheme())
	themeObserver.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ['class'],
	})
}

/* ================= 生命周期 ================= */
/**
 * 销毁当前地图实例与全部 marker / 轮廓，回到未初始化状态。
 * retry 前必须调用：上次尝试可能已走过 initMap() 才失败，旧实例还活着，
 * 直接再建会把第二个地图叠进同一容器（双层画布 + 旧监听永久泄漏）。
 */
function resetMap() {
	if (themeObserver) {
		themeObserver.disconnect()
		themeObserver = null
	}
	clearMarkerCache()
	if (polygonsRef && map) {
		try { map.remove(polygonsRef) }
		catch (e) { /* noop */ }
		polygonsRef = null
	}
	lastBoundaryPaths = []
	resetMask()
	/* 实例马上要销毁：标志跟着归零，否则重建后第一次单层渲染会去清一个
	   已经不存在的遮罩 */
	maskApplied = false
	resetPoiFollow()
	if (poiMap) {
		try { poiMap.destroy() }
		catch (e) { /* noop */ }
		poiMap = null
	}
	if (map) {
		try { map.destroy() }
		catch (e) { /* noop */ }
		map = null
	}
	mapReady.value = false
}

async function bootstrap() {
	try {
		AMap = await loadAMap()
		/* SDK 加载期间用户可能已切走页面：mapEl 此时已被置空，
		   继续初始化只会 new AMap.Map(null)，或在容错实现下留下一个
		   永不 destroy 的地图实例与一只永不 disconnect 的 MutationObserver */
		if (destroyFlag)
			return
		await nextTick()
		if (destroyFlag)
			return
		initMap()
		renderMarkers()
		/* 深链放在标点渲染之后：onSelect 里要改已有标点的选中态，
		   先有标点才有「选中态落到哪一个」可言 */
		applyDeepLink()
		startThemeObserver()
		applyMapTheme()
	}
	catch (e) {
		console.error('[MapView] init failed:', e)
		mapError.value = `地图加载失败：${e && e.message ? e.message : String(e)}`
	}
}

function retry() {
	mapError.value = ''
	resetMap()
	bootstrap()
}

onMounted(() => {
	// 地图初始化放最前：后面的辅助初始化若抛错，绝不能拖累地图加载
	//（上一轮 categoryChipsEl 未声明时，整个 mounted 中断，地图与拖拽一起失效）
	bootstrap()
	/* 小屏默认收起：卡片浮在地图左上角，展开态会盖住大半个地图。
	   断点值只取一次是不够的：窗口跨 1024px 缩放、平板旋转后状态会与断点
	   脱节（小屏停在展开盖住地图 / 桌面停在收看不到列表），必须跟随变化 */
	if (typeof window !== 'undefined' && window.matchMedia) {
		mobileQuery = window.matchMedia(MOBILE_QUERY)
		sidebarCollapsed.value = mobileQuery.matches
		mobileQuery.addEventListener('change', onMobileQueryChange)
	}
	document.addEventListener('keydown', onGlobalKeydown)
	document.addEventListener('keydown', onPickHotkey)
	bindCategoryChips()
	startVisualViewportObserver()
	initPickMode()
})

onUnmounted(() => {
	document.removeEventListener('keydown', onGlobalKeydown)
	document.removeEventListener('keydown', onPickHotkey)
	resetCopyState()
	if (mobileQuery)
		mobileQuery.removeEventListener('change', onMobileQueryChange)
	mobileQuery = null
	unbindCategoryChips()
	destroyFlag = true
	if (themeObserver) {
		themeObserver.disconnect()
		themeObserver = null
	}
	clearHoverCloseTimer()
	if (searchTimer)
		clearTimeout(searchTimer)
	detailResizeObserver?.disconnect()
	stopVisualViewportObserver()
	if (locationMarker && map) {
		try { map.remove(locationMarker) }
		catch (e) { /* noop */ }
	}
	if (pickMarker && map) {
		try { map.remove(pickMarker) }
		catch (e) { /* noop */ }
	}
	pickMarker = null
	if (locationWatchId != null && navigator.geolocation)
		navigator.geolocation.clearWatch(locationWatchId)
	locationWatchId = null
	if (map) {
		try { map.destroy() }
		catch (e) { /* noop */ }
		map = null
	}
	markerCache.clear()
	campusPinCache = new Map()
})
</script>

<template>
<section class="map-section" :class="{ 'map-section-collapsed': sidebarCollapsed }">
	<!-- 可见的标题让位给悬浮卡片，标题只留在文档结构里（供读屏与 SEO） -->
	<h1 class="sr-only">
		校园地图
	</h1>

	<div class="map-body">
		<!-- 左侧悬浮卡片：校区切换 + 搜索 + 分类 + 点位列表，整卡浮在地图之上；
		     收起后只剩前三个控件（可收成小卡片，把地图让出来）。
		     小屏用的也是这张卡片（挂载时默认收起），不再另做抽屉 + 浮层按钮 -->
		<aside class="map-sidebar" aria-label="校园地点">
			<!-- 控制区：校区 / 搜索 / 分类三行放在同一条浅色带上，与下方白底列表分层。
			     收起态下它下方的列表已压成 0 高度，底部那条分界线会变成悬在卡片底部的孤线，
			     故按状态类关掉（见 .sidebar-controls.is-list-collapsed） -->
			<div class="sidebar-controls" :class="{ 'is-list-collapsed': sidebarCollapsed }">
			<!-- 校区切换 + 收起按钮。按钮放在滚动容器之外，
			     否则横向滚动药丸时它会跟着一起滚走 -->
			<div class="sidebar-campus-row">
				<div class="campus-tabs" role="group" aria-label="选择校区">
					<button
						v-for="(cfg, key) in CAMPUS_CONFIG"
						:key="key"
						type="button"
						class="campus-tab"
						:class="{ active: currentCampus === key }"
						:aria-pressed="currentCampus === key"
						@click="selectCampus(key)"
					>
						{{ cfg.name }}
					</button>
				</div>
				<button
					type="button"
					class="icon-btn sidebar-collapse-btn"
					:class="{ collapsed: sidebarCollapsed }"
					:aria-expanded="!sidebarCollapsed"
					aria-controls="map-building-list"
					:aria-label="sidebarCollapsed ? '展开地点列表' : '收起为小卡片'"
					:title="sidebarCollapsed ? '展开地点列表' : '收起小卡片（只留校区、搜索与分类）'"
					@click="sidebarCollapsed = !sidebarCollapsed"
				>
					<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m18 15-6-6-6 6" /></svg>
				</button>
			</div>

			<div class="sidebar-search">
				<label class="search-box">
					<svg class="search-icon" xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
					<span class="sr-only">搜索地点</span>
					<input
						v-model="searchKeyword"
						type="text"
						:placeholder="searchPlaceholder"
						@input="onSearchInput"
					>
					<button v-if="searchKeyword" class="icon-btn clear-btn" aria-label="清空搜索" @click="clearSearch">
						<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
					</button>
				</label>
			</div>

			<!-- 分类筛选：横排彩色药丸，圆点色与标点/列表图标同源（CATEGORY_CONFIG.color）。
			     分类有 17 个，卡片放不下就横向滚动；「全部」不带圆点（它没有对应色） -->
			<div ref="categoryChipsEl" class="category-chips" role="group" aria-label="地点分类">
				<button
					v-for="item in FILTER_LIST"
					:key="item.key"
					type="button"
					class="category-chip"
					:class="{ active: currentCategory === item.key }"
					:aria-pressed="currentCategory === item.key"
					@click="selectCategory(item.key)"
				>
					<span
						v-if="item.key !== 'all'"
						class="chip-dot"
						:style="{ '--chip-dot': categoryColor(item.key) }"
					/>
					{{ item.label }}
				</button>
			</div>
			</div>

			<!-- 列表外面套一层 grid 容器：grid-template-rows 1fr → 0fr 是纯 CSS 里
			     唯一能「动画到内容自适应高度」的写法（主题包侧栏分组折叠也是这套） -->
			<div id="map-building-list" class="sidebar-list-wrap" :class="{ 'is-collapsed': sidebarCollapsed }">
				<div class="building-list">
					<button
						v-for="b in filteredBuildings"
						:key="b.id"
						type="button"
						class="building-item"
						:class="{ active: selected?.id === b.id }"
						:data-id="b.id"
						:aria-current="selected?.id === b.id ? 'true' : undefined"
						@click="onSelect(b)"
					>
						<span class="cat-icon" :style="{ color: categoryColor(b.category) }" v-html="categoryIconMarkup(b.category, 14)" />
						<span class="building-info">
							<span class="building-name">{{ b.name }}</span>
							<span v-if="b.desc" class="building-desc">{{ b.desc }}</span>
						</span>
					</button>
					<div v-if="filteredBuildings.length === 0" class="empty-tip">
						<svg class="empty-icon" xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13" /><path d="M8 12h13" /><path d="M8 18h13" /><path d="M3 6h.01" /><path d="M3 12h.01" /><path d="M3 18h.01" /></svg>
						<p class="empty-title">
							没有匹配的地点
						</p>
						<p class="empty-sub">
							换个关键词或分类试试
						</p>
					</div>
				</div>
			</div>
		</aside>

		<!-- 右侧地图 -->
		<div class="map-canvas">
			<!-- 校外 POI 衬底：垫在主地图下面，只在主地图被遮成透明的地方露出来。
			     外层是跟随层（交互期间由 JS 写 transform），内层才是高德容器 -->
			<div ref="poiLayerEl" class="map-el map-el-poi">
				<div ref="poiMapEl" class="map-el-poi-stage" />
			</div>
			<div ref="mapEl" class="map-el" />

			<!-- 坐标拾取面板：URL 带 ?pick=1 时出现，用于维护 map-data.js -->
			<MapPickPanel
				v-if="pickMode"
				:coord="pickedCoord"
				:buildings="BUILDINGS"
				:categories="CATEGORY_CONFIG"
				:campuses="CAMPUS_CONFIG"
				:default-campus="currentCampus"
				@campus-change="onPickCampusChange"
				@close="togglePickMode(false)"
			/>

			<!-- 加载 / 错误占位层 -->
			<div v-if="!mapReady && !mapError" class="map-placeholder">
				<span class="spinner" />
				<p class="placeholder-text">
					地图加载中
				</p>
			</div>
			<div v-if="mapError" class="map-placeholder">
				<p class="error-title">
					地图暂时不可用
				</p>
				<p class="error-desc">
					{{ mapError }}
				</p>
				<button class="retry-btn" type="button" @click="retry">
					重新加载
				</button>
			</div>

			<!-- hover 悬浮提示 -->
			<div
				v-if="hoverTip"
				class="map-hover-tip"
				:style="{ left: `${hoverTip.x}px`, top: `${hoverTip.y}px` }"
			>
				<img v-if="buildingPhotos(hoverTip.building)[0]" :src="buildingPhotos(hoverTip.building)[0]" alt="" class="hover-img" loading="lazy" decoding="async">
				<p class="hover-name">
					{{ hoverTip.building.name }}
				</p>
				<p class="hover-cat">
					{{ (CATEGORY_CONFIG[hoverTip.building.category] || {}).label || '其他' }}
				</p>
				<p v-if="hoverTip.building.desc" class="hover-desc">
					{{ hoverTip.building.desc }}
				</p>
			</div>

			<p v-if="locationError && !selected" class="location-status" role="status">
				{{ locationError }}
			</p>

			<!-- 右下角这一列：重定位 + 定位/拾取工具卡 + 缩放卡。
			     桌面端（≥1025px）这层是 display: contents，不产生盒子——三个子元素各自
			     按原样绝对定位（重定位在右下，工具组与缩放卡在右上），桌面观感不变；
			     小屏才真正成为一列、整体贴到右下角：收起态卡片铺满左上角后，右侧与顶部
			     都让给了它，而详情卡出现时整列按卡片高度上移（--detail-card-height 挂这层） -->
			<div
				class="map-bottom-right"
				:style="selected ? { '--detail-card-height': `${detailCardHeight}px` } : undefined"
			>
				<!-- 重定位按钮（定位成功后出现） -->
				<button
					v-if="locationReady"
					type="button"
					class="recenter-btn"
					aria-label="重新定位到我的位置"
					@click="recenterLocation"
				>
					<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M12 2v2" /><path d="M12 20v2" /><path d="m4.93 4.93 1.41 1.41" /><path d="m17.66 17.66 1.41 1.41" /><path d="M2 12h2" /><path d="M20 12h2" /><path d="m6.34 17.66-1.41 1.41" /><path d="m19.07 4.93-1.41 1.41" /></svg>
					<span>重定位</span>
				</button>

				<!-- 悬浮卡片组：定位 / 坐标拾取 与 缩放 -->
				<div class="map-right-stack" :class="{ 'map-right-stack-shifted': pickMode }">
					<div class="map-tools" role="group" aria-label="地图工具">
						<button
							type="button"
							class="map-tool-btn"
							:disabled="!mapReady || locating"
							:aria-label="locating ? '定位中' : '显示定位'"
							@click="requestLocation"
						>
							<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M12 2v2" /><path d="M12 20v2" /><path d="m4.93 4.93 1.41 1.41" /><path d="m17.66 17.66 1.41 1.41" /><path d="M2 12h2" /><path d="M20 12h2" /><path d="m6.34 17.66-1.41 1.41" /><path d="m19.07 4.93-1.41 1.41" /></svg>
							<span>{{ locating ? '定位中' : '显示定位' }}</span>
						</button>
						<!-- 坐标拾取入口：维护地图数据时才用，故做成图标按钮（另有 Shift+P 快捷键） -->
						<button
							type="button"
							class="map-tool-btn map-pick-entry"
							:class="{ active: pickMode }"
							:aria-pressed="pickMode"
							:aria-label="pickMode ? '退出坐标拾取' : '坐标拾取（数据维护用）'"
							:title="pickMode ? '退出坐标拾取（Shift+P）' : '坐标拾取（Shift+P）'"
							@click="togglePickMode()"
						>
							<svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8" /><path d="M12 2v3" /><path d="M12 19v3" /><path d="M2 12h3" /><path d="M19 12h3" /><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" /></svg>
						</button>
					</div>

					<div class="map-zoom-ctrl">
						<button class="zoom-btn" aria-label="放大地图" :disabled="!mapReady" @click="map && map.zoomIn()">
							<svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14" /><path d="M12 5v14" /></svg>
						</button>
						<div class="zoom-divider" />
						<button class="zoom-btn" aria-label="缩小地图" :disabled="!mapReady" @click="map && map.zoomOut()">
							<svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14" /></svg>
						</button>
					</div>
				</div>
			</div>

			<!-- 选中地点详情卡片（右下角）。
			     v-if 直接摘节点会让卡片「啪」地消失，与进场的上浮完全不对称；
			     所以交给 <Transition>：进场 220ms 上浮淡入、出场 140ms 快速淡出
			     （出场比进场短一档，关卡片时不会有拖泥带水的黏滞感） -->
			<Transition name="detail-card">
				<section v-if="selected" ref="detailCardEl" class="map-detail-card">
					<div class="detail-head">
						<button
							v-if="selectedPhotos.length"
							type="button"
							class="detail-photo-stack"
							:class="{ 'detail-photo-stack-multiple': selectedPhotos.length > 1 }"
							:aria-label="selectedPhotos.length > 1 ? `查看 ${selectedPhotos.length} 张地点图片` : '查看地点图片'"
							@click.stop="openPhotoViewer()"
						>
							<img v-if="selectedPhotos.length > 1" :src="selectedPhotos[1]" alt="" class="detail-photo detail-photo-back" loading="lazy" decoding="async">
							<img :src="selectedPhotos[0]" alt="" class="detail-photo detail-photo-front" loading="lazy" decoding="async">
							<span v-if="selectedPhotos.length > 1" class="detail-photo-count">{{ selectedPhotos.length }}</span>
						</button>
						<span
							class="detail-icon"
							:style="{ color: categoryColor(selected.category), borderColor: categoryColor(selected.category) }"
							v-html="categoryIconMarkup(selected.category, 15)"
						/>
						<!-- :key 让「换点位」时这段文字重新挂载、重播一次淡入：
						     卡片本身不重建（照片与按钮保持原位），只有文字列轻换，
						     否则从主楼点到食堂，标题/标签/描述是「啪」地整块跳变 -->
						<div :key="selected.id" class="detail-info">
							<h2 class="detail-name">
								{{ selected.name }}
							</h2>
							<!-- 归属标签：校区（中性药丸）+ 分类（圆点取分类色）。
							     两校区同屏后，点位可能不在当前正在浏览的校区，
							     所以校区取点位自己的 campusId，而不是左侧卡片的当前校区 -->
							<div v-if="campusLabel(selected.campusId) || selected.category" class="detail-meta">
								<span v-if="campusLabel(selected.campusId)" class="detail-meta-chip">
									<svg class="detail-meta-icon" xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" /><circle cx="12" cy="10" r="3" /></svg>
									<span class="detail-meta-text">{{ campusLabel(selected.campusId) }}</span>
								</span>
								<span
									v-if="selected.category"
									class="detail-meta-chip"
									:style="{ '--meta-dot': categoryColor(selected.category) }"
								>
									<i class="detail-meta-dot" aria-hidden="true" />
									<span class="detail-meta-text">{{ categoryLabel(selected.category) }}</span>
								</span>
							</div>
							<p v-if="selected.desc" class="detail-desc">
								{{ selected.desc }}
							</p>
						</div>
						<button class="icon-btn" aria-label="关闭地点详情" @click="clearSelection">
							<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
						</button>
					</div>
					<p v-if="locationError" class="location-error">
						{{ locationError }}
					</p>
					<!-- 点位关联文章入口（在 map-data.js 点位上声明 article 字段即可启用） -->
					<a v-if="selected.article" class="detail-article-link" :href="selected.article">
						查看相关文章 <span aria-hidden="true">→</span>
					</a>
					<div class="nav-btns">
						<a
							v-for="link in navigationLinksFor(selected)"
							:key="link.id"
							:href="link.href"
							target="_blank"
							rel="noopener noreferrer"
							class="nav-btn"
						>
							{{ link.label }}
						</a>
					</div>
					<!-- 分享入口。深链做好之后界面上没有任何一处告诉用户「地址栏就是
					     这栋楼的链接」，这个功能等于只有知道的人在用，这里补一枚按钮。
					     复制成功 / 失败就地改字改色，不弹 toast —— 卡片本身就在眼前，
					     再飘一层提示反而是噪音；aria-live 让读屏也能听到结果 -->
					<button
						type="button"
						class="detail-copy-link"
						:class="{ 'is-done': copyState === 'done', 'is-fail': copyState === 'fail' }"
						aria-live="polite"
						@click.stop="copyDeepLink"
					>
						<svg v-if="copyState === 'done'" xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
						<svg v-else xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>
						{{ copyLabel }}
					</button>
				</section>
			</Transition>
		</div>
	</div>
	<div v-if="locationDialogOpen" ref="locationDialogBackdrop" class="location-dialog-backdrop" role="presentation">
		<section ref="locationDialogEl" class="location-dialog" role="dialog" aria-modal="true" aria-labelledby="location-dialog-title" tabindex="-1">
			<div class="location-dialog-icon">
				<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M12 2v2" /><path d="M12 20v2" /><path d="m4.93 4.93 1.41 1.41" /><path d="m17.66 17.66 1.41 1.41" /><path d="M2 12h2" /><path d="M20 12h2" /><path d="m6.34 17.66-1.41 1.41" /><path d="m19.07 4.93-1.41 1.41" /></svg>
			</div>
			<h2 id="location-dialog-title">
				允许获取你的当前位置
			</h2>
			<p>定位信息仅用于在地图上标记你的位置，不会被保存。</p>
			<div class="location-legend" aria-label="地图图标说明">
				<span><i class="legend-pin legend-pin-user" />红色图标：用户定位</span>
				<span><i class="legend-pin legend-pin-place" />彩色图标：按分类着色的可点击标点</span>
			</div>
			<p class="location-countdown">
				点击继续后将请求定位权限，并持续更新你的位置。
			</p>
			<button type="button" class="location-confirm" @click="finishLocationRequest">
				继续
			</button>
			<button type="button" class="location-cancel" @click="cancelLocationRequest">
				暂不定位
			</button>
		</section>
	</div>

	<Teleport to="body">
		<!-- 点详情卡的照片才进来的全屏查看器：直接出现/消失像「闪黑一下」，
		     补 180ms 淡入淡出，图片本身再缩一档收进来 -->
		<Transition name="viewer">
			<div
				v-if="photoViewer && currentViewerPhoto"
				ref="viewerEl"
				class="map-photo-viewer"
				role="dialog"
				aria-modal="true"
				:aria-label="`${selected?.name || '地点'}图片查看器`"
				tabindex="-1"
				@click="closePhotoViewer"
			>
				<button class="map-photo-viewer-close" type="button" aria-label="关闭图片查看器" @click.stop="closePhotoViewer">
					<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
				</button>
				<button v-if="selectedPhotos.length > 1" class="map-photo-viewer-nav map-photo-viewer-prev" type="button" aria-label="上一张图片" @click.stop="changeViewerPhoto(-1)">
					<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6" /></svg>
				</button>
				<img :src="currentViewerPhoto" :alt="`${selected?.name || '地点'}第 ${photoViewerIndex + 1} 张图片`" class="map-photo-viewer-img" decoding="async" @click.stop>
				<button v-if="selectedPhotos.length > 1" class="map-photo-viewer-nav map-photo-viewer-next" type="button" aria-label="下一张图片" @click.stop="changeViewerPhoto(1)">
					<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6" /></svg>
				</button>
				<p v-if="selected?.name" class="map-photo-viewer-caption">
					{{ selected.name }}<span v-if="selectedPhotos.length > 1"> · {{ photoViewerIndex + 1 }} / {{ selectedPhotos.length }}</span>
				</p>
			</div>
		</Transition>
	</Teleport>
</section>
</template>

<style scoped>
/* ============================================================
   CQU-openlib 设计体系（抄自其 theme/colors.ts，OKLCH）
   ============================================================ */
.map-section {
	/* 品牌色直接引用站点 token（南开青莲紫），亮暗模式自动跟随全站，
     不再保留 QUT 的蓝色系硬编码 */
	--c-primary: var(--vp-c-brand-1);
	--c-primary-hover: var(--vp-c-brand-2);
	--c-primary-soft: var(--vp-c-brand-soft);
	--c-primary-faint: color-mix(in srgb, var(--vp-c-brand-1) 6%, transparent);
	--c-mist: color-mix(in srgb, var(--vp-c-brand-1) 6%, transparent);
	--c-ink: #213547;
	--c-muted: #838387;
	--c-line: rgba(33, 53, 71, 0.09);
	--c-paper: #F6F6F7;
	--c-panel: #FFFFFF;
	--c-elev: #FFFFFF;
	--c-icon: #A1A1A6;
	--c-icon-strong: #3C3C43;

	display: flex;
	flex-direction: column;
	overflow: hidden;
	width: 100%;
	height: calc(100vh - var(--vp-nav-height, 64px));
	background: var(--c-paper);
	font-family: inherit;
	color: var(--c-ink);
}

html.dark .map-section {
	/* 品牌色不再重复定义：--c-primary 系列引用的 --vp-c-brand-* 在 .dark 下
     已由站点 tokens.css 换成提亮档，这里只覆盖中性色 */
	--c-ink: rgba(235, 235, 245, 0.92);
	--c-muted: rgba(235, 235, 245, 0.52);
	--c-line: rgba(235, 235, 245, 0.11);
	--c-paper: #161618;
	--c-panel: #252529;
	--c-elev: #2F2F33;
	--c-icon: #6B6B70;
	--c-icon-strong: rgba(235, 235, 245, 0.82);
}

/* ===== 校区切换（悬浮卡片内的横排药丸）+ 收起按钮 ===== */
/* ===== 控制区：校区 / 搜索 / 分类三行同处一条浅色带 =====
   控件放在 --c-paper 色带上、点位列表留在白底上，形成「操作 vs 结果」的分层；
   侧距统一 12px、行距统一 10px，不再各行其是 */
.sidebar-controls {
	display: flex;
	flex-direction: column;
	flex-shrink: 0;
	gap: 10px;
	padding: 12px;
	border-bottom: 1px solid var(--c-line);
	background: var(--c-paper);
	/* 收起时这条分界线要一起淡出，否则会「啪」地消失，与列表 0.2s 的收起动画不同步 */
	transition: border-bottom-color var(--wiki-duration-collapse, 0.2s) var(--wiki-ease-out, ease-out);
}
/* 收起态：下方列表被压成 0 高度，这条分界线已无分界对象，只会在卡片底部悬成一条孤线
   （用 transparent 而非 border-bottom: none，避免 1px 的高度跳变，也让过渡成立） */
.sidebar-controls.is-list-collapsed {
	border-bottom-color: transparent;
}
/* 这一行装「校区药丸 + 收起按钮」。
   类名刻意不叫 .sidebar-top：主题的全局样式（wiki-theme/theme/styles/cards.css）
   给文档侧栏的顶部行定义了裸选择器 .sidebar-top { border-bottom: 1px solid var(--vp-c-divider) }，
   会连带作用到本卡片上，在校区药丸底下多出一条分割线（一度被误判成 flex 压缩/旧样式缓存，
   排查了多轮）。组件内要用的类名必须与主题全局裸选择器错开，见 tests/style-class-collision.test.ts */
.sidebar-campus-row {
	display: flex;
	flex-shrink: 0;
	align-items: center;
	gap: 4px;
}
.campus-tabs {
	display: flex;
	flex: 1;
	min-width: 0;
	gap: 6px;
	/* 药丸比原来的下拉框宽不少，窄卡片里放不下时横向滚动（不显滚动条）。
	   滚动条若放出来，就是一条贴在按钮底下的横线——看起来像按钮压在分割线上 */
	overflow-x: auto;
	scrollbar-width: none;
}
.campus-tabs::-webkit-scrollbar {
	display: none;
}
.sidebar-collapse-btn {
	flex-shrink: 0;
	/* 与左侧校区药丸同高（32px），整行读起来是一条线，而不是一枚悬着的小图标 */
	height: 32px;
	color: var(--c-icon);
}
.sidebar-collapse-btn svg {
	transition: transform var(--wiki-duration-collapse, 0.2s) var(--wiki-ease-out, ease-out);
}
/* 展开时箭头朝上（点了往上收），收起时翻朝下（点了放下） */
.sidebar-collapse-btn.collapsed svg {
	transform: rotate(180deg);
}
.campus-tab {
	flex: 0 0 auto;
	height: 32px;
	padding: 0 14px;
	border: 1px solid var(--c-line);
	border-radius: 999px;
	background: var(--c-panel);
	font-size: 13px;
	font-weight: 500;
	white-space: nowrap;
	color: var(--c-ink);
	transition: background-color var(--wiki-duration-fast, 0.15s) var(--wiki-ease-out, ease-out), border-color var(--wiki-duration-fast, 0.15s) var(--wiki-ease-out, ease-out), color var(--wiki-duration-fast, 0.15s) var(--wiki-ease-out, ease-out);
	cursor: pointer;
}
.campus-tab:hover:not(.active) {
	border-color: var(--c-primary);
	color: var(--c-primary);
}
.campus-tab.active {
	border-color: transparent;
	background: var(--c-primary);
	font-weight: 600;
	color: #FFF;
}

/* ===== 主体 ===== */
.map-body {
	display: flex;
	flex: 1;
	position: relative;
	min-height: 0;
}

/* ===== 左侧悬浮卡片：校区切换 + 搜索 + 点位列表 =====
   刻意用绝对定位浮在地图之上（而不是 flex 列占据左侧），
   这样地图铺满整个视口，卡片四周露出地图——参考站的做法 */
.map-sidebar {
	display: flex;
	flex-direction: column;
	position: absolute;
	overflow: hidden;
	top: 12px;
	left: 12px;
	width: 22rem;
	max-width: calc(100% - 24px);
	/* 用 max-height 而不是 bottom: 12px 撑满：收起时卡片要能缩成小卡片，
     而 bottom 在 12px 与 auto 之间没法过渡——高度随内容才收得动。
     展开时内容比上限高，实际高度仍等于 max-height，与原来一致。
     底部留 28px 而不是 12px：高德 logo/版权固定在地图左下角（不再随卡片
     收展平移），卡片铺到底会把它压掉一半，留出这一条正好让它整块露出来 */
	max-height: calc(100% - 40px);
	border: 1px solid var(--c-line);
	border-radius: 14px;
	box-shadow: 0 12px 32px rgba(15, 23, 42, 0.16);
	background: var(--c-panel);
	z-index: 12;
}

.icon-btn {
	display: grid;
	place-items: center;
	width: 28px;
	height: 28px;
	border: none;
	border-radius: 6px;
	background: transparent;
	color: var(--c-icon-strong);
	cursor: pointer;
	transition: background var(--wiki-duration-fast, 0.15s) var(--wiki-ease-out, ease-out), transform var(--wiki-duration-fast, 0.15s) var(--wiki-ease-out, ease-out);
}
.icon-btn:hover {
	background: var(--c-mist);
}
/* 关闭按钮没有任何按下反馈时，点完只能靠卡片消失确认；缩一档比改背景更容易被察觉 */
.icon-btn:active {
	transform: scale(0.9);
}

.sidebar-search {
	display: flex;
	flex-shrink: 0;
	gap: 8px;
}
.search-box {
	display: flex;
	flex: 1;
	align-items: center;
	position: relative;
	height: 40px;
	min-width: 0;
	border: 1px solid var(--c-line);
	border-radius: 10px;
	/* 白底浮在浅色控制带上：控件带与输入框不再同为灰底、糊成一片 */
	background: var(--c-panel);
	transition: border-color var(--wiki-duration-fast, 0.15s) var(--wiki-ease-out, ease-out);
}
.search-box:focus-within {
	border-color: var(--c-primary);
}
.search-icon {
	position: absolute;
	left: 10px;
	color: var(--c-icon-strong);
}
.search-box input {
	width: 100%;
	height: 100%;
	padding: 0 30px;
	border: none;
	outline: none;
	background: transparent;
	font-size: 13px;
	color: var(--c-ink);
}
.search-box input::placeholder {
	color: var(--c-muted);
}
.clear-btn {
	position: absolute;
	right: 6px;
}

/* 分类筛选：横排彩色药丸。圆点色取自 CATEGORY_CONFIG（与标点、列表图标同一份色），
   选中态改用品牌色填充——与上面的校区切换共用一套药丸视觉 */
.category-chips {
	display: flex;
	flex-shrink: 0;
	gap: 6px;
	/* 分类有 17 个，22rem 的卡片一行放不下，横向滚动（不显滚动条） */
	overflow-x: auto;
	scrollbar-width: none;
	/* 可按住鼠标左右拖动（见 onChipsPointerDown）：空白处给抓手光标；
	   药丸本身仍是 pointer——点选才是主要操作 */
	cursor: grab;
}
.category-chips::-webkit-scrollbar {
	display: none;
}
/* 拖动中：抓紧光标 + 禁止选中，否则拖过文案会划出选区 */
.category-chips.is-dragging {
	cursor: grabbing;
	user-select: none;
}
.category-chip {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	flex: 0 0 auto;
	height: 28px;
	padding: 0 12px;
	border: 1px solid var(--c-line);
	border-radius: 999px;
	background: var(--c-panel);
	font-size: 12px;
	font-weight: 500;
	white-space: nowrap;
	color: var(--c-ink);
	transition: background-color var(--wiki-duration-fast, 0.15s) var(--wiki-ease-out, ease-out), border-color var(--wiki-duration-fast, 0.15s) var(--wiki-ease-out, ease-out), color var(--wiki-duration-fast, 0.15s) var(--wiki-ease-out, ease-out);
	cursor: pointer;
}
.category-chip:hover:not(.active) {
	border-color: var(--c-primary);
	color: var(--c-primary);
}
/* 横向滚动容器会把纵向裁掉，外扩的焦点描边放不下 → 改画在药丸内侧 */
.category-chip:focus-visible {
	outline-offset: -2px;
}
.category-chip.active {
	border-color: transparent;
	background: var(--c-primary);
	font-weight: 600;
	color: #FFF;
}
.chip-dot {
	flex-shrink: 0;
	width: 8px;
	height: 8px;
	border-radius: 50%;
	/* 颜色走自定义属性传入：内联 background 会盖掉选中态的覆盖规则 */
	background: var(--chip-dot, var(--c-muted));
}
/* 选中态保留分类原色（蓝色系在品牌深紫底上偏暗，加一圈半透明白描边
   把色块托出来），让「当前是哪个分类」的色标在选中前后保持一致 */
.category-chip.active .chip-dot {
	box-shadow: 0 0 0 1.5px rgba(255, 255, 255, 0.72);
}

/* 列表折叠：外层 grid 容器高度 1fr ↔ 0fr（纯 CSS 里唯一能动画到「内容自适应高度」
   的写法，主题包侧栏分组折叠用的也是这套）。flex: 1 1 auto + min-height: 0
   让它占满卡片剩余高度，同时能被压到 0 */
.sidebar-list-wrap {
	display: grid;
	flex: 1 1 auto;
	grid-template-rows: 1fr;
	min-height: 0;
	overflow: hidden;
	transition: grid-template-rows var(--wiki-duration-collapse, 0.2s) var(--wiki-ease-out, ease-out);
}
.sidebar-list-wrap.is-collapsed {
	grid-template-rows: 0fr;
	/* 收起时列表的 padding-bottom 会残留成一条 8px 的「小尾巴」
     （0fr 只能压掉内容高度，压不掉 padding），必须一并归零 */
}
.sidebar-list-wrap.is-collapsed .building-list {
	/* 收起时 0fr 只压掉内容高度，压不掉 padding——上下内边距会残留成一段空白「小尾巴」，一并归零 */
	padding-top: 0;
	padding-bottom: 0;
}

.building-list {
	overflow-y: auto;
	min-height: 0;
	/* 圆角分格：列表四周留出内边距，每一行才成为独立圆角块，而不是通栏贴到卡片边缘 */
	padding: 6px 6px 8px;
	/* 卡片是圆角浮层，默认宽度的滚动条压着圆角显得笨重；收细并常驻槽位，
     避免筛选后条数变化时列表宽度来回跳 */
	scrollbar-width: thin;
	scrollbar-gutter: stable;
}
.building-item {
	display: flex;
	align-items: flex-start;
	gap: 10px;
	width: 100%;
	padding: 10px 12px;
	/* 每一行自成一块圆角卡片，与卡片外层、搜索框、地点浮窗里的按钮同一套圆角语言。
	   原来的通栏分割线（border-bottom）是直角、且横贯整卡，与圆角块冲突，故改为「间隙分格」 */
	border: 1px solid var(--c-line);
	border-radius: 10px;
	background: var(--c-panel);
	text-align: left;
	transition: background var(--wiki-duration-fast, 0.15s) var(--wiki-ease-out, ease-out), border-color var(--wiki-duration-fast, 0.15s) var(--wiki-ease-out, ease-out);
	cursor: pointer;
}
/* 行与行之间用间隙分格（4px），取代原来的通栏细线 —— 圆角块之间不能再夹一条直角长线 */
.building-item + .building-item {
	margin-top: 4px;
}
.building-item:hover {
	background: var(--c-mist);
	border-color: var(--c-primary-soft);
}
/* 列表项是圆角块，全站那圈 2px + 4px offset 的外描边会露在块外、和相邻行的描边叠在一起，
   改成内描边（同一条边线落在块内） */
.building-item:focus-visible {
	outline-offset: -2px;
}
.building-item.active {
	background: var(--c-primary-faint);
	border-color: var(--c-primary-soft);
}
.cat-icon {
	flex-shrink: 0;
	opacity: 0.9;
	margin-top: 2px;
}
.building-info {
	display: flex;
	flex: 1;
	flex-direction: column;
	gap: 2px;
	min-width: 0;
}
.building-name {
	font-size: 13px;
	font-weight: 500;
	line-height: 1.3;
	color: var(--c-ink);
}
.building-desc {
	display: -webkit-box;
	overflow: hidden;
	font-size: 12px;
	-webkit-line-clamp: 1;
	color: var(--c-muted);
	-webkit-box-orient: vertical;
}
.empty-tip {
	padding: 40px 24px;
	text-align: center;
}
.empty-icon {
	display: block;
	margin: 0 auto;
	color: var(--c-icon-strong);
}
.empty-title {
	margin: 8px 0 4px;
	font-weight: 500;
	color: var(--c-ink);
}
.empty-sub {
	margin: 0;
	font-size: 12px;
	color: var(--c-muted);
}

/* ===== 地图画布 ===== */
.map-canvas {
	flex: 1;
	position: relative;
	min-width: 0;
	min-height: 0;
	/* 衬底跟随时会整层缩放（zoom 差一级就是 2 倍），不裁会溢出到侧栏和页面上 */
	overflow: hidden;
}
.map-el {
	position: absolute;
	inset: 0;
	/* 主地图压住衬底：它是唯一可交互的层，标点、边界、拾取都在它身上 */
	z-index: 1;
}
/* 校外 POI 衬底：只在主地图被 setMask 挖空的地方可见。
   不吃指针事件——否则点在「校外的地图」上会落进这层、拖不动主地图。
   transform-origin 放左上角：跟随用的 translate+scale 是按容器坐标系推的，
   绕中心缩放的话式子要再多绕一层中心点 */
.map-el-poi {
	z-index: 0;
	pointer-events: none;
	transform-origin: 0 0;
	will-change: transform;
}
/* 高德容器：跟随层的尺寸不能受 transform 影响，这里吃满父级 */
.map-el-poi-stage {
	position: absolute;
	inset: 0;
}
.map-placeholder {
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 8px;
	position: absolute;
	inset: 0;
	background: var(--c-paper);
	z-index: 10;
}
.spinner {
	width: 28px;
	height: 28px;
	border: 3px solid var(--c-line);
	border-top-color: var(--c-primary);
	border-radius: 50%;
	animation: spin 0.8s linear infinite;
}
@keyframes spin {
	to { transform: rotate(360deg); }
}
.placeholder-text {
	margin: 0;
	font-size: 13px;
	color: var(--c-muted);
}
.error-title {
	margin: 0;
	font-weight: 500;
	color: var(--c-ink);
}
.error-desc {
	max-width: 320px;
	margin: 0;
	font-size: 12px;
	text-align: center;
	color: var(--c-muted);
}
.retry-btn {
	height: 32px;
	margin-top: 8px;
	padding: 0 12px;
	border: 1px solid var(--c-line);
	border-radius: 6px;
	background: var(--c-panel);
	font-size: 12px;
	font-weight: 500;
	color: var(--c-ink);
	cursor: pointer;
}
.retry-btn:hover {
	border-color: var(--c-primary);
	color: var(--c-primary);
}

/* hover 悬浮提示 */
.map-hover-tip {
	position: absolute;
	max-width: 300px;
	padding: 12px 14px;
	border: 1px solid var(--c-line);
	border-radius: 10px;
	box-shadow: 0 8px 24px rgba(15, 23, 42, 0.14);
	background: var(--c-elev);
	white-space: normal;
	text-align: center;
	transform: translate(-50%, -100%) translateY(-8px);
	pointer-events: none;
	z-index: 25;
}
.hover-name {
	margin: 0;
	font-size: 14px;
	font-weight: 600;
	line-height: 1.3;
	color: var(--c-ink);
}
.hover-cat {
	margin: 2px 0 0;
	font-size: 13px;
	color: var(--c-muted);
}
/* 悬浮气泡图片与描述（此注释可删） */
.hover-img {
	display: block;
	width: 200px;
	height: 133px;
	margin: 0 auto 10px;
	border-radius: 10px;
	object-fit: cover;
}
.hover-desc {
	max-width: 260px;
	margin: 2px 0 0;
	font-size: 13px;
	line-height: 1.5;
	color: var(--c-muted);
}
.detail-photo-stack {
	flex: 0 0 104px;
	position: relative;
	width: 104px;
	height: 78px;
	padding: 0;
	border: 0;
	background: transparent;
	cursor: zoom-in;
}
.detail-photo {
	display: block;
	position: absolute;
	width: 96px;
	height: 72px;
	border: 2px solid var(--c-elev);
	border-radius: 8px;
	box-shadow: 0 3px 10px rgba(15, 23, 42, 0.16);
	object-fit: cover;
}
.detail-photo-front {
	top: 0;
	left: 0;
	z-index: 2;
}
.detail-photo-back {
	top: 5px;
	left: 6px;
	transform: rotate(5deg);
	transform-origin: center;
	z-index: 1;
}
.detail-photo-count {
	position: absolute;
	right: 4px;
	bottom: 2px;
	height: 20px;
	min-width: 20px;
	padding: 0 5px;
	border: 1px solid rgba(255, 255, 255, 0.8);
	border-radius: 999px;
	background: rgba(15, 23, 42, 0.78);
	font-size: 11px;
	font-weight: 600;
	line-height: 18px;
	text-align: center;
	color: #FFF;
	z-index: 3;
}
.detail-photo-stack:focus-visible {
	outline: 2px solid var(--c-primary);
	outline-offset: 3px;
}
.map-photo-viewer {
	display: grid;
	place-items: center;
	position: fixed;
	inset: 0;
	padding: 24px;
	background: rgba(0, 0, 0, 0.85);
	z-index: 9999;
}
/* 两个模态容器只当「焦点落点」（tabindex="-1"），不给它们画焦点环：
   焦点随即随 Tab 进入内部按钮，容器上多一圈框反而像里面有什么被选中了 */
.map-photo-viewer:focus,
.location-dialog:focus {
	outline: none;
}
/* 查看器进出场：整体淡，图片单独从 0.955 收回原位（只补进场这一程，
   离场时点遮罩的人希望它立刻让开，缩回去会多拖 0.24s） */
.viewer-enter-active,
.viewer-leave-active {
	transition: opacity 0.18s var(--wiki-ease-out, ease-out);
}
.viewer-enter-active .map-photo-viewer-img {
	transition: transform 0.24s var(--wiki-ease-out, ease-out);
}
.viewer-enter-from,
.viewer-leave-to {
	opacity: 0;
}
.viewer-enter-from .map-photo-viewer-img {
	transform: scale(0.955);
}
.map-photo-viewer-close,
.map-photo-viewer-nav {
	display: grid;
	place-items: center;
	position: absolute;
	border: 1px solid rgba(255, 255, 255, 0.18);
	background: rgba(15, 23, 42, 0.62);
	backdrop-filter: blur(8px);
	color: #FFF;
	transition: background var(--wiki-duration-fast, 0.15s) var(--wiki-ease-out, ease-out), transform var(--wiki-duration-fast, 0.15s) var(--wiki-ease-out, ease-out);
	cursor: pointer;
	z-index: 2;
}
.map-photo-viewer-close {
	top: max(18px, env(safe-area-inset-top));
	right: max(18px, env(safe-area-inset-right));
	width: 42px;
	height: 42px;
	border-radius: 50%;
}
.map-photo-viewer-nav {
	top: 50%;
	width: 48px;
	height: 64px;
	border-radius: 12px;
	transform: translateY(-50%);
}
.map-photo-viewer-prev { left: max(18px, env(safe-area-inset-left)); }
.map-photo-viewer-next { right: max(18px, env(safe-area-inset-right)); }
.map-photo-viewer-close:hover,
.map-photo-viewer-nav:hover { background: rgba(30, 41, 59, 0.9); }
.map-photo-viewer-nav:active { transform: translateY(-50%) scale(0.96); }
.map-photo-viewer-close:focus-visible,
.map-photo-viewer-nav:focus-visible {
	outline: 2px solid #FFF;
	outline-offset: 3px;
}
.map-photo-viewer-img {
	max-width: min(calc(100vw - 160px), 1100px);
	max-height: calc(100vh - 112px);
	border-radius: 8px;
	box-shadow: 0 18px 50px rgba(0, 0, 0, 0.4);
	object-fit: contain;
}
.map-photo-viewer-caption {
	position: absolute;
	bottom: 24px;
	left: 50%;
	margin: 0;
	font-size: 14px;
	color: rgba(255, 255, 255, 0.8);
	transform: translateX(-50%);
}

@media (max-width: 640px) {
	.map-photo-viewer { padding: 64px 12px 76px; }
	.map-photo-viewer-img {
		max-width: calc(100vw - 24px);
		max-height: calc(100vh - 140px);
	}
	.map-photo-viewer-nav {
		top: auto;
		bottom: max(18px, env(safe-area-inset-bottom));
		width: 46px;
		height: 46px;
		border-radius: 50%;
		transform: none;
	}
	.map-photo-viewer-prev { left: 18px; }
	.map-photo-viewer-next { right: 18px; }
	.map-photo-viewer-nav:active { transform: scale(0.96); }
	.map-photo-viewer-caption { bottom: max(31px, calc(env(safe-area-inset-bottom) + 13px)); }
}

/* ===== 右上角悬浮卡片组：工具卡 + 缩放卡，竖排右对齐 =====
   两张卡都浮在地图之上；缩放控件原先自己 top/right 定位，
   放进这里后交给 flex 排列（否则会与工具卡重叠） */
/* 重定位按钮 + 这组卡片在模板里同处一个 .map-bottom-right 容器：
   桌面端用 display: contents 让容器不产生盒子，两个子元素各自按原样绝对定位，
   桌面观感与「容器不存在」完全一致；小屏才让它成为右下角的一列（见 ≤1024px 媒体查询） */
.map-bottom-right {
	display: contents;
}
.map-right-stack {
	display: flex;
	flex-direction: column;
	align-items: flex-end;
	gap: 8px;
	position: absolute;
	top: 12px;
	right: 12px;
	z-index: 10;
	transition: right var(--wiki-duration-collapse, 0.2s) var(--wiki-ease-out, ease-out);
}
/* 拾取面板固定在右上角（z-index 更高），开启时把工具卡组让到它左边，
   否则「退出拾取」的按钮会被面板压住 */
.map-right-stack-shifted {
	right: calc(344px + 12px);
}
.map-tools {
	display: flex;
	align-items: center;
	gap: 4px;
	padding: 4px;
	border: 1px solid var(--c-line);
	border-radius: 12px;
	box-shadow: 0 8px 24px rgba(15, 23, 42, 0.12);
	background: var(--c-panel);
}
.map-tool-btn {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	height: 32px;
	padding: 0 10px;
	border: none;
	border-radius: 8px;
	background: transparent;
	font-size: 13px;
	font-weight: 500;
	white-space: nowrap;
	color: var(--c-icon-strong);
	transition: background-color var(--wiki-duration-fast, 0.15s) var(--wiki-ease-out, ease-out), color var(--wiki-duration-fast, 0.15s) var(--wiki-ease-out, ease-out);
	cursor: pointer;
}
.map-tool-btn:hover:not(:disabled) {
	background: var(--c-mist);
	color: var(--c-primary);
}
.map-tool-btn:disabled {
	color: var(--c-icon);
	cursor: not-allowed;
}
/* 坐标拾取入口：开启时用主色底标出来，与相邻的定位按钮区分。
   写在 hover 规则之后，保证开启状态下悬停不会被 hover 底色盖掉 */
.map-tool-btn.map-pick-entry.active {
	background: var(--c-primary-soft);
	color: var(--c-primary);
}
/* 缩放控件 */
.map-zoom-ctrl {
	display: flex;
	flex-direction: column;
	overflow: hidden;
	border: 1px solid var(--c-line);
	border-radius: 12px;
	box-shadow: 0 8px 24px rgba(15, 23, 42, 0.12);
	background: var(--c-panel);
}
.recenter-btn {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	position: absolute;
	right: 12px;
	bottom: 16px;
	height: 36px;
	padding: 0 10px;
	border: 1px solid var(--c-line);
	border-radius: 6px;
	box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
	background: var(--c-panel);
	font-size: 12px;
	font-weight: 500;
	color: var(--c-icon-strong);
	cursor: pointer;
	z-index: 10;
}
.recenter-btn:hover {
	border-color: var(--c-primary);
	color: var(--c-primary);
}
/* 桌面端不抬升重定位按钮：详情卡限宽 30rem 后，它的右边界最多到
   22rem + 24px + 30rem ≈ 856px，而按钮贴在视口右侧（≥1025px 时左边界约 933px），
   两者不会重叠——原先那个写死的 bottom: 154px 只为旧的全宽卡片服务。
   小屏整列（含本按钮与缩放/工具卡）由 .map-bottom-right 统一按详情卡高度上移 */
.zoom-btn {
	display: grid;
	place-items: center;
	width: 40px;
	height: 40px;
	border: none;
	background: transparent;
	color: var(--c-icon-strong);
	transition: background var(--wiki-duration-fast, 0.15s) var(--wiki-ease-out, ease-out);
	cursor: pointer;
}
.zoom-btn:hover:not(:disabled) {
	background: var(--c-mist);
	color: var(--c-primary);
}
.zoom-btn:disabled {
	color: var(--c-icon);
	cursor: not-allowed;
}
.zoom-divider {
	height: 1px;
	background: var(--c-line);
}

/* 选中详情卡片（右下角浮出） */
.map-detail-card {
	position: absolute;
	right: 12px;
	bottom: 16px;
	/* 左侧让开悬浮卡片：卡片 left 12px + 宽 22rem + 间隙 12px。
     不让开的话详情条会被卡片压在下面（卡片 z-index 更高） */
	left: calc(22rem + 24px);
	/* 大屏上限宽：不限宽时卡片会被拉成横贯整屏的长条——4 个导航按钮各摊到很远、
     描述排成一行，观感很散。30rem（480px）下按钮各约 110px、描述稳定折两行。
     max-width 生效时 left 胜出（超出约束会忽略 right），卡片贴近左侧栏一侧 */
	max-width: 30rem;
	padding: 12px;
	border: 1px solid var(--c-line);
	border-radius: 8px;
	box-shadow: 0 8px 24px rgba(15, 23, 42, 0.14);
	background: var(--c-elev);
	/* 上浮放大从左下角长出来：卡片贴着底边，从中心缩放会在底部露出空隙 */
	transform-origin: left bottom;
	z-index: 10;
}
/* 详情卡进出场（配合模板里的 <Transition name="detail-card">）。
   进场 220ms 上浮 + 轻微放大，出场 140ms 淡出下沉 —— 出场必须比进场短，
   读起来才像「被收走」；反过来（出场更慢）会显得拖沓、挡着地图。
   时长刻意写死而不取 --wiki-duration-collapse：这里需要一进一出两个不同值 */
.detail-card-enter-active {
	transition: opacity 0.22s var(--wiki-ease-out, ease-out), transform 0.22s var(--wiki-ease-out, ease-out);
}
.detail-card-leave-active {
	transition: opacity 0.14s ease-in, transform 0.14s ease-in;
}
.detail-card-enter-from,
.detail-card-leave-to {
	opacity: 0;
}
.detail-card-enter-from {
	transform: translateY(12px) scale(0.98);
}
.detail-card-leave-to {
	transform: translateY(6px) scale(0.99);
}
.location-error {
	margin: 8px 0 0;
	font-size: 12px;
	color: #C2410C;
}
.location-status {
	position: absolute;
	bottom: 16px;
	left: 50%;
	max-width: calc(100% - 32px);
	margin: 0;
	padding: 8px 12px;
	border: 1px solid rgba(194, 65, 12, 0.2);
	border-radius: 6px;
	box-shadow: 0 4px 16px rgba(15, 23, 42, 0.12);
	background: var(--c-elev);
	font-size: 12px;
	color: #C2410C;
	transform: translateX(-50%);
	z-index: 12;
}
.detail-head {
	display: flex;
	align-items: flex-start;
	gap: 10px;
}
.detail-icon {
	display: grid;
	flex-shrink: 0;
	place-items: center;
	width: 36px;
	height: 36px;
	border: 1px solid var(--c-primary);
	border-radius: 6px;
	background: var(--c-panel);
	color: var(--c-icon-strong);
}
.detail-info {
	flex: 1;
	min-width: 0;
	/* 换点位（:key 变了、节点重新挂载）时轻淡入一次。
	   只给 2px 位移：卡片本体没动，文字若跟着滑一大截，看起来像整张卡重开了一遍。
	   首次打开时这段动画被卡片的进出场淡入盖住，不会出现两层叠影 */
	animation: detail-swap 0.18s var(--wiki-ease-out, ease-out);
}
@keyframes detail-swap {
	from {
		opacity: 0;
		transform: translateY(2px);
	}
	to {
		opacity: 1;
		transform: none;
	}
}
.detail-name {
	margin: 0;
	font-size: 16px;
	font-weight: 600;
	line-height: 1.3;
	color: var(--c-ink);
}
/* 归属标签（校区 / 分类）：小号中性药丸，与筛选区的药丸同一套圆角语言，
   但尺寸压一档、不加交互态——它们是信息，不是可点的筛选器。
   分类色只落在 6px 圆点上，避免整枚药丸被 17 种分类色染得过于抢眼 */
.detail-meta {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 5px;
	margin-top: 6px;
}
.detail-meta-chip {
	display: inline-flex;
	align-items: center;
	gap: 4px;
	max-width: 100%;
	padding: 1px 8px;
	overflow: hidden;
	border: 1px solid var(--c-line);
	border-radius: 999px;
	background: var(--c-paper);
	font-size: 11px;
	font-weight: 500;
	line-height: 17px;
	white-space: nowrap;
	color: var(--c-muted);
}
/* 省略号必须挂在文字这一层：`text-overflow` 只对「自己包含文字」的块生效，
   挂在 inline-flex 的药丸上（文字其实是匿名 flex 项）只会硬裁、不出省略号。
   校区/分类名现在都很短，但新增长名分类时这里不该变成「莫名被切掉半截」 */
.detail-meta-text {
	overflow: hidden;
	min-width: 0;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.detail-meta-icon {
	flex-shrink: 0;
	opacity: 0.8;
}
.detail-meta-dot {
	flex-shrink: 0;
	width: 6px;
	height: 6px;
	border-radius: 50%;
	background: var(--meta-dot, var(--c-muted));
}
.detail-desc {
	display: -webkit-box;
	overflow: hidden;
	margin: 4px 0 0;
	font-size: 12px;
	-webkit-line-clamp: 2;
	line-height: 1.5;
	color: var(--c-muted);
	-webkit-box-orient: vertical;
}
.nav-btns {
	display: grid;
	grid-template-columns: repeat(4, 1fr);
	gap: 6px;
	margin-top: 10px;
}
.nav-btn {
	display: flex;
	align-items: center;
	justify-content: center;
	height: 32px;
	padding: 0 4px;
	border: 1px solid var(--c-line);
	border-radius: 6px;
	background: var(--c-paper);
	font-size: 12px;
	font-weight: 500;
	white-space: nowrap;
	text-decoration: none;
	color: var(--c-ink);
	/* 不写 transition: all —— 那会让浏览器监听该元素全部可动画属性，
     这里只需要背景 / 文字 / 描边三样；时长走令牌，reduced-motion 下自动归零 */
	transition: background-color var(--wiki-duration-fast, 0.15s) var(--wiki-ease-out, ease-out), color var(--wiki-duration-fast, 0.15s) var(--wiki-ease-out, ease-out), border-color var(--wiki-duration-fast, 0.15s) var(--wiki-ease-out, ease-out), transform var(--wiki-duration-fast, 0.15s) var(--wiki-ease-out, ease-out);
}
.nav-btn:hover {
	border-color: var(--c-primary);
	color: var(--c-primary);
}
/* 按下时整体缩一档：四个按钮并排，缺这点反馈会让人怀疑「点到了吗」 */
.nav-btn:active {
	transform: scale(0.97);
}

/* 「复制链接」：深链做好之后，界面上却没有一处告诉用户「地址栏就是这栋楼」，
   等于只有知道的人在用。放在四个导航按钮下面单独一行 —— 上面那排是
   「去别处」（高德 / 百度 / 腾讯 / Apple），这一枚是「把这里带走」。
   形态刻意与它们同款（实线 + 浅底），只把文字从墨色降到灰：层次靠颜色区分，
   不靠虚线 —— 虚线描边在浅灰卡片上几乎看不见，做了等于没做 */
.detail-copy-link {
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 5px;
	width: 100%;
	height: 30px;
	margin-top: 6px;
	border: 1px solid var(--c-line);
	border-radius: 6px;
	background: var(--c-paper);
	font-family: inherit;
	font-size: 12px;
	font-weight: 500;
	color: var(--c-muted);
	transition: color var(--wiki-duration-fast, 0.15s) var(--wiki-ease-out, ease-out), border-color var(--wiki-duration-fast, 0.15s) var(--wiki-ease-out, ease-out), background-color var(--wiki-duration-fast, 0.15s) var(--wiki-ease-out, ease-out), transform var(--wiki-duration-fast, 0.15s) var(--wiki-ease-out, ease-out);
	cursor: pointer;
}
.detail-copy-link:hover {
	border-color: var(--c-primary);
	background: var(--c-primary-faint);
	color: var(--c-primary);
}
.detail-copy-link:active {
	transform: scale(0.985);
}
.detail-copy-link:focus-visible {
	outline: 2px solid var(--c-primary);
	outline-offset: 2px;
}
/* 结果就地反馈：转品牌色实底，失败用与 .location-error 同一支橙。
   不弹 toast —— 卡片就在眼前，再飘一层提示反而是噪音 */
.detail-copy-link.is-done {
	border-color: var(--c-primary);
	background: var(--c-primary-soft);
	color: var(--c-primary);
}
.detail-copy-link.is-fail {
	border-color: rgba(194, 65, 12, 0.35);
	background: rgba(194, 65, 12, 0.06);
	color: #C2410C;
}

/* 点位关联文章入口：品牌色描边按钮，悬停实底 */
.detail-article-link {
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 6px;
	height: 36px;
	margin-top: 10px;
	border: 1px solid var(--c-primary);
	border-radius: 6px;
	background: var(--c-primary-soft);
	font-size: 13px;
	font-weight: 500;
	text-decoration: none;
	color: var(--c-primary);
	transition: background var(--wiki-duration-fast, 0.15s) var(--wiki-ease-out, ease-out), color var(--wiki-duration-fast, 0.15s) var(--wiki-ease-out, ease-out), transform var(--wiki-duration-fast, 0.15s) var(--wiki-ease-out, ease-out);
}
.detail-article-link:hover {
	background: var(--c-primary);
	color: #FFF;
}
.detail-article-link:active {
	transform: scale(0.985);
}

.sr-only {
	position: absolute;
	overflow: hidden;
	width: 1px;
	height: 1px;
	margin: -1px;
	padding: 0;
	border: 0;
	white-space: nowrap;
	clip: rect(0, 0, 0, 0);
}

/* ===== 移动端 ===== */
@media (max-width: 1024px) {
	/* 小屏不再另做抽屉与浮层按钮：同一张卡片直接浮在地图左上角（定位与桌面一致，
	   绝对定位的 top/left 是相对地图区，天然落在导航栏下方）；默认收起态由脚本
	   按断点在 onMounted 里置位 */
	.map-sidebar {
		width: min(22rem, 88vw);
	}
	/* 小屏：定位/拾取工具卡与缩放卡从右上角下移到右下角，与重定位按钮同处一列，
	   收起态卡片得以铺满左上角。
	   bottom 取「详情卡高度」与「浏览器底部工具条高度」两者的较大值：
	   详情卡出现时整列正好落在卡片上沿，浏览器工具条弹出时也不会被压住 */
	.map-bottom-right {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 8px;
		position: fixed;
		right: 8px;
		bottom: max(
			calc(16px + env(safe-area-inset-bottom) + var(--detail-card-height, 0px)),
			calc(16px + env(safe-area-inset-bottom) + var(--qut-browser-bottom-inset, 0px))
		);
		z-index: 11;
		transition: bottom var(--wiki-duration-collapse, 0.2s) var(--wiki-ease-out, ease-out);
	}
	/* 进了这层就由 flex 排布，两个子元素各自的绝对定位（含 top/right）全部失效 */
	.map-bottom-right .recenter-btn,
	.map-bottom-right .map-right-stack {
		position: static;
	}
	/* 小屏不显示缩放按钮：触屏本来就能双指捏合缩放，+/- 在手机上只是白占底部空间 */
	.map-bottom-right .map-zoom-ctrl {
		display: none;
	}
	/* 小屏没有让位的空间（面板自己就是整条右上角），拾取模式下直接收起工具卡组：
     退出靠面板自带的关闭按钮或 Shift+P */
	.map-right-stack-shifted {
		display: none;
	}
	.map-detail-card {
		position: fixed;
		right: 8px;
		bottom: calc(8px + env(safe-area-inset-bottom));
		left: 8px;
		/* 小屏要占满整行，抵消桌面端的限宽 */
		max-width: none;
	}
}

.location-dialog-backdrop {
	display: grid;
	place-items: center;
	position: fixed;
	inset: 0;
	padding: 20px;
	background: rgba(15, 23, 42, 0.45);
	z-index: 1000;
}
.location-dialog {
	width: min(360px, 100%);
	padding: 24px;
	border: 1px solid var(--c-line);
	border-radius: 12px;
	box-shadow: 0 18px 50px rgba(15, 23, 42, 0.22);
	background: var(--c-elev);
	text-align: center;
	color: var(--c-ink);
}
.location-dialog-icon {
	display: grid;
	place-items: center;
	width: 44px;
	height: 44px;
	margin: 0 auto 12px;
	border-radius: 50%;
	background: var(--c-primary-soft);
	color: var(--c-primary);
}
.location-dialog h2 {
	margin: 0;
	font-size: 18px;
}
.location-dialog p {
	margin: 10px 0 0;
	font-size: 13px;
	line-height: 1.6;
	color: var(--c-muted);
}
.location-dialog .location-countdown { font-size: 12px; }
.location-legend {
	display: flex;
	flex-direction: column;
	gap: 7px;
	margin-top: 14px;
	padding: 10px 12px;
	border-radius: 6px;
	background: var(--c-primary-faint);
	font-size: 12px;
	text-align: left;
	color: var(--c-muted);
}
.location-legend span {
	display: flex;
	align-items: center;
	gap: 7px;
}
.legend-pin {
	display: inline-block;
	flex: 0 0 auto;
	width: 10px;
	height: 10px;
	border: 1px solid #FFF;
	border-radius: 50% 50% 50% 0;
	box-shadow: 0 1px 2px rgb(15 23 42 / 0.25);
	transform: rotate(-45deg);
}
.legend-pin-user { background: #E53935; }
/* 图例里的「彩色」用一小段多色渐变表示，比单一色更能说明标点按分类着色 */
.legend-pin-place {
	background: linear-gradient(135deg, #3B82F6 0%, #10B981 45%, #F59E0B 75%, #EC4899 100%);
}
.location-confirm, .location-cancel {
	width: 100%;
	height: 36px;
	margin-top: 18px;
	border-radius: 6px;
	font-size: 13px;
	cursor: pointer;
}
.location-confirm {
	border: 1px solid var(--c-primary);
	background: var(--c-primary);
	color: #FFF;
}
.location-confirm:disabled {
	opacity: 0.55;
	cursor: not-allowed;
}
.location-cancel {
	margin-top: 8px;
	border: none;
	background: transparent;
	color: var(--c-muted);
}

/* ===== 减少动态偏好 =====
   组件里绝大多数过渡 / 动画的时长都走 --wiki-duration* 令牌（站点主题已在
   reduced-motion 下把它归零，这里再就地补一份，组件被单独引用时也成立）：
   令牌一改，药丸、折叠、标点缩放、卡片进场会一起停。
   高德自己的缩放 / 平移是 JS 驱动的，不受这里影响 —— 那是地图的语义动作，
   不该由我们擅自关掉（关掉会让人以为地图卡住） */
@media (prefers-reduced-motion: reduce) {
	.map-section {
		--wiki-duration-fast: 0.01ms;
		--wiki-duration: 0.01ms;
		--wiki-duration-collapse: 0.01ms;
		--wiki-duration-slow: 0.01ms;
	}
	/* 这两处时长是按「进慢出快」写死的（卡片 220/140ms、查看器 180ms），没走令牌，单独收 */
	.detail-card-enter-active,
	.detail-card-leave-active,
	.viewer-enter-active,
	.viewer-leave-active,
	.viewer-enter-active .map-photo-viewer-img,
	.detail-info {
		animation: none;
		transition: none;
	}
}
</style>

<style>
/* ===== 全局（非 scoped）：高德 marker 内部样式 ===== */
/* 压低下高德版权/logo 层级，避免盖住侧边栏等 UI */
.map-section .amap-copyright,
.map-section .amap-logo {
	z-index: 5 !important;
}

/* ===== 双层底图（校外 POI 衬底）=====
   这一段必须放在非 scoped 样式里：.amap-container / .amap-logo /
   .amap-copyright 都是高德 SDK 自己创建的节点，身上没有本组件的 data-v
   属性，写成 scoped 会匹配不到（踩过：改了没反应，像素完全没变）。 */

/* 主地图这层要透明：setMask 挖掉的区域看到的是它自己的底色，
   不透掉的话衬底层永远露不出来 */
.map-el:not(.map-el-poi),
.map-el:not(.map-el-poi) .amap-container {
	background: transparent !important;
}
/* 衬底层也会画一份 logo 与版权，两层叠在同一位置就是重影。
   只留主地图那一份——它固定在左下角，不随侧栏收展移动 */
.map-el-poi .amap-logo,
.map-el-poi .amap-copyright {
	display: none !important;
}

/* 高德 logo 与版权信息保持高德自己的位置（地图左下角）：
   不给它们加任何位移。曾经按侧栏展开状态把两者整体右移到卡片外侧，
   结果是收/展一次水印就跳一次，反而更闹眼。 */


.qut-pin-root {
	display: flex;
	align-items: flex-end;
	justify-content: center;
	position: relative;
	width: 28px;
	height: 28px;
	cursor: pointer;
	user-select: none;
	-webkit-tap-highlight-color: transparent;
}
.qut-pin-root [data-map-pin-body] {
	position: relative;
	width: 28px;
	height: 28px;
	transform-origin: bottom center;
	transition: transform var(--wiki-duration, 0.2s) var(--wiki-ease-out, ease-out);
	will-change: transform;
}
.qut-pin-root > [data-map-pin-body] > svg {
	position: absolute;
	inset: 0;
	width: 28px;
	height: 28px;
}
.qut-pin-root > [data-map-pin-body] > span {
	pointer-events: none;
}

/* 名称标签溢出在 28×28 的 content 之外，显式声明不裁剪：
   万一高德的 .amap-marker 容器带了 overflow 规则，标签会在标点下方被切掉。
   （overflow 默认就是 visible，这里只是把前提写死，不依赖第三方样式） */
.amap-marker {
	overflow: visible;
}

/* 标点下方的常驻名称标签：对齐高德/百度地图「标点 + 名称」的观感。
   absolute 定位（见 createMarkerPin 注释）让 content 容器保持 28×28、锚点不漂移；
   白底胶囊在亮/暗两种底图上都清晰，故不跟随站点主题变色 */
.qut-pin-label {
	position: absolute;
	top: calc(100% + 3px);
	left: 50%;
	transform: translateX(-50%);
	max-width: 9rem;
	overflow: hidden;
	padding: 2px 7px;
	border: 1px solid rgb(15 23 42 / 0.07);
	border-radius: 999px;
	background: rgb(255 255 255 / 0.94);
	box-shadow: 0 1px 2px rgb(15 23 42 / 0.16);
	font-size: 12px;
	font-weight: 500;
	line-height: 16px;
	color: #1F2937;
	white-space: nowrap;
	text-overflow: ellipsis;
	pointer-events: none;
}

/* 标点放大时标签不变形，只把字重提一档，避免选中后标签被忽略 */
.qut-pin-root > [data-map-pin-body][data-selected="true"] ~ .qut-pin-label {
	font-weight: 600;
}

/* ===== 档位 1 的校区标点 =====
   尺寸（44px）与脚本里的 CAMPUS_PIN_SIZE 是对应关系：marker 的 offset 按
   那个常量算锚点，只改这里的宽高会让水滴的尖不再对准坐标。 */
.qut-campus-pin,
.qut-campus-pin > [data-map-pin-body] {
	width: 44px;
	height: 44px;
}
.qut-campus-pin > [data-map-pin-body] > svg {
	width: 44px;
	height: 44px;
}
/* 它没有选中态（不参与点位选择），缩放只交给 :hover —— 脚本里千万别给它
   写 inline transform，那会把这条规则盖掉 */
.qut-campus-pin > [data-map-pin-body]:hover {
	transform: scale(1.06);
}

/* 校区名要顶替「一片标点的名字」，字号与字重都比普通标签高一档；
   位置比普通标签再低 3px，让水滴的尖露出来（它是区域，不是某个点） */
.qut-campus-pin .qut-campus-pin-label {
	top: calc(100% + 6px);
	padding: 3px 10px;
	border-color: rgb(113 26 95 / 0.32);
	box-shadow: 0 2px 6px rgb(15 23 42 / 0.22);
	font-size: 13px;
	font-weight: 600;
}

/* 两个校区同时在图上：当前校区是主角，另一个轻一档。
   缩得很小的时候两个都能看到，光靠 zIndex 分不出主次（那是叠放顺序，
   不挨着就看不出差别），得让颜色也退半步。 */
.qut-campus-pin:not(.is-current) > [data-map-pin-body] {
	opacity: 0.62;
}
.qut-campus-pin:not(.is-current) .qut-campus-pin-label {
	font-weight: 500;
	opacity: 0.86;
}

/* 窄屏地图本身拥挤，标签收窄一档，尽量少盖住相邻标点 */
@media (max-width: 48rem) {
	.qut-pin-label {
		max-width: 6rem;
		font-size: 11px;
	}
}
.qut-location-marker {
	width: 28px;
	height: 28px;
	filter: drop-shadow(0 1px 2px rgb(15 23 42 / 0.2));
}

/* 拾取模式的坐标标记：与分类标点区分开——品牌紫圆点 + 白环。
   刻意不做脉冲动画：这是维护时才出现的临时标记，不值得为它加常驻动画 */
.map-pick-marker {
	width: 14px;
	height: 14px;
	border: 2px solid #fff;
	border-radius: 50%;
	background: #711A5F;
	box-shadow: 0 0 0 2px rgb(113 26 95 / 0.4), 0 1px 4px rgb(15 23 42 / 0.3);
}
</style>
