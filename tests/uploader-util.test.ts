import assert from 'node:assert/strict'
import test from 'node:test'
import {
	base64ToBytes,
	buildCatalog,
	dedupeTargetName,
	normalizeDir,
	parseArticleDocPath,
	sanitizeFileName,
	sha256Hex,
	toManagedDir,
	truncateFileName,
} from '../image-uploader/src/util.ts'

test('sanitizeFileName 保留中文名并剔除非法字符与路径段', () => {
	assert.equal(sanitizeFileName('活动现场.jpg'), '活动现场.jpg')
	assert.equal(sanitizeFileName('a/b/c\\窃取?:*.png'), '窃取.png')
	assert.equal(sanitizeFileName('  ..点名.  '), '点名')
	assert.equal(sanitizeFileName('???'), 'unnamed')
	assert.equal(sanitizeFileName(''), 'unnamed')
	// 控制字符被剔除
	assert.equal(sanitizeFileName(`图${String.fromCharCode(0, 31)}片.gif`), '图片.gif')
})

test('truncateFileName 截断超长文件名并留省略号', () => {
	assert.equal(truncateFileName('短.jpg'), '短.jpg')
	const long = `${'长'.repeat(150)}.jpg`
	const cut = truncateFileName(long)
	assert.equal([...cut].length, 121)
	assert.ok(cut.endsWith('…'))
})

test('normalizeDir 只接受安全的编号目录或普通段', () => {
	assert.equal(normalizeDir('03/03'), '03/03')
	assert.equal(normalizeDir('/01/02/'), '01/02')
	assert.equal(normalizeDir('authors'), 'authors')
	assert.equal(normalizeDir('南开图片/社团'), '南开图片/社团')
	assert.equal(normalizeDir('_pending'), null)
	assert.equal(normalizeDir('_meta'), null)
	assert.equal(normalizeDir('01/../_meta'), null)
	assert.equal(normalizeDir('..'), null)
	assert.equal(normalizeDir(''), null)
	assert.equal(normalizeDir('  '), null)
	assert.equal(normalizeDir('a b'), null)
	assert.equal(normalizeDir('.hidden'), null)
	assert.equal(normalizeDir('-x'), null)
})

test('parseArticleDocPath 提取两级编号分层，忽略非文章路径', () => {
	assert.deepEqual(parseArticleDocPath('docs/05.校园生活/09.美食.md'), {
		groupCode: '05',
		groupName: '校园生活',
		articleCode: '09',
		articleName: '美食',
	})
	assert.equal(parseArticleDocPath('docs/05.校园生活/README.md'), null)
	assert.equal(parseArticleDocPath('docs/05.校园生活/pages/SiteFeatures.md'), null)
	assert.equal(parseArticleDocPath('docs/index.md'), null)
	assert.equal(parseArticleDocPath('docs/public/img/05/09/美食.jpg'), null)
})

test('buildCatalog 构建按编号排序的栏目树并去重', () => {
	const tree = buildCatalog([
		'docs/01.新生入学/02.军训.md',
		'docs/01.新生入学/01.入学准备.md',
		'docs/01.新生入学/02.军训.md',
		'docs/05.计算机知识/03.WSL安装教程.md',
		'docs/README.md',
	])
	assert.deepEqual(tree, [
		{
			code: '01',
			name: '新生入学',
			children: [
				{ code: '01', name: '入学准备', dir: '01/01' },
				{ code: '02', name: '军训', dir: '01/02' },
			],
		},
		{
			code: '05',
			name: '计算机知识',
			children: [
				{ code: '03', name: 'WSL安装教程', dir: '05/03' },
			],
		},
	])
})

test('toManagedDir 把所有目标归一到 img/ 子树且幂等', () => {
	assert.equal(toManagedDir('03/03'), 'img/03/03')
	assert.equal(toManagedDir('img/03/03'), 'img/03/03')
	assert.equal(toManagedDir(''), 'img')
	assert.equal(toManagedDir('  '), 'img')
	assert.equal(toManagedDir('img'), 'img')
	assert.equal(toManagedDir('/img/'), 'img')
	assert.equal(toManagedDir('authors'), 'img/authors')
	assert.equal(toManagedDir('南开图片/社团'), 'img/南开图片/社团')
	assert.equal(toManagedDir('_pending'), null)
	assert.equal(toManagedDir('..'), null)
	assert.equal(toManagedDir('a b'), null)
})

test('dedupeTargetName 在主名与扩展名之间插入短哈希', () => {
	assert.equal(dedupeTargetName('图.jpg', 'a1b2c3d4e5'), '图-a1b2c3.jpg')
	assert.equal(dedupeTargetName('noext', 'a1b2c3d4e5'), 'noext-a1b2c3')
	// 点开头的隐藏名（理论上清洗后不会出现，但不应把整名当扩展名）
	assert.equal(dedupeTargetName('.dotfile', 'a1b2c3d4e5'), '.dotfile-a1b2c3')
})

test('sha256Hex 与 base64ToBytes 往返一致', async () => {
	// 固定向量校验
	const digest = await sha256Hex(new TextEncoder().encode('abc').buffer as ArrayBuffer)
	assert.equal(digest, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
	const bytes = new TextEncoder().encode('hello NKUwiki')
	const round = base64ToBytes(btoa(String.fromCharCode(...bytes)))
	assert.equal(new TextDecoder().decode(round), 'hello NKUwiki')
})
