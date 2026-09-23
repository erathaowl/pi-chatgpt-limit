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
import { syncFooter } from "./footer.js"
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

async function configureOtherProviders(pi, ctx, state) {
  const current = state.footerConfig.standardFooter.showForOtherProviders
  const labels = [
    `Disabled${!current ? " (current)" : ""}`,
    `Enabled${current ? " (current)" : ""}`,
  ]
  const selected = await ctx.ui.select(
    "Custom footer for other providers",
    labels,
  )
  if (!selected) return

  const enabled = selected.startsWith("Enabled")
  await saveFooterConfig(state, {
    ...state.footerConfig,
    standardFooter: {
      ...state.footerConfig.standardFooter,
      showForOtherProviders: enabled,
    },
  })
  syncFooter(pi, ctx, state)
  ctx.ui.notify(
    `Custom footer for other providers: ${enabled ? "enabled" : "disabled"}`,
    "info",
  )
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

function standardFooterFieldsEqual(left, right) {
  return STANDARD_FOOTER_FIELD_OPTIONS.every(
    ({ value }) => left[value] === right[value],
  )
}

async function configureStandardFooterFields(ctx, state) {
  const originalConfig = normalizeFooterConfig({
    ...state.footerConfig,
    standardFooter: { ...state.footerConfig.standardFooter },
  })
  const originalStandardFooter = originalConfig.standardFooter
  const showForOtherProviders = originalStandardFooter.showForOtherProviders
  const draft = {
    ...(originalStandardFooter.mode === "default"
      ? DEFAULT_STANDARD_FOOTER_CONFIG
      : originalStandardFooter),
    showForOtherProviders,
  }
  const initialFields = { ...draft }

  const result = await ctx.ui.custom((tui, theme, _keybindings, done) => {
    let selectedIndex = 0

    function applyPreview() {
      const unchanged = standardFooterFieldsEqual(draft, initialFields)
      state.footerConfig = unchanged
        ? originalConfig
        : normalizeFooterConfig({
            ...originalConfig,
            standardFooter: {
              ...draft,
              mode: "custom",
            },
          })
      state.requestRender()
    }

    return {
      invalidate() {},
      handleInput(data) {
        if (matchesKey(data, Key.up)) {
          selectedIndex = Math.max(0, selectedIndex - 1)
          tui.requestRender()
          return
        }
        if (matchesKey(data, Key.down)) {
          selectedIndex = Math.min(
            STANDARD_FOOTER_FIELD_OPTIONS.length - 1,
            selectedIndex + 1,
          )
          tui.requestRender()
          return
        }
        if (matchesKey(data, Key.space)) {
          const field = STANDARD_FOOTER_FIELD_OPTIONS[selectedIndex].value
          draft[field] = !draft[field]
          applyPreview()
          tui.requestRender()
          return
        }
        if (matchesKey(data, Key.enter)) {
          done({ ...draft })
          return
        }
        if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
          done(undefined)
        }
      },
      render(width) {
        const changed = !standardFooterFieldsEqual(draft, initialFields)
        const mode =
          originalStandardFooter.mode === "default" && !changed
            ? "Mode: Default • first change switches to Custom"
            : changed
              ? "Mode: Custom • unsaved changes"
              : "Mode: Custom"
        const lines = [
          theme.bold("Standard footer fields"),
          theme.fg("dim", mode),
          "",
        ]

        for (
          let index = 0;
          index < STANDARD_FOOTER_FIELD_OPTIONS.length;
          index++
        ) {
          const option = STANDARD_FOOTER_FIELD_OPTIONS[index]
          const isSelected = index === selectedIndex
          const cursor = isSelected ? "› " : "  "
          const checkbox = draft[option.value] ? "[x]" : "[ ]"
          const text = `${cursor}${checkbox} ${option.label}`
          lines.push(isSelected ? theme.fg("accent", text) : text)
        }

        lines.push(
          "",
          theme.fg(
            "dim",
            "↑↓ navigate • space toggle • enter save • esc cancel",
          ),
        )
        return lines.map((line) => truncateToWidth(line, width, "…"))
      },
    }
  })

  if (result === undefined) {
    state.footerConfig = originalConfig
    state.requestRender()
    return
  }

  if (standardFooterFieldsEqual(result, initialFields)) {
    state.footerConfig = originalConfig
    state.requestRender()
    return
  }

  await saveFooterConfig(state, {
    ...originalConfig,
    standardFooter: {
      ...result,
      mode: "custom",
    },
  })
  ctx.ui.notify("Standard footer fields updated.", "info")
}

async function resetStandardFooterConfig(pi, ctx, state) {
  const confirmed = await ctx.ui.confirm(
    "Reset standard footer to Pi defaults?",
    "This restores every standard footer field, switches to Default mode, and disables the custom footer for other providers.",
  )
  if (!confirmed) return

  await saveFooterConfig(state, {
    ...state.footerConfig,
    standardFooter: { ...DEFAULT_STANDARD_FOOTER_CONFIG },
  })
  syncFooter(pi, ctx, state)
  ctx.ui.notify("Standard footer reset to Pi defaults.", "info")
}

export function registerChatGptLimitFooterCommand(pi, state) {
  pi.registerCommand("chatgpt-limit-footer", {
    description: "Configure standard Pi footer fields",
    handler: async (_args, ctx) => {
      const standardFooter = state.footerConfig.standardFooter
      const action = await ctx.ui.select("ChatGPT limit standard footer", [
        `Footer mode (${standardFooter.mode === "default" ? "Default" : "Custom"})`,
        "Standard footer fields",
        `Other providers (${standardFooter.showForOtherProviders ? "Enabled" : "Disabled"})`,
        "Reset to Pi defaults",
      ])

      if (action?.startsWith("Footer mode")) {
        await configureStandardFooterMode(ctx, state)
      } else if (action === "Standard footer fields") {
        await configureStandardFooterFields(ctx, state)
      } else if (action?.startsWith("Other providers")) {
        await configureOtherProviders(pi, ctx, state)
      } else if (action === "Reset to Pi defaults") {
        await resetStandardFooterConfig(pi, ctx, state)
      }
    },
  })
}

async function loadUsageDetails(ctx, state, queueUpdate) {
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

  return buildUsageDetails(
    snapshot,
    ctx.model?.provider,
    describeFooterConfig(state.footerConfig),
  )
}

export function registerChatGptLimitUsageCommand(pi, state, queueUpdate) {
  pi.registerCommand("chatgpt-limit-usage", {
    description: "Print current ChatGPT Codex usage details",
    handler: async (_args, ctx) => {
      const details = await loadUsageDetails(ctx, state, queueUpdate)
      if (details) ctx.ui.notify(details.join("\n"), "info")
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

      const details = await loadUsageDetails(ctx, state, queueUpdate)
      if (details) await ctx.ui.select("ChatGPT Codex usage limits", details)
    },
  })
}
