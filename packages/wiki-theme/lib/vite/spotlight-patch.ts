import type { Plugin } from 'vite'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 聚光灯组件替换（解析期，dev 与 build 都生效）。
 *
 * Nolebase 增强可读性插件的 SpotlightHoverBlock 命中/取框逻辑有两处观感问题：
 * 逐行高亮段落（跟着鼠标走）与「一项 ↔ 整块列表」的高度跳变（详见
 * theme/components/SpotlightHoverBlock.vue 顶部说明）。这里在 Vite 解析阶段把
 * 插件内部的 `./SpotlightHoverBlock.vue` 重定向到主题包内的修补副本——
 * 插件源码与 node_modules 都不动，回滚只需从 config.mts 的 plugins 里删掉本插件。
 *
 * 同时解析一个专用说明符 `…/client/constants`：副本要引与插件同源的 InjectionKey
 * 等常量，但该子路径不在包 exports 里，Vite/TS 都无法直接解析（类型声明见
 * theme/nolebaseConstants.d.ts）。这里重定向到与包入口同目录的 constants.mjs，
 * 不复制常量、不产生对包入口的循环引用。
 *
 * 注意：副本是 2.21.1 版的手工拷贝，**升级该依赖时需要 diff 一次原组件**。
 */
export function spotlightHoverBlockPatch(): Plugin {
	const patchedComponent = fileURLToPath(new URL('../../theme/components/SpotlightHoverBlock.vue', import.meta.url))
	// 从包入口（client → dist/client/index.mjs）反推同目录的 constants.mjs，
	// 兼容 hoisted 与 .pnpm 两种 node_modules 布局
	const clientEntry = createRequire(import.meta.url).resolve('@nolebase/vitepress-plugin-enhanced-readabilities/client')
	const constantsModule = join(dirname(clientEntry), 'constants.mjs')

	return {
		name: 'wiki-spotlight-hover-block-patch',
		enforce: 'pre',
		resolveId(source, importer) {
			if (source === '@nolebase/vitepress-plugin-enhanced-readabilities/client/constants')
				return constantsModule
			// 只拦插件包内部的相对引用（全仓库仅 Spotlight.vue 引用该组件）
			if (
				source.endsWith('SpotlightHoverBlock.vue')
				&& importer?.replaceAll('\\', '/').includes('@nolebase/vitepress-plugin-enhanced-readabilities')
			) {
				return patchedComponent
			}
			return null
		},
	}
}
