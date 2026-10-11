// 隐秘文本的 click 触发逻辑：`.wiki-plot.click` 点击切换显示，点击页面其他处收起。
// 纯文档级事件委托（隐秘文本由 markdown 规则直接输出 span，没有组件实例可挂事件），
// 在主题入口模块顶层安装一次即可（hover 触发是纯 CSS，不经过这里）。
export function installPlotToggle(): void {
	if (typeof document === 'undefined')
		return
	document.addEventListener('click', (e) => {
		const target = e.target instanceof Element ? e.target : null
		const plot = target?.closest('.wiki-plot.click')
		if (plot) {
			plot.classList.toggle('active')
			return
		}
		for (const el of document.querySelectorAll('.wiki-plot.click.active'))
			el.classList.remove('active')
	})
}
