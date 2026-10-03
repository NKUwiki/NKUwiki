import type { Catalog } from '../lib/types.ts'
import { docsRoot, loadCatalog } from '../lib/content/catalog.ts'

export declare const data: Catalog

export default {
	watch: [`${docsRoot.replaceAll('\\', '/')}/[0-9]*/**/*.md`],
	load: () => loadCatalog(),
}
