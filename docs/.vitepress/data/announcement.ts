/**
 * 全站公告横条配置：渲染在每页视口顶部的固定横条（见「站点功能说明」）。
 *
 * - message：公告文字；空字符串表示隐藏横条（默认关闭）
 * - background / color：可选，留空用默认的「主题色底 + 白字」
 * - id：可选公告指纹，缺省取 message；用户关闭后同 id 不再弹出，发新公告换 id 即可重新展示
 * - lifetime：可选 'session'（本次会话不再显示，默认）/ 'once'（永久不再显示）；不填则关闭不记忆
 *
 * 修改后需重新构建（本地 pnpm dev 需重启；正式站点推送后由 CI 自动重建）。
 */
export const announcement = {
	message: '',
	background: '',
	color: '',
}
