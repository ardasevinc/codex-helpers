/** Shape of ~/.codex/auth.json */
export interface CodexAuth {
	OPENAI_API_KEY: string | null
	tokens: {
		access_token: string
		refresh_token: string
		id_token: string
		account_id?: string
	}
	last_refresh: string // ISO 8601
}

/** Shape of ~/.codex/accounts/_active.json */
export interface ActiveAccount {
	name: string
	switched_at: string // ISO 8601
}

/** Internal account representation */
export interface Account {
	name: string
	auth: CodexAuth
	isActive: boolean
}

/** Raw rate window from the API */
export interface RateWindow {
	used_percent: number // 0-100
	reset_at: number // unix seconds
	limit_window_seconds: number // 18000 (5hr) or 604800 (7d)
}

/** Raw usage API response */
export interface UsageResponse {
	plan_type: string
	rate_limit: {
		primary_window: RateWindow // 5hr session
		secondary_window: RateWindow // 7-day weekly
	}
	code_review_rate_limit?: {
		primary_window: RateWindow
	}
	credits?: {
		has_credits: boolean
		unlimited: boolean
		balance: number | string
	}
	additional_rate_limits?: Array<{
		limit_name: string
		metered_feature: string
		rate_limit: {
			primary_window: RateWindow
			secondary_window: RateWindow
		}
	}>
}

/** Parsed usage for display */
export interface AccountUsage {
	planType: string
	session: {
		usedPercent: number
		resetAt: Date
		windowSeconds: number
	}
	weekly: {
		usedPercent: number
		resetAt: Date
		windowSeconds: number
	}
	credits?: {
		hasCredits: boolean
		unlimited: boolean
		balance: number
	}
}
