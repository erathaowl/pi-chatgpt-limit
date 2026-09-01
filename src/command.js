import { Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui"

import {
  DEFAULT_FOOTER_CONFIG,
  DEFAULT_STANDARD_FOOTER_CONFIG,
  DISPLAY_MODE_OPTIONS,
  FOOTER_POSITION_OPTIONS,
  QUOTA_WINDOW_OPTIONS,
  STANDARD_FOOTER_FIELD_OPTIONS,
  STANDARD_FOOTER_MODE_OPTIONS,
} from "./constants.js"
import {
  describeFooterConfig,
  normalizeFooterConfig,
  saveFooterConfig,
} from "./config.js"
import { isOpenAICodexProvider } from "./auth.js"
import { buildUsageDetails } from "./usage.js"

async function selectFooterConfigOption(
  ctx,
  state,
  title,
  options,
  currentValue,
  preview,
) {
  const initialIndex = Math.max(
    0,
    options.findIndex((option) => option.value === currentValue),
  )
  const originalConfig = { ...state.footerConfig }

  const selected = await ctx.ui.custom((tui, theme, _keybindings, done) => {
    let selectedIndex = initialIndex

    function applyPreview() {
      preview(options[selectedIndex].value)
      state.requestRender()
    }

    applyPreview()

    return {
      invalidate() {},
      handleInput(data) {
        if (matchesKey(data, Key.up)) {
          selectedIndex = Math.max(0, selectedIndex - 1)
          applyPreview()
          tui.requestRender()
          return
        }
        if (matchesKey(data, Key.down)) {
          selectedIndex = Math.min(options.length - 1, selectedIndex + 1)
          applyPreview()
          tui.requestRender()
          return
        }
        if (matchesKey(data, Key.enter)) {
          done(options[selectedIndex])
          return
        }
        if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
          done(undefined)
        }
      },
      render(width) {
        const lines = [
          theme.fg("accent", theme.bold(title)),
          theme.fg("dim", "↑↓ preview in footer • enter save • esc cancel"),
          "",
        ]

        for (let index = 0; index < options.length; index++) {
          const option = options[index]
          const isSelected = index === selectedIndex
          const isCurrent = option.value === currentValue
          const prefix = isSelected ? "› " : "  "
          const suffix = isCurrent ? "  current" : ""
          const text = `${prefix}${option.label}${suffix}`
          lines.push(
            truncateToWidth(
              isSelected ? theme.fg("accent", text) : text,
              width,
              "…",
            ),
          )
        }

        return lines.map((line) => truncateToWidth(line, width, "…"))
      },
    }
  })

  if (!selected) {
    state.footerConfig = originalConfig
    state.requestRender()
  }

  return selected
}

async function configureQuotaWindow(ctx, state) {
  const selected = await selectFooterConfigOption(
    ctx,
    state,
    "Display which ChatGPT limit in footer?",
    QUOTA_WINDOW_OPTIONS,
    state.footerConfig.quotaWindow,
    (quotaWindow) => {
      state.footerConfig = normalizeFooterConfig({
        ...state.footerConfig,
        quotaWindow,
      })
    },
  )
  if (!selected) return

  await saveFooterConfig(state, {
    ...state.footerConfig,
    quotaWindow: selected.value,
  })
  ctx.ui.notify(
    selected.value === "hidden"
      ? "ChatGPT footer display: Hide usage from footer (usage hidden)."
      : `ChatGPT footer display: ${selected.label}`,
    "info",
  )
}

async function configureDisplayMode(ctx, state) {
  const selected = await selectFooterConfigOption(
    ctx,
    state,
    "How should the footer value be shown?",
    DISPLAY_MODE_OPTIONS,
    state.footerConfig.displayMode,
    (displayMode) => {
      state.footerConfig = normalizeFooterConfig({
        ...state.footerConfig,
        displayMode,
      })
    },
  )
  if (!selected) return

  await saveFooterConfig(state, {
    ...state.footerConfig,
    displayMode: selected.value,
  })
  ctx.ui.notify(`ChatGPT footer mode: ${selected.label}`, "info")
}

async function configureFooterPosition(ctx, state) {
  const selected = await selectFooterConfigOption(
    ctx,
    state,
    "Where should the ChatGPT limit be shown?",
    FOOTER_POSITION_OPTIONS,
    state.footerConfig.footerPosition,
    (footerPosition) => {
      state.footerConfig = normalizeFooterConfig({
        ...state.footerConfig,
        footerPosition,
      })
    },
  )
  if (!selected) return

  await saveFooterConfig(state, {
    ...state.footerConfig,
    footerPosition: selected.value,
  })
  ctx.ui.notify(`ChatGPT footer position: ${selected.label}`, "info")
}

async function resetFooterConfig(ctx, state) {
  const confirmed = await ctx.ui.confirm(
    "Reset ChatGPT footer settings?",
    "This restores the default footer display: weekly usage, used percent, on the second line.",
  )
  if (!confirmed) return

  await saveFooterConfig(state, {
    ...state.footerConfig,
    quotaWindow: DEFAULT_FOOTER_CONFIG.quotaWindow,
    displayMode: DEFAULT_FOOTER_CONFIG.displayMode,
    footerPosition: DEFAULT_FOOTER_CONFIG.footerPosition,
  })
  ctx.ui.notify("ChatGPT footer settings reset to defaults.", "info")
}

async function configureStandardFooterMode(ctx, state) {
  const currentMode = state.footerConfig.standardFooter.mode
  const labels = STANDARD_FOOTER_MODE_OPTIONS.map(
    (option) =>
      `${option.label}${option.value === currentMode ? " (current)" : ""}`,
  )
  const selectedLabel = await ctx.ui.select("Footer mode", labels)
  const selected = STANDARD_FOOTER_MODE_OPTIONS[labels.indexOf(selectedLabel)]
  if (!selected) return

  await saveFooterConfig(state, {
    ...state.footerConfig,
    standardFooter: {
      ...state.footerConfig.standardFooter,
      mode: selected.value,
    },
  })
  ctx.ui.notify(`Standard footer mode: ${selected.label}`, "info")
}

async function configureStandardFooterFields(ctx, state) {
  const standardFooter = state.footerConfig.standardFooter
  const labels = STANDARD_FOOTER_FIELD_OPTIONS.map((option) => {
    const enabled =
      standardFooter.mode === "default"
        ? DEFAULT_STANDARD_FOOTER_CONFIG[option.value]
        : standardFooter[option.value]
    return `${option.label}: ${enabled ? "enabled" : "disabled"}`
  })
  const selectedLabel = await ctx.ui.select("Standard footer fields", labels)
  const selected = STANDARD_FOOTER_FIELD_OPTIONS[labels.indexOf(selectedLabel)]
  if (!selected) return

  const currentValue =
    standardFooter.mode === "default"
      ? DEFAULT_STANDARD_FOOTER_CONFIG[selected.value]
      : standardFooter[selected.value]
  await saveFooterConfig(state, {
    ...state.footerConfig,
    standardFooter: {
      ...standardFooter,
      mode: "custom",
      [selected.value]: !currentValue,
    },
  })
  ctx.ui.notify(
    `${selected.label}: ${currentValue ? "disabled" : "enabled"} (custom mode)`,
    "info",
  )
}

async function resetStandardFooterConfig(ctx, state) {
  const confirmed = await ctx.ui.confirm(
    "Reset standard footer to Pi defaults?",
    "This restores every standard footer field and switches to Default mode.",
  )
  if (!confirmed) return

  await saveFooterConfig(state, {
    ...state.footerConfig,
    standardFooter: { ...DEFAULT_STANDARD_FOOTER_CONFIG },
  })
  ctx.ui.notify("Standard footer reset to Pi defaults.", "info")
}

export function registerChatGptLimitFooterCommand(pi, state) {
  pi.registerCommand("chatgpt-limit-footer", {
    description: "Configure standard Pi footer fields",
    handler: async (_args, ctx) => {
      const mode = state.footerConfig.standardFooter.mode
      const action = await ctx.ui.select("ChatGPT limit standard footer", [
        `Footer mode (${mode === "default" ? "Default" : "Custom"})`,
        "Standard footer fields",
        "Reset to Pi defaults",
      ])

      if (action?.startsWith("Footer mode")) {
        await configureStandardFooterMode(ctx, state)
      } else if (action === "Standard footer fields") {
        await configureStandardFooterFields(ctx, state)
      } else if (action === "Reset to Pi defaults") {
        await resetStandardFooterConfig(ctx, state)
      }
    },
  })
}

export function registerChatGptLimitCommand(pi, state, queueUpdate) {
  pi.registerCommand("chatgpt-limit", {
    description: "Show ChatGPT Codex 5-hour and weekly usage limits",
    handler: async (_args, ctx) => {
      const action = await ctx.ui.select("ChatGPT Codex usage limits", [
        "Show current usage details",
        `Configure footer limit (${describeFooterConfig(state.footerConfig)})`,
        "Configure footer display mode",
        "Configure footer position",
        "Reset footer settings to defaults",
      ])

      if (action === "Configure footer display mode") {
        await configureDisplayMode(ctx, state)
        return
      }

      if (action === "Configure footer position") {
        await configureFooterPosition(ctx, state)
        return
      }

      if (action === "Reset footer settings to defaults") {
        await resetFooterConfig(ctx, state)
        return
      }

      if (action?.startsWith("Configure footer limit")) {
        await configureQuotaWindow(ctx, state)
        return
      }

      if (!action) return

      if (!isOpenAICodexProvider(ctx.model?.provider)) {
        ctx.ui.notify(
          "ChatGPT limits are only available for openai-codex models.",
          "info",
        )
        return
      }

      const snapshot = await queueUpdate(ctx)
      if (!snapshot) {
        ctx.ui.notify("Could not load ChatGPT usage limits.", "warning")
        return
      }

      await ctx.ui.select(
        "ChatGPT Codex usage limits",
        buildUsageDetails(
          snapshot,
          ctx.model?.provider,
          describeFooterConfig(state.footerConfig),
        ),
      )
    },
  })
}
