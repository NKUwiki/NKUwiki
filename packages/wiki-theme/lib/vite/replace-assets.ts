/**
 * 资源链接替换（构建期）：把产物里的本地静态资源地址改写到网络存储。
 *
 * ── 解决什么问题 ──
 * 站点图片、字体、媒体目前都放在 docs/public 下随站点一起部署。将来要把这些资源
 * 迁到 OSS / CDN 时，最省事的做法是「内容里继续写本地路径，构建时统一换成外链」：
 * 写作不被打断，迁移只改一处配置，回滚也只改一处。
 *
 * 本插件在 Vite 生成产物之后（generateBundle）对 HTML / CSS / JS 里的站内绝对
 * 资源路径做前缀替换，**不修改任何源文件**，也不影响 dev（apply: 'build'）。
 *
 * ── 怎么用 ──
 * 不配置任何规则时插件是空转的（零成本、产物逐字节不变），可以放心常驻：
 *
 *   import { replaceAssets } from '@nkuwiki/theme/lib/vite/replace-assets.ts'
 *   vite: { plugins: [replaceAssets({ siteBase: base, image: 'https://cdn.example.com' })] }
 *
 * 建议只在生产构建启用（与 Plume 的做法一致），例如读环境变量：
 *
 *   image: process.env.WIKI_ASSETS_BASE || ''
 *   skip: '^/assets/'   // VitePress 自己的打包产物（文件名带哈希），必须留在站内
 *
 * 迁移步骤：把 docs/public 整个目录上传到对象存储 → 配上访问域名 → 设置环境变量
 * 重新构建。资源路径在本地与远端保持一致，所以不需要改任何 md / 组件代码。
 *
 * ── 能识别什么 ──
 * 只处理**以 / 开头的站内绝对路径**且带资源扩展名的链接，覆盖四种写法：
 *   HTML  <img src="/img/foo.png">
 *   CSS   background: url(/img/foo.png)
 *   JS    const foo = '/img/foo.png'
 *   JS    const foo = `/img/foo.png`   ← 压缩器常把单引号改写成模板字面量
 * 三种引号（" ' `）与左括号都算作路径的起点，因为产物里的字符串必然被其中一种
 * 包住。已经是 http(s) / 协议相对 // / data: 的链接不会被动（要求以单个 / 开头）。
 *
 * 不支持用 + 拼接的路径（'/img/' + 'foo.png'），也不处理 srcset 的多候选写法——
 * 这是所有同类插件的共同限制，遇到就写成完整字符串。模板字面量里的 ${} 插值不受
 * 影响（`/img/${campus}/a.png` 只替换静态前缀，插值原样保留）。
 *
 * ── 只改写「该搬走」的资源 ──
 * skip 用来排除不该迁移的路径，最常见的是 Vite(Press) 自己打包出来的目录：
 * 那些文件名带构建哈希（/assets/inter-roman-latin.q5rAVC0E.woff2），每次构建都变，
 * 对象存储永远追不平，改写到桶里必然 404，只能继续由站点直出。
 *
 * 反过来说，**不要**用「文件是否存在」来做判据：本站允许图片只存在于图床
 * （`docs/public` 里没有也能用），那种引用必须照改不误。
 */
import type { Plugin } from 'vite'

/** 内置「图片」规则的扩展名 */
const IMAGE_EXT = ['apng', 'bmp', 'png', 'jpeg', 'jpg', 'jfif', 'pjpeg', 'pjp', 'gif', 'svg', 'ico', 'webp', 'avif', 'cur', 'jxl']
/** 内置「媒体」规则的扩展名（含字体，字体是本站外置收益最大的一类） */
const MEDIA_EXT = ['mp4', 'webm', 'ogg', 'mp3', 'wav', 'flac', 'aac', 'opus', 'mov', 'm4a', 'vtt', 'pdf', 'woff', 'woff2', 'ttf', 'eot']

/** 替换方式：字符串作为前缀拼接，或函数返回完整新链接 */
export type AssetReplacement = string | ((url: string) => string)

export interface AssetReplaceRule {
	/** 匹配资源链接：正则，或字符串（见 toRegExp 说明） */
	find: RegExp | string
	/** 替换：前缀字符串，或返回新链接的函数 */
	replacement: AssetReplacement
}

export interface ReplaceAssetsOptions {
	/** 站点 base（VitePress 的 base）。替换前会先从资源路径里剥掉它再拼 CDN */
	siteBase?: string
	/** 内置「图片 + 媒体」规则 */
	all?: AssetReplacement
	/** 内置「图片」规则 */
	image?: AssetReplacement
	/** 内置「媒体（含字体）」规则 */
	media?: AssetReplacement
	/** 自定义规则，优先于内置规则匹配 */
	rules?: AssetReplaceRule | AssetReplaceRule[]
	/** 额外纳入的扩展名（不含点），追加到 image 与 media 两组 */
	extensions?: string[]
	/**
	 * 保持原样、不改写的路径（字符串约定同 find：'^/assets/' 为前缀，'$' 结尾为后缀）。
	 * 构建产物目录必须列在这里：带哈希的文件名每次构建都变，桶里追不平。
	 */
	skip?: RegExp | string | Array<RegExp | string>
}

const escapeRe = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * 字符串 → 正则（与 Plume 的约定一致）：
 *   '^/images/'  → /^\/images\//
 *   '/foo.png$'  → /\/foo.png$/
 *   其余          → 以该串开头 或 以该串结尾
 */
function toRegExp(find: RegExp | string): RegExp {
	if (find instanceof RegExp)
		// 去掉 g / y 标志：replace() 里对每条路径做 test()，带全局标志时
		// lastIndex 会跨调用漂移，同一条规则对相同 URL 交替命中/不命中，
		// 表现为外链随机漏换且难以复现
		return new RegExp(find.source, find.flags.replace(/[gy]/g, ''))
	if (find.startsWith('^'))
		return new RegExp(`^${escapeRe(find.slice(1))}`)
	if (find.endsWith('$'))
		return new RegExp(`${escapeRe(find.slice(0, -1))}$`)
	const escaped = escapeRe(find)
	return new RegExp(`(?:^${escaped}|${escaped}$)`)
}

/** 按扩展名匹配的规则（路径尾部匹配，允许带查询串） */
function extRegExp(exts: string[]) {
	return new RegExp(`\\.(?:${exts.join('|')})(?:\\?[^"'()\\s]*)?$`, 'i')
}

/** 站点 base 归一成 '/xxx' 或 '' */
function normalizeBase(base = '') {
	const trimmed = base.replace(/^\/+|\/+$/g, '')
	return trimmed ? `/${trimmed}` : ''
}

/** 只对文本产物做替换，二进制资源（图片本身）跳过 */
const TEXT_FILE = /\.(?:html|css|js|mjs|cjs|webmanifest)$/i

/**
 * 插件的两个入口：
 * - plugin：挂到 vite.plugins，负责 JS / CSS（构建产物）
 * - transformHtml：挂到 VitePress 的 transformHtml，负责最终生成的 HTML
 *
 * 为什么要两个？VitePress 是先出 bundle、再用 SSR bundle 渲染页面，HTML 里的
 * <head>（favicon、字体 preload、og:image）是在 generateBundle 之后才拼出来的，
 * Vite 插件够不到，必须靠 transformHtml 补。body 里的资源来自 SSR，
 * 已被 plugin 阶段的 JS 替换覆盖，两边配合才没有漏网。
 */
export interface ReplaceAssetsHandle {
	plugin: Plugin
	transformHtml: (code: string) => string
}

export function replaceAssets(options: ReplaceAssetsOptions = {}): ReplaceAssetsHandle {
	const siteBase = normalizeBase(options.siteBase)
	const extra = options.extensions ?? []
	const imageExt = [...IMAGE_EXT, ...extra]
	const mediaExt = [...MEDIA_EXT, ...extra]

	const rules: Array<{ find: RegExp, replacement: AssetReplacement }> = []
	const custom = options.rules ? (Array.isArray(options.rules) ? options.rules : [options.rules]) : []
	for (const rule of custom)
		rules.push({ find: toRegExp(rule.find), replacement: rule.replacement })
	if (options.image)
		rules.push({ find: extRegExp(imageExt), replacement: options.image })
	if (options.media)
		rules.push({ find: extRegExp(mediaExt), replacement: options.media })
	if (options.all)
		rules.push({ find: extRegExp([...imageExt, ...mediaExt]), replacement: options.all })

	const name = 'wiki-replace-assets'
	// 未配置任何规则：空转。这样常驻插件也不会影响日常构建
	if (!rules.length)
		return { plugin: { name, apply: 'build' }, transformHtml: code => code }

	// skip 判据：与 find 同一套字符串约定（'^/assets/' 前缀、'/foo$' 后缀）
	const skips = (options.skip ? (Array.isArray(options.skip) ? options.skip : [options.skip]) : []).map(toRegExp)

	const replace = (url: string) => {
		// 只处理站内绝对路径；协议相对（//cdn...）已是外部地址
		if (!url.startsWith('/') || url.startsWith('//'))
			return url
		const path = siteBase && (url === siteBase || url.startsWith(`${siteBase}/`))
			? url.slice(siteBase.length)
			: url
		// 构建产物（带哈希）不改写：桶里追不平，切过去必 404
		if (skips.some(skip => skip.test(path)))
			return url
		for (const rule of rules) {
			if (!rule.find.test(path))
				continue
			return typeof rule.replacement === 'function'
				? rule.replacement(path)
				: rule.replacement.replace(/\/+$/, '') + path
		}
		return url
	}

	// 匹配资源路径字面量：前导是字符串定界符（" ' `）或 CSS url( 的左括号，
	// 结尾必须紧跟定界符，这样才连得上「整条路径就是一个完整字符串」。
	// 反引号不能少：压缩器会把同一段字面量在 " / ' / ` 之间改写，少了反引号，
	// 被打包成模板字面量的路径会整批漏改（实测漏掉 180 个真实资源：美食卡片封面、
	// 协会头像、favicon 切换、地图照片）。
	// 路径长度设 512 上限：惰性量 + 三十余个扩展名分支，不设上限时遇到
	// 不含资源扩展名的超长引号串（打包进 JS 的长 SVG path、JSON 串）会退化成
	// O(长度² × 扩展名数) 的回溯扫描
	const quote = `"'\``
	const inner = `[^${quote}()\\s]`
	const pattern = new RegExp(
		`([${quote}(])(/(?:${inner}{1,512}?)\\.(?:${[...imageExt, ...mediaExt].join('|')})(?:\\?${inner}*)?)(?=[${quote})])`,
		'gi',
	)
	const apply = (code: string) => code.replace(pattern, (_m, open: string, url: string) => open + replace(url))

	return {
		plugin: {
			name,
			apply: 'build',
			enforce: 'post',
			generateBundle(_options, bundle) {
				for (const fileName of Object.keys(bundle)) {
					if (!TEXT_FILE.test(fileName))
						continue
					const item = bundle[fileName]
					// JS chunk 走 code，CSS / manifest 走 source
					if (item.type === 'chunk' && typeof item.code === 'string') {
						const next = apply(item.code)
						if (next !== item.code)
							item.code = next
					}
					else if (item.type === 'asset' && typeof item.source === 'string') {
						const next = apply(item.source)
						if (next !== item.source)
							item.source = next
					}
				}
			},
		},
		transformHtml: apply,
	}
}
