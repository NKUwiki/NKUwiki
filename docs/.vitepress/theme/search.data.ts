import type { SearchDoc } from '../lib/search/searchCore.ts'
import { docsRoot } from '../lib/content/catalog.ts'
import { buildSearchDocs } from '../lib/search/search.ts'

export declare const data: SearchDoc[]

export default {
	watch: [`${docsRoot.replaceAll('\\', '/')}/[0-9]*/**/*.md`],
	load: () => buildSearchDocs(),
}
