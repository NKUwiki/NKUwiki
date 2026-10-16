import type { MarkdownRenderer } from 'vitepress'
// markdown 图片尺寸注入：构建期读取本地图片宽高，为 <img> 写入 width/height 属性，
// 浏览器在图片加载完成前即可预留空间，消除布局跳动（CLS）。
// 只处理本地图片（/public 下的绝对路径与 md 文件同目录的相对路径），远程图与已标尺寸的跳过。
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { imageSize } from 'image-size'

/** 同一张图只读一次磁盘 */
const cache = new Map<string, { width: number, height: number } | null>()

export function imageSizePlugin(md: MarkdownRenderer, srcDir: string) {
	const raw = md.renderer.rules.image
	md.renderer.rules.image = (tokens, idx, options, env, self) => {
		const token = tokens[idx]
		const src = token.attrGet('src') ?? ''
		const hasDim = (name: string) => (token.attrs ?? []).some(attr => attr[0] === name)
		if (src && !/^(?:https?:)?\/\//i.test(src) && !hasDim('width') && !hasDim('height')) {
			const key = `${env.relativePath ?? ''}|${src}`
			let size = cache.get(key)
			if (size === undefined) {
				size = null
				try {
					// 去掉查询与锚点后定位磁盘文件：绝对路径映射到 public/，相对路径按 md 文件所在目录解析
					const clean = src.split('?')[0].split('#')[0]
					const file = clean.startsWith('/')
						? join(srcDir, 'public', decodeURI(clean))
						: resolve(dirname(join(srcDir, env.relativePath ?? '')), decodeURI(clean))
					if (existsSync(file)) {
						// image-size v2 的同步 API 只收 buffer；图片都不大，且结果有缓存
						const raw2 = imageSize(readFileSync(file))
						if (raw2.width && raw2.height)
							size = { width: raw2.width, height: raw2.height }
					}
				}
				catch {
					// 读不到尺寸（损坏文件/不认识格式）就保持原样，不阻塞构建
				}
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
