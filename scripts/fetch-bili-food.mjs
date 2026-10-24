/**
 * 抓取 B 站合集「南开食堂天天吃」→ 解析标题 → 每道菜生成一张卡片 → 下载封面
 *
 * 用法：
 *   node scripts/fetch-bili-food.mjs                # 抓取、下封面、生成数据
 *   node scripts/fetch-bili-food.mjs --dry          # 只打印解析结果，不写文件、不下图
 *   node scripts/fetch-bili-food.mjs --refresh      # 强制重新下载已有封面
 *   node scripts/fetch-bili-food.mjs --refresh-data # 忽略接口缓存，重新抓取列表
 *
 * 产物：
 *   docs/.vitepress/data/food-canteens.js   （自动生成，勿手改）
 *   docs/public/food/shots/<bvid>.webp
 *   docs/.vitepress/cache/bili-food-raw.json（接口原始响应，6 小时内复用）
 *
 * 为什么要缓存：B 站接口连打十几页会触发风控（code=-352），而调文案/规则时
 * 根本不需要重新要数据。缓存放在 vitepress 的 cache 目录（已被 gitignore）。
 *
 * ── 卡片粒度：一个窗口 / 一家店一张卡 ──
 * 「几食堂几楼」既是卡片上的 location，也是分类：category 写成 `canteen-<楼层短码>`，
 * 页面上的筛选 chip 因此直接是「一食堂一楼 / 二食堂二楼 …」，不再有笼统的「校内食堂」。
 * 标题不写窗口名，所以窗口按「楼层 + 粗档口类型」归（见 STALL_RULES）：一条视频基本
 * 只拍一个窗口，整条视频归进同一张卡；实在归不进桶的单菜先按菜名单独建卡占位，
 * 等人工补数据后再并进真正的窗口。西南村 / 肯德基不属食堂体系，不建卡。
 *
 * 标题解析出的三类信息，可靠性依次下降：
 *   1. 地点（一食堂一楼…）——129 条里 121 条能认出来
 *   2. 菜品（烤鸭饭…）——只有 80 条标题写了菜名，没写的成不了卡
 *   3. 餐次（早饭/午饭/晚饭）——只有早期标题写，只用于 desc 文案
 *   日期一律取 pubdate，标题里的 `2024.11.11` 前缀不作数
 *
 * 地点只写到「几食堂」没写楼层的、以及完全没写地点的，location 记「待定」，
 * 卡片照样生成，等人工在 CANTEEN_META 或本源里补。西南村 / 肯德基不属食堂体系，不建卡。
 */
import { Buffer } from 'node:buffer'
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { slugify } from '../docs/.vitepress/data/pinyin.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const OUT_JS = resolve(ROOT, 'docs/.vitepress/data/food-canteens.js')
const IMG_ROOT = resolve(ROOT, 'docs/public/food/shots')

const MID = '3493299289590174'
const SEASON_ID = '4166470'
const PAGE_SIZE = 30
const SEASON_URL = `https://space.bilibili.com/${MID}/lists/${SEASON_ID}?type=season`
const API = 'https://api.bilibili.com/x/polymer/web-space/seasons_archives_list'

const argv = new Set(process.argv.slice(2))
const DRY = argv.has('--dry')
const REFRESH = argv.has('--refresh')
const REFRESH_DATA = argv.has('--refresh-data')

/** 接口原始响应的落盘位置：vitepress 的 cache 目录已被 gitignore，不污染仓库 */
const CACHE_FILE = resolve(ROOT, 'docs/.vitepress/cache/bili-food-raw.json')
/** 缓存有效期。数据本身按天更新，6 小时内复用不影响准确性 */
const CACHE_TTL = 6 * 3600 * 1000

/* ================= 分类规则 ================= */

/**
 * 地点 → id 前缀 + 排序位次。
 * 排序不是按字典序，而是「一食堂一楼→…→静园餐厅→待定」的动线顺序，
 * 让卡片墙按食堂楼层的实际逛店顺序铺开。
 */
const PLACE_DEFS = [
	{ slug: 'yi-1f', place: '一食堂一楼' },
	{ slug: 'yi-2f', place: '一食堂二楼' },
	{ slug: 'er-1f', place: '二食堂一楼' },
	{ slug: 'er-2f', place: '二食堂二楼' },
	{ slug: 'er-3f', place: '二食堂三楼' },
	{ slug: 'san-1f', place: '三食堂一楼' },
	{ slug: 'san-2f', place: '三食堂二楼' },
	{ slug: 'san-3f', place: '三食堂三楼' },
	{ slug: 'qingzhen', place: '清真食堂' },
	{ slug: 'jingyuan', place: '静园餐厅' },
]

/** 地点写不精确时的兜底：卡片照样生成，location 标「待定」，排序垫底 */
const TBD = { slug: 'tbd', place: '待定' }

/**
 * 标题只写地点、没写菜名的实拍，按「餐次」归口：
 * 早饭的进该楼层的「早点窗口」，一食堂一楼的午饭实拍全是自选菜档口的日常记录
 * （20 条），归「自选菜」；二食堂一楼的早饭那批以前没地方去，现在有了。
 * 其余（没写餐次的）仍然不上页面 —— 连「大概是什么窗口」都推不出来。
 */
const SELF_SERVE = new Map([
	['一食堂一楼', { name: '自选菜', slug: 'zi-xuan-cai', tag: '自选' }],
])

/**
 * 粗档口归类：标题里没有窗口名，只能按菜品内容粗分。刻意只分四个桶，
 * 归不进去的单菜先按菜名占位 —— 窗口的真实名字等人工补数据再细化，
 * 机器猜得越细以后越难改。匹配在视频级做（一条视频 = 一次探店 ≈ 一个窗口），
 * 多菜标题（「肉夹馍、八宝粥」）整条进同一张卡。
 *
 * 顺序有讲究：面食要排在早点前面，「西红柿鸡蛋面」里也有「鸡蛋」，
 * 先匹配早点会被错误吸走。
 */
const STALL_RULES = [
	// slug 用 zi-xuan-cai 与 SELF_SERVE 保持同一名：一食一楼的自选菜卡 id 不因重构而变
	{ slug: 'zi-xuan-cai', name: '自选菜', re: /自选(菜|餐)/ },
	{ slug: 'mianshi', name: '面食窗口', re: /面|米线|米粉|泡馍|馄饨|水饺|饺子|抄手/ },
	{ slug: 'zaodian', name: '早点窗口', re: /包子|粥|油条|麻团|发糕|馅饼|糯米包|卷饼|鸡蛋|香肠|鸡柳|糖葫芦|煎饼|肉夹馍/ },
	{ slug: 'fancai', name: '饭菜窗口', re: /饭|石锅|煲/ },
]

/** 不在食堂体系里的地点：认得出，但不建卡 */
const EXCLUDED_PLACES = new Set(['西南村', '肯德基'])

/** 拼音表与 slugify 见 docs/.vitepress/data/pinyin.js —— 脚本与页面投稿助手共用一份 */

/** 脚本运行期收集缺拼音的字，结束时统一提示 */
const MISSING_PINYIN = new Set()

/* 菜品类型标签：按顺序匹配菜品名，命中即打标。
   宁可少标也不要标错 —— 这些徽章是给读者看的，标错比不标更糟。 */
const TAG_RULES = [
	['水饺馄饨', ['水饺', '饺子', '馄饨', '抄手']],
	['面食', ['面', '米线', '米粉', '泡馍', '意面']],
	['包子点心', ['包子', '馅饼', '煎饼', '卷饼', '糯米包', '发糕', '麻团', '油条', '糖葫芦']],
	['粥', ['粥']],
	['盖饭', ['饭', '拌饭', '双拼', '牛腩', '炖牛肉']],
	['西餐', ['牛扒', '猪排', '意面', '咖喱']],
	['汤锅', ['汤', '砂锅', '石锅', '煲', '蹄花']],
	['小吃', ['鸡柳', '香肠', '鸡蛋', '麻团', '小酥肉', '里脊']],
	['韩餐', ['分米鸡', '年糕鸡']],
	['自选', ['自选菜', '自选餐']],
]

const DATE_RE = /^(\d{4})\.(\d{1,2})\.(\d{1,2})\s*[，,]?\s*/
const MEAL_RE = /(早饭|午饭|晚饭|早餐|午餐|晚餐)/
const PLACE_RE = /(一食堂|二食堂|三食堂|清真食堂|静园餐厅|西南村|肯德基)([一二三]楼)?/
const DISH_SPLIT_RE = /[、，,]/

/* ================= 抓取 ================= */

const HEADERS = {
	'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
	'Referer': 'https://space.bilibili.com/',
}

async function fetchPage(pageNum) {
	const url = `${API}?mid=${MID}&season_id=${SEASON_ID}&page_num=${pageNum}&page_size=${PAGE_SIZE}`
	let lastError
	for (let attempt = 0; attempt < 3; attempt++) {
		try {
			const res = await fetch(url, { headers: HEADERS })
			if (!res.ok) {
				throw new Error(`HTTP ${res.status}`)
			}
			const json = await res.json()
			if (json.code === -352) {
				// 风控是「等几分钟」型错误：800/1600/2400ms 的瞬时重试只会火上浇油，
				// 直接放弃本次抓取，让调用方走缓存兜底或改天再跑
				const error = new Error('被 B 站风控（-352）：请求太频繁，等几分钟再试，或直接用缓存跑')
				error.fatal = true
				throw error
			}
			if (json.code !== 0) {
				throw new Error(`接口返回 code=${json.code} ${json.message}`)
			}
			return json.data
		}
		catch (error) {
			if (error.fatal)
				throw error
			lastError = error
			await new Promise(ok => setTimeout(ok, 800 * (attempt + 1)))
		}
	}
	throw new Error(`第 ${pageNum} 页抓取失败：${lastError?.message}`)
}

async function fetchAll() {
	const first = await fetchPage(1)
	const total = first.page.total
	const pageCount = Math.ceil(total / PAGE_SIZE)
	const archives = [...first.archives]
	for (let page = 2; page <= pageCount; page++) {
		// 页间留点间隔：连着打十几页很容易被判成爬虫
		await new Promise(ok => setTimeout(ok, 300))
		const data = await fetchPage(page)
		archives.push(...data.archives)
	}
	return archives
}

function readCache(maxAge) {
	try {
		const raw = JSON.parse(readFileSync(CACHE_FILE, 'utf8'))
		if (!Array.isArray(raw.archives) || !raw.archives.length) {
			return null
		}
		// savedAt 缺失/非法时按过期处理：NaN 比较恒为 false，会让永不过期
		if (maxAge !== Infinity && !(Number.isFinite(raw.savedAt) && Date.now() - raw.savedAt <= maxAge)) {
			return null
		}
		return raw.archives
	}
	catch {
		return null
	}
}

/**
 * 取原始列表：优先新鲜缓存 → 抓接口 → 抓不动就退回任意旧缓存。
 * 最后一层兜底是为了「只想调文案/规则」时不至于被风控卡死。
 */
async function loadArchives() {
	if (!REFRESH_DATA) {
		const cached = readCache(CACHE_TTL)
		if (cached) {
			console.log(`用本地缓存（${cached.length} 条）…`)
			return cached
		}
	}
	try {
		console.log('抓取合集…')
		const archives = await fetchAll()
		mkdirSync(dirname(CACHE_FILE), { recursive: true })
		writeFileSync(CACHE_FILE, JSON.stringify({ savedAt: Date.now(), archives }))
		return archives
	}
	catch (error) {
		const cached = readCache(Infinity)
		if (cached) {
			console.warn(`抓取失败（${error.message}）\n改用旧缓存（${cached.length} 条）继续生成`)
			return cached
		}
		throw error
	}
}

/* ================= 解析 ================= */

function toDate(ts) {
	// 固定按东八区取「自然日」，避免 CI 跑在 UTC 时整体差一天
	const d = new Date((ts + 8 * 3600) * 1000)
	return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

function splitDishes(text) {
	return text
		.split(DISH_SPLIT_RE)
		.map(s => cleanDish(s))
		.filter(Boolean)
}

/**
 * 菜名清洗。后期标题是探店口吻（「食堂的黑椒烧肉煲，14块钱值不值？」），
 * 主体两侧会挂「食堂的」前缀和价格/评价尾巴，这些都不该当成菜品。
 * 剥完不足 2 字视为噪声，返回空串由调用方过滤。
 */
function cleanDish(text) {
	const out = text
		.replace(/食堂的|食堂/g, '')
		.replace(/新品尝鲜|值不值|正不正宗|好一招空城计|只有面/g, '')
		.replace(/\d+\s*(?:元|块钱)/g, '')
		.replace(/[？?！!。、，,\s]+$/g, '')
		.trim()
	return out.length >= 2 ? out : ''
}

/**
 * 标题 → { place, meal, dishes }。
 * 「南开」「南开大学」是后期标题才加的前缀，先剥掉再认地点。
 */
function parseTitle(title) {
	let rest = title.replace(DATE_RE, '')
	rest = rest.replace(/南开大学|南开/g, '').trim()

	let meal = ''
	const mealMatch = rest.match(MEAL_RE)
	if (mealMatch) {
		meal = mealMatch[1]
		rest = rest.replace(meal, '').trim()
	}

	const placeMatch = rest.match(PLACE_RE)
	if (!placeMatch) {
		// 没有地点时，标题基本是「食堂的XXX，评价」的探店口吻：只取第一个
		// 分隔符前的主体，后面那段是价格/点评，不是菜品
		if (/多少钱|一周吃/.test(rest)) {
			return { place: '', meal, dishes: [] }
		}
		const head = rest.split(/[，,、？?]/)[0] || ''
		const dish = cleanDish(head)
		return { place: '', meal, dishes: dish ? [dish] : [] }
	}

	const place = placeMatch[1] + (placeMatch[2] || '')
	const dishes = splitDishes(rest.replace(placeMatch[0], ''))
	return { place, meal, dishes }
}

/**
 * 菜名 → 拼音 slug。
 * 「烤鸭饭」→ `kao-ya-fan`；生字退化成 `u70e4`，保证 id 永远稳定、
 * 不会因为补一次拼音表就把历史评论的 key 换掉。
 * 规则本身在 data/pinyin.js，页面上的投稿助手用的是同一份，两处产出才对得上。
 */
function dishSlug(dish) {
	return slugify(dish, char => MISSING_PINYIN.add(char))
}

/**
 * 单个菜名的类型标签，最多 3 个。
 */
function tagsOf(dish) {
	const tags = []
	for (const [tag, words] of TAG_RULES) {
		if (words.some(word => dish.includes(word)) && !tags.includes(tag)) {
			tags.push(tag)
		}
	}
	return tags.slice(0, 3)
}

/* ================= 封面 ================= */

/**
 * B 站封面原图宽 1920 且近 800KB，按 4:3 中心裁切到 480×360（约 20KB），
 *  与 food-data.js 里既有条目的 cover 比例一致，卡片 CSS 不用改
 */
function imageUrl(pic) {
	const base = pic.replace(/^http:/, 'https:').replace(/@.*$/, '')
	return `${base}@480w_360h_1c.webp`
}

/**
 * 封面按 bvid 扁平存放，不按卡片分目录：
 * 一条视频可能对应多张食物卡（「炸酱面和炒鸡面」→ 两张卡），
 * 分目录会让同一张封面在仓库里存好几份。
 */
async function downloadImage(shot, stats) {
	const rel = `/food/shots/${shot.bvid}.webp`
	const file = resolve(IMG_ROOT, `${shot.bvid}.webp`)
	if (!REFRESH && existsSync(file) && statSync(file).size > 1024) {
		stats.skipped++
		return rel
	}
	mkdirSync(dirname(file), { recursive: true })
	try {
		const res = await fetch(imageUrl(shot.pic), { headers: HEADERS })
		if (!res.ok) {
			throw new Error(`HTTP ${res.status}`)
		}
		const buf = Buffer.from(await res.arrayBuffer())
		if (buf.length < 1024) {
			throw new Error(`内容过小（${buf.length}B）`)
		}
		// 临时文件 + rename：直接覆盖被中途打断会留下半张 webp，而它 >1KB，
		// 下次会通过上面的「已有文件」检查被永久跳过
		const tmp = `${file}.tmp`
		writeFileSync(tmp, buf)
		renameSync(tmp, file)
		stats.downloaded++
		stats.bytes += buf.length
		return rel
	}
	catch (error) {
		stats.failed.push(`${shot.bvid}：${error.message}`)
		// 不兜底远程直链：页面 <img> 不带 referrerpolicy="no-referrer"，
		// B 站图床对带第三方 Referer 的请求回 403，直链在页面上就是死图。
		// 留空走「首字占位」，卡片照常出；失败已在 stats.failed 汇总并以非零退出提醒重跑
		return ''
	}
}

async function pool(list, limit, worker) {
	let cursor = 0
	const runners = Array.from({ length: Math.min(limit, list.length) }, async () => {
		while (cursor < list.length) {
			const index = cursor++
			await worker(list[index], index)
		}
	})
	await Promise.all(runners)
}

/* ================= 序列化 ================= */

function quote(text) {
	return `'${text.replace(/\\/g, '\\\\').replace(/'/g, '\\\'')}'`
}

function serialize(value, depth) {
	const pad = '\t'.repeat(depth + 1)
	const close = '\t'.repeat(depth)
	if (Array.isArray(value)) {
		if (!value.length) {
			return '[]'
		}
		const allShortString = value.every(v => typeof v === 'string' && !v.includes('\n'))
		if (allShortString && value.join('、').length <= 24) {
			return `[${value.map(quote).join(', ')}]`
		}
		return `[\n${value.map(v => `${pad}${serialize(v, depth + 1)},`).join('\n')}\n${close}]`
	}
	if (value && typeof value === 'object') {
		const body = Object.entries(value)
			.map(([key, val]) => `${pad}${key}: ${serialize(val, depth + 1)},`)
			.join('\n')
		return `{\n${body}\n${close}}`
	}
	if (typeof value === 'string') {
		return quote(value)
	}
	return String(value)
}

/* ================= 主流程 ================= */

const PLACE_RANK = new Map(PLACE_DEFS.map((def, index) => [def.place, index]))
const PLACE_SLUG = new Map(PLACE_DEFS.map(def => [def.place, def.slug]))

/**
 * 一个窗口一张卡。
 * 视频级归类：一条视频基本只拍一个窗口，整条（含多菜标题）进同一张卡。
 * 归类顺序：无菜名实拍按餐次/楼层归口（SELF_SERVE + 早饭→早点窗口）；
 * 有菜名的先试 STALL_RULES 粗分桶；都没命中的按菜名单独建卡占位。
 * 同一窗口被多次实拍 → 合并成一张卡，封面按时间排进 gallery。
 */
function buildCards(shots) {
	/** key 是「地点|桶标识」，一个 key 一张卡；桶标识是窗口 slug 或 `dish:菜名` */
	const buckets = new Map()

	for (const shot of shots) {
		// 楼层写清楚的才当 location，只写到「二食堂」的降级为待定
		const place = PLACE_RANK.has(shot.place) ? shot.place : TBD.place

		let bucketKey
		if (!shot.dishes.length) {
			// 无菜名：早饭 → 早点窗口；配了 SELF_SERVE 的楼层按配置归；其余丢弃
			if ((shot.meal || '').startsWith('早')) {
				bucketKey = 'zaodian'
			}
			else {
				const selfServe = SELF_SERVE.get(place)
				if (!selfServe) {
					continue
				}
				bucketKey = selfServe.slug
			}
		}
		else {
			const subject = shot.dishes.join('、')
			const rule = STALL_RULES.find(item => item.re.test(subject))
			bucketKey = rule ? rule.slug : `dish:${shot.dishes[0]}`
		}

		const key = `${place}\u0000${bucketKey}`
		let bucket = buckets.get(key)
		if (!bucket) {
			bucket = { place, rawPlace: shot.place, bucketKey, dishes: new Set(), shots: [] }
			buckets.set(key, bucket)
		}
		bucket.shots.push(shot)
		for (const dish of shot.dishes) {
			bucket.dishes.add(dish)
		}
	}

	const usedIds = new Set()
	const cards = []

	/** 真撞了（生字退化成同一码位）加序号，不让评论 key 互相覆盖 */
	function uniqueId(base) {
		let id = base
		if (usedIds.has(id)) {
			let index = 2
			while (usedIds.has(`${id}-${index}`)) {
				index++
			}
			id = `${id}-${index}`
		}
		usedIds.add(id)
		return id
	}

	function pushCard({ id, name, place, bucket, desc, detail, tags }) {
		const list = bucket.shots
		const covers = [...new Set(list.map(shot => shot.cover).filter(Boolean))]
		cards.push({
			id,
			name,
			// 分类就是楼层：「几食堂几楼」既是 location 也是分类，页面上的筛选 chip 直接是楼层
			category: `canteen-${PLACE_SLUG.get(place) || TBD.slug}`,
			campus: 'balitai',
			location: place === TBD.place ? TBD.place : place,
			cover: covers[0] || '',
			...(covers.length > 1 ? { gallery: covers } : {}),
			...(tags.length ? { tags } : {}),
			desc,
			detail,
			shotCount: list.length,
			lastDate: list[0].date,
			place,
			shots: list.map(shot => ({
				bvid: shot.bvid,
				date: shot.date,
				...(shot.meal ? { meal: shot.meal } : {}),
			})),
		})
	}

	for (const bucket of buckets.values()) {
		const { place, bucketKey, dishes } = bucket
		const dishNames = [...dishes]
		const isDishless = !dishes.size
		const selfServe = isDishless && bucketKey !== 'zaodian' ? SELF_SERVE.get(place) : null
		const stallName = isDishless
			? (selfServe?.name || '早点窗口')
			: (STALL_RULES.find(item => item.slug === bucketKey)?.name || dishNames[0])
		const isStall = isDishless || !bucketKey.startsWith('dish:')
		const tags = isDishless
			? [selfServe?.tag || '早点']
			: [...new Set(dishNames.flatMap(dish => tagsOf(dish)))].slice(0, 3)

		pushCard({
			id: uniqueId(`canteen-${PLACE_SLUG.get(place) || TBD.slug}-${isStall ? bucketKey : dishSlug(dishNames[0])}`),
			name: stallName,
			place,
			bucket,
			tags,
			...describe({ isTbd: place === TBD.place, rawPlace: bucket.rawPlace, stallName, isStall, dishNames, list: bucket.shots }),
		})
	}

	// 地点按「一食 1F → 三食 3F → 清真 → 静园 → 待定」的动线排；
	// 同地点内实拍多的在前（被拍多次说明常吃），再按最近实拍时间
	cards.sort((a, b) => {
		const rank = (PLACE_RANK.get(a.place) ?? PLACE_DEFS.length) - (PLACE_RANK.get(b.place) ?? PLACE_DEFS.length)
		if (rank) {
			return rank
		}
		if (a.shotCount !== b.shotCount) {
			return b.shotCount - a.shotCount
		}
		return a.lastDate < b.lastDate ? 1 : -1
	})
	return cards
}

/**
 * 卡片描述分两层：
 *   desc   上卡片，一句话说完「这是什么」，卡片上两行截断
 *   detail 只在详情弹窗里出现，放实拍条数、吃过的菜与「窗口名是推断的」这类注脚
 *
 * 早先两层合在一句里（「收录 1 条实拍，最近 2025-11-24。菜名取自 B 站合集标题，非官方菜单。」），
 * 结果每张卡上重复刷同一句免责声明，还必然截断在半句。
 */
function describe({ isTbd, rawPlace, stallName, isStall, dishNames, list }) {
	const times = `收录 ${list.length} 条实拍，最近 ${list[0].date}${list.length > 1 ? `，最早 ${list[list.length - 1].date}` : ''}。`
	const dishList = dishNames.join('、')
	const caveat = '菜名取自 B 站合集标题，不是官方菜单，看到跟档口对不上就在评论区说一声。'
	if (isTbd) {
		const why = rawPlace
			? `标题只写到「${rawPlace}」，没标楼层，先放在待定里。`
			: `标题没写几食堂几楼，只认出「${dishList || stallName}」，先放在待定里。`
		return { desc: why, detail: `${times}认出楼层后会挪到对应分类。${caveat}` }
	}
	if (isStall) {
		const tasted = dishNames.length ? `，拍过 ${dishList}` : ''
		return {
			desc: `${rawPlace}的${stallName}，${list.length} 条实拍${tasted.length > 30 ? '' : tasted}。`,
			detail: `${times}${dishNames.length ? `实拍过的菜：${dishList}。` : ''}窗口名是按实拍内容粗分的，和实际档口对不上就在评论区说一声。`,
		}
	}
	return {
		desc: `${rawPlace}的${dishNames[0]}，${list.length} 条实拍。`,
		detail: `${times}这层的窗口还没细分，先按菜名单独建卡。${caveat}`,
	}
}

function renderFile(cards, shots, { total, updatedAt, excluded, tbd }) {
	const head = `/**
 * NKUwiki 食堂实拍数据（页面：04.校园生活/02.美食推荐）
 *
 * ⚠ 本文件由 scripts/fetch-bili-food.mjs 自动生成，请勿手改。
 *    要改文案/人均/推荐理由/分类，写在 food-data.js 的 CANTEEN_META 里（那份不会被覆盖）。
 *
 * 数据源：${SEASON_URL}
 * UP 主：zyc哈哈哈哈哈 · 合集「南开食堂天天吃」（八里台校区）
 * 数据更新至：${updatedAt}（视频总数 ${total}，收录 ${shots.length} 条，未收录 ${excluded.length} 条）
 *
 * 字段说明：
 *   CANTEEN_SHOTS  逐条实拍的解析结果，dishes 为空表示标题没写菜名（这种成不了卡）
 *   CANTEEN_FOODS  一个窗口 / 一家店一张卡，直接并入 food-data.js 的 FOODS。
 *                  category 是「canteen-楼层短码」（分类即楼层），location 也是楼层；
 *                  窗口名按实拍内容粗分（STALL_RULES），单菜占位卡在 detail 里注明。
 *                  desc 上卡片、detail 只在详情弹窗里出现。
 */

`

	const shotsLiteral = `export const CANTEEN_SHOTS = [\n${shots
		.map(shot => `\t${serialize(shot, 1)},`)
		.join('\n')}\n]\n\n`

	const cardsLiteral = `export const CANTEEN_FOODS = [\n${cards
		.map(card => `\t${serialize(card, 1)},`)
		.join('\n')}\n]\n\n`

	const excludedLiteral = `/** 认得出地点、但不属于食堂体系的实拍（西南村 / 肯德基），留给「校内店铺」条目以后人工挂载 */
export const CANTEEN_EXCLUDED = [\n${excluded
	.map(shot => `\t${serialize(shot, 1)},`)
	.join('\n')}\n]\n\n`

	const tbdNote = tbd.length
		? `/** 地点待定的卡片：${tbd.length} 张（标题只写到食堂名，或根本没写几食堂几楼） */\nexport const CANTEEN_TBD_COUNT = ${tbd.length}\n`
		: 'export const CANTEEN_TBD_COUNT = 0\n'

	return `${head}${shotsLiteral}${cardsLiteral}${excludedLiteral}${tbdNote}`
}

async function main() {
	const archives = await loadArchives()
	// 统一成「新的在前」：卡片封面取第一条即最新
	archives.sort((a, b) => b.pubdate - a.pubdate)
	const total = archives.length
	console.log(`共 ${total} 条视频`)

	const shots = archives.map((item) => {
		const { place, meal, dishes } = parseTitle(item.title)
		return {
			bvid: item.bvid,
			date: toDate(item.pubdate),
			meal,
			place,
			dishes,
			// 只排除明确认出的非食堂地点（西南村/肯德基）；楼层写不精确的留在体系内
			excluded: Boolean(place) && EXCLUDED_PLACES.has(place),
			views: item.stat.view,
			cover: '',
			pic: item.pic,
		}
	})

	const excluded = shots.filter(shot => shot.excluded)
	const usable = shots.filter(shot => !shot.excluded)

	const imageStats = { downloaded: 0, skipped: 0, bytes: 0, failed: [] }
	if (!DRY) {
		console.log(`下载封面（${usable.length} 张）…`)
		await pool(usable, 5, async (shot) => {
			shot.cover = await downloadImage(shot, imageStats)
		})
		console.log(`  新下载 ${imageStats.downloaded}，跳过已有 ${imageStats.skipped}，失败 ${imageStats.failed.length}`)
		if (imageStats.downloaded) {
			console.log(`  新增体积 ${(imageStats.bytes / 1024 / 1024).toFixed(2)} MB`)
		}
		for (const line of imageStats.failed.slice(0, 5)) {
			console.warn(`  ! ${line}`)
		}
		if (imageStats.failed.length) {
			console.warn(`  ! 共 ${imageStats.failed.length} 张封面下载失败，对应卡片将以无图占位生成；建议稍后重跑补齐`)
			process.exitCode = 1
		}
	}
	else {
		for (const shot of usable) {
			shot.cover = `/food/shots/${shot.bvid}.webp`
		}
	}

	const cards = buildCards(usable)
	const tbd = cards.filter(card => card.place === TBD.place)
	const updatedAt = archives[0] ? toDate(archives[0].pubdate) : ''

	// pic 只在下载阶段用得到，落盘时去掉，避免数据文件出现 B 站原始 http 链接；
	// excluded 只是中间标记，也不落盘
	const forFile = list => list.map(({ pic, excluded: _ignored, ...rest }) => rest)

	const content = renderFile(
		cards,
		forFile(usable),
		{ total, updatedAt, excluded: forFile(excluded), tbd },
	)

	const withDish = usable.filter(shot => shot.dishes.length).length
	const byBvid = new Map(usable.map(shot => [shot.bvid, shot]))
	const cardedNoDish = new Set()
	for (const card of cards) {
		for (const item of card.shots) {
			if (!byBvid.get(item.bvid)?.dishes.length) {
				cardedNoDish.add(item.bvid)
			}
		}
	}
	console.log(`\n${cards.length} 张窗口卡（${withDish} 条写了菜名的实拍 + ${cardedNoDish.size} 条只写了餐次/地点）`)
	if (usable.length - withDish - cardedNoDish.size > 0) {
		console.log(`  另有 ${usable.length - withDish - cardedNoDish.size} 条无菜名、归不出窗口的实拍未成卡`)
	}
	console.log('按地点分布：')
	const byPlace = new Map()
	for (const card of cards) {
		byPlace.set(card.place, (byPlace.get(card.place) || 0) + 1)
	}
	for (const [place, count] of byPlace) {
		console.log(`  ${place.padEnd(10, '　')} ${String(count).padStart(3)} 张`)
	}
	console.log(`  未收录 ${String(excluded.length).padStart(3)} 条（西南村/肯德基，不属食堂体系）`)

	if (tbd.length) {
		console.log('\n地点待定（标题没写清几食堂几楼）：')
		for (const card of tbd) {
			console.log(`  ${card.name.padEnd(14, '　')} ${card.desc.slice(0, 24)}`)
		}
	}

	if (MISSING_PINYIN.size) {
		console.warn(`\n! 缺拼音（已退化成 u<码位> 形式的 id）：${[...MISSING_PINYIN].join('')}`)
	}

	if (DRY) {
		console.log('\n--dry：未写文件')
		return
	}

	const previous = existsSync(OUT_JS) ? await import('node:fs').then(fs => fs.readFileSync(OUT_JS, 'utf8')) : ''
	if (previous === content) {
		console.log('\n数据无变化，未重写 food-canteens.js')
	}
	else {
		mkdirSync(dirname(OUT_JS), { recursive: true })
		writeFileSync(OUT_JS, content)
		console.log(`\n已写入 ${OUT_JS.replace(ROOT, '.')}`)
	}
}

await main()
