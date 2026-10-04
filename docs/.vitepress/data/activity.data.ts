import type { Activity } from '@nkuwiki/theme/lib/types.ts'
import { docsRoot } from '@nkuwiki/theme/lib/content/catalog.ts'
import { activityRoot, loadActivities } from '@nkuwiki/theme/lib/data/activity.ts'
import { createMarkdownRenderer } from 'vitepress'
import config from '../config.mts'

export declare const data: Activity[]

export default {
	watch: [`${activityRoot.replaceAll('\\', '/')}/*.md`],
	async load() {
		const renderer = await createMarkdownRenderer(docsRoot, config.markdown)
		return Promise.all(loadActivities().map(async activity => ({
			...activity,
			html: activity.body ? await renderer.renderAsync(activity.body, { relativePath: `activity/${activity.source}` }) : undefined,
		})))
	},
}
