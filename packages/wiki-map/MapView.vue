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

const props = defineProps({
	/** 地图数据对象，导出字段与 map-data.example.js 一致 */
	data: { type: Object, required: true },
})

/* 与数据文件的导出同名解构：正文代码与「数据内联在包里」的旧版完全一致 */
const {
	BUILDINGS,
	CAMPUS_CONFIG,
	CATEGORY_CONFIG,
	CATEGORY_GROUPS,
	CATEGORY_ICON_PATHS,
	AMAP_KEY,
	AMAP_SECURITY_JS_CODE,
	MAP_DISPLAY,
} = props.data

const PIN_SIZE = 28
const PIN_SCALE = { idle: 1, hover: 1.3, selected: 1.4 }
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
let map = null
let AMap = null
const mapReady = ref(false)
const mapError = ref('')

const currentCampus = ref('n')
const currentCategory = ref('all')
/** 当前展开细类行的分组 key（null = 不展开细类行） */
const activeGroup = ref(null)
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

const markerCache = new Map()
let polygonsRef = null
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

const campusBuildings = computed(() =>
	BUILDINGS.filter(b => b.campusId === currentCampus.value),
)

const filteredBuildings = computed(() => {
	const kw = searchKeyword.value.trim().toLowerCase()
	const matched = kw ? buildingSearch(kw) : null
	/* currentCategory 可为 'all' / 分组 key / 细类 key：
	   分组 → 该组下所有细类的并集；细类 → 精确匹配；全部 → 不过滤 */
	const cat = currentCategory.value
	const isGroup = !!CATEGORY_GROUPS[cat]
	return campusBuildings.value.filter((b) => {
		if (cat !== 'all') {
			if (isGroup) {
				if ((CATEGORY_CONFIG[b.category] || {}).group !== cat)
					return false
			} else if (b.category !== cat) {
				return false
			}
		}
		if (matched && !matched.has(b.id))
			return false
		return true
	})
})

/* 筛选后仍保留选中的建筑 */
const markerBuildings = computed(() => {
	const list = filteredBuildings.value
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

function onViewerKeydown(event) {
	if (!photoViewer.value)
		return
	if (event.key === 'Escape')
		closePhotoViewer()
	else if (event.key === 'ArrowLeft')
		changeViewerPhoto(-1)
	else if (event.key === 'ArrowRight')
		changeViewerPhoto(1)
	else return
	event.preventDefault()
}

/* ================= 校区建筑边界多边形（GCJ02，可选）
 * 用高德坐标拾取器描出校区范围轮廓后填入，如：
 * POLYGONS.h = [[[120.20, 35.97], [120.21, 35.97], ...]]
 * 暂无数据时留空，不影响地图使用。
 * ================= */
const POLYGONS = {
	n: [],
	j: [],
}

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
function initMap() {
	const campus = CAMPUS_CONFIG[currentCampus.value]
	/* 底图要素：point 就是高德下发的 POI 点（某某楼、某店铺这类建筑名），
	   与我们自己标注的点位重名且打架，默认关掉，只留底色/道路/建筑轮廓。
	   showLabel 单独管文字标注（道路名、行政区名），关掉连路名一起没。
	   两者都由站点侧 MAP_DISPLAY 控制，未配置时用下面的默认值。 */
	const display = MAP_DISPLAY || {}
	const features = display.showPoi === true
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
	/* 高德地图点击：拾取模式下取坐标。注意与点位标点的 click 不冲突——
	   标点自带 click 监听（选中），点标点时事件不会冒泡到地图 click */
	map.on('click', onMapPickClick)
	/* 传 currentCampus 的 key 而不是 campus.id：数据条目里的 id 字段是可选的
	   （示例数据就没有），POLYGONS 与 campusId 都按对象的 key 引用 */
	renderPolygons(currentCampus.value)
	mapReady.value = true
}

function renderPolygons(campusId) {
	if (polygonsRef) {
		try { map.remove(polygonsRef) }
		catch (e) { /* noop */ }
		polygonsRef = null
	}
	const paths = (POLYGONS[campusId] || [])
	if (!paths.length || !map)
		return
	polygonsRef = paths.map(path =>
		new AMap.Polygon({
			path,
			fillColor: '#4069B2',
			fillOpacity: 0.08,
			strokeColor: '#4069B2',
			strokeOpacity: 0.8,
			strokeStyle: 'dashed',
			strokeWeight: 2,
			zIndex: 2,
		}),
	)
	map.add(polygonsRef)
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

function renderMarkers() {
	if (!map || !AMap)
		return
	const list = markerBuildings.value
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
		for (const [id, entry] of markerCache) {
			const isSelected = id === b.id
			applyPinState(entry.root, isSelected)
			entry.marker.setzIndex(isSelected ? 120 : 10)
		}
		hoverTip.value = null
		map.panTo(b.coord)
	}
	/* 小屏选完点位就收起列表：卡片给地图让位，底部详情卡才露得出来 */
	if (isMobileViewport())
		sidebarCollapsed.value = true
}

function clearSelection() {
	closePhotoViewer()
	selected.value = null
	for (const [, entry] of markerCache) {
		applyPinState(entry.root, false)
		entry.marker.setzIndex(10)
	}
}

/** 切换校区（接校区 id，不是事件对象——拾取面板也要复用） */
function selectCampus(next) {
	if (next === currentCampus.value)
		return
	currentCampus.value = next
	selected.value = null
	currentCategory.value = 'all'
	activeGroup.value = null
	searchKeyword.value = ''
	/* 悬浮提示也要清：指针不动（键盘切校区）时不会触发 marker mouseout，
	   残留的提示会按旧校区坐标继续定位、还跟着地图飘 */
	clearHoverCloseTimer()
	hoverTip.value = null
	if (map) {
		const c = CAMPUS_CONFIG[next]
		map.setZoomAndCenter(c.zoom, c.coord)
		clearMarkerCache()
		renderPolygons(next)
		renderMarkers()
	}
}

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
	const t = e.target
	const editing = t instanceof HTMLElement
		&& (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')
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
}

/* 分类筛选：两级（分组 → 细类）。currentCategory 可为 'all' / 分组 key / 细类 key，
   activeGroup 记录当前展开细类行的分组；分组与细类共用 CATEGORY_CONFIG 的配色。 */

/** 全部：清空分组与细类筛选 */
function selectAll() {
	currentCategory.value = 'all'
	activeGroup.value = null
	renderMarkers()
}

/** 取某分组下的细类列表（按 CATEGORY_CONFIG 声明顺序） */
function leavesOf(groupKey) {
	return Object.entries(CATEGORY_CONFIG)
		.filter(([, cfg]) => cfg.group === groupKey)
		.map(([key, cfg]) => ({ key, label: cfg.label }))
}

/** 分组标题文字（无障碍标签用） */
function groupLabel(key) {
	return (CATEGORY_GROUPS[key] || {}).label || ''
}

/** 点分组药丸：展开它的细类行并筛选到该组并集；单细类分组直接选中细类；
    再次点已激活的分组则收起回全部 */
function toggleGroup(key) {
	if (currentCategory.value === key) {
		selectAll()
		return
	}
	const leaves = leavesOf(key)
	if (leaves.length === 1) {
		selectLeaf(leaves[0].key)
		return
	}
	currentCategory.value = key
	activeGroup.value = key
	renderMarkers()
}

/** 点细类药丸：精确筛选到该细类，并保持其所属分组展开 */
function selectLeaf(key) {
	currentCategory.value = key
	activeGroup.value = (CATEGORY_CONFIG[key] || {}).group || null
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
	document.addEventListener('keydown', onViewerKeydown)
	document.addEventListener('keydown', onPickHotkey)
	bindCategoryChips()
	startVisualViewportObserver()
	initPickMode()
})

onUnmounted(() => {
	document.removeEventListener('keydown', onViewerKeydown)
	document.removeEventListener('keydown', onPickHotkey)
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

			<!-- 分类筛选：两级（分组 → 细类），交互结构参考上海交大电子地图。
			     第一行是 8 个分组药丸（带色点），点开后在第二行展开该组的细类药丸；
			     单细类分组（食堂/宿舍/体育/生活服务/景观）点一下即直达细类。 -->
			<div class="category-filter">
				<div
					ref="categoryChipsEl"
					class="category-chips group-row"
					role="group"
					aria-label="地点分类（分组）"
				>
					<button
						type="button"
						class="category-chip group-chip"
						:class="{ active: currentCategory === 'all' }"
						:aria-pressed="currentCategory === 'all'"
						@click="selectAll"
					>
						全部
					</button>
					<button
						v-for="(g, gk) in CATEGORY_GROUPS"
						:key="gk"
						type="button"
						class="category-chip group-chip"
						:class="{ active: currentCategory === gk }"
						:aria-pressed="currentCategory === gk"
						@click="toggleGroup(gk)"
					>
						<span class="chip-dot" :style="{ '--chip-dot': g.color }" />
						{{ g.label }}
					</button>
				</div>
				<div
					v-if="activeGroup && leavesOf(activeGroup).length > 1"
					class="category-chips leaf-row"
					role="group"
					:aria-label="`${groupLabel(activeGroup)}的子分类`"
				>
					<button
						v-for="leaf in leavesOf(activeGroup)"
						:key="leaf.key"
						type="button"
						class="category-chip leaf-chip"
						:class="{ active: currentCategory === leaf.key }"
						:aria-pressed="currentCategory === leaf.key"
						@click="selectLeaf(leaf.key)"
					>
						<span class="chip-dot" :style="{ '--chip-dot': categoryColor(leaf.key) }" />
						{{ leaf.label }}
					</button>
				</div>
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
			<div ref="mapEl" class="map-el" />

			<!-- 坐标拾取面板：URL 带 ?pick=1 时出现，用于维护 map-data.js -->
			<MapPickPanel
				v-if="pickMode"
				:coord="pickedCoord"
				:buildings="BUILDINGS"
				:categories="CATEGORY_CONFIG"
				:groups="CATEGORY_GROUPS"
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
				<img v-if="buildingPhotos(hoverTip.building)[0]" :src="buildingPhotos(hoverTip.building)[0]" alt="" class="hover-img">
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

			<!-- 选中地点详情卡片（右下角） -->
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
						<img v-if="selectedPhotos.length > 1" :src="selectedPhotos[1]" alt="" class="detail-photo detail-photo-back">
						<img :src="selectedPhotos[0]" alt="" class="detail-photo detail-photo-front">
						<span v-if="selectedPhotos.length > 1" class="detail-photo-count">{{ selectedPhotos.length }}</span>
					</button>
					<span
						class="detail-icon"
						:style="{ color: categoryColor(selected.category), borderColor: categoryColor(selected.category) }"
						v-html="categoryIconMarkup(selected.category, 15)"
					/>
					<div class="detail-info">
						<h2 class="detail-name">
							{{ selected.name }}
						</h2>
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
			</section>
		</div>
	</div>
	<div v-if="locationDialogOpen" ref="locationDialogBackdrop" class="location-dialog-backdrop" role="presentation">
		<section class="location-dialog" role="dialog" aria-modal="true" aria-labelledby="location-dialog-title">
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
		<div
			v-if="photoViewer && currentViewerPhoto"
			class="map-photo-viewer"
			role="dialog"
			aria-modal="true"
			:aria-label="`${selected?.name || '地点'}图片查看器`"
			@click="closePhotoViewer"
		>
			<button class="map-photo-viewer-close" type="button" aria-label="关闭图片查看器" @click.stop="closePhotoViewer">
				<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
			</button>
			<button v-if="selectedPhotos.length > 1" class="map-photo-viewer-nav map-photo-viewer-prev" type="button" aria-label="上一张图片" @click.stop="changeViewerPhoto(-1)">
				<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6" /></svg>
			</button>
			<img :src="currentViewerPhoto" :alt="`${selected?.name || '地点'}第 ${photoViewerIndex + 1} 张图片`" class="map-photo-viewer-img" @click.stop>
			<button v-if="selectedPhotos.length > 1" class="map-photo-viewer-nav map-photo-viewer-next" type="button" aria-label="下一张图片" @click.stop="changeViewerPhoto(1)">
				<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6" /></svg>
			</button>
			<p v-if="selected?.name" class="map-photo-viewer-caption">
				{{ selected.name }}<span v-if="selectedPhotos.length > 1"> · {{ photoViewerIndex + 1 }} / {{ selectedPhotos.length }}</span>
			</p>
		</div>
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
     展开时内容比上限高，实际高度仍等于 max-height，与原来一致 */
	max-height: calc(100% - 24px);
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
}
.icon-btn:hover {
	background: var(--c-mist);
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

/* 两级筛选容器：分组行在上，可选的细类行在下（参考上海交大电子地图） */
.category-filter {
	display: flex;
	flex-direction: column;
	gap: 6px;
}
/* 细类行：点位少，换行即可，不必横向滚动/拖动 */
.category-chips.leaf-row {
	flex-wrap: wrap;
	overflow: visible;
	cursor: default;
}
.category-chip.leaf-chip {
	height: 24px;
	padding: 0 10px;
	font-size: 12px;
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
}
.map-el {
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
	animation: detail-in var(--wiki-duration-collapse, 0.2s) var(--wiki-ease-out, ease-out);
	z-index: 10;
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
@keyframes detail-in {
	from {
		opacity: 0;
		transform: translateY(8px);
	}
	to {
		opacity: 1;
		transform: translateY(0);
	}
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
}
.detail-name {
	margin: 0;
	font-size: 16px;
	font-weight: 600;
	line-height: 1.3;
	color: var(--c-ink);
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
	transition: background-color var(--wiki-duration-fast, 0.15s) var(--wiki-ease-out, ease-out), color var(--wiki-duration-fast, 0.15s) var(--wiki-ease-out, ease-out), border-color var(--wiki-duration-fast, 0.15s) var(--wiki-ease-out, ease-out);
}
.nav-btn:hover {
	border-color: var(--c-primary);
	color: var(--c-primary);
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
	transition: background var(--wiki-duration-fast, 0.15s) var(--wiki-ease-out, ease-out), color var(--wiki-duration-fast, 0.15s) var(--wiki-ease-out, ease-out);
}
.detail-article-link:hover {
	background: var(--c-primary);
	color: #FFF;
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
</style>

<style>
/* ===== 全局（非 scoped）：高德 marker 内部样式 ===== */
/* 压低下高德版权/logo 层级，避免盖住侧边栏等 UI */
.map-section .amap-copyright,
.map-section .amap-logo {
	z-index: 5 !important;
}

/* 高德 logo 与版权信息默认贴地图左下角，而左下角现在被悬浮卡片占着——
   卡片把整块压住、只在左侧露出一条边，看着像被裁了一半。
   桌面端把两者整体右移到卡片外侧（用 translateX 平移，两者之间的相对位置
   原样保留，不去猜高德各版本的 left 值）；卡片收起时左下角是空的，就不用让。
   小屏卡片更窄、且默认收起，同样保持原位。 */
@media (min-width: 1025px) {
	.map-section:not(.map-section-collapsed) .amap-logo,
	.map-section:not(.map-section-collapsed) .amap-copyright {
		transform: translateX(calc(22rem + 24px));
	}
}

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
