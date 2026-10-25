/**
 * 上传器单页 UI（内联 HTML/CSS/JS，无外部依赖）。
 *
 * 内联 JS 刻意全部用字符串拼接而不用模板字面量：本文件外层是 TS 模板字符串，
 * 任何 `${` 都会被外层解析掉。动态文本一律走 textContent，防文件名注入 HTML。
 */

function pageHtml(): string {
	return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>NKUwiki 图片上传器</title>
<style>
:root {
	color-scheme: light dark;
	--bg: #f6f7f9; --fg: #1c2130; --muted: #6b7280; --card: #ffffff;
	--border: #e2e5ea; --accent: #4f6bed; --accent-fg: #ffffff;
	--ok: #178a50; --warn: #b45309; --err: #b91c1c; --pending-bg: #fff7ed;
}
@media (prefers-color-scheme: dark) {
	:root {
		--bg: #14161c; --fg: #e6e8ee; --muted: #9aa1ad; --card: #1d2027;
		--border: #2c313b; --accent: #7b93f5; --accent-fg: #10131a;
		--ok: #4ade80; --warn: #fbbf24; --err: #f87171; --pending-bg: #2b2318;
	}
}
* { box-sizing: border-box; }
body {
	margin: 0; background: var(--bg); color: var(--fg); min-height: 100vh;
	font: 15px/1.6 -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif;
}
header {
	display: flex; align-items: center; gap: 12px; padding: 14px 20px;
	border-bottom: 1px solid var(--border); background: var(--card);
	position: sticky; top: 0; z-index: 5;
}
header h1 { font-size: 17px; margin: 0; }
header .spacer { flex: 1; }
.badge {
	font-size: 12px; padding: 2px 10px; border-radius: 999px;
	background: var(--pending-bg); border: 1px solid var(--border);
}
.badge.owner { background: color-mix(in srgb, var(--ok) 14%, transparent); }
.badge.guest { background: color-mix(in srgb, var(--warn) 14%, transparent); }
main { max-width: 1180px; margin: 0 auto; padding: 18px 20px 80px; }
.toolbar {
	display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 14px 0;
}
button {
	font: inherit; padding: 6px 14px; border-radius: 8px; cursor: pointer;
	border: 1px solid var(--border); background: var(--card); color: var(--fg);
}
button:hover { border-color: var(--accent); color: var(--accent); }
button.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); }
button.primary:hover { color: var(--accent-fg); opacity: .92; }
button.danger:hover { border-color: var(--err); color: var(--err); }
button.mini { padding: 3px 10px; font-size: 13px; border-radius: 6px; }
.crumb { color: var(--muted); font-size: 14px; margin-right: auto; }
.crumb a { color: var(--muted); text-decoration: none; }
.crumb a:hover { color: var(--accent); }
.crumb .sep { margin: 0 6px; }
#notice {
	display: none; margin: 0 0 14px; padding: 8px 14px; border-radius: 8px;
	background: var(--pending-bg); border: 1px solid var(--border); font-size: 13.5px;
}
#grid {
	display: grid; gap: 12px;
	grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
}
.tile {
	position: relative; background: var(--card); border: 1px solid var(--border);
	border-radius: 10px; overflow: hidden; cursor: pointer;
	display: flex; flex-direction: column; min-height: 128px;
}
.tile .thumb {
	flex: 1; display: flex; align-items: center; justify-content: center;
	background:
		linear-gradient(45deg, color-mix(in srgb, var(--border) 45%, transparent) 25%, transparent 25%,
		transparent 75%, color-mix(in srgb, var(--border) 45%, transparent) 75%) 0 0 / 16px 16px,
		linear-gradient(45deg, color-mix(in srgb, var(--border) 45%, transparent) 25%, transparent 25%,
		transparent 75%, color-mix(in srgb, var(--border) 45%, transparent) 75%) 8px 8px / 16px 16px;
}
.tile .thumb img { max-width: 100%; max-height: 150px; object-fit: contain; display: block; }
.tile .thumb .ext { color: var(--muted); font-size: 26px; font-weight: 600; }
.tile .name {
	padding: 7px 10px; font-size: 13px; border-top: 1px solid var(--border);
	white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.tile.dir .name { color: var(--accent); font-weight: 500; }
.tile .ops {
	position: absolute; top: 6px; right: 6px; display: none; gap: 4px;
}
.tile:hover .ops { display: flex; }
.tile .ops button { backdrop-filter: blur(4px); }
dialog {
	border: 1px solid var(--border); border-radius: 12px; background: var(--card);
	color: var(--fg); padding: 20px; width: min(560px, calc(100vw - 32px));
}
dialog::backdrop { background: rgba(0,0,0,.45); }
dialog h2 { margin: 0 0 12px; font-size: 16px; }
dialog .row { margin: 10px 0; }
dialog label { display: block; font-size: 13px; color: var(--muted); margin-bottom: 4px; }
dialog input[type=text], dialog select {
	width: 100%; font: inherit; padding: 7px 10px; border-radius: 8px;
	border: 1px solid var(--border); background: var(--bg); color: var(--fg);
}
dialog .foot { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }
.file-row {
	display: flex; align-items: center; gap: 8px; padding: 6px 0;
	border-bottom: 1px dashed var(--border); font-size: 13.5px;
}
.file-row .fname { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.file-row .fsize { color: var(--muted); font-size: 12px; white-space: nowrap; }
.file-row .fstatus { font-size: 12.5px; white-space: nowrap; }
.fstatus.ok { color: var(--ok); } .fstatus.err { color: var(--err); }
.fstatus.queued { color: var(--warn); }
.fstatus a { color: var(--accent); }
.preview-img {
	max-width: 100%; max-height: 320px; display: block; margin: 0 auto 10px;
	border-radius: 8px; background:
		linear-gradient(45deg, var(--border) 25%, transparent 25%, transparent 75%, var(--border) 75%) 0 0 / 16px 16px,
		linear-gradient(45deg, var(--border) 25%, transparent 25%, transparent 75%, var(--border) 75%) 8px 8px / 16px 16px;
}
.meta-line { font-size: 13px; color: var(--muted); word-break: break-all; }
.pending-item {
	border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; margin: 8px 0;
	background: var(--pending-bg); font-size: 13.5px;
}
.pending-item .who { color: var(--muted); font-size: 12.5px; }
.pending-item .acts { display: flex; gap: 8px; margin-top: 6px; }
#toast {
	position: fixed; left: 50%; bottom: 26px; transform: translateX(-50%);
	background: var(--fg); color: var(--bg); padding: 8px 18px; border-radius: 999px;
	font-size: 13.5px; opacity: 0; pointer-events: none; transition: opacity .25s;
	max-width: 80vw;
}
#toast.show { opacity: .95; }
#drop-mask {
	display: none; position: fixed; inset: 0; z-index: 50; align-items: center; justify-content: center;
	background: color-mix(in srgb, var(--accent) 12%, rgba(0,0,0,.35));
	font-size: 20px; color: #fff; pointer-events: none;
}
.empty { color: var(--muted); text-align: center; padding: 48px 0; grid-column: 1 / -1; }
.muted { color: var(--muted); }
</style>
</head>
<body>
<header>
	<h1>NKUwiki 图片上传器</h1>
	<span id="userBadge" class="badge" hidden></span>
	<div class="spacer"></div>
	<button id="btnPending" class="mini" hidden>待审批 <span id="pendingCount"></span></button>
</header>
<main>
	<div id="notice"></div>
	<div class="toolbar">
		<nav id="crumb" class="crumb"></nav>
		<button id="btnUploadFile" class="primary">上传图片</button>
		<button id="btnUploadFolder">上传文件夹</button>
		<button id="btnMkdir">新建文件夹</button>
		<button id="btnRefresh">刷新</button>
	</div>
	<div id="grid"></div>
</main>

<dialog id="uploadDialog">
	<h2>上传</h2>
	<div class="row">
		<label for="upTarget">存到哪篇文章（图片目录 = 栏目编号/文章编号）</label>
		<select id="upTarget"></select>
		<input type="text" id="upDir" placeholder="如 03/03" hidden>
	</div>
	<div class="row" id="upList"></div>
	<div class="foot">
		<button id="upCancel">取消</button>
		<button id="upSubmit" class="primary">开始上传</button>
	</div>
</dialog>

<dialog id="fileDialog">
	<h2 id="fdName"></h2>
	<img id="fdImg" class="preview-img" hidden alt="">
	<div class="meta-line" id="fdMeta"></div>
	<div class="row"><label>公开链接</label><input type="text" id="fdUrl" readonly></div>
	<div class="foot">
		<button id="fdCopy" class="primary">复制链接</button>
		<button id="fdRename">重命名</button>
		<button id="fdMove">移动</button>
		<button id="fdDelete" class="danger">删除</button>
		<button id="fdClose">关闭</button>
	</div>
</dialog>

<dialog id="pendingDialog">
	<h2>待审批申请</h2>
	<div id="pendingList"></div>
	<div class="foot"><button id="pdClose">关闭</button></div>
</dialog>

<input type="file" id="fileInput" multiple accept="image/*,video/*,.pdf" hidden>
<input type="file" id="folderInput" multiple webkitdirectory hidden>
<div id="drop-mask">松开以上传</div>
<div id="toast"></div>

<script>
'use strict'
var MANAGED_ROOT = 'img'
var state = { me: null, catalog: [], dir: '', data: null, pendingFile: null, uploadFiles: [] }
var ROLE_LABEL = { owner: '管理员', member: '成员', guest: '访客（改动需审批）' }
var IMAGE_EXT = { png: 1, jpg: 1, jpeg: 1, gif: 1, webp: 1, avif: 1, svg: 1, bmp: 1, ico: 1, jfif: 1 }
var MEDIA_EXT = { mp4: 1, webm: 1, pdf: 1 }

function $(id) { return document.getElementById(id) }
function toast(text, ms) {
	var el = $('toast'); el.textContent = text; el.classList.add('show')
	setTimeout(function () { el.classList.remove('show') }, ms || 2600)
}
function ext(name) { var dot = name.lastIndexOf('.'); return dot < 0 ? '' : name.slice(dot + 1).toLowerCase() }
function fmtSize(bytes) {
	if (bytes < 1024) return bytes + ' B'
	if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB'
	return (bytes / 1048576).toFixed(1) + ' MB'
}
function absUrl(url) { return new URL(url, location.href).href }
function bytesToBase64(bytes) {
	var CHUNK = 0x8000, parts = []
	for (var i = 0; i < bytes.length; i += CHUNK)
		parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK)))
	return btoa(parts.join(''))
}

async function api(path, options) {
	var res = await fetch(path, options)
	var data = null
	try { data = await res.json() } catch (e) { /* 非 JSON 响应按错误处理 */ }
	if (!res.ok) throw new Error((data && data.error) || ('请求失败 ' + res.status))
	return data
}

/* ── 初始化 ── */

async function init() {
	try {
		var results = await Promise.all([api('/api/me'), api('/api/catalog')])
		state.me = results[0]
		state.catalog = results[1].groups || []
		if (results[1].error) toast('文章目录拉取失败：' + results[1].error)
	} catch (err) {
		toast('初始化失败：' + err.message)
		return
	}
	renderMe()
	fillTargetSelect('')
	load(MANAGED_ROOT)
	refreshPendingBadge()
}

function renderMe() {
	var badge = $('userBadge')
	badge.hidden = false
	badge.textContent = ROLE_LABEL[state.me.role] + (state.me.user && state.me.user.label ? ' · ' + state.me.user.label : '')
	if (state.me.role === 'owner') badge.classList.add('owner')
	if (state.me.role === 'guest') badge.classList.add('guest')
	if (state.me.role === 'guest') {
		var notice = $('notice')
		notice.style.display = 'block'
		notice.textContent = '当前身份为访客：上传、删除、移动、重命名都会先进入待审批队列，由管理员放行后生效。'
	}
}

/* ── 目录浏览 ── */

function catalogTitle(dir) {
	// 目录选择器与文章树以不含 img/ 前缀的编号目录为键
	var rel = dir === MANAGED_ROOT ? '' : (dir.slice(0, 4) === 'img/' ? dir.slice(4) : dir)
	if (!rel) return ''
	for (var i = 0; i < state.catalog.length; i++) {
		var group = state.catalog[i]
		for (var j = 0; j < group.children.length; j++) {
			if (group.children[j].dir === rel)
				return group.code + '.' + group.name + ' / ' + group.children[j].code + '.' + group.children[j].name
		}
	}
	return ''
}

function renderCrumb() {
	var el = $('crumb')
	el.textContent = ''
	// 上传器只管理 img/ 子树：根即 img/，面包屑不显示这一层
	var root = document.createElement('a')
	root.href = '#'; root.textContent = '图片库'
	root.onclick = function (e) { e.preventDefault(); load(MANAGED_ROOT) }
	el.appendChild(root)
	var rel = state.dir === MANAGED_ROOT ? '' : state.dir.slice(0, 4) === 'img/' ? state.dir.slice(4) : state.dir
	var parts = rel ? rel.split('/') : []
	for (var i = 0; i < parts.length; i++) {
		var sep = document.createElement('span'); sep.className = 'sep'; sep.textContent = '/'
		el.appendChild(sep)
		var sub = MANAGED_ROOT + '/' + parts.slice(0, i + 1).join('/')
		var link = document.createElement('a')
		link.href = '#'
		link.textContent = catalogTitle(sub) || parts[i]
		link.onclick = function (target) { return function (e) { e.preventDefault(); load(target) } }(sub)
		el.appendChild(link)
	}
}

function renderGrid() {
	var grid = $('grid')
	grid.textContent = ''
	var data = state.data
	if (!data.dirs.length && !data.files.length) {
		var empty = document.createElement('div')
		empty.className = 'empty'
		empty.textContent = '这里还没有图片，点右上角「上传图片」试试'
		grid.appendChild(empty)
		return
	}
	data.dirs.forEach(function (name) { grid.appendChild(makeDirTile(name)) })
	data.files.forEach(function (file) { grid.appendChild(makeFileTile(file)) })
}

function makeDirTile(name) {
	var tile = document.createElement('div')
	tile.className = 'tile dir'
	var thumb = document.createElement('div'); thumb.className = 'thumb'
	var icon = document.createElement('div'); icon.className = 'ext'; icon.textContent = '📁'
	thumb.appendChild(icon)
	var label = document.createElement('div'); label.className = 'name'
	label.textContent = catalogTitle((state.dir ? state.dir + '/' : '') + name) || name
	tile.appendChild(thumb); tile.appendChild(label)
	tile.onclick = function () { load((state.dir ? state.dir + '/' : '') + name) }
	return tile
}

function makeFileTile(file) {
	var tile = document.createElement('div')
	tile.className = 'tile'
	var thumb = document.createElement('div'); thumb.className = 'thumb'
	var kind = ext(file.name)
	if (IMAGE_EXT[kind]) {
		var img = document.createElement('img')
		img.loading = 'lazy'; img.src = file.url; img.alt = file.name
		thumb.appendChild(img)
	} else {
		var icon = document.createElement('div'); icon.className = 'ext'
		icon.textContent = MEDIA_EXT[kind] ? '🎬' : '📄'
		thumb.appendChild(icon)
	}
	var label = document.createElement('div'); label.className = 'name'; label.textContent = file.name
	var ops = document.createElement('div'); ops.className = 'ops'
	var copyBtn = document.createElement('button'); copyBtn.className = 'mini'; copyBtn.textContent = '复制链接'
	copyBtn.onclick = function (e) { e.stopPropagation(); copyLink(file.url) }
	ops.appendChild(copyBtn)
	tile.appendChild(thumb); tile.appendChild(label); tile.appendChild(ops)
	tile.onclick = function () { openFile(file) }
	return tile
}

async function load(dir) {
	try {
		state.data = await api('/api/list?dir=' + encodeURIComponent(dir))
		state.dir = dir
		renderCrumb()
		renderGrid()
	} catch (err) {
		toast('目录加载失败：' + err.message)
	}
}

/* ── 上传 ── */

function fillTargetSelect(currentDir) {
	var select = $('upTarget')
	select.textContent = ''
	if (currentDir) {
		var opt = document.createElement('option')
		opt.value = currentDir
		opt.textContent = '当前目录（' + (catalogTitle(currentDir) || currentDir) + '）'
		select.appendChild(opt)
	}
	var blank = document.createElement('option')
	blank.value = ''; blank.textContent = currentDir ? '' : '— 选择文章 —'
	if (!currentDir) select.appendChild(blank)
	state.catalog.forEach(function (group) {
		var og = document.createElement('optgroup')
		og.label = group.code + '.' + group.name
		group.children.forEach(function (article) {
			var opt = document.createElement('option')
			opt.value = MANAGED_ROOT + '/' + article.dir
			opt.textContent = article.code + '.' + article.name
			og.appendChild(opt)
		})
		select.appendChild(og)
	})
	var custom = document.createElement('option')
	custom.value = '__custom'; custom.textContent = '自定义目录…'
	select.appendChild(custom)
}

function openUpload(fileList) {
	var files = Array.prototype.slice.call(fileList || [])
	if (!files.length) return
	state.uploadFiles = files
	fillTargetSelect(state.dir)
	$('upTarget').value = state.dir || MANAGED_ROOT
	$('upDir').hidden = true
	$('upDir').value = ''
	var list = $('upList')
	list.textContent = ''
	files.forEach(function (file, index) {
		var row = document.createElement('div'); row.className = 'file-row'
		var name = document.createElement('span'); name.className = 'fname'; name.textContent = file.name
		var size = document.createElement('span'); size.className = 'fsize'; size.textContent = fmtSize(file.size)
		var status = document.createElement('span'); status.className = 'fstatus'; status.textContent = '等待'
		row.appendChild(name); row.appendChild(size); row.appendChild(status)
		row.dataset.index = String(index)
		list.appendChild(row)
	})
	$('uploadDialog').showModal()
}

function currentTargetDir() {
	if ($('upTarget').value === '__custom') return $('upDir').value.trim()
	return $('upTarget').value || MANAGED_ROOT
}

async function submitUpload() {
	var dir = currentTargetDir()
	if (!dir) { toast('请先选择文章或填写目标目录'); return }
	var rows = $('upList').querySelectorAll('.file-row')
	$('upSubmit').disabled = true
	var changedHere = false
	for (var i = 0; i < state.uploadFiles.length; i++) {
		var file = state.uploadFiles[i]
		var status = rows[i].querySelector('.fstatus')
		status.textContent = '上传中…'; status.className = 'fstatus'
		try {
			var buffer = await file.arrayBuffer()
			var bytes = new Uint8Array(buffer)
			var digest = await crypto.subtle.digest('SHA-256', buffer)
			var sha = Array.prototype.map.call(new Uint8Array(digest), function (b) { return b.toString(16).padStart(2, '0') }).join('')
			var data = await api('/api/upload', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ dir: dir, files: [{ name: file.name, b64: bytesToBase64(bytes), sha256: sha }] }),
			})
			var result = data.results && data.results[0]
			if (!result) throw new Error('无结果')
			if (result.error) throw new Error(result.error)
			if (result.queued) {
				status.textContent = '已提交待审批'
				status.className = 'fstatus queued'
			} else {
				status.textContent = ''
				var link = document.createElement('a')
				link.href = absUrl(result.url); link.textContent = result.kind === 'deduped' ? '已存在，复用' : (result.kind === 'renamed' ? '已上传（重名改名）' : '已上传')
				link.target = '_blank'; link.rel = 'noopener'
				status.className = 'fstatus ok'; status.appendChild(link)
			}
			if (dir === state.dir) changedHere = true
		} catch (err) {
			status.textContent = '失败：' + err.message
			status.className = 'fstatus err'
		}
	}
	$('upSubmit').disabled = false
	refreshPendingBadge()
	if (changedHere) load(state.dir)
}

/* ── 文件详情与操作 ── */

function openFile(file) {
	state.pendingFile = file
	$('fdName').textContent = file.name
	var img = $('fdImg')
	if (IMAGE_EXT[ext(file.name)]) { img.hidden = false; img.src = file.url }
	else img.hidden = true
	$('fdMeta').textContent = fmtSize(file.size) + (file.uploaded ? ' · ' + file.uploaded.replace('T', ' ').slice(0, 16) + ' UTC' : '') + (file.sha256 ? ' · sha256 ' + file.sha256.slice(0, 12) + '…' : '')
	$('fdUrl').value = absUrl(file.url)
	$('fileDialog').showModal()
}

function copyLink(url) {
	var text = absUrl(url)
	if (navigator.clipboard && navigator.clipboard.writeText) {
		navigator.clipboard.writeText(text).then(function () { toast('链接已复制：' + text) }, function () { fallbackCopy(text) })
	} else fallbackCopy(text)
}
function fallbackCopy(text) {
	var input = document.createElement('textarea')
	input.value = text; document.body.appendChild(input); input.select()
	try { document.execCommand('copy'); toast('链接已复制：' + text) } catch (e) { toast('复制失败，请手动复制：' + text) }
	document.body.removeChild(input)
}

async function runActions(actions, doneMsg) {
	try {
		var data = await api('/api/action', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ actions: actions }),
		})
		var first = data.results && data.results[0]
		if (first && first.ok === false) throw new Error(first.error || '操作失败')
		toast(first && first.queued ? '已提交待审批' : (doneMsg || '操作成功'))
		$('fileDialog').close()
		load(state.dir)
		refreshPendingBadge()
	} catch (err) {
		toast('操作失败：' + err.message)
	}
}

/* ── 待审批 ── */

var ACTION_LABEL = { upload: '上传', delete: '删除', rename: '重命名', move: '移动', mkdir: '新建文件夹' }

async function refreshPendingBadge() {
	if (!state.me) return
	try {
		var data = await api('/api/pending')
		var count = (data.pendings || []).length
		var btn = $('btnPending')
		btn.hidden = count === 0
		$('pendingCount').textContent = count ? '(' + count + ')' : ''
	} catch (e) { /* 徽标加载失败不打扰用户 */ }
}

async function openPending() {
	var data = await api('/api/pending')
	var list = $('pendingList')
	list.textContent = ''
	if (!(data.pendings || []).length) {
		var empty = document.createElement('div'); empty.className = 'muted'; empty.textContent = '暂无待审批申请'
		list.appendChild(empty)
	}
	(data.pendings || []).forEach(function (meta) {
		var item = document.createElement('div'); item.className = 'pending-item'
		var title = document.createElement('div')
		title.textContent = describePending(meta)
		var who = document.createElement('div'); who.className = 'who'
		who.textContent = meta.actor + ' · ' + meta.createdAt.replace('T', ' ').slice(0, 16) + ' UTC'
		item.appendChild(title); item.appendChild(who)
		if (state.me.role === 'owner') {
			var acts = document.createElement('div'); acts.className = 'acts'
			var approve = document.createElement('button'); approve.className = 'mini primary'; approve.textContent = '批准'
			approve.onclick = function () { decide(meta.id, true) }
			var reject = document.createElement('button'); reject.className = 'mini danger'; reject.textContent = '拒绝'
			reject.onclick = function () { decide(meta.id, false) }
			acts.appendChild(approve); acts.appendChild(reject)
			item.appendChild(acts)
		}
		list.appendChild(item)
	})
	$('pendingDialog').showModal()
}

function describePending(meta) {
	switch (meta.action) {
		case 'upload': return '上传「' + meta.name + '」到 ' + meta.dir + '/'
		case 'delete': return '删除 ' + meta.key
		case 'rename': return '重命名 ' + meta.key + ' → ' + meta.name
		case 'move': return '移动 ' + meta.key + ' → ' + meta.dir + '/'
		case 'mkdir': return '新建文件夹 ' + meta.dir + '/'
		default: return meta.action
	}
}

async function decide(id, approve) {
	try {
		await api('/api/pending/decide', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ ids: [id], approve: approve }),
		})
		toast(approve ? '已批准' : '已拒绝')
		$('pendingDialog').close()
		refreshPendingBadge()
		load(state.dir)
	} catch (err) {
		toast('审批失败：' + err.message)
	}
}

/* ── 事件绑定 ── */

$('btnUploadFile').onclick = function () { $('fileInput').click() }
$('btnUploadFolder').onclick = function () { $('folderInput').click() }
$('fileInput').onchange = function () { openUpload(this.files); this.value = '' }
$('folderInput').onchange = function () { openUpload(this.files); this.value = '' }
$('btnRefresh').onclick = function () { load(state.dir) }
$('btnMkdir').onclick = function () {
	var name = prompt('新文件夹名（将在 ' + (state.dir || '根目录') + ' 下创建）')
	if (!name) return
	runActions([{ type: 'mkdir', dir: (state.dir ? state.dir + '/' : '') + name }], '文件夹已创建')
}
$('btnPending').onclick = openPending
$('upTarget').onchange = function () { $('upDir').hidden = this.value !== '__custom' }
$('upSubmit').onclick = submitUpload
$('upCancel').onclick = function () { $('uploadDialog').close() }
$('fdClose').onclick = function () { $('fileDialog').close() }
$('pdClose').onclick = function () { $('pendingDialog').close() }
$('fdCopy').onclick = function () { if (state.pendingFile) copyLink(state.pendingFile.url) }
$('fdRename').onclick = function () {
	var file = state.pendingFile; if (!file) return
	var name = prompt('新名称', file.name)
	if (!name || name === file.name) return
	runActions([{ type: 'rename', key: file.key, name: name }], '已重命名')
}
$('fdMove').onclick = function () {
	var file = state.pendingFile; if (!file) return
	var dir = prompt('移动到哪个目录？（如 03/03，可从上传面板的文章下拉里查编号）', state.dir)
	if (dir === null) return
	runActions([{ type: 'move', key: file.key, dir: dir.trim() }], '已移动')
}
$('fdDelete').onclick = function () {
	var file = state.pendingFile; if (!file) return
	if (!confirm('确认删除 ' + file.name + '？站内正在引用它的位置会失效。')) return
	runActions([{ type: 'delete', key: file.key }], '已删除')
}

document.addEventListener('dragover', function (e) { e.preventDefault(); $('drop-mask').style.display = 'flex' })
document.addEventListener('dragleave', function (e) {
	if (e.relatedTarget === null) $('drop-mask').style.display = 'none'
})
document.addEventListener('drop', function (e) {
	e.preventDefault(); $('drop-mask').style.display = 'none'
	if (e.dataTransfer && e.dataTransfer.files.length) openUpload(e.dataTransfer.files)
})
document.addEventListener('paste', function (e) {
	if (e.clipboardData && e.clipboardData.files.length) openUpload(e.clipboardData.files)
})

init()
</script>
</body>
</html>`
}

export { pageHtml }
