import { renderSVG } from 'uqr'

/**
 * 兜底图标也取不到时的最后手段（不依赖网络）：中性头像占位。
 * 本站图片走图床后是跨域地址，取它需要桶上配好 CORS；这里留一层，
 * 免得一张头像取不到就把整张长图连带拖死。
 */
const NEUTRAL_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="16" fill="#d8d8d8"/><circle cx="16" cy="12" r="5.5" fill="#9a9a9a"/><path d="M4.5 27a11.5 11.5 0 0 1 23 0z" fill="#9a9a9a"/></svg>'

export async function createShareImage(source: HTMLElement, title: string, url: string, compact: boolean) {
	const { domToBlob } = await import('modern-screenshot')
	const fallbackIcon = document.documentElement.classList.contains('dark') ? '/favicon-dark.svg' : '/favicon-light.svg'
	const stage = document.createElement('div')
	stage.className = 'share-stage'
	stage.setAttribute('aria-hidden', 'true')
	const sheet = document.createElement('article')
	sheet.className = 'share-sheet vp-doc'
	const header = document.createElement('header')
	header.className = 'share-heading'
	const brand = document.createElement('p')
	brand.className = 'share-brand'
	brand.textContent = 'NKUwiki · 南开校园知识库'
	const heading = document.createElement('h1')
	heading.textContent = title
	header.append(brand, heading)
	sheet.append(header)
	if (compact) {
		const description = document.createElement('p')
		description.className = 'share-description'
		description.textContent = '汲公能之志，汇众人之识。新生入学、学习经验、校园生活——来自同学，服务同学。'
		const topics = document.createElement('ul')
		for (const node of [...source.querySelectorAll('h2')].filter(node => !node.closest('[data-share-exclude]')).slice(0, 6)) {
			const item = document.createElement('li')
			item.textContent = node.textContent?.replace(/\s*#\s*$/, '') || ''
			topics.append(item)
		}
		sheet.append(description, topics)
	}
	else {
		const body = source.cloneNode(true) as HTMLElement
		body.className = 'share-body'
		body.querySelectorAll('h1, .article-meta, [data-share-exclude], .share-dialog, .header-anchor, .VPDocFooter, script, button').forEach(node => node.remove())
		for (const media of body.querySelectorAll<HTMLElement>('.hover-media')) {
			const target = document.createElement('div')
			const qr = media.dataset.shareQr
			if (qr) {
				target.className = 'wiki-qr'
				target.style.width = '128px'
				target.innerHTML = renderSVG(qr, { border: 4, pixelSize: 4 })
			}
			else if (media.dataset.shareImage) {
				const image = document.createElement('img')
				image.src = media.dataset.shareImage
				image.alt = '联系图片'
				target.append(image)
			}
			media.replaceWith(target)
		}
		body.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'))
		for (const frame of body.querySelectorAll('iframe')) {
			const link = document.createElement('a')
			link.href = frame.src
			link.textContent = `嵌入内容请在原页面查看：${frame.title || frame.src}`
			frame.replaceWith(link)
		}
		body.querySelectorAll('img').forEach(img => img.loading = 'eager')
		sheet.append(body)
	}
	const footer = document.createElement('footer')
	footer.className = 'share-signature'
	const text = document.createElement('div')
	const slogan = document.createElement('strong')
	slogan.textContent = '把校园经验，分享给下一位同学。'
	const address = document.createElement('p')
	address.textContent = url
	const hint = document.createElement('small')
	hint.textContent = '扫码阅读原文，查看最新内容 · 非官方校园知识库'
	text.append(slogan, address, hint)
	const qr = document.createElement('div')
	qr.className = 'share-page-qr'
	qr.innerHTML = renderSVG(url, { border: 4, pixelSize: 4 })
	footer.append(text, qr)
	sheet.append(footer)
	stage.append(sheet)
	document.body.append(stage)
	try {
		await document.fonts.ready
		await Promise.all([...sheet.querySelectorAll('img')].map(async (img) => {
			try {
				await img.decode()
			}
			catch {
				if (img.closest('.group-avatar')) {
					img.src = fallbackIcon
					await img.decode()
					return
				}
				throw new Error(`图片未能载入：${img.alt || img.getAttribute('src')}`)
			}
		}))
		const scale = Math.min(2, 16000 / sheet.scrollHeight)
		if (scale < 0.75)
			throw new Error('页面过长，请选择分享卡片，或使用浏览器打印保存全文。')
		const blob = await domToBlob(sheet, {
			scale,
			backgroundColor: getComputedStyle(sheet).backgroundColor,
			timeout: 15000,
			fetchFn: async (url) => {
				if (!url.startsWith('https://p.qlogo.cn/'))
					return false
				try {
					const response = await fetch(url, { cache: 'reload', signal: AbortSignal.timeout(5000) })
					if (!response.ok)
						throw new Error('Avatar unavailable')
					const blob = await response.blob()
					return await new Promise<string>((resolve, reject) => {
						const reader = new FileReader()
						reader.onload = () => resolve(String(reader.result))
						reader.onerror = reject
						reader.readAsDataURL(blob)
					})
				}
				catch {
					// 头像取不到 → 退回站点图标；图标也取不到 → 退回内置占位。
					// 图标要 cache:'reload'：它可能已被 <link rel=icon> 以 no-cors 方式缓存，
					// 命中的话 CORS 模式的 fetch 会直接失败（同下面 requestInit 那条）。
					const svg = await fetch(fallbackIcon, { cache: 'reload' })
						.then(response => response.text())
						.catch(() => NEUTRAL_ICON)
					return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
				}
			},
			// 长图里的图片会被逐张 fetch 成 data URL（否则 canvas 被污染）。构建期若
			// 配了 WIKI_ASSETS_BASE，图片就是跨域地址，这条 fetch 依赖图床的 CORS，
			// 桶上没有规则时整个导出会失败——见 image-uploader/README.md。
			// requestInit 必须覆盖：该库默认 cache: 'force-cache'，而图片此时已经被
			// <img> 以 no-cors 方式缓存过，浏览器不会为这份不透明副本补 CORS 校验，
			// 于是 fetch 直接失败、图片被静默丢掉（实测：默认模式 3/3 失败，
			// cache:'reload' 3/3 成功）。
			fetch: {
				requestInit: { cache: 'reload' },
				placeholderImage: () => { throw new Error('部分图片无法嵌入，请选择分享卡片或浏览器打印。') },
			},
		})
		if (!blob)
			throw new Error('浏览器未能生成图片，请使用分享卡片或浏览器打印。')
		return blob
	}
	finally { stage.remove() }
}
