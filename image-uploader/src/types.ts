/** wrangler.toml 的 bindings 与 vars； secret（GITHUB_TOKEN 等）可选 */
export interface Env {
	BUCKET: R2Bucket
	IMAGE_BASE_URL: string
	REQUIRE_AUTH: string | boolean
	WIKI_REPO: string
	GITHUB_ORG: string
	ADMIN_EMAILS: string
	MAX_UPLOAD_MB: string
	GITHUB_TOKEN?: string
	ACCESS_TEAM_DOMAIN?: string
	ACCESS_AUD?: string
}

/** owner 可直接改桶并审批他人申请；member 自己的操作直接生效；guest 的一切改动进待审批 */
export type Role = 'owner' | 'member' | 'guest'

export interface AuthUser {
	email: string | null
	login: string | null
	githubId: string | null
	/** anonymous 表示 REQUIRE_AUTH=false 的开发模式 */
	source: 'access' | 'anonymous'
}

export interface AuthContext {
	user: AuthUser
	role: Role
}
