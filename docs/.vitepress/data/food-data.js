/**
 * NKUwiki 美食推荐数据（页面：04.校园生活/02.美食推荐）
 *
 * 添加条目：在 FOODS 数组追加 { id, name, category, campus, location, price, tags, recommend, desc, cover, gallery }
 * - id 是评论与评分的唯一标识（Twikoo 路径 /food/<id>），把 id 当「主键」而非「名字」用
 * - category 取 FOOD_CATEGORIES 里的 key：食堂按楼层（canteen-yi-1f …），其余是 xinancun / outside
 * - 同一品牌在不同商场的门店各占一条（各自独立评分），id 用「地点-店名拼音」区分
 * - price / recommend / desc 是编辑参考值，欢迎同学投稿修正；留空的字段在页面上自动隐藏
 * - cover / gallery 需 https 直链，没有图就留空（卡片用店名首字占位）
 *
 * ── 关于修改 id ──
 * 原则：店改名、搬家、换菜单都【不要】动 id——id 跟店不跟名，只改对应字段即可。
 * 确需更换 id 时（如当初的 slug 起得太糟），按顺序做两件事：
 * 1. 新条目的 id 换成新值，并加 aliases: ['旧id'] —— 旧评分仍会计入平均分（前端自动兼容）
 * 2. 让后端在 Twikoo 数据库里把旧路径的评论迁移到新路径，否则弹窗里看不到历史评论：
 *    MongoDB:  db.comment.updateMany({ url: '/food/旧id' }, { $set: { url: '/food/新id' } })
 *    MySQL:    UPDATE comment SET url = '/food/新id' WHERE url = '/food/旧id';
 *    （集合/表名以实际部署为准；迁移前先备份。迁移完成后 aliases 可保留也可移除）
 */
import { CANTEEN_FOODS } from './food-canteens.js'

/**
 * 食堂实拍卡片的手写补充，按 id 覆盖自动生成的字段。
 *
 * 卡片本身由 scripts/fetch-bili-food.mjs 从 B 站合集「南开食堂天天吃」生成到
 * food-canteens.js（重跑会整体覆盖，别去那边改）。一种食物一张卡，
 * id 形如 `canteen-<楼层>-<菜名拼音>`；「几食堂几楼」是卡片的 location，
 * 分类统一是 canteen。要补人均、改文案，或者把待定的卡片认领到具体楼层，
 * 都写在这里，例如：
 *   'canteen-yi-1f-kao-ya-fan': { price: '¥12' }
 */
const CANTEEN_META = {}

/** 校区 key → 展示名 */
/** @type {Record<string, string>} */
export const FOOD_CAMPUS = {
	balitai: '八里台校区',
	jinnan: '津南校区',
}

/**
 * 分类 = 地点。食堂按「几食堂几楼」拆成独立分类，校外按一个商圈大类收口。
 *
 * key 只有一份：食堂楼层用 `canteen-<短码>`，短码与 scripts/fetch-bili-food.mjs
 * 的 PLACE_DEFS 一一对应（那个脚本生成卡片时就写这个 key）；投稿助手也直接读这张表
 * 当选项，别在别处再写一遍。
 *
 * campus 是「这个分类属于哪个校区」：两校区相距 20km、食堂名字不重合，一食堂二楼
 * 只在八里台有。页面上的 chip 按「当前校区有没有卡片」实时决定显不显示（见
 * site-components/food-filter.js），这里的 campus 供投稿助手用 —— 选了楼层就把
 * 校区跟着定下来，避免投稿时把八里台的楼层挂到津南去。校外商圈两个校区都有，
 * 不写 campus。新增分类时若只属于一个校区，记得补上。
 *
 * 顺序即页面上的 chip 顺序与分组顺序：按「一食 1F → 三食 3F → 待定 → 西南村 → 校外」的动线。
 */
export const FOOD_CATEGORIES = [
	{ key: 'canteen-yi-1f', label: '一食堂一楼', campus: 'balitai' },
	{ key: 'canteen-yi-2f', label: '一食堂二楼', campus: 'balitai' },
	{ key: 'canteen-er-1f', label: '二食堂一楼', campus: 'balitai' },
	{ key: 'canteen-er-2f', label: '二食堂二楼', campus: 'balitai' },
	{ key: 'canteen-er-3f', label: '二食堂三楼', campus: 'balitai' },
	{ key: 'canteen-san-1f', label: '三食堂一楼', campus: 'balitai' },
	{ key: 'canteen-san-2f', label: '三食堂二楼', campus: 'balitai' },
	{ key: 'canteen-san-3f', label: '三食堂三楼', campus: 'balitai' },
	{ key: 'canteen-qingzhen', label: '清真食堂', campus: 'balitai' },
	{ key: 'canteen-jingyuan', label: '静园餐厅', campus: 'balitai' },
	// 标题只写到「几食堂」或没写地点的，等人认领
	{ key: 'canteen-tbd', label: '待定', campus: 'balitai' },
	{ key: 'xinancun', label: '西南村', campus: 'balitai' },
	// 五个商圈（大悦城 / 鲁能城 / 吾悦广场 / 新华城市广场 / 永旺梦乐城）合并为一个分类，
	// 具体去哪家看卡片的 location；原「饮品甜点」也并进来，奶茶咖啡跟着商圈走
	{ key: 'outside', label: '校外商圈' },
]

/** 食堂卡：一种食物一张，分类即楼层（category 与 location 都是「几食堂几楼」） */

function photoList(item) {
	if (Array.isArray(item.gallery) && item.gallery.length)
		return item.gallery.filter(Boolean)
	if (Array.isArray(item.photos) && item.photos.length)
		return item.photos.filter(Boolean)
	return item.cover ? [item.cover] : []
}

export const FOODS = [
	/* ===== 食堂 · 分类即楼层（B 站实拍生成，见 scripts/fetch-bili-food.mjs） ===== */
	...CANTEEN_FOODS.map(item => ({ ...item, ...CANTEEN_META[item.id] })),

	/* ===== 西南村（校内，单独一个分类） ===== */
	{
		id: 'xinancun-laotao-baozipu',
		name: '老陶包子铺',
		category: 'xinancun',
		campus: 'balitai',
		location: '西南村',
		price: '¥10 左右',
		tags: ['包子点心'],
		recommend: '现包蒸制的包子',
		desc: '西南村的包子铺，适合顺手带一份早点。',
	},
	{
		id: 'xinancun-wuhan-reganmian',
		name: '武汉热干面',
		category: 'xinancun',
		campus: 'balitai',
		location: '西南村',
		price: '¥8-15',
		tags: ['面食'],
		recommend: '热干面',
		desc: '主打武汉风味热干面的小面馆。',
	},
	{
		id: 'xinancun-sansheng-niuroufan',
		name: '清真三升特色牛肉饭',
		category: 'xinancun',
		campus: 'balitai',
		location: '西南村',
		price: '¥15-25',
		tags: ['清真', '盖饭'],
		recommend: '牛肉饭',
		desc: '清真档口，主打各类牛肉饭。',
	},
	{
		id: 'xinancun-chongqing-chuanxiang',
		name: '重庆一绝串串香',
		category: 'xinancun',
		campus: 'balitai',
		location: '西南村',
		price: '¥30-60',
		tags: ['串串香', '辣'],
		desc: '川味串串香，适合多人聚餐。',
	},
	{
		id: 'xinancun-liangshi-hanguoliaoli',
		name: '梁氏韩国料理',
		category: 'xinancun',
		campus: 'balitai',
		location: '西南村',
		price: '¥20-40',
		tags: ['韩餐'],
		desc: '西南村的韩式小馆。',
	},
	{
		id: 'xinancun-shalina-xiaochi',
		name: '莎莉娜特色风味小吃',
		category: 'xinancun',
		campus: 'balitai',
		location: '西南村',
		price: '¥10-20',
		tags: ['小吃'],
		desc: '风味小吃店，品类多，适合换口味。',
	},
	{
		id: 'xinancun-shuigudian',
		name: '西南村水果店',
		category: 'xinancun',
		campus: 'balitai',
		location: '西南村',
		tags: ['水果'],
		desc: '买水果的顺手去处。',
	},
	{
		id: 'xinancun-zuiai-gailiwu',
		name: '醉爱咖喱屋',
		category: 'xinancun',
		campus: 'balitai',
		location: '西南村',
		price: '¥12-22',
		tags: ['咖喱', '盖饭'],
		recommend: '咖喱鸡排饭',
		desc: '专做咖喱饭的小店，鸡排饭 15 元起，现点现炸浇汁。咖喱口味偏清淡。',
		detail: '西南村里专做咖喱饭的小店，菜单：咖喱鸡排饭 15 元、咖喱猪肉饭 15 元、咖喱鸡肉饭 15 元、咖喱蛋包饭 15 元、咖喱猪排饭 17 元、咖喱牛肉饭 22 元、咖喱蔬菜饭 12 元，另有韩式冷面 13 元、蔬菜沙拉 7 元，可以加卤蛋 2 元/个、鸡排 5 元/份、猪排 8 元/份。实拍为咖喱鸡排饭：鸡排切块盖在饭上，配土豆胡萝卜咖喱浓汤和一撮蔬菜丝。咖喱味道有些淡，常吃咖喱饭的人可能会觉得不够浓郁，重口可以加点猪排或自己调味。图集第二张附完整菜单。',
		cover: '/img/food/shots/zuiai-gailiwu-jipaifan.webp',
		gallery: ['/img/food/shots/zuiai-gailiwu-jipaifan.webp', '/img/food/shots/zuiai-gailiwu-caidan.webp'],
	},

	/* ===== 八里台 · 大悦城（南开店） ===== */
	{
		id: 'dayuecheng-luxihe',
		name: '泸溪河桃酥',
		category: 'outside',
		campus: 'balitai',
		location: '大悦城（南开店）',
		price: '¥15-30',
		tags: ['糕点'],
		recommend: '桃酥、泡芙',
		desc: '连锁新中式糕点品牌，桃酥是招牌。',
	},
	{
		id: 'dayuecheng-yerenmufang',
		name: '野人牧坊',
		category: 'outside',
		campus: 'balitai',
		location: '大悦城（南开店）',
		price: '¥10-25',
		tags: ['甜品', '酸奶'],
		desc: '甜品饮品小店。',
	},
	{
		id: 'dayuecheng-luckin',
		name: '瑞幸咖啡',
		category: 'outside',
		campus: 'balitai',
		location: '大悦城（南开店）',
		price: '¥10-25',
		tags: ['咖啡'],
		recommend: '生椰拿铁',
		desc: '连锁咖啡品牌，常有大幅优惠券。',
	},
	{
		id: 'dayuecheng-xianguoshijian',
		name: '鲜果时间',
		category: 'outside',
		campus: 'balitai',
		location: '大悦城（南开店）',
		price: '¥10-20',
		tags: ['果汁', '奶茶'],
		desc: '连锁果汁饮品店。',
	},
	{
		id: 'dayuecheng-wenyecai',
		name: '温野菜日本涮涮锅',
		category: 'outside',
		campus: 'balitai',
		location: '大悦城（南开店）',
		price: '¥80-120',
		tags: ['日式', '火锅', '自助'],
		desc: '日式涮涮锅自助连锁，蔬菜与小锅为主。',
	},
	{
		id: 'dayuecheng-xiabuxiabu',
		name: '呷哺呷哺',
		category: 'outside',
		campus: 'balitai',
		location: '大悦城（南开店）',
		price: '¥50-80',
		tags: ['小火锅'],
		recommend: '麻酱小料',
		desc: '连锁小火锅，一人一锅的形式，适合一人食。',
	},
	{
		id: 'dayuecheng-shaojianglaorou',
		name: '烧江南烤肉',
		category: 'outside',
		campus: 'balitai',
		location: '大悦城（南开店）',
		price: '¥80-130',
		tags: ['烤肉'],
		desc: '连锁烤肉品牌。',
	},
	{
		id: 'dayuecheng-sandailaorou',
		name: '三代烤肉',
		category: 'outside',
		campus: 'balitai',
		location: '大悦城（南开店）',
		price: '¥70-120',
		tags: ['烤肉'],
		desc: '连锁烤肉店。',
	},
	{
		id: 'dayuecheng-yuku',
		name: '鱼酷',
		category: 'outside',
		campus: 'balitai',
		location: '大悦城（南开店）',
		price: '¥50-80',
		tags: ['烤鱼'],
		desc: '连锁烤鱼品牌，口味选择多。',
	},
	{
		id: 'dayuecheng-dashucanting',
		name: '大树餐厅',
		category: 'outside',
		campus: 'balitai',
		location: '大悦城（南开店）',
		price: '¥50-90',
		tags: ['融合菜'],
		desc: '家常融合菜餐厅。',
	},
	{
		id: 'dayuecheng-subway',
		name: '赛百味',
		category: 'outside',
		campus: 'balitai',
		location: '大悦城（南开店）',
		price: '¥20-40',
		tags: ['三明治', '轻食'],
		desc: '连锁三明治品牌，可自选面包与配菜。',
	},

	/* ===== 八里台 · 鲁能城 ===== */
	{
		id: 'lunengcheng-xianyuxian',
		name: '鲜芋仙',
		category: 'outside',
		campus: 'balitai',
		location: '鲁能城',
		price: '¥20-35',
		tags: ['甜品'],
		recommend: '芋圆系列',
		desc: '台式甜品连锁，芋圆糖水是主打。',
	},
	{
		id: 'lunengcheng-xicunshushu',
		name: '西村叔叔的店',
		category: 'outside',
		campus: 'balitai',
		location: '鲁能城',
		price: '¥30-50',
		tags: ['日式', '甜品'],
		desc: '日式风格甜品店。',
	},
	{
		id: 'lunengcheng-xicha',
		name: '喜茶',
		category: 'outside',
		campus: 'balitai',
		location: '鲁能城',
		price: '¥15-35',
		tags: ['奶茶'],
		recommend: '多肉葡萄',
		desc: '连锁新茶饮品牌。',
	},
	{
		id: 'lunengcheng-starbucks',
		name: '星巴克',
		category: 'outside',
		campus: 'balitai',
		location: '鲁能城',
		price: '¥30-45',
		tags: ['咖啡'],
		desc: '连锁咖啡品牌，适合坐下自习聊天。',
	},
	{
		id: 'lunengcheng-xiongmiaolaile',
		name: '熊喵来了',
		category: 'outside',
		campus: 'balitai',
		location: '鲁能城',
		price: '¥25-45',
		tags: ['麻辣烫'],
		desc: '连锁麻辣烫品牌。',
	},
	{
		id: 'lunengcheng-xiabuxiabu',
		name: '呷哺呷哺',
		category: 'outside',
		campus: 'balitai',
		location: '鲁能城',
		price: '¥50-80',
		tags: ['小火锅'],
		recommend: '麻酱小料',
		desc: '连锁小火锅，一人一锅的形式，适合一人食。',
	},
	{
		id: 'lunengcheng-haidilao',
		name: '海底捞',
		category: 'outside',
		campus: 'balitai',
		location: '鲁能城',
		price: '¥90-130',
		tags: ['火锅'],
		recommend: '番茄锅底',
		desc: '连锁火锅品牌，以服务细致著称。',
	},
	{
		id: 'lunengcheng-lihuazizhu',
		name: '梨花自助烤肉',
		category: 'outside',
		campus: 'balitai',
		location: '鲁能城',
		price: '¥60-90',
		tags: ['烤肉', '自助'],
		desc: '自助烤肉店，品类固定、走性价比路线。',
	},
	{
		id: 'lunengcheng-sandailaorou',
		name: '三代烤肉',
		category: 'outside',
		campus: 'balitai',
		location: '鲁能城',
		price: '¥70-120',
		tags: ['烤肉'],
		desc: '连锁烤肉店。',
	},
	{
		id: 'lunengcheng-shangyuwei',
		name: '尚渔味双拼烤鱼',
		category: 'outside',
		campus: 'balitai',
		location: '鲁能城',
		price: '¥50-80',
		tags: ['烤鱼'],
		desc: '连锁烤鱼品牌，可双拼口味。',
	},
	{
		id: 'lunengcheng-bantianyao',
		name: '半天妖烤鱼',
		category: 'outside',
		campus: 'balitai',
		location: '鲁能城',
		price: '¥50-80',
		tags: ['烤鱼'],
		desc: '连锁烤鱼品牌，门店多。',
	},
	{
		id: 'lunengcheng-hanbaowang',
		name: '汉堡王',
		category: 'outside',
		campus: 'balitai',
		location: '鲁能城',
		price: '¥25-45',
		tags: ['快餐', '汉堡'],
		desc: '连锁快餐品牌，主打火烤汉堡。',
	},
	{
		id: 'lunengcheng-binsousi',
		name: '滨寿司',
		category: 'outside',
		campus: 'balitai',
		location: '鲁能城',
		price: '¥40-80',
		tags: ['寿司'],
		desc: '回转寿司连锁，按碟计价。',
	},

	/* ===== 津南 · 吾悦广场 ===== */
	{
		id: 'wuyueguangchang-suhou',
		name: '酥侯糕点',
		category: 'outside',
		campus: 'jinnan',
		location: '吾悦广场',
		price: '¥15-30',
		tags: ['糕点'],
		desc: '连锁糕点品牌。',
	},
	{
		id: 'wuyueguangchang-dq',
		name: 'DQ',
		category: 'outside',
		campus: 'jinnan',
		location: '吾悦广场',
		price: '¥25-40',
		tags: ['冰淇淋'],
		recommend: '暴风雪',
		desc: '冰淇淋连锁，暴风雪是招牌。',
	},
	{
		id: 'wuyueguangchang-starbucks',
		name: '星巴克',
		category: 'outside',
		campus: 'jinnan',
		location: '吾悦广场',
		price: '¥30-45',
		tags: ['咖啡'],
		desc: '连锁咖啡品牌。',
	},
	{
		id: 'wuyueguangchang-bawangchaji',
		name: '霸王茶姬',
		category: 'outside',
		campus: 'jinnan',
		location: '吾悦广场',
		price: '¥15-25',
		tags: ['奶茶'],
		recommend: '伯牙绝弦',
		desc: '连锁原叶鲜奶茶品牌。',
	},
	{
		id: 'wuyueguangchang-haidilao',
		name: '海底捞',
		category: 'outside',
		campus: 'jinnan',
		location: '吾悦广场',
		price: '¥90-130',
		tags: ['火锅'],
		recommend: '番茄锅底',
		desc: '连锁火锅品牌，以服务细致著称。',
	},
	{
		id: 'wuyueguangchang-xiabuxiabu',
		name: '呷哺呷哺',
		category: 'outside',
		campus: 'jinnan',
		location: '吾悦广场',
		price: '¥50-80',
		tags: ['小火锅'],
		recommend: '麻酱小料',
		desc: '连锁小火锅，一人一锅的形式，适合一人食。',
	},
	{
		id: 'wuyueguangchang-xitalaotaitai',
		name: '西塔老太太泥炉烤肉',
		category: 'outside',
		campus: 'jinnan',
		location: '吾悦广场',
		price: '¥80-130',
		tags: ['烤肉'],
		desc: '延边风味泥炉烤肉连锁。',
	},
	{
		id: 'wuyueguangchang-jiucunding',
		name: '津创九寸钉',
		category: 'outside',
		campus: 'jinnan',
		location: '吾悦广场',
		tags: ['西餐'],
		desc: '欢迎吃过同学补充人均与推荐菜。',
	},
	{
		id: 'wuyueguangchang-yuku',
		name: '鱼酷',
		category: 'outside',
		campus: 'jinnan',
		location: '吾悦广场',
		price: '¥50-80',
		tags: ['烤鱼'],
		desc: '连锁烤鱼品牌，口味选择多。',
	},
	{
		id: 'wuyueguangchang-bantianyao',
		name: '半天妖',
		category: 'outside',
		campus: 'jinnan',
		location: '吾悦广场',
		price: '¥50-80',
		tags: ['烤鱼'],
		desc: '连锁烤鱼品牌，门店多。',
	},
	{
		id: 'wuyueguangchang-ganfanxiang',
		name: '干饭湘',
		category: 'outside',
		campus: 'jinnan',
		location: '吾悦广场',
		price: '¥40-70',
		tags: ['湘菜', '辣'],
		desc: '湘菜馆，口味偏辣。',
	},
	{
		id: 'wuyueguangchang-kfc',
		name: '肯德基',
		category: 'outside',
		campus: 'jinnan',
		location: '吾悦广场',
		price: '¥25-45',
		tags: ['快餐', '炸鸡'],
		desc: '连锁快餐品牌。',
	},

	/* ===== 津南 · 新华城市广场 ===== */
	{
		id: 'xinhuachengshi-dq',
		name: 'DQ',
		category: 'outside',
		campus: 'jinnan',
		location: '新华城市广场',
		price: '¥25-40',
		tags: ['冰淇淋'],
		recommend: '暴风雪',
		desc: '冰淇淋连锁，暴风雪是招牌。',
	},
	{
		id: 'xinhuachengshi-luckin',
		name: '瑞幸咖啡',
		category: 'outside',
		campus: 'jinnan',
		location: '新华城市广场',
		price: '¥10-25',
		tags: ['咖啡'],
		recommend: '生椰拿铁',
		desc: '连锁咖啡品牌，常有大幅优惠券。',
	},
	{
		id: 'xinhuachengshi-hushangayi',
		name: '沪上阿姨',
		category: 'outside',
		campus: 'jinnan',
		location: '新华城市广场',
		price: '¥12-25',
		tags: ['奶茶'],
		desc: '连锁五谷茶饮品牌。',
	},
	{
		id: 'xinhuachengshi-fangzhuyuan',
		name: '芳竹园火锅',
		category: 'outside',
		campus: 'jinnan',
		location: '新华城市广场',
		price: '¥60-100',
		tags: ['火锅'],
		desc: '本地火锅店。',
	},
	{
		id: 'xinhuachengshi-haidilao',
		name: '海底捞',
		category: 'outside',
		campus: 'jinnan',
		location: '新华城市广场',
		price: '¥90-130',
		tags: ['火锅'],
		recommend: '番茄锅底',
		desc: '连锁火锅品牌，以服务细致著称。',
	},
	{
		id: 'xinhuachengshi-jiushangding',
		name: '九尚鼎烤肉',
		category: 'outside',
		campus: 'jinnan',
		location: '新华城市广场',
		price: '¥70-110',
		tags: ['烤肉'],
		desc: '烤肉店。',
	},
	{
		id: 'xinhuachengshi-shangyuwei',
		name: '尚渔味',
		category: 'outside',
		campus: 'jinnan',
		location: '新华城市广场',
		price: '¥50-80',
		tags: ['烤鱼'],
		desc: '连锁烤鱼品牌。',
	},
	{
		id: 'xinhuachengshi-dominos',
		name: '达美乐比萨',
		category: 'outside',
		campus: 'jinnan',
		location: '新华城市广场',
		price: '¥35-60',
		tags: ['比萨'],
		desc: '连锁比萨品牌，以外送见长。',
	},
	{
		id: 'xinhuachengshi-hanbaowang',
		name: '汉堡王',
		category: 'outside',
		campus: 'jinnan',
		location: '新华城市广场',
		price: '¥25-45',
		tags: ['快餐', '汉堡'],
		desc: '连锁快餐品牌，主打火烤汉堡。',
	},

	/* ===== 津南 · 永旺梦乐城 ===== */
	{
		id: 'yongwang-luxihe',
		name: '泸溪河桃酥',
		category: 'outside',
		campus: 'jinnan',
		location: '永旺梦乐城',
		price: '¥15-30',
		tags: ['糕点'],
		recommend: '桃酥、泡芙',
		desc: '连锁新中式糕点品牌，桃酥是招牌。',
	},
	{
		id: 'yongwang-dq',
		name: 'DQ',
		category: 'outside',
		campus: 'jinnan',
		location: '永旺梦乐城',
		price: '¥25-40',
		tags: ['冰淇淋'],
		recommend: '暴风雪',
		desc: '冰淇淋连锁，暴风雪是招牌。',
	},
	{
		id: 'yongwang-chatailiangpin',
		name: '茶太良品',
		category: 'outside',
		campus: 'jinnan',
		location: '永旺梦乐城',
		price: '¥10-20',
		tags: ['奶茶'],
		desc: '平价连锁奶茶品牌。',
	},
	{
		id: 'yongwang-cotti',
		name: '库迪咖啡',
		category: 'outside',
		campus: 'jinnan',
		location: '永旺梦乐城',
		price: '¥9-20',
		tags: ['咖啡'],
		desc: '连锁咖啡品牌，定价偏低，常发券。',
	},
	{
		id: 'yongwang-shangyuwei',
		name: '尚渔味',
		category: 'outside',
		campus: 'jinnan',
		location: '永旺梦乐城',
		price: '¥50-80',
		tags: ['烤鱼'],
		desc: '连锁烤鱼品牌。',
	},
	{
		id: 'yongwang-micunbanfan',
		name: '米村拌饭',
		category: 'outside',
		campus: 'jinnan',
		location: '永旺梦乐城',
		price: '¥25-40',
		tags: ['拌饭'],
		recommend: '石锅拌饭',
		desc: '延边风味拌饭连锁，出餐快。',
	},
	{
		id: 'yongwang-xiaocaiyuan',
		name: '小菜园',
		category: 'outside',
		campus: 'jinnan',
		location: '永旺梦乐城',
		price: '¥40-60',
		tags: ['家常菜'],
		desc: '平价家常菜连锁。',
	},
]

export function getFoodPhotos(item) {
	return photoList(item || {})
}

export function getFoodCategoryLabel(key) {
	return FOOD_CATEGORIES.find(category => category.key === key)?.label || '其他'
}
