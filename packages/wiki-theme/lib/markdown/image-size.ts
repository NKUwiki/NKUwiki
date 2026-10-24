import type { MarkdownRenderer } from 'vitepress'
// markdown 图片尺寸注入：构建期读取本地图片宽高，为 <img> 写入 width/height 属性，
// 浏览器在图片加载完成前即可预留空间，消除布局跳动（CLS）。
// 只处理本地图片（/public 下的绝对路径与 md 文件同目录的相对路径），远程图与已标尺寸的跳过。
import { readFileSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { imageSize } from 'image-size'

interface CachedSize {
	width: number
	height: number
	/** 采到该尺寸时的文件 mtime：dev watch 下换图后据此让位重读 */
	mtimeMs: number
}

/**
 * 同一张图只读一次磁盘；记录 mtime，dev 下替换同名图片后缓存自动让位
 * （生产构建一次成型，校验只是一次 statSync，代价可忽略）。null 表示读过但拿不到尺寸。
 */
const cache = new Map<string, CachedSize | null>()

/** target 是否仍落在 base 目录内（含 base 自身）：防 /../ 之类写法越出站内读任意文件 */
function isInside(base: string, target: string): boolean {
	const rel = relative(resolve(base), resolve(target))
	return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function statMtime(file: string): number | undefined {
	try {
		return statSync(file).mtimeMs
	}
	catch {
		return undefined
	}
}

function readSize(file: string, mtimeMs: number): CachedSize | null {
	try {
		// image-size v2 的同步 API 只收 buffer；图片都不大，且结果有缓存
		const raw = imageSize(readFileSync(file))
		if (raw.width && raw.height)
			return { width: raw.width, height: raw.height, mtimeMs }
	}
	catch {
		// 读不到尺寸（损坏文件/不认识格式）就保持原样，不阻塞构建
	}
	return null
}

export function imageSizePlugin(md: MarkdownRenderer, srcDir: string) {
	const publicRoot = join(srcDir, 'public')
	const raw = md.renderer.rules.image
	md.renderer.rules.image = (tokens, idx, options, env, self) => {
		const token = tokens[idx]
		const src = token.attrGet('src') ?? ''
		const hasDim = (name: string) => (token.attrs ?? []).some(attr => attr[0] === name)
		if (src && !/^(?:https?:)?\/\//i.test(src) && !hasDim('width') && !hasDim('height')) {
			const key = `${env.relativePath ?? ''}|${src}`
			// 去掉查询与锚点后定位磁盘文件：绝对路径映射到 public/，相对路径按 md 文件所在目录解析
			const clean = src.split('?')[0].split('#')[0]
			const file = clean.startsWith('/')
				? join(publicRoot, decodeURI(clean))
				: resolve(dirname(join(srcDir, env.relativePath ?? '')), decodeURI(clean))
			// 解析出的路径必须仍在站内：/../../ 等写法可能越出 srcDir 去读任意本地文件，
			// 构建期不该当探针——越界或文件不存在都按「拿不到尺寸」处理，不注入属性
			const inside = isInside(clean.startsWith('/') ? publicRoot : srcDir, file)
			const mtimeMs = inside ? statMtime(file) : undefined
			let size = cache.get(key)
			if (!size || size.mtimeMs !== mtimeMs) {
				size = mtimeMs === undefined ? null : readSize(file, mtimeMs)
				cache.set(key, size)
			}
			if (size) {
				token.attrSet('width', String(size.width))
				token.attrSet('height', String(size.height))
			}
		}
		// 声明异步解码：图片解码不再占用主线程去做同步工作，长页面（含大量图片）
		// 的滚动与交互更顺。刻意不加 loading="lazy"——本项目有打印/导出图片的功能，
		// 视口外的懒加载图在打印时尚未开始下载，会印成空白。
		if (src && !hasDim('decoding'))
			token.attrSet('decoding', 'async')
		return raw?.(tokens, idx, options, env, self) ?? self.renderToken(tokens, idx, options)
	}
}
