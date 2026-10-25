import type { Env } from '../image-uploader/src/types.ts'
import assert from 'node:assert/strict'
import test from 'node:test'
import { createPending, decidePending, deletePath, ensureDir, listPending, storeFile } from '../image-uploader/src/storage.ts'
import { sha256Hex } from '../image-uploader/src/util.ts'

/** 最小内存版 R2 模拟：覆盖 storage 层用到的 put/get/head/list/delete 语义 */
function mockEnv(): { env: Env, objects: Map<string, { data: Uint8Array, customMetadata?: Record<string, string> }> } {
	const objects = new Map<string, { data: Uint8Array, customMetadata?: Record<string, string> }>()
	const bucket = {
		async put(key: string, value: Uint8Array | string, opts?: { customMetadata?: Record<string, string> }) {
			objects.set(key, {
				data: typeof value === 'string' ? new TextEncoder().encode(value) : value,
				customMetadata: opts?.customMetadata,
			})
		},
		async get(key: string) {
			const o = objects.get(key)
			if (!o)
				return null
			return {
				customMetadata: o.customMetadata,
				arrayBuffer: async () => o.data.slice().buffer,
				json: async <T>() => JSON.parse(new TextDecoder().decode(o.data)) as T,
			}
		},
		async head(key: string) {
			const o = objects.get(key)
			return o ? { customMetadata: o.customMetadata, size: o.data.byteLength } : null
		},
		async list({ prefix }: { prefix: string }) {
			const keys = [...objects.keys()].filter(key => key.startsWith(prefix)).sort()
			return { objects: keys.map(key => ({ key, size: objects.get(key)!.data.byteLength, customMetadata: objects.get(key)!.customMetadata })), truncated: false }
		},
		async delete(keys: string | string[]) {
			for (const key of Array.isArray(keys) ? keys : [keys])
				objects.delete(key)
		},
	}
	return { env: { BUCKET: bucket } as unknown as Env, objects }
}

async function shaOf(text: string): Promise<string> {
	return await sha256Hex(new TextEncoder().encode(text).buffer as ArrayBuffer)
}

test('访客上传申请保存内容，批准后落盘且申请清理', async () => {
	const { env, objects } = mockEnv()
	const bytes = new TextEncoder().encode('hello guest')
	const sha256 = await shaOf('hello guest')
	const meta = await createPending(env, { action: 'upload', actor: 'guest@x.y', actorRole: 'guest', dir: 'img/03/03', name: '投稿.jpg', size: bytes.byteLength, sha256 }, bytes)
	// 申请必须带内容：丢了 blob 批准必失败（回归 2026-10-25 的 api 漏传 bytes 事故）
	assert.ok(objects.has(`_pending/${meta.id}.blob`), '申请缺少内容 blob')
	assert.deepEqual((await listPending(env)).map(m => m.id), [meta.id])

	const decided = await decidePending(env, meta.id, true)
	assert.equal(decided?.id, meta.id)
	const stored = objects.get('img/03/03/投稿.jpg')
	assert.ok(stored, '批准后文件未落盘')
	assert.equal(new TextDecoder().decode(stored!.data), 'hello guest')
	assert.equal(stored!.customMetadata?.sha256, sha256)
	assert.ok(!objects.has(`_pending/${meta.id}.json`) && !objects.has(`_pending/${meta.id}.blob`), '申请未清理')
	assert.deepEqual(await listPending(env), [])
})

test('拒绝申请不落盘，内容一并清理', async () => {
	const { env, objects } = mockEnv()
	const bytes = new TextEncoder().encode('x')
	const sha256 = await shaOf('x')
	const meta = await createPending(env, { action: 'upload', actor: 'g', actorRole: 'guest', dir: 'img/01', name: 'a.png', size: 1, sha256 }, bytes)
	await decidePending(env, meta.id, false)
	assert.ok(!objects.has('img/01/a.png'))
	assert.ok(!objects.has(`_pending/${meta.id}.blob`))
})

test('批准时内容校验不符则报错，申请保留待人工处理', async () => {
	const { env } = mockEnv()
	const bytes = new TextEncoder().encode('actual content')
	const meta = await createPending(env, { action: 'upload', actor: 'g', actorRole: 'guest', dir: 'img/01', name: 'b.png', size: bytes.byteLength, sha256: '0'.repeat(64) }, bytes)
	await assert.rejects(() => decidePending(env, meta.id, true), /内容校验不符/)
	assert.equal((await listPending(env)).length, 1, '失败的申请应保留')
})

test('deletePath 拒绝整删 img 根目录，目录递归删除正常', async () => {
	const { env, objects } = mockEnv()
	await assert.rejects(() => deletePath(env, 'img'), /不允许删除/)
	await ensureDir(env, 'img/99', 'tester')
	await env.BUCKET.put('img/99/x.png', new TextEncoder().encode('p'))
	const deleted = await deletePath(env, 'img/99')
	assert.equal(deleted, 2, '.keep 占位与文件都应删除')
	assert.equal(objects.size, 0)
})

test('storeFile 同名同内容复用、同名不同内容加哈希后缀', async () => {
	const { env, objects } = mockEnv()
	const a = new TextEncoder().encode('AAA')
	const shaA = await shaOf('AAA')
	const first = await storeFile(env, 'img/05', '图.jpg', a, shaA, 'u1')
	assert.equal(first.kind, 'stored')
	const again = await storeFile(env, 'img/05', '图.jpg', a, shaA, 'u1')
	assert.equal(again.kind, 'deduped')
	assert.equal(again.key, first.key)

	const b = new TextEncoder().encode('BBB')
	const shaB = await shaOf('BBB')
	const renamed = await storeFile(env, 'img/05', '图.jpg', b, shaB, 'u2')
	assert.equal(renamed.kind, 'renamed')
	assert.match(renamed.name, /^图-[0-9a-f]{6}\.jpg$/)
	assert.equal(objects.size, 2)
})
