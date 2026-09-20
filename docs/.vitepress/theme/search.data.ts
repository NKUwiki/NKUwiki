import type { SearchDoc } from '../searchCore.ts'
import { docsRoot } from '../catalog.ts'
import { buildSearchDocs } from '../search.ts'

export declare const data: SearchDoc[]

export default {
	watch: [`${docsRoot.replaceAll('\\', '/')}/[0-9]*/**/*.md`],
	load: () => buildSearchDocs(),
}
