// 全站公告横条的**注入点**：真实值属于站点数据，不随主题包分发。
//
// 站点侧在 docs/.vitepress/data/announcement.ts 保存配置，并在 config.mts 里通过
// `vite.define` 把它以全局常量形式编译期注入（构建期与客户端双端生效）：
//
//   vite: { define: { __ANNOUNCEMENT__: JSON.stringify(announcement) } }
//
// 未注入（主题包被独立复用）或解析失败时返回 null，横条不渲染。

/** 全站公告横条配置 */
export interface AnnouncementConfig {
	/** 公告文字；空字符串表示隐藏横条 */
	message: string
	/** 背景色（任意 CSS 颜色值），缺省为主题色 */
	background?: string
	/** 文字颜色，缺省白色 */
	color?: string
}

declare const __ANNOUNCEMENT__: string | undefined

export const announcement: AnnouncementConfig | null = (() => {
	// typeof 判断保证未注入（标识符不存在）时也不会抛错
	if (typeof __ANNOUNCEMENT__ !== 'string')
		return null
	try {
		const parsed = JSON.parse(__ANNOUNCEMENT__) as AnnouncementConfig
		return parsed && typeof parsed.message === 'string' ? parsed : null
	}
	catch {
		return null
	}
})()
