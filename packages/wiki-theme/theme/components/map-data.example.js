/**
 * map-data.js 格式示例（虚拟数据，不可直接使用）。
 *
 * MapView 组件不内置任何站点数据：点位、分类、校区与高德密钥都通过
 * `data` prop 注入。把本文件复制到你的站点（如 docs/.vitepress/data/map-data.js）、
 * 填入真实数据后，在页面中：
 *
 *   import MapView from '@nkuwiki/theme/theme/components/MapView.vue'
 *   import mapData from './.vitepress/data/map-data.js'
 *
 *   <MapView :data="mapData" />
 *
 * 数据结构遵循 QUT-WiKi MapView 的约定：
 *   点位 { id, name, category, campusId, coord: [经度, 纬度], desc, photos: ['图片地址'] }
 *   photos 可放多张图片（旧的单图 photo 字段也已兼容）。
 * 坐标统一 GCJ02（高德坐标系），高德底图与高德导航直接使用；百度/腾讯/Apple 导航
 * 外链由 MapView 内部做坐标转换。
 *
 * ================= 新增分类（三处同步，key 保持一致） =================
 * 1. CATEGORY_CONFIG      分类的显示名与标点颜色；
 * 2. CATEGORY_ICON_PATHS  标点与列表上的图标（Lucide 风格 SVG path，viewBox 24×24）；
 * 3. FILTER_LIST          左侧筛选下拉的选项（icon 为 FontAwesome 类名）。
 * 不新增分类就无法在点位上使用新 category，构建不校验但标点会缺图标。
 *
 * ================= 校区配置（CAMPUS_CONFIG） =================
 * 每个校区一条：id（点位的 campusId 与 POLYGONS 的键都引用它）、
 * name（切换下拉显示名）、coord（初始中心坐标，GCJ02）、zoom（初始缩放级别）。
 * 校区轮廓 POLYGONS（MapView.vue 内）按 id 引用，暂为空数组，不影响使用。
 */

export const CATEGORY_CONFIG = {
	teaching: { label: '教学楼', color: '#4A90D9' },
	canteen: { label: '食堂', color: '#D9772F' },
	gate: { label: '校门', color: '#3B7A57' },
}

export const CATEGORY_ICON_PATHS = {
	/* 图标为 Lucide 风格 SVG path，viewBox 24×24 */
	teaching: 'M3 22h18M5 22V6l7-4 7 4v16M9 10h.01M15 10h.01M9 14h.01M15 14h.01',
	canteen: 'M4 2v8a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2V2M7 2v20M17 2c-1.5 2-2 4-2 7 0 2 1 3 2 3v10',
	gate: 'M3 21h18M5 21V7l7-5 7 5v14M10 21v-4a2 2 0 0 1 4 0v4',
}

export const CAMPUS_CONFIG = {
	/* 主校区：n */
	n: { name: '主校区', coord: [116.397, 39.909], zoom: 16 },
}

export const FILTER_LIST = [
	{ key: 'all', label: '全部', icon: 'fa-th-large' },
	{ key: 'teaching', label: '教学楼', icon: 'fa-graduation-cap' },
	{ key: 'canteen', label: '食堂', icon: 'fa-cutlery' },
	{ key: 'gate', label: '校门', icon: 'fa-flag' },
]

export const BUILDINGS = [
	{
		id: 'demo-teaching-1',
		name: '示例教学楼',
		category: 'teaching',
		campusId: 'n',
		coord: [116.3972, 39.9092],
		desc: '虚拟点位：替换为你的真实建筑。photos 字段放多张图片地址。',
		photos: ['/map/pic/demo.jpg'],
	},
	{
		id: 'demo-gate-1',
		name: '示例校门',
		category: 'gate',
		campusId: 'n',
		coord: [116.3956, 39.9078],
		desc: '虚拟点位：article 字段可关联站内文章，标点弹层直达。',
		article: '/pages/SomeArticle/',
	},
]

/* ================= 高德密钥（lbs.amap.com 控制台申请，应用类型：Web端(JS API)） =================
 * key 与安全密钥由站点自行提供，随点位数据一起通过 data prop 注入。 */
export const AMAP_KEY = '你的高德 Web 端(JS API) key'
export const AMAP_SECURITY_JS_CODE = '你的安全密钥（2021 年后申请的 key 必填）'
