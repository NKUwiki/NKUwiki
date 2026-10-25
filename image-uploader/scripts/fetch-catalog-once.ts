/**
 * 维护工具：组装文章目录缓存并种进 R2（_meta/catalog.json）。
 *
 * 背景：Worker 出口调 GitHub API 走共享限流池，时常 403；目录变化又很低频。
 * 缓存 TTL 24h，过期且 Worker 拉取失败时 UI 报错。本脚本在本机拉取（本机网络
 * 可直连 GitHub）后重新种缓存即可恢复。Node 在代理环境下 fetch 会证书报错，
 * 拉取这步交给 curl。
 *
 * 用法：
 *   curl -s "https://api.github.com/repos/NKUwiki/NKUwiki/git/trees/HEAD?recursive=1" \
 *     -H "accept: application/vnd.github+json" -o image-uploader/tree.json
 *   npx tsx image-uploader/scripts/fetch-catalog-once.ts   # 生成 image-uploader/catalog-cache.json
 *   npx wrangler r2 object put "nkuwiki/_meta/catalog.json" \
 *     --file image-uploader/catalog-cache.json --content-type "application/json" --remote
 */
import { readFile, writeFile } from 'node:fs/promises'
import { buildCatalog } from '../src/util.ts'

// 输入输出都相对 image-uploader/ 根目录（脚本在 scripts/ 子目录里）
const data = JSON.parse(await readFile(new URL('../tree.json', import.meta.url), 'utf8'))
if (!data.tree)
	throw new Error(`tree.json 无 tree 字段：${JSON.stringify(data).slice(0, 200)}`)
const groups = buildCatalog(data.tree.map(item => item.path ?? '').filter(Boolean))
const entry = { fetchedAt: new Date().toISOString(), groups }
await writeFile(new URL('../catalog-cache.json', import.meta.url), JSON.stringify(entry))
console.log(`groups: ${groups.length}, articles: ${groups.reduce((n, g) => n + g.children.length, 0)}`)
