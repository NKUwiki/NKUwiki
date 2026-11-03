/**
 * `@nolebase/vitepress-plugin-enhanced-readabilities/client/constants` 是
 * lib/vite/spotlight-patch.ts 专用的虚拟说明符：运行时被重定向到包内的
 * dist/client/constants.mjs（该子路径不在包 exports 里，但值必须与插件同源，
 * InjectionKey 才能对上 app.provide 注入的选项）。类型按包根的声明转发。
 */
declare module '@nolebase/vitepress-plugin-enhanced-readabilities/client/constants' {
	export { InjectionKey, SpotlightStyle, SpotlightStylesStorageKey } from '@nolebase/vitepress-plugin-enhanced-readabilities/client'
}
