// 搜索弹窗的跨实例共享状态。
// WikiSearch 在导航栏与移动端菜单各挂一个实例，弹窗开关必须是模块级单例：
// 任意入口按钮打开的都是同一个弹窗（由导航栏实例渲染）。
import { ref } from 'vue'

export const searchModalOpen = ref(false)
export const searchIndexLoading = ref(false)
