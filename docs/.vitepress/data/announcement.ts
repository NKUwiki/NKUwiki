/**
 * 全站公告横条配置：渲染在每页视口顶部的固定横条（见「站点功能说明」）。
 *
 * - message：公告文字；空字符串表示隐藏横条（默认关闭）
 * - background / color：可选，留空用默认的「主题色底 + 白字」
 *
 * 修改后需重新构建（本地 pnpm dev 需重启；正式站点推送后由 CI 自动重建）。
 */
export const announcement = {
	message: '',
	background: '',
	color: '',
}
