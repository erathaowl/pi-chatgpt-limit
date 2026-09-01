import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui"

import { isOpenAICodexProvider } from "./auth.js"
import { DEFAULT_STANDARD_FOOTER_CONFIG } from "./constants.js"
import {
  formatPacePercent,
  formatPacePercentShort,
  formatRemainingPercent,
  formatResetShort,
  formatTokens,
  formatUsedPercent,
} from "./format.js"

/** @param {import('@earendil-works/pi-ai').AssistantMessage['usage']} usage */
function addUsage(total, usage) {
  total.input += usage?.input ?? 0
  total.output += usage?.output ?? 0
  total.cacheRead += usage?.cacheRead ?? 0
  total.cacheWrite += usage?.cacheWrite ?? 0
  total.cost += usage?.cost?.total ?? 0
}

function getUsageColor(window) {
  const used = Math.max(0, Math.min(100, window?.usedPercent ?? 0))
  if (used >= 90) return "error"
  if (used >= 80) return "warning"
  return "dim"
}

function formatFooterUsagePart(state, label, window, theme) {
  if (!window) return undefined

  let text
  if (label === "W" && state.footerConfig.displayMode.startsWith("pace")) {
    if (state.footerConfig.displayMode === "pace") {
      text = `WP ${formatPacePercent(window)}`
    } else if (state.footerConfig.displayMode === "paceCompact") {
      text = `WP ${formatPacePercentShort(window)}`
    } else if (state.footerConfig.displayMode === "paceResetCompact") {
      text = `WP ${formatPacePercentShort(window)} · ${formatResetShort(window.resetAt)}`
    }
  } else {
    if (state.footerConfig.displayMode === "remaining") {
      text = `${label} ${formatRemainingPercent(window)} left`
    } else if (state.footerConfig.displayMode === "remainingCompact") {
      text = `${label} ${formatRemainingPercent(window)} left · ${formatResetShort(window.resetAt)}`
    } else {
      const used = formatUsedPercent(window)
      text =
        state.footerConfig.displayMode === "compact"
          ? `${label} ${used} · ${formatResetShort(window.resetAt)}`
          : `${label} ${used}`
    }
  }

  return theme.fg(getUsageColor(window), text)
}

function formatFooterUsage(state, theme) {
  if (state.footerConfig.quotaWindow === "hidden") return undefined

  const parts = []
  if (
    state.footerConfig.quotaWindow === "fiveHour" ||
    state.footerConfig.quotaWindow === "both"
  ) {
    const part = formatFooterUsagePart(
      state,
      "5h",
      state.usageSnapshot?.fiveHour,
      theme,
    )
    if (part) parts.push(part)
  }
  if (
    state.footerConfig.quotaWindow === "weekly" ||
    state.footerConfig.quotaWindow === "both"
  ) {
    const part = formatFooterUsagePart(
      state,
      "W",
      state.usageSnapshot?.weekly,
      theme,
    )
    if (part) parts.push(part)
  }

  return parts.length > 0 ? parts.join(theme.fg("dim", " / ")) : undefined
}

function alignRight(left, right, width, leftEllipsis = "") {
  const fittedRight = truncateToWidth(right, width, "")
  const rightWidth = visibleWidth(fittedRight)
  const availableForLeft = Math.max(0, width - rightWidth - 2)
  const fittedLeft =
    visibleWidth(left) > availableForLeft
      ? truncateToWidth(left, availableForLeft, leftEllipsis)
      : left
  const padding = Math.max(0, width - visibleWidth(fittedLeft) - rightWidth)
  return fittedLeft + " ".repeat(padding) + fittedRight
}

export function isStandardFooterFieldEnabled(config, field) {
  if (config?.mode !== "custom") {
    return DEFAULT_STANDARD_FOOTER_CONFIG[field]
  }
  return typeof config[field] === "boolean"
    ? config[field]
    : DEFAULT_STANDARD_FOOTER_CONFIG[field]
}

function joinWithBullet(parts) {
  return parts.filter(Boolean).join(" • ")
}

function renderFooter(pi, ctx, state, footerData, theme, width) {
  const model = ctx.model
  const standardFooter = state.footerConfig.standardFooter
  const enabled = (field) => isStandardFooterFieldEnabled(standardFooter, field)

  const total = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 }
  for (const entry of ctx.sessionManager.getEntries()) {
    if (entry.type === "message" && entry.message.role === "assistant") {
      addUsage(total, entry.message.usage)
    }
  }

  let workingDirectory = ctx.sessionManager.getCwd()
  const home = process.env.HOME || process.env.USERPROFILE
  if (home && workingDirectory.startsWith(home)) {
    workingDirectory = `~${workingDirectory.slice(home.length)}`
  }

  const locationParts = []
  if (enabled("workingDirectory")) locationParts.push(workingDirectory)
  const branch = footerData.getGitBranch()
  if (enabled("gitBranch") && branch) locationParts.push(`(${branch})`)
  let location = locationParts.join(" ")
  const sessionName = ctx.sessionManager.getSessionName()
  if (enabled("sessionName") && sessionName) {
    location = joinWithBullet([location, sessionName])
  }

  const statsParts = []
  if (enabled("inputTokens") && total.input) {
    statsParts.push(`↑${formatTokens(total.input)}`)
  }
  if (enabled("outputTokens") && total.output) {
    statsParts.push(`↓${formatTokens(total.output)}`)
  }
  const totalTokens = total.input + total.output
  if (enabled("totalTokens") && totalTokens) {
    statsParts.push(`T${formatTokens(totalTokens)}`)
  }
  if (enabled("cacheReadTokens") && total.cacheRead) {
    statsParts.push(`R${formatTokens(total.cacheRead)}`)
  }
  if (enabled("cacheWriteTokens") && total.cacheWrite) {
    statsParts.push(`W${formatTokens(total.cacheWrite)}`)
  }

  const usingSubscription = model
    ? ctx.modelRegistry.isUsingOAuth(model)
    : false
  if (enabled("cost") && (total.cost || usingSubscription)) {
    statsParts.push(`$${total.cost.toFixed(3)}`)
  }
  if (enabled("subscriptionMarker") && usingSubscription) {
    statsParts.push("(sub)")
  }

  if (enabled("contextUsage")) {
    const contextUsage = ctx.getContextUsage()
    const contextWindow =
      contextUsage?.contextWindow ?? model?.contextWindow ?? 0
    const contextPercentValue = contextUsage?.percent ?? 0
    const contextPercent =
      contextUsage?.percent !== null ? contextPercentValue.toFixed(1) : "?"
    const contextDisplay =
      contextPercent === "?"
        ? `?/${formatTokens(contextWindow)}`
        : `${contextPercent}%/${formatTokens(contextWindow)}`
    statsParts.push(
      contextPercentValue > 90
        ? theme.fg("error", contextDisplay)
        : contextPercentValue > 70
          ? theme.fg("warning", contextDisplay)
          : contextDisplay,
    )
  }

  let statsLeft = statsParts.join(" ")
  let statsLeftWidth = visibleWidth(statsLeft)
  if (statsLeftWidth > width) {
    statsLeft = truncateToWidth(statsLeft, width, "...")
    statsLeftWidth = visibleWidth(statsLeft)
  }

  const modelParts = []
  if (enabled("model")) modelParts.push(model?.id || "no-model")
  if (enabled("thinkingLevel") && model?.reasoning) {
    const thinkingLevel = pi.getThinkingLevel ? pi.getThinkingLevel() : "off"
    modelParts.push(thinkingLevel === "off" ? "thinking off" : thinkingLevel)
  }
  let rightSideWithoutProvider = joinWithBullet(modelParts)

  const footerUsage = isOpenAICodexProvider(model?.provider)
    ? formatFooterUsage(state, theme)
    : undefined
  if (footerUsage && state.footerConfig.footerPosition === "second") {
    rightSideWithoutProvider = joinWithBullet([
      rightSideWithoutProvider,
      footerUsage,
    ])
  }

  let rightSide = rightSideWithoutProvider
  if (
    enabled("provider") &&
    footerData.getAvailableProviderCount() > 1 &&
    model
  ) {
    const provider = `(${model.provider})`
    const withProvider = rightSideWithoutProvider
      ? `${provider} ${rightSideWithoutProvider}`
      : provider
    const providerPadding = statsLeft ? 2 : 0
    if (
      statsLeftWidth + providerPadding + visibleWidth(withProvider) <= width ||
      !rightSideWithoutProvider
    ) {
      rightSide = withProvider
    }
  }

  let statsLine = statsLeft
  if (rightSide) {
    if (!statsLeft) {
      statsLine = alignRight("", rightSide, width)
    } else {
      const rightSideWidth = visibleWidth(rightSide)
      const minPadding = 2
      if (statsLeftWidth + minPadding + rightSideWidth <= width) {
        statsLine =
          statsLeft +
          " ".repeat(width - statsLeftWidth - rightSideWidth) +
          rightSide
      } else {
        const availableForRight = width - statsLeftWidth - minPadding
        if (availableForRight > 0) {
          const truncatedRight = truncateToWidth(
            rightSide,
            availableForRight,
            "",
          )
          statsLine =
            statsLeft +
            " ".repeat(
              Math.max(
                0,
                width - statsLeftWidth - visibleWidth(truncatedRight),
              ),
            ) +
            truncatedRight
        }
      }
    }
  }

  const locationEllipsis = theme.fg("dim", "...")
  let locationLine = truncateToWidth(
    theme.fg("dim", location),
    width,
    locationEllipsis,
  )
  if (footerUsage && state.footerConfig.footerPosition === "first") {
    locationLine = alignRight(
      locationLine,
      footerUsage,
      width,
      locationEllipsis,
    )
  }

  const remainder = statsLine.slice(statsLeft.length)
  const lines = [
    locationLine,
    theme.fg("dim", statsLeft) + theme.fg("dim", remainder),
  ]
  if (footerUsage && state.footerConfig.footerPosition === "third") {
    lines.push(alignRight("", footerUsage, width))
  }
  return lines
}

/** @param {import('@earendil-works/pi-coding-agent').ExtensionContext} ctx */
export function installFooter(pi, ctx, state) {
  ctx.ui.setFooter((tui, theme, footerData) => {
    state.requestRender = () => tui.requestRender()
    const unsub = footerData.onBranchChange(() => tui.requestRender())
    return {
      dispose() {
        unsub?.()
      },
      invalidate() {},
      render(width) {
        return renderFooter(pi, ctx, state, footerData, theme, width)
      },
    }
  })
}
