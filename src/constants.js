export const CHATGPT_BASE_URL = (
  process.env.CHATGPT_BASE_URL || "https://chatgpt.com/backend-api"
).replace(/\/+$/, "")

export const OPENAI_AUTH_CLAIM = "https://api.openai.com/auth"
export const OPENAI_PROFILE_CLAIM = "https://api.openai.com/profile"
export const FIVE_HOUR_SECONDS = 5 * 60 * 60
export const WEEK_SECONDS = 7 * 24 * 60 * 60
export const CONFIG_ENTRY_TYPE = "chatgpt-limit-config"
export const CONFIG_FILE_NAME = "chatgpt-limit.json"

export const DEFAULT_STANDARD_FOOTER_CONFIG = {
  mode: "default",
  showForOtherProviders: false,
  workingDirectory: true,
  gitBranch: true,
  sessionName: true,
  inputTokens: true,
  outputTokens: true,
  totalTokens: false,
  cacheReadTokens: true,
  cacheWriteTokens: true,
  cost: true,
  subscriptionMarker: true,
  contextUsage: true,
  provider: true,
  model: true,
  thinkingLevel: true,
}

export const DEFAULT_FOOTER_CONFIG = {
  quotaWindow: "weekly",
  displayMode: "used",
  footerPosition: "second",
  standardFooter: { ...DEFAULT_STANDARD_FOOTER_CONFIG },
}

export const STANDARD_FOOTER_MODE_OPTIONS = [
  { label: "Default", value: "default" },
  { label: "Custom", value: "custom" },
]

export const STANDARD_FOOTER_FIELD_OPTIONS = [
  { label: "Working directory", value: "workingDirectory" },
  { label: "Git branch", value: "gitBranch" },
  { label: "Session name", value: "sessionName" },
  { label: "Input tokens", value: "inputTokens" },
  { label: "Output tokens", value: "outputTokens" },
  { label: "Total tokens", value: "totalTokens" },
  { label: "Cache read tokens", value: "cacheReadTokens" },
  { label: "Cache write tokens", value: "cacheWriteTokens" },
  { label: "Cost", value: "cost" },
  { label: "Subscription marker", value: "subscriptionMarker" },
  { label: "Context usage", value: "contextUsage" },
  { label: "Provider", value: "provider" },
  { label: "Model", value: "model" },
  { label: "Thinking level", value: "thinkingLevel" },
]

export const QUOTA_WINDOW_OPTIONS = [
  { label: "Weekly usage (default)", value: "weekly" },
  { label: "5-hour usage", value: "fiveHour" },
  { label: "Both 5-hour and weekly", value: "both" },
  { label: "Hide usage from footer", value: "hidden" },
]

export const FOOTER_POSITION_OPTIONS = [
  { label: "First line, right aligned", value: "first" },
  { label: "Second line, right aligned (default)", value: "second" },
  { label: "Third line, right aligned", value: "third" },
]

export const DISPLAY_MODE_OPTIONS = [
  { label: "Used percent, e.g. W 42%", value: "used" },
  { label: "Used percent with reset, e.g. W 42% · ~2d", value: "compact" },
  { label: "Pace percent with state, e.g. WP 13% (reserve)", value: "pace" },
  { label: "Pace percent, e.g. WP -13%", value: "paceCompact" },
  {
    label: "Pace percent with reset, e.g. WP -13% · ~2d",
    value: "paceResetCompact",
  },
  { label: "Remaining percent, e.g. W 58% left", value: "remaining" },
  {
    label: "Remaining percent with reset, e.g. W 58% left · ~2d",
    value: "remainingCompact",
  },
]
