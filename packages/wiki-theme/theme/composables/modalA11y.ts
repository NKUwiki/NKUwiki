import { nextTick } from 'vue'

/** 弹层内可获焦元素的选择器（常规顺序即 DOM 顺序，关闭按钮通常在最前） */
const FOCUSABLE
	= 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * 弹层的无障碍焦点管理（WCAG 对 modal 的基本要求）：
 *
 * - 打开时记录触发元素，把焦点移入弹层（优先带 data-autofocus 的元素，
 *   否则取第一个可获焦元素）——不这样做的话，读屏用户根本不知道弹出了一层，
 *   键盘用户的焦点还停在遮罩底下的正文里；
 * - Tab / Shift+Tab 在弹层内循环，焦点不会逃到遮罩外面「看不见」的位置；
 * - 关闭时焦点还原到触发元素，用户从原位置继续操作。两级嵌套弹层
 *   （如美食详情弹窗内再开图片查看器）天然可用：内层打开时记录的触发元素
 *   就是外层里的按钮，关闭时正好还原回去。
 *
 * 刻意做成显式调用的纯函数而不内置 watch：两个使用方的开关时序各有特例
 * （灯箱要等离场动画结束才解锁滚动、美食弹窗与查看器两级嵌套共用一个
 * keydown），集中托管反而要为每个特例开口子。
 */
export function createModalFocus() {
	let lastTrigger: HTMLElement | null = null

	/**
	 * Tab 焦点陷阱。挂在使用方的 keydown 里调用；拦下按键时通过
	 * preventDefault 表达（调用方据此决定是否继续处理）。
	 */
	function trap(event: KeyboardEvent, container: HTMLElement | null | undefined) {
		if (event.key !== 'Tab' || !container)
			return
		const items = [...container.querySelectorAll<HTMLElement>(FOCUSABLE)]
		if (!items.length) {
			event.preventDefault()
			return
		}
		const first = items[0]!
		const last = items[items.length - 1]!
		const current = document.activeElement
		// 焦点不知为何跑到了弹层外：拉回第一个，别让 Tab 直接逃出去
		if (!(current instanceof HTMLElement) || !container.contains(current)) {
			event.preventDefault()
			first.focus()
			return
		}
		if (event.shiftKey && current === first) {
			event.preventDefault()
			last.focus()
		}
		else if (!event.shiftKey && current === last) {
			event.preventDefault()
			first.focus()
		}
	}

	/** 弹层打开时调用：记录触发元素并把焦点移入容器（等容器渲染完） */
	function onOpen(container?: HTMLElement | null) {
		lastTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
		void nextTick(() => {
			if (!container)
				return
			const target = container.querySelector<HTMLElement>('[data-autofocus]')
				|| container.querySelector<HTMLElement>(FOCUSABLE)
			target?.focus()
		})
	}

	/** 弹层关闭时调用：焦点还原到触发元素 */
	function onClose() {
		lastTrigger?.focus()
		lastTrigger = null
	}

	/** 组件在弹层仍开着时被卸载：照样还原焦点，别丢在已删除的节点上 */
	function restoreIfOpen() {
		if (lastTrigger) {
			lastTrigger.focus()
			lastTrigger = null
		}
	}

	return { trap, onOpen, onClose, restoreIfOpen }
}
