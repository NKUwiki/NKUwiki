import antfu from '@antfu/eslint-config'
import css from '@zinkawaii/eslint-config-css'

export default antfu({
	stylistic: { indent: 'tab' },
	pnpm: false,
	vue: true,
	typescript: true,
	test: false,
	// Historical articles contain teaching examples, not executable project code.
	// MapView.vue / map-data.js 自 QUT-WiKi 与 CQUMAPS-1.0 移植（保持上游原样便于同步），
	// 代码风格遵循各自上游，不参与本项目的 lint。
	ignores: [
		'docs/public/**',
		'docs/**/*.md',
		'**/dist/**',
		'**/cache/**',
		'.npm-cache/**',
		'docs/.vitepress/theme/components/MapView.vue',
		'docs/.vitepress/theme/components/map-data.js',
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
