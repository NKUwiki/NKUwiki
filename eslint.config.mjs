import antfu from '@antfu/eslint-config'
import css from '@zinkawaii/eslint-config-css'

export default antfu({
	stylistic: { indent: 'tab' },
	pnpm: false,
	vue: true,
	typescript: true,
	test: false,
	// Historical articles contain teaching examples, not executable project code.
	// MapView.vue 自 QUT-WiKi 移植（保持上游原样便于同步），
	// map-data.js 为站点地图数据（自上游转换生成，保持书写风格），
	// campus-boundary.js 由 scripts/gen-boundary.mjs 生成（几千个坐标点，格式由脚本决定），
	// 以上均不参与本项目的 lint。
	ignores: [
		'docs/public/**',
		'docs/**/*.md',
		'**/dist/**',
		'**/cache/**',
		'.npm-cache/**',
		'packages/wiki-map/MapView.vue',
		'docs/.vitepress/data/map-data.js',
		'docs/.vitepress/data/campus-boundary.js',
		// food-canteens.js 由 scripts/fetch-bili-food.mjs 生成（上百条实拍，格式由脚本决定）
		'docs/.vitepress/data/food-canteens.js',
	],
	rules: {
		'jsonc/indent': ['error', 2],
		'yaml/indent': ['error', 2],
		'vue/block-lang': ['error', { script: { lang: ['ts'] } }],
		'vue/html-indent': ['error', 'tab', { baseIndent: 0 }],
	},
})
	.append(css, {
		files: ['**/*.css'],
		rules: {
			'css-stylistic/indentation': ['error', 'tab'],
			// 十六进制色值按 color-hex-case 用大写，尾字母（如 #69337A 的 A）会被
			// unit-case 误判为单位要求小写——两条规则互相矛盾，关闭后者
			'css-stylistic/unit-case': 'off',
		},
	})
	.setDefaultIgnores(previous => [...previous, '**/*.css'])
