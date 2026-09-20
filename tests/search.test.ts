import assert from 'node:assert/strict'
import test from 'node:test'
import { buildSearchDocs, extractBody } from '../docs/.vitepress/search.ts'
import { buildExcerpt, expandQuery, highlightText, tokenize, tokenizeForIndex } from '../docs/.vitepress/searchCore.ts'

test('query-side expansion appends synonym variants to the search string', () => {
	assert.equal(expandQuery('吉它社团'), '吉它社团 吉他')
	assert.equal(expandQuery('宿舍电费'), '宿舍电费 寝室')
	assert.equal(expandQuery('校园卡'), '校园卡')
})

test('tokenizer segments Chinese into dictionary words and normalizes case', () => {
	// 切词只需保证：所有汉字都会保留（词典如何切不影响两侧一致性）、英文归一小写
	assert.deepEqual(tokenize('GitHub'), ['github'])
	assert.ok(tokenize('用GitHub查GPA成绩').includes('github'))
	assert.ok(tokenize('用GitHub查GPA成绩').includes('gpa'))
	assert.equal(tokenize('如何办理校园卡并开通校园网').join(''), '如何办理校园卡并开通校园网')
	assert.equal(tokenize('吉他社团').join(''), '吉他社团')
	// 索引侧只多不少：去掉变体词后与查询侧一致
	assert.deepEqual(tokenizeForIndex('吉他社团').filter(token => token !== '吉它'), tokenize('吉他社团'))
})

test('index-side tokenization expands synonym variants into the token list', () => {
	const tokens = tokenizeForIndex('我加入了吉他社')
	assert.ok(tokens.includes('吉他'))
	assert.ok(tokens.includes('吉它'))
	// 无变体的词不额外扩散
	assert.deepEqual(tokenizeForIndex('校园卡').filter(token => token === '饭堂'), [])
	assert.deepEqual(tokenizeForIndex('校园卡').filter(token => !tokenize('校园卡').includes(token)), [])
})

test('extractBody keeps cardlist tables and code content, drops syntax noise, records section offsets', () => {
	const { text, sections } = extractBody(`## 使用

欢迎来到 [NKUwiki](https://nku.wiki)！步骤如下：

1. 打开 \`setup.exe\`
2. 安装 **吉他** 相关驱动

| 名称 | 备注 |
| :--- | :--- |
| 吉他社 | 老活动中心 |

::: cardlist
| 群名 |
| :--- |
| 吉它交流群 |
:::

:::markmap
- 大纲内容不应被索引
:::

\`\`\`sh
git log --oneline
\`\`\`

![二维码](/img/qr.png) 更多见 https://example.com/a
`)
	assert.ok(text.includes('欢迎来到 NKUwiki！步骤如下：'))
	assert.ok(text.includes('打开 setup.exe'))
	assert.ok(text.includes('安装 吉他 相关驱动'))
	assert.ok(text.includes('吉他社 老活动中心'))
	// cardlist 容器内的表格内容参与检索
	assert.ok(text.includes('吉它交流群'))
	// markmap 块、图片、裸链接被丢弃
	assert.ok(!text.includes('大纲内容'))
	assert.ok(!text.includes('img/qr'))
	assert.ok(!text.includes('example.com'))
	assert.ok(text.includes('git log --oneline'))
	// 章节偏移必须能取回标题自身
	for (const section of sections)
		assert.equal(text.slice(section.o, section.o + section.t.length), section.t)
})

test('buildExcerpt centers on the first match and names the section', () => {
	const { text, sections } = extractBody('## 电费\n\n宿舍电费可以在网上营业厅缴纳，欠费前会短信提醒。\n\n## 洗浴\n\n浴室在每层楼两侧。')
	const excerpt = buildExcerpt(text, ['电费'], sections)
	assert.equal(excerpt.section, '电费')
	assert.ok(excerpt.html.includes('<mark>'))
	assert.ok(excerpt.html.includes('宿舍'))
	// 无命中时返回开头纯文本
	const plain = buildExcerpt('开头一段正文', [])
	assert.equal(plain.html, '开头一段正文')
	assert.equal(plain.section, '')
})

test('buildExcerpt merges adjacent query tokens into one mark run', () => {
	const excerpt = buildExcerpt('南开大学是本站的起点', ['南开', '大学'])
	assert.ok(excerpt.html.includes('<mark>南开大学</mark>'))
	assert.ok(!excerpt.html.includes('</mark><mark>'))
})

test('highlightText marks matched terms in titles and escapes html', () => {
	assert.equal(highlightText('校园卡办理', ['校园卡']), '<mark>校园卡</mark>办理')
	assert.equal(highlightText('a<b & c', []), 'a&lt;b &amp; c')
	// 变体词也应一并标出
	assert.ok(highlightText('吉他社招新', ['吉它']).includes('<mark>吉他</mark>'))
})

test('buildSearchDocs indexes every non-empty article with plain-text body', () => {
	const docs = buildSearchDocs()
	const preparation = docs.find(doc => doc.id === '/pages/Preparation')
	assert.ok(preparation)
	assert.equal(preparation.title, '入学准备')
	assert.ok(preparation.text.includes('身份证'))
	assert.ok(preparation.headings.length > 0)
	assert.ok(preparation.categoriesList.includes('新生入学'))
	// 全部章节偏移可自洽回取
	for (const section of preparation.sections)
		assert.equal(preparation.text.slice(section.o, section.o + section.t.length), section.t)
})
