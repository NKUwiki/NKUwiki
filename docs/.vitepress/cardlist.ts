import type { MarkdownRenderer } from 'vitepress'
import linkIcon from '@iconify-icons/ri/external-link-fill'
import mailIcon from '@iconify-icons/ri/mail-fill'
import qqIcon from '@iconify-icons/ri/qq-fill'
import kitchen from '@iconify-icons/ri/restaurant-line'
import wechatIcon from '@iconify-icons/ri/wechat-fill'

const plainText = (cell = '') => cell.replace(/<[^>]*>/g, '').trim()
/** 从单元格取图片地址：`![](...)` 渲染出的 <img>、外链、或裸路径均可 */
function pickImageSrc(cell = '') {
	return cell.match(/<img\b[^>]*?\ssrc="([^"]+)"/i)?.[1]
		|| cell.match(/<a\b[^>]*?\shref="([^"]+)"/i)?.[1]
		|| plainText(cell)
}

/**
 * 飞书官方 logo（取自 Flathub 应用图标，256×256 视图），单色化以与整套图标统一。
 *  原三段 path 为青/蓝/深蓝实色，此处统一改为 currentColor，由 CSS 上成品牌蓝。
 */
const feishuBody = [
	'M135.837 130.957L136.315 130.48C136.625 130.17 136.959 129.835 137.293 129.525L137.962 128.88L139.943 126.923L142.665 124.273L144.981 121.981L147.153 119.832L149.421 117.588L151.498 115.535L154.411 112.67C154.96 112.121 155.533 111.596 156.106 111.071C157.156 110.116 158.255 109.184 159.353 108.277C160.379 107.466 161.43 106.678 162.504 105.914C164.008 104.839 165.56 103.861 167.136 102.906C168.688 101.998 170.287 101.139 171.91 100.327C173.438 99.5872 175.014 98.8948 176.614 98.2741C177.497 97.916 178.404 97.6056 179.311 97.2953C179.765 97.152 180.219 96.9849 180.696 96.8417C176.661 80.9656 169.284 66.1638 159.042 53.3912C157.061 50.9322 154.053 49.4998 150.901 49.4998H67.2235C66.3641 49.4998 65.6479 50.1921 65.6479 51.0755C65.6479 51.5768 65.8866 52.0304 66.2925 52.3408C94.8456 73.2782 118.528 100.184 135.646 131.172L135.837 130.957Z',
	'M102.581 204.609C145.793 204.609 183.442 180.759 203.066 145.521C203.759 144.279 204.427 143.038 205.072 141.773C204.093 143.659 202.995 145.473 201.777 147.192C201.347 147.789 200.918 148.386 200.464 148.983C199.891 149.723 199.318 150.415 198.721 151.107C198.244 151.656 197.766 152.182 197.265 152.707C196.262 153.757 195.212 154.76 194.114 155.691C193.493 156.216 192.896 156.718 192.252 157.195C191.511 157.768 190.747 158.317 189.983 158.819C189.506 159.153 189.005 159.463 188.503 159.774C188.002 160.084 187.477 160.394 186.928 160.705C185.853 161.302 184.731 161.874 183.609 162.376C182.63 162.806 181.628 163.211 180.625 163.593C179.527 163.999 178.428 164.357 177.283 164.668C175.587 165.145 173.892 165.503 172.15 165.766C170.908 165.957 169.619 166.1 168.354 166.196C167.017 166.291 165.656 166.315 164.295 166.315C162.791 166.291 161.287 166.196 159.759 166.029C158.637 165.909 157.515 165.742 156.393 165.551C155.414 165.384 154.435 165.169 153.456 164.93C152.931 164.811 152.43 164.668 151.905 164.525C150.472 164.143 149.04 163.737 147.607 163.331C146.891 163.116 146.175 162.925 145.482 162.71C144.408 162.4 143.358 162.065 142.307 161.731C141.448 161.469 140.588 161.182 139.729 160.896C138.917 160.633 138.082 160.37 137.27 160.084L135.599 159.511C134.93 159.272 134.238 159.033 133.569 158.795L132.137 158.27C131.182 157.935 130.227 157.577 129.296 157.219C128.747 157.004 128.198 156.813 127.649 156.598C126.909 156.312 126.192 156.025 125.452 155.739C124.688 155.429 123.9 155.118 123.136 154.808L121.632 154.187L119.77 153.423L118.338 152.826L116.858 152.182L115.568 151.609L114.399 151.083L113.205 150.534L111.987 149.961L110.435 149.245L108.812 148.481C108.239 148.195 107.666 147.932 107.093 147.646L105.637 146.929C79.9484 134.109 56.7668 116.824 37.1425 95.863C36.5456 95.2423 35.5668 95.1945 34.9222 95.7914C34.6118 96.0779 34.4208 96.5076 34.4208 96.9373L34.4686 170.779V176.772C34.4686 180.257 36.1875 183.504 39.0762 185.438C57.865 197.996 79.9723 204.657 102.581 204.609Z',
	'M229.566 100.517C214.98 93.379 198.292 91.8511 182.654 96.2439C181.986 96.4348 181.341 96.6258 180.697 96.8168C180.243 96.9601 179.789 97.1033 179.312 97.2704C178.405 97.5808 177.498 97.915 176.614 98.2493C175.015 98.87 173.463 99.5623 171.911 100.302C170.288 101.09 168.688 101.95 167.136 102.857C165.537 103.788 164.009 104.791 162.505 105.865C161.43 106.629 160.38 107.417 159.353 108.229C158.231 109.136 157.157 110.043 156.107 111.022C155.534 111.547 154.985 112.072 154.412 112.621L151.499 115.486L149.422 117.539L147.154 119.783L144.981 121.932L142.666 124.224L139.968 126.898L137.986 128.856L137.318 129.5C137.007 129.811 136.673 130.145 136.339 130.455L135.862 130.933L135.121 131.625C134.835 131.888 134.572 132.126 134.286 132.389C127.1 139.002 119.078 144.66 110.46 149.268L112.012 149.984L113.229 150.557L114.423 151.106L115.593 151.631L116.882 152.204L118.362 152.849L119.794 153.446L121.657 154.21L123.161 154.83C123.925 155.141 124.712 155.451 125.476 155.761C126.193 156.048 126.933 156.334 127.673 156.621C128.222 156.836 128.771 157.027 129.32 157.242C130.275 157.6 131.23 157.934 132.161 158.292L133.594 158.817C134.262 159.056 134.93 159.295 135.623 159.533L137.294 160.106C138.106 160.369 138.917 160.656 139.753 160.918C140.612 161.205 141.472 161.467 142.331 161.754C143.382 162.088 144.456 162.398 145.507 162.733C146.223 162.947 146.939 163.162 147.631 163.353C149.064 163.759 150.496 164.165 151.929 164.547C152.454 164.69 152.955 164.81 153.48 164.953C154.459 165.192 155.438 165.383 156.417 165.574C157.539 165.765 158.661 165.932 159.783 166.051C161.311 166.218 162.815 166.314 164.319 166.338C165.68 166.361 167.041 166.314 168.378 166.218C169.667 166.123 170.932 165.979 172.174 165.788C173.893 165.526 175.612 165.144 177.307 164.69C178.429 164.38 179.551 164.022 180.649 163.616C181.652 163.258 182.654 162.852 183.633 162.398C184.755 161.897 185.877 161.324 186.952 160.727C187.477 160.441 188.002 160.13 188.527 159.796C189.053 159.486 189.53 159.152 190.007 158.841C190.771 158.316 191.535 157.791 192.275 157.218C192.92 156.74 193.541 156.239 194.138 155.714C195.212 154.783 196.262 153.78 197.265 152.729C197.766 152.204 198.244 151.679 198.721 151.13C199.318 150.438 199.915 149.721 200.464 149.005C200.918 148.432 201.348 147.835 201.777 147.215C202.971 145.496 204.069 143.705 205.048 141.843L206.17 139.623L216.149 119.736L216.269 119.497C219.563 112.383 224.052 105.984 229.566 100.517Z',
].map(d => `<path fill="currentColor" d="${d}"/>`).join('')

/**
 * 预载入可用图标：名称 -> { body: 内联 SVG 内容, vb: viewBox }。
 *  表格中用 :名称: 手动调用，例如 :qq: 或 :feishu:
 */
const cardIcons: Record<string, { body: string, vb: string }> = {
	qq: { body: qqIcon.body, vb: '0 0 24 24' },
	wechat: { body: wechatIcon.body, vb: '0 0 24 24' },
	feishu: { body: feishuBody, vb: '0 0 256 256' },
	mail: { body: mailIcon.body, vb: '0 0 24 24' },
	link: { body: linkIcon.body, vb: '0 0 24 24' },
	// 如需更多，在此追加并 import 对应 @iconify-icons/ri/* 图标
}

/** 把单元格里的 :名称: 替换为对应 SVG 图标（名称不存在则原样保留） */
function renderCardIcons(value: string): string {
	return value.replace(/:([a-z][a-z0-9-]*):/gi, (match, name: string) => {
		const icon = cardIcons[name.toLowerCase()]
		return icon ? `<svg class="card-field-icon" aria-hidden="true" viewBox="${icon.vb}">${icon.body}</svg>` : match
	})
}

/** Keep editorial data in Markdown tables while rendering semantic cards. */
export function cardlist(md: MarkdownRenderer) {
	md.block.ruler.before('fence', 'cardlist', (state, start, end, silent) => {
		const line = (index: number) => state.src.slice(state.bMarks[index] + state.tShift[index], state.eMarks[index]).trim()
		if (line(start) !== '::: cardlist')
			return false
		let close = start + 1
		while (close < end && line(close) !== ':::') close++
		if (close === end)
			return false
		if (silent)
			return true
		const tokens = md.parse(state.getLines(start + 1, close, state.blkIndent, false), state.env)
		const html: string[] = []
		let headers: string[] = []
		let cells: string[] = []
		let isGroup = false
		let isHeader = false
		let inTable = false
		let avatarIndex = -1
		for (const token of tokens) {
			switch (token.type) {
				case 'table_open':
					inTable = true
					headers = []
					html.push('<div class="campus-card-grid" role="list">')
					break
				case 'table_close':
					inTable = false
					html.push('</div>')
					break
				case 'thead_open':
					isHeader = true
					break
				case 'thead_close':
					isHeader = false
					break
				case 'tr_open':
					cells = []
					break
				case 'tr_close':
					if (isHeader) {
						headers = cells
						isGroup = headers.some(header => /群号|加入方式|二维码/.test(header))
						avatarIndex = headers.findIndex(header => /头像/.test(header))
						html[html.length - 1] = `<div class="campus-card-grid ${isGroup ? 'group-cards' : 'food-cards'}" role="list">`
						break
					}
					html.push('<article class="campus-card" role="listitem">')
					if (isGroup) {
						const qq = cells[1]?.replace(/<[^>]*>/g, '').match(/\b\d{5,12}\b/)?.[0] || ''
						const avatar = avatarIndex > -1 ? pickImageSrc(cells[avatarIndex]) : ''
						html.push(avatar
							? `<GroupAvatar qq="${qq}" avatar="${avatar}" />`
							: `<GroupAvatar qq="${qq}" />`)
					}
					else {
						html.push(`<span class="food-card-icon" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${kitchen.body}</svg></span>`)
					}
					html.push(`<h3 class="campus-card-title">${cells[0]}</h3>`)
					for (let i = 1; i < cells.length; i++) {
						if (!cells[i].trim())
							continue
						if (i === avatarIndex)
							continue
						const label = headers[i] || ''
						const value = renderCardIcons(cells[i].replace(/<QrCode\b/g, '<HoverMedia kind="qr"'))
						if (isGroup && /备注/.test(label)) {
							html.push(`<div class="card-badges">${value}</div>`)
						}
						else if (/菜品/.test(label)) {
							const scores = value.split('-')
							html.push(`<div class="food-scores" aria-label="${label}">${scores.map((score, index) => `<span>${['菜品', '菜量', '环境', '总体'][index] || ''} <b>${score}</b></span>`).join('')}</div>`)
						}
						else if (/评价|主要工作/.test(label)) {
							html.push(`<div class="card-description">${value}</div>`)
						}
						else if (isGroup && /群号|加入方式/.test(label)) {
							html.push(`<div class="group-contact">${value}</div>`)
						}
						else if (isGroup && /二维码/.test(label)) {
							html.push(value)
						}
						else {
							html.push(`<div class="campus-card-field"><span class="campus-card-label">${label}</span><div>${value}</div></div>`)
						}
					}
					html.push('</article>')
					break
				case 'inline':
					if (inTable)
						cells.push(md.renderer.renderInline(token.children || [], md.options, state.env))
					else html.push(md.renderer.render([token], md.options, state.env))
					break
				default:
					if (!inTable)
						html.push(md.renderer.render([token], md.options, state.env))
			}
		}
		const token = state.push('html_block', '', 0)
		token.content = `${html.join('\n')}\n`
		token.map = [start, close + 1]
		state.line = close + 1
		return true
	}, { alt: ['paragraph', 'reference', 'blockquote', 'list'] })
}
