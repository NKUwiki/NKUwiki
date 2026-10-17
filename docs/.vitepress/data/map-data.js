/* eslint-disable */
/**
 * NKU Maps 校园地图数据。
 *
 * 数据结构完全遵循 QUT-WiKi MapView 的约定：
 *   { id, name, category, campusId, coord: [经度, 纬度], desc, photos: ['图片地址'] }
 * photos 可放多张图片（旧的单图 photo 字段也已兼容）。
 *
 * 点位与坐标来自 CQUMAPS-1.0（南开大学八里台 / 津南校区，GCJ02，高德拾取器采集），
 * images 字段已转换为 photos；图标与配色沿用 QUT-WiKi 的定义，分类经本地精简
 * （2026-10：17 → 11 个，零星分类并入邻近大类，见 CATEGORY_CONFIG 上方注释）。
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
 * 每个校区一条：id（n 八里台 / j 津南，点位的 campusId 与 POLYGONS 的键都引用它）、
 * name（切换下拉显示名）、coord（初始中心坐标，GCJ02）、zoom（初始缩放级别）。
 * 校区轮廓 POLYGONS（MapView.vue 内）按 id 引用，暂为空数组，不影响使用。
 *
 * 各字段的详细说明与「点位关联文章（article）」用法，
 * 见站内《贡献指南》的「校园地图数据维护」一节。
 */

/* 底图显示开关（可选，不导出时用 MapView 内的默认值）：
   showPoi: false  不显示高德底图自带的 POI 点，即「某某楼/某店铺」这类由接口下发的
                   建筑名称——只保留我们自己标注的点位，避免两套标注互相打架。
                   道路名、行政区名等地图文字不受影响，由 showLabels 单独控制。
   showLabels: true 保留底图文字标注（道路名等）。改成 false 会连路名一起隐藏。 */
export const MAP_DISPLAY = {
  showPoi: false,
  showLabels: true,
}

export const CATEGORY_CONFIG = {
  /* 分类色 = 标点与列表图标的填充色。按语义分组取色（学习办公冷色、餐饮生活暖色、
     运动文化青紫、交通出行蓝绿），组内用深浅区分，做到「同类相近、异类分明」。
     想换配色只改这里的 color 即可，MapView 会自动取用；未命中的分类回落到灰色。

     2026-10 精简：17 → 11 个。零星分类各自成项只会让筛选行多一排点不动的药丸——
     theater 并入 sports（运动文体），food/shop/express/hospital 并入 service
     （生活服务），busstation 并入 transit（交通出行），tool 从未有点位、删除。 */
  teaching:   { label: '教学楼',   color: '#3B82F6' },
  college:    { label: '学院楼',   color: '#6366F1' },
  library:    { label: '图书馆',   color: '#8B5CF6' },
  dormitory:  { label: '学生宿舍', color: '#10B981' },
  canteen:    { label: '食堂',     color: '#F59E0B' },
  sports:     { label: '运动文体', color: '#06B6D4' },
  landmark:   { label: '地标建筑', color: '#F43F5E' },
  admin:      { label: '行政楼',   color: '#64748B' },
  gate:       { label: '校门',     color: '#14B8A6' },
  service:    { label: '生活服务', color: '#EC4899' },
  transit:    { label: '交通出行', color: '#0EA5E9' }
}

/* 分类 SVG 图标 path 数据（Lucide 风格，抄自 CQU-openlib markerIcons.ts）。
   2026-10 精简后：service 用购物袋（原 shop）、transit 用公交（原 busstation），
   被合并分类的 path 一并删除，key 与 CATEGORY_CONFIG / FILTER_LIST 保持一致 */

export const CATEGORY_ICON_PATHS = {
  teaching:
    '<path d="M14 21v-3a2 2 0 0 0-4 0v3"/><path d="M18 5v16"/><path d="m4 6 7.106-3.79a2 2 0 0 1 1.788 0L20 6"/><path d="m6 11-3.52 2.147a1 1 0 0 0-.48.854V19a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5a1 1 0 0 0-.48-.853L18 11"/><path d="M6 5v16"/><circle cx="12" cy="9" r="2"/>',
  college:
    '<path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z"/><path d="M22 10v6"/><path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5"/>',
  library:
    '<path d="m16 6 4 14"/><path d="M12 6v14"/><path d="M8 8v12"/><path d="M4 4v16"/>',
  dormitory:
    '<path d="M2 20v-8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v8"/><path d="M4 10V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v4"/><path d="M12 4v6"/><path d="M2 18h20"/>',
  canteen:
    '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>',
  sports:
    '<path d="M17.596 12.768a2 2 0 1 0 2.829-2.829l-1.768-1.767a2 2 0 0 0 2.828-2.829l-2.828-2.828a2 2 0 0 0-2.829 2.828l-1.767-1.768a2 2 0 1 0-2.829 2.829z"/><path d="m2.5 21.5 1.4-1.4"/><path d="m20.1 3.9 1.4-1.4"/><path d="M5.343 21.485a2 2 0 1 0 2.829-2.828l1.767 1.768a2 2 0 1 0 2.829-2.829l-6.364-6.364a2 2 0 1 0-2.829 2.829l1.768 1.767a2 2 0 0 0-2.828 2.829z"/><path d="m9.6 14.4 4.8-4.8"/>',
  admin:
    '<path d="M10 12h4"/><path d="M10 8h4"/><path d="M14 21v-3a2 2 0 0 0-4 0v3"/><path d="M6 10H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2"/><path d="M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16"/>',
  gate: '<path d="M11 20H2"/><path d="M11 4.562v16.157a1 1 0 0 0 1.242.97L19 20V5.562a2 2 0 0 0-1.515-1.94l-4-1A2 2 0 0 0 11 4.561z"/><path d="M11 4H8a2 2 0 0 0-2 2v14"/><path d="M14 12h.01"/><path d="M22 20h-3"/>',
  landmark:
    '<path d="M10 18v-7"/><path d="M11.12 2.198a2 2 0 0 1 1.76.006l7.866 3.847c.476.233.31.949-.22.949H3.474c-.53 0-.695-.716-.22-.949z"/><path d="M14 18v-7"/><path d="M18 18v-7"/><path d="M3 22h18"/><path d="M6 18v-7"/>',
  service: '<path d="M3 9l1-5h16l1 5"/><path d="M5 13v7h14v-7"/><path d="M9 20v-6h6v6"/><path d="M3 9a2 2 0 0 0 4 0 2 2 0 0 0 4 0 2 2 0 0 0 4 0 2 2 0 0 0 4 0 2 2 0 0 0 4 0"/>',
  transit:
    '<path d="M4 6 2 7"/><path d="M10 6h4"/><path d="m22 7-2-1"/><rect width="16" height="16" x="4" y="3" rx="2"/><path d="M4 11h16"/><path d="M8 15h.01"/><path d="M16 15h.01"/><path d="M6 19v2"/><path d="M18 21v-2"/>'
}

/* 南开大学校区（coord 为 GCJ02，zoom 与 CQUMAPS 一致）。
   name 会出现在校区切换按钮、搜索框占位文案与拾取面板的下拉里，
   都是窄容器，故用短名（南开大学八里台校区 → 八里台校区）。 */
export const CAMPUS_CONFIG = {
  n: { id: 'n', name: '八里台校区', coord: [117.171274, 39.102101], zoom: 17 },
  j: { id: 'j', name: '津南校区', coord: [117.345, 38.989], zoom: 16 }
}

export const FILTER_LIST = [
  { key: 'all',        label: '全部',     icon: 'fa-th-large' },
  { key: 'teaching',   label: '教学楼',   icon: 'fa-graduation-cap' },
  { key: 'college',    label: '学院楼',   icon: 'fa-university' },
  { key: 'library',    label: '图书馆',   icon: 'fa-book' },
  { key: 'dormitory',  label: '学生宿舍', icon: 'fa-building' },
  { key: 'canteen',    label: '食堂',     icon: 'fa-cutlery' },
  { key: 'sports',     label: '运动文体', icon: 'fa-futbol-o' },
  { key: 'landmark',   label: '地标建筑', icon: 'fa-star' },
  { key: 'admin',      label: '行政楼',   icon: 'fa-briefcase' },
  { key: 'gate',       label: '校门',     icon: 'fa-flag' },
  { key: 'service',    label: '生活服务', icon: 'fa-shopping-bag' },
  { key: 'transit',    label: '交通出行', icon: 'fa-bus' }
]

/* 南开大学建筑点位（自 CQUMAPS-1.0 转换） */
export const BUILDINGS = [
  {
    "id": "n_landmark_01",
    "name": "南开大学主楼",
    "category": "landmark",
    "campusId": "n",
    "coord": [
      117.171274,
      39.102101
    ],
    "desc": "八里台校区标志性主楼，位于校园中轴线上，是南开大学的地标建筑。",
    "photos": [
      "/map/pic/nankai-main-building.png"
    ],
    "article": "/pages/BalitaiCampus/#主楼"
  },
  {
    "id": "n_landmark_02",
    "name": "周恩来总理塑像",
    "category": "landmark",
    "campusId": "n",
    "coord": [
      117.171302,
      39.10173
    ],
    "desc": "主楼正前方广场上的周恩来总理塑像，南开的标志性打卡点。"
  },
  {
    "id": "n_landmark_03",
    "name": "周恩来总理纪念碑",
    "category": "landmark",
    "campusId": "n",
    "coord": [
      117.175527,
      39.104012
    ],
    "desc": "马蹄湖畔的周恩来总理纪念碑，刻有「我是爱南开的」。"
  },
  {
    "id": "n_landmark_04",
    "name": "马蹄湖",
    "category": "landmark",
    "campusId": "n",
    "coord": [
      117.175527,
      39.104005
    ],
    "desc": "南开最具代表性的圆形湖，湖心岛立有周恩来总理纪念碑，夏季荷花盛开。"
  },
  {
    "id": "n_landmark_05",
    "name": "新开湖",
    "category": "landmark",
    "campusId": "n",
    "coord": [
      117.172996,
      39.103461
    ],
    "desc": "校区东部的开阔湖面，与马蹄湖相邻，湖边是课余散步的好去处。"
  },
  {
    "id": "n_landmark_06",
    "name": "校钟景观",
    "category": "landmark",
    "campusId": "n",
    "coord": [
      117.171163,
      39.10312
    ],
    "desc": "南开校钟所在，校庆等重要时刻鸣响，铭记校史。"
  },
  {
    "id": "n_landmark_07",
    "name": "敬业广场",
    "category": "landmark",
    "campusId": "n",
    "coord": [
      117.167248,
      39.103285
    ],
    "desc": "图书馆旁的开阔广场，课余休憩与社团活动的好去处。"
  },
  {
    "id": "n_library_01",
    "name": "图书馆",
    "category": "library",
    "campusId": "n",
    "coord": [
      117.165783,
      39.103177
    ],
    "desc": "八里台校区图书馆，自习与借阅的核心场所。"
  },
  {
    "id": "n_teaching_01",
    "name": "第二主教学楼",
    "category": "teaching",
    "campusId": "n",
    "coord": [
      117.171116,
      39.103659
    ],
    "desc": "位于主楼北侧的公共教学楼。"
  },
  {
    "id": "n_teaching_02",
    "name": "第四教学楼",
    "category": "teaching",
    "campusId": "n",
    "coord": [
      117.170096,
      39.102659
    ],
    "desc": "公共教学楼。"
  },
  {
    "id": "n_teaching_03",
    "name": "第五教学楼",
    "category": "teaching",
    "campusId": "n",
    "coord": [
      117.169447,
      39.102177
    ],
    "desc": "公共教学楼。"
  },
  {
    "id": "n_teaching_04",
    "name": "文科创新楼",
    "category": "teaching",
    "campusId": "n",
    "coord": [
      117.169188,
      39.103834
    ],
    "desc": "文科类科研与创新用楼。"
  },
  {
    "id": "n_teaching_05",
    "name": "组合教学中心",
    "category": "teaching",
    "campusId": "n",
    "coord": [
      117.163582,
      39.105295
    ],
    "desc": "校区西北部的公共教学组团，邻近学生活动中心。"
  },
  {
    "id": "n_teaching_06",
    "name": "中心实验室",
    "category": "teaching",
    "campusId": "n",
    "coord": [
      117.164389,
      39.104501
    ],
    "desc": "公共实验教学楼。"
  },
  {
    "id": "n_college_01",
    "name": "范孙楼",
    "category": "college",
    "campusId": "n",
    "coord": [
      117.166571,
      39.102215
    ],
    "desc": "八里台校区老建筑之一，邻近敬业广场。"
  },
  {
    "id": "n_college_02",
    "name": "伯苓楼",
    "category": "college",
    "campusId": "n",
    "coord": [
      117.164379,
      39.103401
    ],
    "desc": "以张伯苓校长命名的历史建筑。"
  },
  {
    "id": "n_college_03",
    "name": "省身楼",
    "category": "college",
    "campusId": "n",
    "coord": [
      117.169864,
      39.101032
    ],
    "desc": "陈省身数学研究所所在地，南开数学学科的重镇。"
  },
  {
    "id": "n_college_04",
    "name": "蒙民伟楼",
    "category": "college",
    "campusId": "n",
    "coord": [
      117.1767,
      39.10227
    ],
    "desc": "位于校区东部、临近卫津路的教学科研楼。"
  },
  {
    "id": "n_college_05",
    "name": "东方艺术大楼",
    "category": "college",
    "campusId": "n",
    "coord": [
      117.173342,
      39.102925
    ],
    "desc": "东方艺术系教学科研楼，紧邻新开湖。"
  },
  {
    "id": "n_college_06",
    "name": "化学楼",
    "category": "college",
    "campusId": "n",
    "coord": [
      117.168009,
      39.103163
    ],
    "desc": "化学学院教学科研楼，化学是南开的传统优势学科。"
  },
  {
    "id": "n_college_07",
    "name": "文学院",
    "category": "college",
    "campusId": "n",
    "coord": [
      117.166618,
      39.10222
    ],
    "desc": "文学院教学科研楼。"
  },
  {
    "id": "n_college_08",
    "name": "数学科学学院",
    "category": "college",
    "campusId": "n",
    "coord": [
      117.163965,
      39.103851
    ],
    "desc": "数学科学学院教学楼。"
  },
  {
    "id": "n_college_09",
    "name": "汉语言文化学院",
    "category": "college",
    "campusId": "n",
    "coord": [
      117.172879,
      39.102335
    ],
    "desc": "汉语言文化学院教学科研楼。"
  },
  {
    "id": "n_college_10",
    "name": "管理学院西院",
    "category": "college",
    "campusId": "n",
    "coord": [
      117.162072,
      39.106948
    ],
    "desc": "管理学院西院办公教学区。"
  },
  {
    "id": "n_canteen_01",
    "name": "学生第一食堂",
    "category": "canteen",
    "campusId": "n",
    "coord": [
      117.167223,
      39.104316
    ],
    "desc": "北区学生食堂之一。"
  },
  {
    "id": "n_canteen_02",
    "name": "学生第二食堂",
    "category": "canteen",
    "campusId": "n",
    "coord": [
      117.167026,
      39.104806
    ],
    "desc": "北区学生食堂之一。"
  },
  {
    "id": "n_canteen_03",
    "name": "学生三食堂",
    "category": "canteen",
    "campusId": "n",
    "coord": [
      117.165837,
      39.104806
    ],
    "desc": "北区学生食堂，邻近物美超市。"
  },
  {
    "id": "n_sports_01",
    "name": "体育场（田径场）",
    "category": "sports",
    "campusId": "n",
    "coord": [
      117.16927,
      39.105496
    ],
    "desc": "标准田径场，含足球场，体育课与晨跑的主场地。"
  },
  {
    "id": "n_sports_02",
    "name": "体育馆",
    "category": "sports",
    "campusId": "n",
    "coord": [
      117.17146,
      39.10514
    ],
    "desc": "室内体育馆，篮球、羽毛球等场地。"
  },
  {
    "id": "n_sports_03",
    "name": "游泳馆",
    "category": "sports",
    "campusId": "n",
    "coord": [
      117.174576,
      39.103724
    ],
    "desc": "游泳馆，游泳课与日常锻炼场所。"
  },
  {
    "id": "n_food_01",
    "name": "西南村",
    "category": "service",
    "campusId": "n",
    "coord": [
      117.161646,
      39.101672
    ],
    "desc": "西南村生活区，聚集各类小吃餐馆，是南开人「食堂之外」的觅食地。"
  },
  {
    "id": "n_express_01",
    "name": "顺丰速运（南开大学店）",
    "category": "service",
    "campusId": "n",
    "coord": [
      117.163427,
      39.106041
    ],
    "desc": "校区快递驿站之一，顺丰件在此取寄。"
  },
  {
    "id": "n_hospital_01",
    "name": "校医院",
    "category": "service",
    "campusId": "n",
    "coord": [
      117.166632,
      39.101544
    ],
    "desc": "校区医院，提供基础诊疗与药品购买。"
  },
  {
    "id": "n_gate_01",
    "name": "东门",
    "category": "gate",
    "campusId": "n",
    "coord": [
      117.177802,
      39.101762
    ],
    "desc": "面向卫津路的主校门，大中路由此向西延伸。"
  },
  {
    "id": "n_gate_02",
    "name": "南门",
    "category": "gate",
    "campusId": "n",
    "coord": [
      117.171385,
      39.101025
    ],
    "desc": "校区南门，邻近复康路一侧。"
  },
  {
    "id": "n_gate_03",
    "name": "西门",
    "category": "gate",
    "campusId": "n",
    "coord": [
      117.160782,
      39.101935
    ],
    "desc": "校区西门，紧邻西南村生活区。"
  },
  {
    "id": "n_landmark_08",
    "name": "西南联大纪念碑",
    "category": "landmark",
    "campusId": "n",
    "coord": [
      117.16935,
      39.102895
    ],
    "desc": "国立西南联合大学纪念碑，纪念抗战时期南开南迁与长沙临时大学、西南联大的办学历史。"
  },
  {
    "id": "n_admin_01",
    "name": "南开大学出版社",
    "category": "admin",
    "campusId": "n",
    "coord": [
      117.158883,
      39.105912
    ],
    "desc": "南开大学出版社，位于校区西北角。"
  },
  {
    "id": "n_teaching_07",
    "name": "电教中心",
    "category": "teaching",
    "campusId": "n",
    "coord": [
      117.166693,
      39.10332
    ],
    "desc": "电教中心，紧邻新图书馆。"
  },
  {
    "id": "n_canteen_04",
    "name": "清真食堂",
    "category": "canteen",
    "campusId": "n",
    "coord": [
      117.167195,
      39.104404
    ],
    "desc": "清真食堂，位于北区食堂群。"
  },
  {
    "id": "n_college_11",
    "name": "经济学院",
    "category": "college",
    "campusId": "n",
    "coord": [
      117.162463,
      39.103321
    ],
    "desc": "经济学院楼（含第一、第二教学楼），位于校区西侧。"
  },
  {
    "id": "n_theater_01",
    "name": "田家炳音乐厅",
    "category": "sports",
    "campusId": "n",
    "coord": [
      117.163614,
      39.105766
    ],
    "desc": "田家炳音乐厅，演出与音乐会场地，紧邻学生活动中心。"
  },
  /* ── 以下八里台点位按《南开大学百年校庆手绘地图》图例补齐 ──
     坐标沿用同一套约定：GCJ02，高德 POI 检索（与站内拾取工具同一坐标系，可直接用）。
     手绘图是艺术变形的俯瞰图，没有比例尺，坐标只能来自 POI 检索或实地拾取；
     高德没有独立 POI 的条目（各宿舍楼、部分教学楼与校门、银行网点等）暂未收录。 */
  {
    "id": "n_teaching_08",
    "name": "综合实验楼",
    "category": "teaching",
    "campusId": "n",
    "coord": [
      117.174078,
      39.102537
    ],
    "desc": "校区东部的公共实验教学楼，楼内设有南大商城与校园文化产品专卖店。"
  },
  {
    "id": "n_admin_02",
    "name": "专家楼",
    "category": "admin",
    "campusId": "n",
    "coord": [
      117.17336,
      39.102068
    ],
    "desc": "校内宾馆与专家楼餐厅，接待来访学者与会议宾客。"
  },
  {
    "id": "n_landmark_09",
    "name": "谊园",
    "category": "landmark",
    "campusId": "n",
    "coord": [
      117.173818,
      39.101415
    ],
    "desc": "校园东南部的园林式庭院，环境清幽，适合散步小坐。"
  },
  {
    "id": "n_busstation_01",
    "name": "校车区（接待服务中心客运部）",
    "category": "transit",
    "campusId": "n",
    "coord": [
      117.178482,
      39.10376
    ],
    "desc": "校区东侧的校车发车点，往返八里台与津南校区的班车在此乘坐。"
  },
  {
    "id": "n_college_12",
    "name": "生物楼（生命科学学院）",
    "category": "college",
    "campusId": "n",
    "coord": [
      117.167545,
      39.102098
    ],
    "desc": "生命科学学院教学科研楼，紧邻范孙楼与新开湖一侧。"
  },
  {
    "id": "n_theater_02",
    "name": "学生活动中心",
    "category": "sports",
    "campusId": "n",
    "coord": [
      117.170575,
      39.103975
    ],
    "desc": "社团活动与学生事务办理的集中场所，门口设有快递柜。"
  },
  {
    "id": "n_shop_01",
    "name": "西南村综合购物中心",
    "category": "service",
    "campusId": "n",
    "coord": [
      117.16325,
      39.101704
    ],
    "desc": "西南村生活区里的综合购物点，日用百货与零食在此采买。"
  },
  {
    "id": "n_landmark_10",
    "name": "明珠园",
    "category": "landmark",
    "campusId": "n",
    "coord": [
      117.173143,
      39.101765
    ],
    "desc": "校园东南部的小园，国际学术交流处设在园内。"
  },
  {
    "id": "n_landmark_11",
    "name": "宁园",
    "category": "landmark",
    "campusId": "n",
    "coord": [
      117.174692,
      39.101831
    ],
    "aliases": ["陈省身故居"],
    "desc": "毗邻谊园路的小园，园内即数学大师陈省身先生的故居。"
  },
  {
    "id": "n_college_13",
    "name": "迦陵学舍",
    "category": "college",
    "campusId": "n",
    "coord": [
      117.175108,
      39.10185
    ],
    "desc": "为叶嘉莹先生（号迦陵）修建的居所与讲学之所，中华古典文化研究所所在。"
  },
  {
    "id": "n_landmark_13",
    "name": "友谊樱花园",
    "category": "landmark",
    "campusId": "n",
    "coord": [
      117.172192,
      39.101117
    ],
    "desc": "校内的樱花小园，春季花开时是热门的拍照点。"
  },
  {
    "id": "n_landmark_14",
    "name": "小花园",
    "category": "landmark",
    "campusId": "n",
    "coord": [
      117.175585,
      39.10279
    ],
    "desc": "校区东部的小花园，紧邻综合实验楼与东方艺术大楼一带。"
  },
  {
    "id": "n_landmark_15",
    "name": "春城弦诵广场",
    "category": "landmark",
    "campusId": "n",
    "coord": [
      117.165483,
      39.103538
    ],
    "desc": "图书馆西侧的广场，「春城弦诵」取自咏诵南开办学的诗句。"
  },
  {
    "id": "n_sports_04",
    "name": "网球场",
    "category": "sports",
    "campusId": "n",
    "coord": [
      117.17109,
      39.105197
    ],
    "desc": "室外网球场，体育课与课余约球的主要场地。"
  },
  {
    "id": "n_college_14",
    "name": "药学院",
    "category": "college",
    "campusId": "n",
    "coord": [
      117.175089,
      39.105983
    ],
    "desc": "药学院教学科研楼，位于校区东北部。"
  },
  {
    "id": "n_college_15",
    "name": "外国语学院",
    "category": "college",
    "campusId": "n",
    "coord": [
      117.165563,
      39.104042
    ],
    "desc": "外国语学院教学科研楼，位于校区中西部。"
  },
  {
    "id": "n_college_16",
    "name": "统计与数据科学学院",
    "category": "college",
    "campusId": "n",
    "coord": [
      117.16629,
      39.10211
    ],
    "desc": "统计与数据科学学院教学科研楼，邻近文化素质教育活动中心。"
  },
  {
    "id": "n_college_17",
    "name": "化学学院分析科学研究中心",
    "category": "college",
    "campusId": "n",
    "coord": [
      117.16454,
      39.104431
    ],
    "desc": "化学学院分析科学研究中心，位于校区西北部实验区。"
  },
  {
    "id": "n_dormitory_01",
    "name": "西区公寓",
    "category": "dormitory",
    "campusId": "n",
    "coord": [
      117.160293,
      39.106834
    ],
    "desc": "校区西北部的学生公寓组团，邻近中心实验室与组合教学中心。"
  },
  {
    "id": "n_dormitory_02",
    "name": "学生宿舍区",
    "category": "dormitory",
    "campusId": "n",
    "coord": [
      117.169236,
      39.104116
    ],
    "desc": "八里台校区中部学生宿舍组团，紧邻食堂群与体育场。"
  },
  {
    "id": "n_dormitory_03",
    "name": "东村",
    "category": "dormitory",
    "campusId": "n",
    "coord": [
      117.178422,
      39.102926
    ],
    "desc": "校区东侧的教职工住宅区，邻近大中路东段。"
  },
  {
    "id": "j_library_01",
    "name": "津南校区图书馆",
    "category": "library",
    "campusId": "j",
    "coord": [
      117.346974,
      38.986286
    ],
    "desc": "津南校区中心图书馆，空间宽敞、自习氛围好。"
  },
  {
    "id": "j_teaching_01",
    "name": "公共教学楼C区",
    "category": "teaching",
    "campusId": "j",
    "coord": [
      117.342801,
      38.988329
    ],
    "desc": "本科生公共课程教学楼。"
  },
  {
    "id": "j_teaching_02",
    "name": "公共教学楼D区",
    "category": "teaching",
    "campusId": "j",
    "coord": [
      117.345993,
      38.989238
    ],
    "desc": "本科生公共课程教学楼。"
  },
  {
    "id": "j_teaching_03",
    "name": "电子信息实验教学中心",
    "category": "teaching",
    "campusId": "j",
    "coord": [
      117.347704,
      38.988031
    ],
    "desc": "电子信息类实验教学中心。"
  },
  {
    "id": "j_teaching_04",
    "name": "综合实验楼",
    "category": "teaching",
    "campusId": "j",
    "coord": [
      117.349099,
      38.988928
    ],
    "desc": "综合实验教学楼群。"
  },
  {
    "id": "j_dorm_01",
    "name": "学生公寓",
    "category": "dormitory",
    "campusId": "j",
    "coord": [
      117.344178,
      38.992447
    ],
    "desc": "津南校区学生公寓区。"
  },
  {
    "id": "j_canteen_01",
    "name": "第一食堂",
    "category": "canteen",
    "campusId": "j",
    "coord": [
      117.342336,
      38.992424
    ],
    "desc": "津南校区主要食堂之一，紧邻学生公寓区。"
  },
  {
    "id": "j_canteen_02",
    "name": "第二食堂",
    "category": "canteen",
    "campusId": "j",
    "coord": [
      117.341225,
      38.986165
    ],
    "desc": "津南校区食堂之一，位于校区西南部。"
  },
  {
    "id": "j_sports_01",
    "name": "体育馆",
    "category": "sports",
    "campusId": "j",
    "coord": [
      117.347626,
      38.991919
    ],
    "desc": "津南校区室内体育馆。"
  },
  {
    "id": "j_theater_01",
    "name": "大学生活动中心",
    "category": "sports",
    "campusId": "j",
    "coord": [
      117.350444,
      38.98823
    ],
    "desc": "大通学生中心，社团活动与讲座的主要场地。"
  },
  {
    "id": "j_college_01",
    "name": "金融学院",
    "category": "college",
    "campusId": "j",
    "coord": [
      117.34346,
      38.990144
    ],
    "desc": "金融学院大楼，位于校区西北部。"
  },
  {
    "id": "j_college_02",
    "name": "材料科学与工程学院",
    "category": "college",
    "campusId": "j",
    "coord": [
      117.343057,
      38.987573
    ],
    "desc": "材料科学与工程学院教学科研楼。"
  },
  {
    "id": "j_college_03",
    "name": "计算机学院",
    "category": "college",
    "campusId": "j",
    "coord": [
      117.342775,
      38.986625
    ],
    "desc": "计算机学院（网络空间安全学院）教学科研楼。"
  },
  {
    "id": "j_college_04",
    "name": "人工智能学院北楼",
    "category": "college",
    "campusId": "j",
    "coord": [
      117.341779,
      38.987988
    ],
    "desc": "人工智能学院楼（北楼）。"
  },
  {
    "id": "j_college_05",
    "name": "软件学院",
    "category": "college",
    "campusId": "j",
    "coord": [
      117.341934,
      38.987802
    ],
    "desc": "软件学院教学楼。"
  },
  {
    "id": "j_hospital_01",
    "name": "校医院",
    "category": "service",
    "campusId": "j",
    "coord": [
      117.341864,
      38.994124
    ],
    "desc": "津南校区校医院。"
  },
  {
    "id": "j_gate_01",
    "name": "西门",
    "category": "gate",
    "campusId": "j",
    "coord": [
      117.339575,
      38.983975
    ],
    "desc": "津南校区西门。"
  },
  {
    "id": "j_transit_01",
    "name": "海河教育园区地铁站",
    "category": "transit",
    "campusId": "j",
    "coord": [
      117.322181,
      38.988951
    ],
    "desc": "海河教育园区轨道交通站点，津南校区师生进出市区的重要交通节点。"
  },
  {
    "id": "j_admin_01",
    "name": "综合业务西楼",
    "category": "admin",
    "campusId": "j",
    "coord": [
      117.345725,
      38.986225
    ],
    "desc": "综合业务楼，与东楼分列校园中轴线两侧，紧邻图书馆。"
  },
  {
    "id": "j_admin_02",
    "name": "综合业务东楼",
    "category": "admin",
    "campusId": "j",
    "coord": [
      117.348223,
      38.986225
    ],
    "desc": "综合业务楼，与西楼分列校园中轴线两侧，紧邻图书馆。"
  },
  {
    "id": "j_college_06",
    "name": "哲学院",
    "category": "college",
    "campusId": "j",
    "coord": [
      117.344147,
      38.99074
    ],
    "desc": "文科学院组团之一，位于校区西北部。"
  },
  {
    "id": "j_college_07",
    "name": "马克思主义教育学院",
    "category": "college",
    "campusId": "j",
    "coord": [
      117.344177,
      38.991243
    ],
    "desc": "文科学院组团之一，位于校区西北部。"
  },
  {
    "id": "j_college_08",
    "name": "历史学院",
    "category": "college",
    "campusId": "j",
    "coord": [
      117.343471,
      38.99114
    ],
    "desc": "文科学院组团之一，位于校区西北部。"
  },
  {
    "id": "j_college_09",
    "name": "周恩来政府管理学院",
    "category": "college",
    "campusId": "j",
    "coord": [
      117.342517,
      38.991353
    ],
    "desc": "文科学院组团之一，位于校区西北部。"
  },
  {
    "id": "j_college_10",
    "name": "汉语言文化学院",
    "category": "college",
    "campusId": "j",
    "coord": [
      117.341757,
      38.990665
    ],
    "desc": "文科学院组团之一，位于校区西北部。"
  },
  {
    "id": "j_college_11",
    "name": "法学院",
    "category": "college",
    "campusId": "j",
    "coord": [
      117.342266,
      38.990299
    ],
    "desc": "文科学院组团之一，位于校区西北部。"
  },
  {
    "id": "j_college_12",
    "name": "医学院",
    "category": "college",
    "campusId": "j",
    "coord": [
      117.33691,
      38.986981
    ],
    "desc": "理科学院一组团，位于校区西部。"
  },
  {
    "id": "j_college_13",
    "name": "药学院",
    "category": "college",
    "campusId": "j",
    "coord": [
      117.337758,
      38.987719
    ],
    "desc": "理科学院一组团，位于校区西部。"
  },
  {
    "id": "j_college_14",
    "name": "环境科学与工程学院",
    "category": "college",
    "campusId": "j",
    "coord": [
      117.337425,
      38.989196
    ],
    "desc": "理科学院一组团，位于校区西部。"
  },
  {
    "id": "j_college_15",
    "name": "旅游与服务学院",
    "category": "college",
    "campusId": "j",
    "coord": [
      117.338054,
      38.991045
    ],
    "desc": "对外办学组团，位于校区西部。"
  },
  {
    "id": "j_dorm_02",
    "name": "留学生宿舍（A-E楼）",
    "category": "dormitory",
    "campusId": "j",
    "coord": [
      117.339726,
      38.992515
    ],
    "desc": "对外办学组团留学生宿舍A至E楼。"
  },
  {
    "id": "j_landmark_01",
    "name": "思源堂",
    "category": "landmark",
    "campusId": "j",
    "coord": [
      117.340346,
      38.990203
    ],
    "desc": "复建的南开历史建筑思源堂，与木斋馆、秀山堂同为津南校区标志性人文景观。"
  },
  {
    "id": "j_landmark_02",
    "name": "木斋图书馆",
    "category": "landmark",
    "campusId": "j",
    "coord": [
      117.3401,
      38.99
    ],
    "desc": "复建的木斋图书馆，南开历史建筑之一，毗邻思源堂与秀山堂。"
  },
  {
    "id": "j_landmark_03",
    "name": "秀山堂",
    "category": "landmark",
    "campusId": "j",
    "coord": [
      117.340104,
      38.989021
    ],
    "desc": "复建的南开历史建筑秀山堂，与思源堂、木斋馆毗邻。"
  }
]

/* ================= 高德密钥（lbs.amap.com 控制台申请，应用类型：Web端(JS API)） =================
 * 与点位数据同住本文件：密钥属于站点资产，不随主题包分发。
 * 泄露处理：到控制台重置 key 与安全密钥后同步替换这里。 */
export const AMAP_KEY = 'fe37a7d989ade35c41747b9165b565be'
export const AMAP_SECURITY_JS_CODE = 'acc16e636d7724ddb9da843854da04e4'
