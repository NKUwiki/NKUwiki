/**
 * Gallery 图片画廊的布局纯函数：按原始宽高比把图片排成等高行（杂志式两端对齐网格），
 * 每行在目标行高附近整体缩放到恰好铺满容器宽度，最后一行不强行拉伸。
 * 不感知 DOM，供 Gallery.vue 在客户端测出图片宽高比与容器宽度后调用，单元测试直接覆盖。
 */

/** 布局输入：一张图与其宽高比（naturalWidth / naturalHeight） */
export interface GalleryImage {
	src: string
	alt?: string
	aspect: number
}

/** 一张图在所在行内缩放后的显示尺寸 */
export interface GalleryPlacement {
	image: GalleryImage
	width: number
	height: number
}

export interface GalleryRow {
	height: number
	images: GalleryPlacement[]
}

/** 最后一行的目标行高（不拉伸，只可能在超宽时缩小） */
const DEFAULT_ROW_HEIGHT = 220

/**
 * 贪心分行：累计宽度达到容器宽即收行，行内等高铺满；末行保持目标行高、靠左排布。
 * 宽高比非正（未知或非法）的图片直接跳过，避免未知尺寸参与计算造成布局抖动。
 */
export function layoutGallery(
	images: GalleryImage[],
	containerWidth: number,
	rowHeight = DEFAULT_ROW_HEIGHT,
	gap = 8,
): GalleryRow[] {
	if (containerWidth <= 0 || !Number.isFinite(containerWidth))
		return []
	const rows: GalleryRow[] = []
	let row: GalleryImage[] = []
	let aspectSum = 0

	const finalize = (stretch: boolean) => {
		if (!row.length)
			return
		const gaps = gap * (row.length - 1)
		// stretch 行按剩余宽度精确铺满；末行用目标行高，超宽时才缩小
		const height = Math.max(1, stretch ? (containerWidth - gaps) / aspectSum : Math.min(rowHeight, (containerWidth - gaps) / aspectSum))
		rows.push({
			height,
			images: row.map(image => ({ image, width: image.aspect * height, height })),
		})
		row = []
		aspectSum = 0
	}

	for (const image of images) {
		if (!(image.aspect > 0) || !Number.isFinite(image.aspect))
			continue
		row.push(image)
		aspectSum += image.aspect
		if (aspectSum * rowHeight + gap * (row.length - 1) >= containerWidth)
			finalize(true)
	}
	finalize(false)
	return rows
}
