<script setup>
/**
 * 校园地图（NKU Maps）：组件与样式完全取自 QUT-WiKi 的 MapView（青岛理工大学 Wiki），
 * 仅做三处适配：高德 Key 换为 CQUMAPS 内置的一组；导航外链来源参数改为 NKUwiki；
 * 校区轮廓数据的键换为南开校区。点位数据来自 CQUMAPS-1.0，见同目录 map-data.js。
 */
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import {
  BUILDINGS,
  CATEGORY_CONFIG,
  CATEGORY_ICON_PATHS,
  CAMPUS_CONFIG,
  FILTER_LIST
} from './map-data.js'

/* 高德地图 Web 端 JS API key（lbs.amap.com 控制台申请，应用类型：Web端(JS API)） */
const AMAP_KEY = 'fe37a7d989ade35c41747b9165b565be'

const PIN_SIZE = 28
const PIN_SCALE = { idle: 1, hover: 1.3, selected: 1.4 }
const FIRST_PAINT_TIMEOUT_MS = 2500
/* 高德官方内置样式：normal 标准 / dark 夜间 */
const MAP_STYLES = { light: 'amap://styles/normal', dark: 'amap://styles/dark' }

/* ================= 状态 ================= */
const mapEl = ref(null)
let map = null
let AMap = null
const mapReady = ref(false)
const mapError = ref('')

const currentCampus = ref('n')
const currentCategory = ref('all')
const searchKeyword = ref('')
const sidebarOpen = ref(false)
const selected = ref(null)
const hoverTip = ref(null)
const locationDialogOpen = ref(false)
const locationDialogBackdrop = ref(null)
const locating = ref(false)
const locationError = ref('')
const routeSummary = ref(null)
const locationReady = ref(false)
const detailPosition = ref(null)
const detailCardEl = ref(null)
const detailCardHeight = ref(0)
const photoViewer = ref(false)
const photoViewerIndex = ref(0)

let markerCache = new Map()
let polygonsRef = null
let locationMarker = null
let routeLine = null
let locationWatchId = null
let searchTimer = null
let hoverCloseTimer = null
let destroyFlag = false
let visualViewport = null
let detailResizeObserver = null

/* ================= 派生数据 ================= */
const campusBuildings = computed(() =>
  BUILDINGS.filter((b) => b.campusId === currentCampus.value)
)

const filteredBuildings = computed(() => {
  const kw = searchKeyword.value.trim().toLowerCase()
  return campusBuildings.value.filter((b) => {
    if (currentCategory.value !== 'all' && b.category !== currentCategory.value) return false
    if (kw) {
      const hay = (b.name + ' ' + (b.desc || '')).toLowerCase()
      if (!hay.includes(kw)) return false
    }
    return true
  })
})

/* 筛选后仍保留选中的建筑 */
const markerBuildings = computed(() => {
  const list = filteredBuildings.value
  if (!selected.value || list.some((b) => b.id === selected.value.id)) return list
  return [...list, selected.value]
})

const campusName = computed(() => CAMPUS_CONFIG[currentCampus.value]?.name || '')
const selectedPhotos = computed(() => buildingPhotos(selected.value))
const currentViewerPhoto = computed(() => selectedPhotos.value[photoViewerIndex.value] || '')
const isDark = () => document.documentElement.classList.contains('dark')

function buildingPhotos(building) {
  if (!building) return []
  const photos = Array.isArray(building.photos) ? building.photos.filter(Boolean) : []
  return photos.length ? photos : (building.photo ? [building.photo] : [])
}

function openPhotoViewer(index = 0) {
  if (!selectedPhotos.value.length) return
  photoViewerIndex.value = index
  photoViewer.value = true
}

function closePhotoViewer() {
  photoViewer.value = false
}

function changeViewerPhoto(step) {
  const count = selectedPhotos.value.length
  if (count < 2) return
  photoViewerIndex.value = (photoViewerIndex.value + step + count) % count
}

function onViewerKeydown(event) {
  if (!photoViewer.value) return
  if (event.key === 'Escape') closePhotoViewer()
  else if (event.key === 'ArrowLeft') changeViewerPhoto(-1)
  else if (event.key === 'ArrowRight') changeViewerPhoto(1)
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
  j: []
}

/* ================= 高德地图加载 ================= */
function loadAMap() {
  return new Promise((resolve, reject) => {
    if (window.AMap) return resolve(window.AMap)
    /* 2021 年后申请的 key 需要安全密钥，必须在 SDK 脚本加载前设置 */
    window._AMapSecurityConfig = {
      securityJsCode: 'acc16e636d7724ddb9da843854da04e4'
    }
    window.__NKUMapReady = () => {
      if (window.AMap) resolve(window.AMap)
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

/* ================= 坐标转换（仅外链导航用） ================= */
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

function escapeHtml(str) {
  if (str == null) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
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
    { id: 'apple', label: 'Apple', href: `https://maps.apple.com/?ll=${wgsLat},${wgsLng}&q=${name}` }
  ]
}

function loadAMapPlugins(names) {
  return new Promise((resolve, reject) => {
    AMap.plugin(names, () => resolve())
    setTimeout(() => reject(new Error('高德地图定位或路线插件加载超时')), 10000)
  })
}

function formatDistance(meters) {
  if (meters < 1000) return `${Math.round(meters)} 米`
  return `${(meters / 1000).toFixed(1)} 公里`
}

function clearRoute() {
  if (routeLine && map) {
    try { map.remove(routeLine) } catch (e) { /* noop */ }
  }
  routeLine = null
  routeSummary.value = null
}

function drawRoute(result) {
  const route = result?.routes?.[0]
  const path = route?.steps?.flatMap((step) => step.path || []) || []
  if (!route || !path.length || !map) {
    routeSummary.value = null
    locationError.value = '没有找到可用的步行路线，请稍后重试。'
    return
  }
  clearRoute()
  routeLine = new AMap.Polyline({
    path,
    strokeColor: '#1677ff',
    strokeWeight: 6,
    strokeOpacity: 0.85,
    lineJoin: 'round',
    lineCap: 'round',
    zIndex: 40
  })
  map.add(routeLine)
  routeSummary.value = {
    distance: formatDistance(route.distance),
    duration: route.time ? `${Math.max(1, Math.round(route.time / 60))} 分钟` : ''
  }
  map.setFitView([routeLine, locationMarker].filter(Boolean), false, [60, 110, 170, 60])
}

function routeToSelected() {
  if (!locationReady.value || !selected.value || !map) return
  locationError.value = ''
  const walking = new AMap.Walking({ map: null, autoFitView: false })
  walking.search(locationMarker.getPosition(), selected.value.coord, (status, result) => {
    if (destroyFlag) return
    if (status === 'complete') drawRoute(result)
    else locationError.value = '路线规划失败，请检查网络后重试。'
  })
}

function updateLocation(position) {
  if (destroyFlag || !map || !AMap || !position) return
  locationReady.value = true
  if (locationMarker) {
    locationMarker.setPosition(position)
  } else {
    locationMarker = new AMap.Marker({
      position,
      content: '<div class="qut-location-marker" aria-label="我的位置"><svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2c-3.87 0-7 3.13-7 7 0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7Z" fill="#e53935" stroke="rgba(255,255,255,0.9)" stroke-width="1" stroke-linejoin="round"/><circle cx="12" cy="8" r="2" fill="#fff"/><path d="M8.5 15.5c.35-2.1 1.65-3.5 3.5-3.5s3.15 1.4 3.5 3.5" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round"/></svg></div>',
      offset: new AMap.Pixel(-14, -28),
      zIndex: 100
    })
    map.add(locationMarker)
  }
  if (selected.value) routeToSelected()
}

function recenterLocation() {
  if (!map || !locationMarker) return
  map.setCenter(locationMarker.getPosition())
}

function syncDetailPosition() {
  if (!map || !selected.value || !window.matchMedia('(max-width: 1024px)').matches) {
    detailPosition.value = null
    return
  }
  const { x, y } = map.lngLatToContainer(selected.value.coord)
  const mapWidth = mapEl.value?.clientWidth || 0
  detailPosition.value = {
    x: Math.max(170, Math.min(mapWidth - 170, x)),
    y: Math.max(12, y - PIN_SIZE)
  }
}

function onBrowserLocation(position) {
  const [lng, lat] = [position.coords.longitude, position.coords.latitude]
  // 浏览器返回 WGS84，高德地图底图使用 GCJ02。
  AMap.convertFrom([lng, lat], 'gps', (status, result) => {
    if (destroyFlag || status !== 'complete' || !result?.locations?.[0]) return
    const wasReady = locationReady.value
    locationError.value = ''
    updateLocation(result.locations[0])
    if (!wasReady) map.setCenter(result.locations[0])
  })
}

function onBrowserLocationError() {
  locating.value = false
  if (!locationReady.value) locationError.value = '无法获取当前位置，请检查浏览器的位置权限后重试。'
}

function finishLocationRequest() {
  locationDialogOpen.value = false
  // Hide the permission explainer synchronously. Edge rejects permission
  // requests while a full-screen overlay is still visually present.
  if (locationDialogBackdrop.value) locationDialogBackdrop.value.style.display = 'none'
  if (!map || !AMap || !navigator.geolocation) {
    locationError.value = '当前浏览器不支持定位功能。'
    return
  }
  if (locationWatchId != null) navigator.geolocation.clearWatch(locationWatchId)
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
        { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
      )
    },
    onBrowserLocationError,
    { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
  )
}

function requestLocation() {
  if (locationDialogOpen.value || locating.value) return
  locationDialogOpen.value = true
}

function cancelLocationRequest() {
  locationDialogOpen.value = false
}

function updateBrowserBottomInset() {
  if (!window.visualViewport) return
  const viewport = window.visualViewport
  const visibleBottom = viewport.offsetTop + viewport.height
  const browserInset = Math.max(0, window.innerHeight - visibleBottom)
  document.documentElement.style.setProperty('--qut-browser-bottom-inset', `${browserInset}px`)
}

function startVisualViewportObserver() {
  visualViewport = window.visualViewport
  if (!visualViewport) return
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
  if (!building) return
  await nextTick()
  if (!detailCardEl.value) return
  detailCardHeight.value = detailCardEl.value.offsetHeight
  detailResizeObserver = new ResizeObserver(([entry]) => {
    detailCardHeight.value = entry.borderBoxSize?.[0]?.blockSize || entry.contentRect.height
  })
  detailResizeObserver.observe(detailCardEl.value)
})

/* ================= 地图初始化 ================= */
function initMap() {
  const campus = CAMPUS_CONFIG[currentCampus.value]
  map = new AMap.Map(mapEl.value, {
    center: campus.coord,
    zoom: campus.zoom,
    mapStyle: MAP_STYLES[isDark() ? 'dark' : 'light'],
    viewMode: '2D',
    scrollWheel: true
  })
  map.on('mapmove', syncDetailPosition)
  map.on('zoomchange', syncDetailPosition)
  renderPolygons(campus.id)
  mapReady.value = true
}

function renderPolygons(campusId) {
  if (polygonsRef) {
    try { map.remove(polygonsRef) } catch (e) { /* noop */ }
    polygonsRef = null
  }
  const paths = (POLYGONS[campusId] || [])
  if (!paths.length || !map) return
  polygonsRef = paths.map((path) =>
    new AMap.Polygon({
      path,
      fillColor: '#4069B2',
      fillOpacity: 0.08,
      strokeColor: '#4069B2',
      strokeOpacity: 0.8,
      strokeStyle: 'dashed',
      strokeWeight: 2,
      zIndex: 2
    })
  )
  map.add(polygonsRef)
}

/* ================= marker（缓存 + 增量更新） ================= */
function markerPinMarkup(category) {
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" aria-hidden="true" style="display:block;filter:drop-shadow(0 1px 2px rgb(15 23 42 / .2))">' +
    '<path d="M12 2c-3.87 0-7 3.13-7 7 0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7Z" fill="var(--c-primary)" stroke="rgba(255,255,255,0.9)" stroke-width="1" stroke-linejoin="round" style="transition:fill 160ms ease"/></svg>' +
    '<span style="position:absolute;left:50%;top:38%;transform:translate(-50%,-50%);color:#fff;display:grid;place-items:center">' +
    categoryIconMarkup(category, 11) +
    '</span>'
  )
}

function applyPinState(root, selectedFlag) {
  const body = root.querySelector('[data-map-pin-body]')
  if (!body) return
  body.dataset.selected = selectedFlag ? 'true' : 'false'
  body.style.transform = `scale(${selectedFlag ? PIN_SCALE.selected : PIN_SCALE.idle})`
  const pin = body.querySelector('svg path')
  if (pin) pin.style.fill = selectedFlag ? 'var(--c-primary-hover)' : 'var(--c-primary)'
}

function applyPinHover(root, hovered) {
  const body = root.querySelector('[data-map-pin-body]')
  if (!body) return
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
  body.style.transform = `scale(${selectedFlag ? PIN_SCALE.selected : PIN_SCALE.idle})`
  body.innerHTML = markerPinMarkup(building.category)

  root.appendChild(body)
  return root
}

function renderMarkers() {
  if (!map || !AMap) return
  const list = markerBuildings.value
  const visibleIds = new Set(list.map((b) => b.id))

  for (const [id, entry] of markerCache) {
    if (visibleIds.has(id)) continue
    entry.marker.off('click', entry.listeners.click)
    entry.marker.off('mouseover', entry.listeners.mouseover)
    entry.marker.off('mouseout', entry.listeners.mouseout)
    map.remove(entry.marker)
    markerCache.delete(id)
    if (hoverTip.value?.building.id === id) hoverTip.value = null
  }

  for (const b of list) {
    if (markerCache.has(b.id)) {
      applyPinState(markerCache.get(b.id).root, b.id === selected.value?.id)
      continue
    }
    const root = createMarkerPin(b, b.id === selected.value?.id)
    const marker = new AMap.Marker({
      position: b.coord,
      content: root,
      offset: new AMap.Pixel(-PIN_SIZE / 2, -PIN_SIZE),
      zIndex: b.id === selected.value?.id ? 120 : 10
    })
    const listeners = {
      click: () => onSelect(b),
      mouseover: () => showHoverTip(b, root),
      mouseout: () => hideHoverTip(root)
    }
    marker.on('click', listeners.click)
    marker.on('mouseover', listeners.mouseover)
    marker.on('mouseout', listeners.mouseout)
    map.add(marker)
    markerCache.set(b.id, { marker, root, listeners })
  }
}

/* ================= hover 提示（跟随地图移动） ================= */
function showHoverTip(building, root) {
  if (!map) return
  clearHoverCloseTimer()
  applyPinHover(root, true)
  const { x, y } = map.lngLatToContainer(building.coord)
  hoverTip.value = { building, x, y: y - PIN_SIZE * PIN_SCALE.hover }
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
  if (!tip) return
  const sync = () => {
    if (!map || !hoverTip.value || hoverTip.value.building.id !== tip.building.id) return
    const { x, y } = map.lngLatToContainer(tip.building.coord)
    const nextY = y - PIN_SIZE * PIN_SCALE.hover
    if (Math.abs(hoverTip.value.x - x) < 0.5 && Math.abs(hoverTip.value.y - nextY) < 0.5) return
    hoverTip.value = { building: tip.building, x, y: nextY }
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
    syncDetailPosition()
    window.setTimeout(syncDetailPosition, 250)
  }
  if (locationReady.value) routeToSelected()
  if (window.matchMedia('(max-width: 1024px)').matches) sidebarOpen.value = false
}

function clearSelection() {
  closePhotoViewer()
  selected.value = null
  detailPosition.value = null
  clearRoute()
  for (const [, entry] of markerCache) {
    applyPinState(entry.root, false)
    entry.marker.setzIndex(10)
  }
}

function selectCampus(e) {
  const next = e.target.value
  if (next === currentCampus.value) return
  currentCampus.value = next
  selected.value = null
  currentCategory.value = 'all'
  searchKeyword.value = ''
  if (map) {
    const c = CAMPUS_CONFIG[next]
    map.setZoomAndCenter(c.zoom, c.coord)
    clearMarkerCache()
    renderPolygons(next)
    renderMarkers()
    clearRoute()
  }
}

function clearMarkerCache() {
  for (const [, entry] of markerCache) {
    try { map.remove(entry.marker) } catch (e) { /* noop */ }
  }
  markerCache.clear()
}

function selectCategory(e) {
  currentCategory.value = e.target.value
  renderMarkers()
}

function onSearchInput() {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(renderMarkers, 200)
}

function clearSearch() {
  searchKeyword.value = ''
  onSearchInput()
}

/* ================= 主题联动（MutationObserver 监听 html.dark，切换高德官方夜间样式） ================= */
let themeObserver = null

function applyMapTheme() {
  if (!map) return
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
    attributeFilter: ['class']
  })
}

/* ================= 生命周期 ================= */
async function bootstrap() {
  try {
    AMap = await loadAMap()
    await loadAMapPlugins(['AMap.Geolocation', 'AMap.Walking'])
    await nextTick()
    initMap()
    renderMarkers()
    startThemeObserver()
    applyMapTheme()
  } catch (e) {
    console.error('[MapView] init failed:', e)
    mapError.value = '地图加载失败：' + (e && e.message ? e.message : String(e))
  }
}

function retry() {
  mapError.value = ''
  bootstrap()
}

onMounted(() => {
  document.addEventListener('keydown', onViewerKeydown)
  startVisualViewportObserver()
  bootstrap()
})

onUnmounted(() => {
  document.removeEventListener('keydown', onViewerKeydown)
  destroyFlag = true
  if (themeObserver) {
    themeObserver.disconnect()
    themeObserver = null
  }
  clearHoverCloseTimer()
  if (searchTimer) clearTimeout(searchTimer)
  detailResizeObserver?.disconnect()
  stopVisualViewportObserver()
  clearRoute()
  if (locationMarker && map) {
    try { map.remove(locationMarker) } catch (e) { /* noop */ }
  }
  if (locationWatchId != null && navigator.geolocation) navigator.geolocation.clearWatch(locationWatchId)
  locationWatchId = null
  if (map) {
    try { map.destroy() } catch (e) { /* noop */ }
    map = null
  }
  markerCache.clear()
})
</script>

<template>
  <section class="map-section">
    <!-- 顶部工具条（3.5rem，抄 CQU-openlib） -->
    <header class="map-header">
      <h1 class="map-title">校园地图</h1>
      <div class="campus-select-wrap">
        <select class="campus-select" :value="currentCampus" @change="selectCampus" aria-label="选择校区">
          <option v-for="(cfg, key) in CAMPUS_CONFIG" :key="key" :value="key">{{ cfg.name }}</option>
        </select>
        <svg class="campus-caret" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
      </div>
      <div class="map-header-right">
        <button class="location-btn location-header-btn" type="button" :disabled="!mapReady || locating" @click="requestLocation">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>
          {{ locating ? '定位中' : '显示定位' }}
        </button>
        <button class="mobile-list-btn" aria-label="打开地点列表" @click="sidebarOpen = true">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/></svg>
        </button>
      </div>
    </header>

    <div class="map-body">
      <!-- 左侧地点列表 -->
      <aside class="map-sidebar" :class="{ 'map-sidebar-open': sidebarOpen }" aria-label="校园地点">
        <div class="sidebar-mobile-head">
          <span>校园地点</span>
          <button class="icon-btn" aria-label="关闭地点列表" @click="sidebarOpen = false">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </div>

        <div class="sidebar-search">
          <label class="search-box">
            <svg class="search-icon" xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
            <span class="sr-only">搜索地点</span>
            <input
              v-model="searchKeyword"
              type="text"
              placeholder="搜索"
              @input="onSearchInput"
            />
            <button v-if="searchKeyword" class="icon-btn clear-btn" aria-label="清空搜索" @click="clearSearch">
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            </button>
          </label>
          <select class="category-select" :value="currentCategory" @change="selectCategory" aria-label="地点分类">
            <option v-for="item in FILTER_LIST" :key="item.key" :value="item.key">{{ item.label }}</option>
          </select>
        </div>

        <div class="building-list">
          <button
            v-for="b in filteredBuildings"
            :key="b.id"
            type="button"
            class="building-item"
            :class="{ active: selected?.id === b.id }"
            @click="onSelect(b)"
          >
            <span class="cat-icon" :style="{ color: (CATEGORY_CONFIG[b.category] || {}).color || '#711A5F' }" v-html="categoryIconMarkup(b.category, 14)"></span>
            <span class="building-info">
              <span class="building-name">{{ b.name }}</span>
              <span v-if="b.desc" class="building-desc">{{ b.desc }}</span>
            </span>
          </button>
          <div v-if="filteredBuildings.length === 0" class="empty-tip">
            <svg class="empty-icon" xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/></svg>
            <p class="empty-title">没有匹配的地点</p>
            <p class="empty-sub">换个关键词或分类试试</p>
          </div>
        </div>
      </aside>

      <!-- 移动端遮罩 -->
      <div v-if="sidebarOpen" class="map-scrim" @click="sidebarOpen = false"></div>

      <!-- 右侧地图 -->
      <div class="map-canvas">
        <div ref="mapEl" class="map-el"></div>

        <!-- 加载 / 错误占位层 -->
        <div v-if="!mapReady && !mapError" class="map-placeholder">
          <span class="spinner"></span>
          <p class="placeholder-text">地图加载中</p>
        </div>
        <div v-if="mapError" class="map-placeholder">
          <p class="error-title">地图暂时不可用</p>
          <p class="error-desc">{{ mapError }}</p>
          <button class="retry-btn" type="button" @click="retry">重新加载</button>
        </div>

        <!-- hover 悬浮提示 -->
        <div
          v-if="hoverTip"
          class="map-hover-tip"
          :style="{ left: hoverTip.x + 'px', top: hoverTip.y + 'px' }"
        >
          <img v-if="buildingPhotos(hoverTip.building)[0]" :src="buildingPhotos(hoverTip.building)[0]" alt="" class="hover-img" />
          <p class="hover-name">{{ hoverTip.building.name }}</p>
          <p class="hover-cat">{{ (CATEGORY_CONFIG[hoverTip.building.category] || {}).label || '其他' }}</p>
          <p v-if="hoverTip.building.desc" class="hover-desc">{{ hoverTip.building.desc }}</p>
        </div>

        <!-- 移动端：打开地点列表浮层按钮（仅小屏显示） -->
        <div v-if="!sidebarOpen" class="mobile-map-actions">
          <button
            type="button"
            class="mobile-open-list"
            aria-label="打开地点列表"
            @click="sidebarOpen = true"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 5h20"/><path d="M6 12h12"/><path d="M9 19h6"/></svg>
            {{ filteredBuildings.length }} 个地点
          </button>
          <button
            type="button"
            class="location-btn mobile-location-btn"
            :disabled="!mapReady || locating"
            aria-label="显示定位"
            @click="requestLocation"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>
            <span>显示定位</span>
          </button>
        </div>
        <p v-if="locationError && !selected" class="location-status" role="status">{{ locationError }}</p>

        <!-- 缩放控件 -->
        <button
          v-if="locationReady"
          type="button"
          class="recenter-btn"
          :class="{ 'recenter-btn-raised': selected }"
          :style="selected ? { '--detail-card-height': `${detailCardHeight}px` } : undefined"
          aria-label="重新定位到我的位置"
          @click="recenterLocation"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>
          <span>重定位</span>
        </button>

        <div class="map-zoom-ctrl">
          <button class="zoom-btn" aria-label="放大地图" :disabled="!mapReady" @click="map && map.zoomIn()">
            <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
          </button>
          <div class="zoom-divider"></div>
          <button class="zoom-btn" aria-label="缩小地图" :disabled="!mapReady" @click="map && map.zoomOut()">
            <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/></svg>
          </button>
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
              <img v-if="selectedPhotos.length > 1" :src="selectedPhotos[1]" alt="" class="detail-photo detail-photo-back" />
              <img :src="selectedPhotos[0]" alt="" class="detail-photo detail-photo-front" />
              <span v-if="selectedPhotos.length > 1" class="detail-photo-count">{{ selectedPhotos.length }}</span>
            </button>
            <span class="detail-icon" v-html="categoryIconMarkup(selected.category, 15)"></span>
            <div class="detail-info">
              <h2 class="detail-name">{{ selected.name }}</h2>
              <p v-if="selected.desc" class="detail-desc">{{ selected.desc }}</p>
            </div>
            <button class="icon-btn" aria-label="关闭地点详情" @click="clearSelection">
              <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            </button>
          </div>
          <div v-if="routeSummary" class="route-summary" role="status">
            <strong>步行约 {{ routeSummary.distance }}</strong>
            <span v-if="routeSummary.duration">预计 {{ routeSummary.duration }}</span>
          </div>
          <p v-if="locationError" class="location-error">{{ locationError }}</p>
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
          <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>
        </div>
        <h2 id="location-dialog-title">允许获取你的当前位置</h2>
        <p>定位信息仅用于在地图上标记你的位置，并规划到所选地点的步行路线，不会被保存。</p>
        <div class="location-legend" aria-label="地图图标说明">
          <span><i class="legend-pin legend-pin-user"></i>红色图标：用户定位</span>
          <span><i class="legend-pin legend-pin-place"></i>蓝色图标：可点击标点</span>
        </div>
        <p class="location-countdown">点击继续后将请求定位权限，并持续更新你的位置。</p>
        <button type="button" class="location-confirm" @click="finishLocationRequest">继续</button>
        <button type="button" class="location-cancel" @click="cancelLocationRequest">暂不定位</button>
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
          <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
        </button>
        <button v-if="selectedPhotos.length > 1" class="map-photo-viewer-nav map-photo-viewer-prev" type="button" aria-label="上一张图片" @click.stop="changeViewerPhoto(-1)">
          <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
        </button>
        <img :src="currentViewerPhoto" :alt="`${selected?.name || '地点'}第 ${photoViewerIndex + 1} 张图片`" class="map-photo-viewer-img" @click.stop />
        <button v-if="selectedPhotos.length > 1" class="map-photo-viewer-nav map-photo-viewer-next" type="button" aria-label="下一张图片" @click.stop="changeViewerPhoto(1)">
          <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
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
  --c-paper: #f6f6f7;
  --c-panel: #ffffff;
  --c-elev: #ffffff;
  --c-icon: #a1a1a6;
  --c-icon-strong: #3c3c43;
  --c-backdrop: rgba(33, 53, 71, 0.4);

  display: flex;
  flex-direction: column;
  height: calc(100vh - var(--vp-nav-height, 64px));
  width: 100%;
  overflow: hidden;
  background: var(--c-paper);
  color: var(--c-ink);
  font-family: inherit;
}

html.dark .map-section {
  /* 品牌色不再重复定义：--c-primary 系列引用的 --vp-c-brand-* 在 .dark 下
     已由站点 tokens.css 换成提亮档，这里只覆盖中性色 */
  --c-ink: rgba(235, 235, 245, 0.92);
  --c-muted: rgba(235, 235, 245, 0.52);
  --c-line: rgba(235, 235, 245, 0.11);
  --c-paper: #161618;
  --c-panel: #252529;
  --c-elev: #2f2f33;
  --c-icon: #6b6b70;
  --c-icon-strong: rgba(235, 235, 245, 0.82);
  --c-backdrop: rgba(0, 0, 0, 0.55);
}

/* ===== 顶部工具条 ===== */
.map-header {
  position: relative;
  z-index: 25;
  display: flex;
  align-items: center;
  gap: 10px;
  height: 3.5rem;
  flex-shrink: 0;
  padding: 0 12px;
  border-bottom: 1px solid var(--c-line);
  background: var(--c-panel);
}
.map-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--c-ink);
  white-space: nowrap;
  line-height: 1.2;
}
.campus-select-wrap {
  position: relative;
  flex-shrink: 0;
  display: flex;
  align-items: center;
}
.campus-select {
  max-width: 100%;
  appearance: none;
  -webkit-appearance: none;
  padding: 4px 26px 4px 10px;
  font-size: 13px;
  color: var(--c-ink);
  background: var(--c-paper);
  border: 1px solid var(--c-line);
  border-radius: 6px;
  cursor: pointer;
  outline: none;
}
.campus-select:focus {
  border-color: var(--c-primary);
}
.campus-caret {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  pointer-events: none;
  color: var(--c-icon);
}
.map-header-right {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  margin-left: auto;
}
.location-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--c-line);
  border-radius: 6px;
  background: var(--c-paper);
  color: var(--c-icon-strong);
  font-size: 12px;
  cursor: pointer;
}
.location-btn:hover:not(:disabled) { border-color: var(--c-primary); color: var(--c-primary); }
.location-btn:disabled { color: var(--c-muted); cursor: not-allowed; }
.mobile-list-btn {
  display: none;
  width: 32px;
  height: 32px;
  place-items: center;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--c-icon-strong);
  cursor: pointer;
}
.mobile-list-btn:hover {
  background: var(--c-mist);
}

/* ===== 主体 ===== */
.map-body {
  position: relative;
  display: flex;
  flex: 1;
  min-height: 0;
}

/* ===== 左侧地点列表 ===== */
.map-sidebar {
  display: flex;
  flex-direction: column;
  width: 21rem;
  flex-shrink: 0;
  background: var(--c-panel);
  border-right: 1px solid var(--c-line);
}
.sidebar-mobile-head {
  display: none;
  align-items: center;
  justify-content: space-between;
  height: 2.5rem;
  padding: 0 12px;
  border-bottom: 1px solid var(--c-line);
}
.sidebar-mobile-head span {
  font-size: 12px;
  font-weight: 500;
  color: var(--c-muted);
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
  gap: 8px;
  padding: 12px;
  border-bottom: 1px solid var(--c-line);
}
.search-box {
  position: relative;
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
  height: 40px;
  border: 1px solid var(--c-line);
  border-radius: 6px;
  background: var(--c-paper);
  transition: border-color 0.15s;
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
  padding: 0 30px 0 32px;
  border: none;
  background: transparent;
  font-size: 13px;
  color: var(--c-ink);
  outline: none;
}
.search-box input::placeholder {
  color: var(--c-muted);
}
.clear-btn {
  position: absolute;
  right: 6px;
}
.category-select {
  width: 8.5rem;
  padding: 0 8px;
  font-size: 12px;
  color: var(--c-ink);
  background: var(--c-paper);
  border: 1px solid var(--c-line);
  border-radius: 6px;
  cursor: pointer;
  outline: none;
}
.category-select:focus {
  border-color: var(--c-primary);
}

.building-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-bottom: 8px;
}
.building-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  width: 100%;
  padding: 10px 12px;
  border: none;
  border-bottom: 1px solid var(--c-line);
  background: var(--c-panel);
  text-align: left;
  cursor: pointer;
  transition: background 0.15s;
}
.building-item:hover {
  background: var(--c-mist);
}
.building-item.active {
  background: var(--c-primary-faint);
}
.cat-icon {
  margin-top: 2px;
  flex-shrink: 0;
  opacity: 0.9;
}
.building-info {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.building-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--c-ink);
  line-height: 1.3;
}
.building-desc {
  font-size: 12px;
  color: var(--c-muted);
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
}
.empty-tip {
  padding: 40px 24px;
  text-align: center;
}
.empty-icon {
  margin: 0 auto;
  color: var(--c-icon-strong);
  display: block;
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
  position: relative;
  flex: 1;
  min-width: 0;
  min-height: 0;
}
.map-el {
  position: absolute;
  inset: 0;
}
.map-placeholder {
  position: absolute;
  inset: 0;
  z-index: 10;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: var(--c-paper);
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
  margin: 0;
  font-size: 12px;
  color: var(--c-muted);
  max-width: 320px;
  text-align: center;
}
.retry-btn {
  margin-top: 8px;
  height: 32px;
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
  z-index: 25;
  pointer-events: none;
  transform: translate(-50%, -100%) translateY(-8px);
  padding: 12px 14px;
  border: 1px solid var(--c-line);
  border-radius: 10px;
  background: var(--c-elev);
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.14);
  white-space: normal;
  max-width: 300px;
  text-align: center;
}
.hover-name {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--c-ink);
  line-height: 1.3;
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
  object-fit: cover;
  border-radius: 10px;
  margin: 0 auto 10px;
}
.hover-desc {
  margin: 2px 0 0;
  max-width: 260px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--c-muted);
}
.detail-photo-stack {
  position: relative;
  width: 104px;
  height: 78px;
  flex: 0 0 104px;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: zoom-in;
}
.detail-photo {
  position: absolute;
  display: block;
  width: 96px;
  height: 72px;
  object-fit: cover;
  border-radius: 8px;
  border: 2px solid var(--c-elev);
  box-shadow: 0 3px 10px rgba(15, 23, 42, 0.16);
}
.detail-photo-front {
  z-index: 2;
  top: 0;
  left: 0;
}
.detail-photo-back {
  z-index: 1;
  top: 5px;
  left: 6px;
  transform: rotate(5deg);
  transform-origin: center;
}
.detail-photo-count {
  position: absolute;
  right: 4px;
  bottom: 2px;
  z-index: 3;
  min-width: 20px;
  height: 20px;
  padding: 0 5px;
  border: 1px solid rgba(255, 255, 255, 0.8);
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.78);
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  line-height: 18px;
  text-align: center;
}
.detail-photo-stack:focus-visible {
  outline: 2px solid var(--c-primary);
  outline-offset: 3px;
}
.map-photo-viewer {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.85);
}
.map-photo-viewer-close,
.map-photo-viewer-nav {
  position: absolute;
  z-index: 2;
  display: grid;
  place-items: center;
  border: 1px solid rgba(255, 255, 255, 0.18);
  background: rgba(15, 23, 42, 0.62);
  color: #fff;
  cursor: pointer;
  backdrop-filter: blur(8px);
  transition: background 0.15s, transform 0.15s;
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
  outline: 2px solid #fff;
  outline-offset: 3px;
}
.map-photo-viewer-img {
  max-width: min(calc(100vw - 160px), 1100px);
  max-height: calc(100vh - 112px);
  object-fit: contain;
  border-radius: 8px;
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.4);
}
.map-photo-viewer-caption {
  position: absolute;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  margin: 0;
  color: rgba(255, 255, 255, 0.8);
  font-size: 14px;
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

/* 缩放控件 */
.map-zoom-ctrl {
  position: absolute;
  right: 12px;
  top: 12px;
  z-index: 10;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--c-line);
  border-radius: 6px;
  background: var(--c-panel);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
}
.recenter-btn {
  position: absolute;
  right: 12px;
  bottom: 16px;
  z-index: 10;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 10px;
  border: 1px solid var(--c-line);
  border-radius: 6px;
  background: var(--c-panel);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
  color: var(--c-icon-strong);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
}
.recenter-btn:hover {
  border-color: var(--c-primary);
  color: var(--c-primary);
}
.recenter-btn-raised {
  bottom: 154px;
}
.zoom-btn {
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  border: none;
  background: transparent;
  color: var(--c-icon-strong);
  cursor: pointer;
  transition: background 0.15s;
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
  left: 12px;
  z-index: 10;
  padding: 12px;
  border: 1px solid var(--c-line);
  border-radius: 8px;
  background: var(--c-elev);
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.14);
  animation: detail-in 0.2s ease-out;
}
.route-summary {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-top: 10px;
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--c-primary-soft);
  color: var(--c-primary);
  font-size: 12px;
}
.route-summary strong { font-size: 13px; }
.route-summary span { color: var(--c-muted); }
.location-error { margin: 8px 0 0; color: #c2410c; font-size: 12px; }
.location-status {
  position: absolute;
  left: 50%;
  bottom: 16px;
  z-index: 12;
  max-width: calc(100% - 32px);
  margin: 0;
  padding: 8px 12px;
  border: 1px solid rgba(194, 65, 12, 0.2);
  border-radius: 6px;
  background: var(--c-elev);
  box-shadow: 0 4px 16px rgba(15, 23, 42, 0.12);
  color: #c2410c;
  font-size: 12px;
  transform: translateX(-50%);
}
@keyframes detail-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
.detail-head {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}
.detail-icon {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  flex-shrink: 0;
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
  color: var(--c-ink);
  line-height: 1.3;
}
.detail-desc {
  margin: 4px 0 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--c-muted);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
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
  color: var(--c-ink);
  text-decoration: none;
  white-space: nowrap;
  transition: all 0.15s;
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
  color: var(--c-primary);
  font-size: 13px;
  font-weight: 500;
  text-decoration: none;
  transition: background 0.15s, color 0.15s;
}
.detail-article-link:hover {
  background: var(--c-primary);
  color: #fff;
}

/* 移动端遮罩：仅覆盖地图区域，不盖住顶部工具条（header z-30 以上可点） */
.map-scrim {
  position: absolute;
  inset: 0;
  z-index: 20;
  background: var(--c-backdrop);
}

/* 移动端：打开地点列表浮层按钮（仅小屏显示） */
.mobile-open-list {
  display: none;
}
.mobile-location-btn {
  display: none;
}
.mobile-map-actions {
  display: none;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

/* ===== 移动端 ===== */
@media (max-width: 1024px) {
  .location-header-btn {
    display: none;
  }
  .mobile-list-btn {
    display: none;
  }
  .mobile-map-actions {
    position: absolute;
    top: 12px;
    left: 12px;
    z-index: 10;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .mobile-open-list {
    position: static;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 40px;
    padding: 0 12px;
    border: 1px solid var(--c-line);
    border-radius: 6px;
    background: var(--c-panel);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
    font-size: 13px;
    font-weight: 500;
    color: var(--c-icon-strong);
    cursor: pointer;
  }
  .map-sidebar {
    position: fixed;
    top: calc(var(--vp-nav-height, 64px) + 3.5rem);
    left: 0;
    bottom: 0;
    z-index: 21;
    width: min(22rem, 88vw);
    transform: translateX(-100%);
    transition: transform 0.3s ease;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
  }
  .map-sidebar-open {
    transform: translateX(0);
  }
  .sidebar-mobile-head {
    display: flex;
  }
  .map-detail-card {
    position: fixed;
    right: 8px;
    left: 8px;
    bottom: calc(8px + env(safe-area-inset-bottom));
  }
  .recenter-btn {
    position: fixed;
    right: 8px;
    bottom: calc(18px + env(safe-area-inset-bottom) + var(--qut-browser-bottom-inset, 0px));
    z-index: 11;
  }
  .recenter-btn-raised {
    bottom: calc(16px + var(--detail-card-height, 0px) + env(safe-area-inset-bottom));
  }
  .mobile-location-btn {
    position: static;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: auto;
    height: 40px;
    gap: 6px;
    padding: 0 12px;
    border: 1px solid var(--c-line);
    border-radius: 6px;
    background: var(--c-panel);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
    font-size: 13px;
    font-weight: 500;
    color: var(--c-icon-strong);
    cursor: pointer;
    white-space: nowrap;
  }
  .mobile-location-btn:hover:not(:disabled) {
    background: var(--c-mist);
  }
  .mobile-location-btn:disabled {
    color: var(--c-icon-strong);
    cursor: not-allowed;
  }
}

.location-dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(15, 23, 42, 0.45);
}
.location-dialog {
  width: min(360px, 100%);
  padding: 24px;
  border: 1px solid var(--c-line);
  border-radius: 12px;
  background: var(--c-elev);
  color: var(--c-ink);
  box-shadow: 0 18px 50px rgba(15, 23, 42, 0.22);
  text-align: center;
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
.location-dialog h2 { margin: 0; font-size: 18px; }
.location-dialog p { margin: 10px 0 0; color: var(--c-muted); font-size: 13px; line-height: 1.6; }
.location-dialog .location-countdown { font-size: 12px; }
.location-legend {
  display: flex;
  flex-direction: column;
  gap: 7px;
  margin-top: 14px;
  padding: 10px 12px;
  border-radius: 6px;
  background: var(--c-primary-faint);
  color: var(--c-muted);
  font-size: 12px;
  text-align: left;
}
.location-legend span {
  display: flex;
  align-items: center;
  gap: 7px;
}
.legend-pin {
  display: inline-block;
  width: 10px;
  height: 10px;
  flex: 0 0 auto;
  border: 1px solid #fff;
  border-radius: 50% 50% 50% 0;
  box-shadow: 0 1px 2px rgb(15 23 42 / 0.25);
  transform: rotate(-45deg);
}
.legend-pin-user { background: #e53935; }
.legend-pin-place { background: var(--c-primary); }
.location-confirm, .location-cancel {
  width: 100%;
  height: 36px;
  margin-top: 18px;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
}
.location-confirm { border: 1px solid var(--c-primary); background: var(--c-primary); color: #fff; }
.location-confirm:disabled { opacity: 0.55; cursor: not-allowed; }
.location-cancel { margin-top: 8px; border: none; background: transparent; color: var(--c-muted); }
</style>

<style>
/* ===== 全局（非 scoped）：高德 marker 内部样式 ===== */
/* 压低下高德版权/logo 层级，避免盖住侧边栏等 UI */
.map-section .amap-copyright,
.map-section .amap-logo {
  z-index: 5 !important;
}

.qut-pin-root {
  position: relative;
  width: 28px;
  height: 28px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  user-select: none;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}
.qut-pin-root [data-map-pin-body] {
  position: relative;
  width: 28px;
  height: 28px;
  transform-origin: bottom center;
  transition: transform 200ms ease-out;
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
.qut-location-marker {
  width: 28px;
  height: 28px;
  filter: drop-shadow(0 1px 2px rgb(15 23 42 / 0.2));
}
</style>
