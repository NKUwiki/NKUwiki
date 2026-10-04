import type { SearchDoc } from '@nkuwiki/theme/lib/search/searchCore.ts'
import { docsRoot } from '@nkuwiki/theme/lib/content/catalog.ts'
import { buildSearchDocs } from '@nkuwiki/theme/lib/search/search.ts'

export declare const data: SearchDoc[]

export default {
	watch: [`${docsRoot.replaceAll('\\', '/')}/[0-9]*/**/*.md`],
	load: () => buildSearchDocs(),
}
