import assert from 'node:assert/strict'
import test from 'node:test'
import { replaceAssets } from '../packages/wiki-theme/lib/vite/replace-assets.ts'

const cdn = 'https://img.example.com'

/** 站内绝对路径 + 图片扩展名 → 前缀拼接 */
test('图片与媒体按前缀拼到图床域名下', () => {
	const { transformHtml } = replaceAssets({ siteBase: '', image: cdn, media: cdn })
	assert.equal(
		transformHtml('<img src="/img/05/09/美食.jpg">'),
		`<img src="${cdn}/img/05/09/美食.jpg">`,
	)
	// 字体走 media 规则
	assert.equal(
		transformHtml('<link rel="preload" href="/fonts/a.woff2">'),
		`<link rel="preload" href="${cdn}/fonts/a.woff2">`,
	)
})

/**
 * 这是本插件最要紧的一条：VitePress 自己打包出来的资源（内置 Inter 字体等）文件名
 * 带构建哈希，桶里追不平，改写到图床必然 404 —— 必须留在站内由 Pages 直出。
 */
test('skip 命中构建产物目录时保持原样', () => {
	const { transformHtml } = replaceAssets({
		siteBase: '',
		skip: '^/assets/',
		image: cdn,
		media: cdn,
	})
	const html = [
		'<link rel="preload" href="/assets/inter-roman-latin.q5rAVC0E.woff2" as="font">',
		'<img src="/img/banner.png">',
	].join('')
	assert.equal(
		transformHtml(html),
		`<link rel="preload" href="/assets/inter-roman-latin.q5rAVC0E.woff2" as="font"><img src="${cdn}/img/banner.png">`,
	)
})

test('skip 支持数组与正则，且只影响命中的路径', () => {
	const { transformHtml } = replaceAssets({
		siteBase: '',
		skip: ['^/assets/', /^\/favicon-/],
		image: cdn,
	})
	assert.equal(
		transformHtml('<img src="/assets/a.png"><img src="/favicon-light.svg"><img src="/img/a.png">'),
		`<img src="/assets/a.png"><img src="/favicon-light.svg"><img src="${cdn}/img/a.png">`,
	)
})

test('不加 skip 时构建产物也会被改写（说明 skip 必须显式配置）', () => {
	const { transformHtml } = replaceAssets({ siteBase: '', image: cdn, media: cdn })
	assert.equal(
		transformHtml('<link href="/assets/inter-roman-latin.q5rAVC0E.woff2">'),
		`<link href="${cdn}/assets/inter-roman-latin.q5rAVC0E.woff2">`,
	)
})

test('未配置任何规则时是恒等操作', () => {
	const handle = replaceAssets({ siteBase: '' })
	const html = '<img src="/img/banner.png"><img src="/assets/app.abc.js">'
	assert.equal(handle.transformHtml(html), html)
	// 空转时连 generateBundle 都不挂，构建成本为零
	assert.equal(handle.plugin.generateBundle, undefined)
})

test('外链、协议相对、data: 一律不动', () => {
	const { transformHtml } = replaceAssets({ siteBase: '', image: cdn, media: cdn })
	const html = [
		'<img src="https://other.example.com/img/banner.png">',
		'<img src="//other.example.com/img/banner.png">',
		'<img src="data:image/png;base64,iVBORw0KGgo=">',
	].join('')
	assert.equal(transformHtml(html), html)
})

test('非资源扩展名（页面、脚本、样式、webmanifest）不在改写范围', () => {
	const { transformHtml } = replaceAssets({ siteBase: '', image: cdn, media: cdn })
	const html = [
		'<link rel="manifest" href="/manifest.webmanifest">',
		'<script src="/assets/app.abc.js"></script>',
		'<link rel="stylesheet" href="/assets/style.abc.css">',
	].join('')
	assert.equal(transformHtml(html), html)
})

test('siteBase 会先从路径里剥掉再拼 CDN', () => {
	const { transformHtml } = replaceAssets({ siteBase: '/wiki', image: cdn })
	assert.equal(
		transformHtml('<img src="/wiki/img/banner.png">'),
		`<img src="${cdn}/img/banner.png">`,
	)
})

test('替换函数拿到的是去掉 siteBase 后的路径', () => {
	const seen: string[] = []
	const { transformHtml } = replaceAssets({
		siteBase: '',
		image: (url) => {
			seen.push(url)
			return `https://fn.example.com${url}`
		},
	})
	assert.equal(transformHtml('<img src="/img/banner.png">'), '<img src="https://fn.example.com/img/banner.png">')
	assert.deepEqual(seen, ['/img/banner.png'])
})

test('前缀字符串带尾斜杠时不会拼出双斜杠', () => {
	const { transformHtml } = replaceAssets({ siteBase: '', image: `${cdn}/` })
	assert.equal(transformHtml('<img src="/img/banner.png">'), `<img src="${cdn}/img/banner.png">`)
})

test('带查询串的链接连同查询串一起拼接', () => {
	const { transformHtml } = replaceAssets({ siteBase: '', image: cdn })
	assert.equal(
		transformHtml('<img src="/img/banner.png?v=2">'),
		`<img src="${cdn}/img/banner.png?v=2">`,
	)
})

test('generateBundle 同时处理 JS chunk 与 CSS 资源', () => {
	const handle = replaceAssets({ siteBase: '', skip: '^/assets/', image: cdn })
	const bundle = {
		'app.js': { type: 'chunk', code: `const a = '/img/banner.png'` },
		'style.css': { type: 'asset', source: `.x{background:url(/img/banner.png)}` },
		'logo.png': { type: 'asset', source: 'binary-placeholder' },
	}
	const run = handle.plugin.generateBundle as (options: unknown, bundle: unknown) => void
	run({}, bundle)
	assert.equal(bundle['app.js'].code, `const a = '${cdn}/img/banner.png'`)
	assert.equal(bundle['style.css'].source, `.x{background:url(${cdn}/img/banner.png)}`)
	// 二进制资源（图片本身）不在处理范围
	assert.equal(bundle['logo.png'].source, 'binary-placeholder')
})

/**
 * 压缩器会把源码里的单引号改写成模板字面量：WikiLayout.vue 里明明写的是
 * '/favicon-dark.svg'，产物里成了反引号包裹。只认 " ' ( 三个前导字符时，
 * 被打包成模板字面量的路径会整批漏改（实测漏掉 180 个真实资源）。
 */
test('模板字面量里的路径同样改写', () => {
	const bundle = { 'app.js': { type: 'chunk', code: 'const icon = `/favicon-dark.svg`;const cover=`/img/food/shots/BV1.webp`' } }
	const run = replaceAssets({ siteBase: '', image: cdn }).plugin.generateBundle as (options: unknown, bundle: unknown) => void
	run({}, bundle)
	assert.equal(
		bundle['app.js'].code,
		`const icon = \`${cdn}/favicon-dark.svg\`;const cover=\`${cdn}/img/food/shots/BV1.webp\``,
	)
})

test('模板字面量里的 ${} 插值原样保留，只替换静态前缀', () => {
	const bundle = { 'app.js': { type: 'chunk', code: `const a = \`/img/\${campus}/a.png\`` } }
	const run = replaceAssets({ siteBase: '', image: cdn }).plugin.generateBundle as (options: unknown, bundle: unknown) => void
	run({}, bundle)
	assert.equal(bundle['app.js'].code, `const a = \`${cdn}/img/\${campus}/a.png\``)
})

test('拼接路径与「路径只是长文本的一部分」都不改动', () => {
	const { transformHtml } = replaceAssets({ siteBase: '', image: cdn })
	// 用 + 拼接：静态前缀和扩展名分散在两段里，不猜
	assert.equal(
		transformHtml(`<script>const a = '/img/' + name + '.png'</script>`),
		`<script>const a = '/img/' + name + '.png'</script>`,
	)
	// 整条路径必须就是一个完整字符串；散文里的路径不碰
	assert.equal(
		transformHtml(`<script>const s = \`见 /img/a.png。\`</script>`),
		`<script>const s = \`见 /img/a.png。\`</script>`,
	)
})
