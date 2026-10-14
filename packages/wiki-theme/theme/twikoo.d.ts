/**
 * twikoo 包没有自带类型声明（main 指向 minified UMD），这里按实际用到的接口补最小声明。
 * 完整选项见官方文档：https://twikoo.js.org/quick-start.html
 */
declare module 'twikoo' {
	export interface TwikooInitOptions {
		/** 腾讯云 Cloudbase 环境 ID，或自建后端的完整地址 */
		envId: string
		/** 挂载点：元素或选择器 */
		el?: HTMLElement | string
		/** 界面语言，默认 zh-CN */
		lang?: string
		/** 其余选项（locale、maxLen 等）原样透传给 Twikoo */
		[key: string]: unknown
	}

	export function init(options: TwikooInitOptions): Promise<void>
}
