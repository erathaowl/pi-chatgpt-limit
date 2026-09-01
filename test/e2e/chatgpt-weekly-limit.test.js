import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { once } from "node:events"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import http from "node:http"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { test } from "node:test"

import { normalizeFooterConfig, restoreFooterConfig } from "../../src/config.js"
import {
  DEFAULT_STANDARD_FOOTER_CONFIG,
  STANDARD_FOOTER_FIELD_OPTIONS,
} from "../../src/constants.js"
import { registerChatGptLimitFooterCommand } from "../../src/command.js"
import { installFooter } from "../../src/footer.js"

const EXTENSION_PATH = resolve("index.js")

function encodeBase64Url(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url")
}

function fakeJwt(payload) {
  return `${encodeBase64Url({ alg: "none" })}.${encodeBase64Url(payload)}.`
}

async function startUsageServer(handler) {
  const requests = []
  const server = http.createServer(async (req, res) => {
    requests.push({ url: req.url, headers: req.headers })
    await handler(req, res)
  })

  server.listen(0, "127.0.0.1")
  await once(server, "listening")

  const { port } = server.address()
  return {
    requests,
    baseUrl: `http://127.0.0.1:${port}/backend-api`,
    close: () =>
      new Promise((resolveClose, reject) =>
        server.close((error) => (error ? reject(error) : resolveClose())),
      ),
  }
}

function sendUsageResponse(res, options = {}) {
  const {
    planType,
    fiveHourUsed = 25,
    weeklyUsed = 42,
    fiveHourResetSeconds = 2 * 60 * 60,
    weeklyResetSeconds = 2 * 24 * 60 * 60,
  } = options

  res.writeHead(200, { "content-type": "application/json" })
  res.end(
    JSON.stringify({
      ...(planType ? { plan_type: planType } : {}),
      rate_limit: {
        primary_window: {
          used_percent: fiveHourUsed,
          limit_window_seconds: 5 * 60 * 60,
          reset_at: Math.floor(Date.now() / 1000) + fiveHourResetSeconds,
        },
        secondary_window: {
          used_percent: weeklyUsed,
          limit_window_seconds: 7 * 24 * 60 * 60,
          reset_at: Math.floor(Date.now() / 1000) + weeklyResetSeconds,
        },
      },
    }),
  )
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`
}

function scriptCommand(outputFile, command, args) {
  if (process.platform === "darwin")
    return ["script", ["-q", outputFile, command, ...args]]

  return [
    "script",
    [
      "-q",
      "-f",
      "-c",
      [command, ...args].map(shellQuote).join(" "),
      outputFile,
    ],
  ]
}

async function readIfExists(path) {
  if (!existsSync(path)) return ""
  return readFile(path, "utf8")
}

async function waitForOutput(path, predicate, timeoutMs = 8000) {
  const startedAt = Date.now()
  let output = ""

  while (Date.now() - startedAt < timeoutMs) {
    output = await readIfExists(path)
    if (predicate(output)) return output
    await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  }

  return output
}

function tclDoubleQuote(value) {
  return `"${String(value)
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("$", "\\$")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]")}"`
}

function expectSendLiteral(value) {
  return String(value).replaceAll('"', '\\"')
}

function expectBlock(pattern) {
  return `expect {\n  ${tclDoubleQuote(pattern)} {}\n  timeout { exit 1 }\n  eof { exit 1 }\n}`
}

function expectExactBlock(pattern) {
  return `expect {\n  -exact ${tclDoubleQuote(pattern)} {}\n  timeout { exit 1 }\n  eof { exit 1 }\n}`
}

function stripAnsi(value) {
  return String(value)
    .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, "")
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
}

function buildPiArgs(apiKey) {
  return [
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-themes",
    "--no-context-files",
    "--no-session",
    "--extension",
    EXTENSION_PATH,
    "--provider",
    "openai-codex",
    "--model",
    "gpt-5.5",
    "--api-key",
    apiKey,
  ]
}

async function runRealPiTui({
  baseUrl,
  apiKey,
  extraEnv = {},
  initialConfig,
  waitFor = (text) => text.includes("42%") && text.includes("gpt-5.5"),
  settleMs = 0,
  timeoutMs = 12000,
}) {
  if (
    spawnSync("script", ["--version"], { stdio: "ignore" }).error?.code ===
    "ENOENT"
  ) {
    throw new Error(
      "The `script` command is required for real pi TUI e2e tests.",
    )
  }

  const tempDir = await mkdtemp(join(tmpdir(), "pi-chatgpt-limit-e2e-"))
  const outputFile = join(tempDir, "typescript.log")
  const agentDir = join(tempDir, "agent")
  const sessionDir = join(tempDir, "sessions")

  if (initialConfig) {
    await mkdir(agentDir, { recursive: true })
    await writeFile(
      join(agentDir, "chatgpt-limit.json"),
      `${JSON.stringify(initialConfig, null, 2)}\n`,
    )
  }

  const piArgs = buildPiArgs(apiKey)

  const [command, args] = scriptCommand(outputFile, "pi", piArgs)
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      CHATGPT_BASE_URL: baseUrl,
      PI_CODING_AGENT_DIR: agentDir,
      PI_CODING_AGENT_SESSION_DIR: sessionDir,
      PI_SKIP_VERSION_CHECK: "1",
      PI_TELEMETRY: "0",
      TERM: "xterm-256color",
      NO_COLOR: "0",
      COLUMNS: "160",
      LINES: "40",
      ...extraEnv,
    },
  })

  try {
    let output = await waitForOutput(outputFile, waitFor, timeoutMs)
    if (settleMs > 0) {
      await new Promise((resolveWait) => setTimeout(resolveWait, settleMs))
      output = await readIfExists(outputFile)
    }
    return { output, outputFile }
  } finally {
    try {
      process.kill(-child.pid, "SIGTERM")
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 250))
    try {
      process.kill(-child.pid, "SIGKILL")
    } catch {}
    await rm(tempDir, { recursive: true, force: true })
  }
}

async function runRealPiTuiExpect({
  baseUrl,
  apiKey,
  mainKeys,
  optionKeys,
  submenuText,
  expectText,
  expectedConfig,
  initialConfig,
  scriptBody,
  readyText = "W 42%",
  settleMs = 100,
  extraEnv = {},
  timeoutMs = 12000,
  command = "/chatgpt-limit",
}) {
  if (
    spawnSync("expect", ["-v"], { stdio: "ignore" }).error?.code === "ENOENT"
  ) {
    throw new Error(
      "The `expect` command is required for interactive e2e tests.",
    )
  }

  const tempDir = await mkdtemp(join(tmpdir(), "pi-chatgpt-limit-expect-"))
  const outputFile = join(tempDir, "expect.log")
  const expectFile = join(tempDir, "test.exp")
  const agentDir = join(tempDir, "agent")
  const sessionDir = join(tempDir, "sessions")
  if (initialConfig) {
    await mkdir(agentDir, { recursive: true })
    await writeFile(
      join(agentDir, "chatgpt-limit.json"),
      `${JSON.stringify(initialConfig, null, 2)}\n`,
    )
  }

  const piArgs = buildPiArgs(apiKey).map(tclDoubleQuote).join(" ")
  const env = {
    CHATGPT_BASE_URL: baseUrl,
    PI_CODING_AGENT_DIR: agentDir,
    PI_CODING_AGENT_SESSION_DIR: sessionDir,
    PI_SKIP_VERSION_CHECK: "1",
    PI_TELEMETRY: "0",
    TERM: "xterm-256color",
    NO_COLOR: "0",
    COLUMNS: "160",
    LINES: "40",
    ...extraEnv,
  }
  const envLines = Object.entries(env)
    .map(([key, value]) => `set env(${key}) ${tclDoubleQuote(value)}`)
    .join("\n")

  const body =
    scriptBody ??
    `${expectBlock("Configure footer display mode")}
send "${expectSendLiteral(mainKeys)}"
${expectBlock(submenuText)}
send "${expectSendLiteral(optionKeys)}"
${expectBlock(expectText)}`

  await writeFile(
    expectFile,
    `log_file -noappend ${tclDoubleQuote(outputFile)}
set timeout ${Math.ceil(timeoutMs / 1000)}
${envLines}
spawn pi ${piArgs}
set pi_pid [exp_pid]
stty columns 160 rows 40
${expectBlock(readyText)}
after 300
send "${expectSendLiteral(command)}\\r"
${body}
after ${settleMs}
catch {exec kill -TERM $pi_pid}
after 100
catch {exec kill -KILL $pi_pid}
close
`,
  )

  try {
    const child = spawn("expect", [expectFile], {
      detached: true,
      stdio: "ignore",
    })
    const status = await new Promise((resolveClose) => {
      child.on("close", (code) => resolveClose(code))
    })
    const output = await readIfExists(outputFile)
    assert.equal(status, 0, output)
    if (expectedConfig) {
      assert.deepEqual(
        JSON.parse(
          await readFile(join(agentDir, "chatgpt-limit.json"), "utf8"),
        ),
        normalizeFooterConfig(expectedConfig),
      )
    }
    return output
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

function customStandardFooter(overrides = {}) {
  return {
    mode: "custom",
    ...Object.fromEntries(
      STANDARD_FOOTER_FIELD_OPTIONS.map(({ value }) => [value, false]),
    ),
    ...overrides,
  }
}

async function runStandardFooterEditor({
  initialConfig = {},
  inputs,
  width = 120,
  persistInitial = false,
}) {
  const tempDir = await mkdtemp(join(tmpdir(), "pi-chatgpt-limit-editor-"))
  const configPath = join(tempDir, "chatgpt-limit.json")
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR
  process.env.PI_CODING_AGENT_DIR = tempDir

  try {
    const normalizedInitial = normalizeFooterConfig(initialConfig)
    const initialText = `${JSON.stringify(normalizedInitial, null, 2)}\n`
    if (persistInitial) await writeFile(configPath, initialText)

    let handler
    const state = {
      footerConfig: normalizedInitial,
      requestRenderCalls: 0,
      requestRender() {
        this.requestRenderCalls++
      },
    }
    registerChatGptLimitFooterCommand(
      {
        registerCommand(name, command) {
          assert.equal(name, "chatgpt-limit-footer")
          handler = command.handler
        },
      },
      state,
    )

    const tui = {
      requestRenderCalls: 0,
      requestRender() {
        this.requestRenderCalls++
      },
    }
    const accentRows = []
    const theme = {
      bold: (text) => text,
      fg(color, text) {
        if (color === "accent") accentRows.push(text)
        return text
      },
    }
    const renders = []
    const persistedDuringInput = []
    const previewConfigs = []
    const notifications = []
    let customDoneCalls = 0

    const ctx = {
      ui: {
        select: async () => "Standard footer fields",
        async custom(factory) {
          let result
          let done = false
          const component = factory(tui, theme, {}, (value) => {
            customDoneCalls++
            result = value
            done = true
          })
          renders.push(component.render(width))
          for (const input of inputs) {
            assert.equal(done, false, "custom editor closed before all inputs")
            component.handleInput(input)
            persistedDuringInput.push(existsSync(configPath))
            previewConfigs.push(structuredClone(state.footerConfig))
            renders.push(component.render(width))
          }
          assert.equal(done, true, "custom editor did not close")
          return result
        },
        notify(message, level) {
          notifications.push({ message, level })
        },
      },
    }

    await handler("", ctx)
    const finalText = await readIfExists(configPath)
    return {
      state,
      tui,
      renders,
      accentRows,
      notifications,
      customDoneCalls,
      persistedDuringInput,
      previewConfigs,
      persistedConfig: finalText ? JSON.parse(finalText) : undefined,
      persistedUnchanged: persistInitial && finalText === initialText,
    }
  } finally {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir
    await rm(tempDir, { recursive: true, force: true })
  }
}

function renderTestFooter({
  footerPosition = "second",
  quotaWindow = "weekly",
  standardFooter,
  entries = [],
  width = 80,
  branch,
  sessionName,
  cwd = "/project",
  model = { id: "gpt-5.5", provider: "openai-codex" },
  providerCount = 1,
  usingSubscription = true,
  contextUsage = { contextWindow: 128000, percent: 10 },
} = {}) {
  let footerFactory
  const state = {
    footerConfig: normalizeFooterConfig({
      quotaWindow,
      displayMode: "used",
      footerPosition,
      standardFooter,
    }),
    usageSnapshot: { weekly: { usedPercent: 42 } },
    requestRender: () => {},
  }
  const ctx = {
    model,
    getContextUsage: () => contextUsage,
    modelRegistry: { isUsingOAuth: () => usingSubscription },
    sessionManager: {
      getEntries: () => entries,
      getCwd: () => cwd,
      getSessionName: () => sessionName,
    },
    ui: {
      setFooter(factory) {
        footerFactory = factory
      },
    },
  }
  const pi = { getThinkingLevel: () => "off" }

  installFooter(pi, ctx, state)
  const footer = footerFactory(
    { requestRender() {} },
    { fg: (_color, text) => text },
    {
      getGitBranch: () => branch,
      getAvailableProviderCount: () => providerCount,
      onBranchChange: () => undefined,
    },
  )
  return footer.render(width)
}

function renderFooterWithPosition(footerPosition, width = 80) {
  return renderTestFooter({ footerPosition, width })
}

test("footer position configuration accepts all supported values", () => {
  for (const footerPosition of ["first", "second", "third"]) {
    assert.equal(
      normalizeFooterConfig({ footerPosition }).footerPosition,
      footerPosition,
    )
  }

  assert.equal(normalizeFooterConfig({}).footerPosition, "second")
  assert.equal(
    normalizeFooterConfig({ footerPosition: "invalid" }).footerPosition,
    "second",
  )
})

test("footer supports all configured line positions", async (t) => {
  await t.test("first line", () => {
    const lines = renderFooterWithPosition("first")

    assert.equal(lines.length, 2)
    assert.match(lines[0], /W 42%$/)
    assert.equal(lines[0].length, 80)
    assert.doesNotMatch(lines[1], /W 42%/)
  })

  await t.test("second line", () => {
    const lines = renderFooterWithPosition("second")

    assert.equal(lines.length, 2)
    assert.doesNotMatch(lines[0], /W 42%/)
    assert.match(lines[1], /gpt-5\.5 • W 42%$/)
    assert.equal(lines[1].length, 80)
  })

  await t.test("third line", () => {
    const lines = renderFooterWithPosition("third")

    assert.equal(lines.length, 3)
    assert.doesNotMatch(lines[0], /W 42%/)
    assert.doesNotMatch(lines[1], /W 42%/)
    assert.match(lines[2], /W 42%$/)
    assert.equal(lines[2].length, 80)
  })
})

test("standard footer configuration is backward compatible and normalized", () => {
  const legacy = normalizeFooterConfig({
    quotaWindow: "both",
    displayMode: "remaining",
    footerPosition: "first",
  })

  assert.deepEqual(legacy.standardFooter, DEFAULT_STANDARD_FOOTER_CONFIG)

  const custom = normalizeFooterConfig({
    standardFooter: {
      mode: "custom",
      totalTokens: true,
      inputTokens: "invalid",
    },
  }).standardFooter
  assert.equal(custom.mode, "custom")
  assert.equal(custom.totalTokens, true)
  assert.equal(custom.inputTokens, true)

  const invalid = normalizeFooterConfig({
    standardFooter: { mode: "invalid", workingDirectory: false },
  }).standardFooter
  assert.equal(invalid.mode, "default")
})

test("default footer mode ignores persisted custom toggles", () => {
  const lines = renderTestFooter({
    quotaWindow: "hidden",
    branch: "main",
    sessionName: "session-name",
    model: {
      id: "gpt-5.5",
      provider: "openai-codex",
      reasoning: true,
    },
    standardFooter: {
      ...customStandardFooter(),
      mode: "default",
    },
  })

  assert.equal(lines[0], "/project (main) • session-name")
  assert.match(lines[1], /10\.0%\/128k/)
  assert.match(lines[1], /gpt-5\.5 • thinking off$/)
})

test("custom footer totals only input and output tokens", () => {
  const lines = renderTestFooter({
    quotaWindow: "hidden",
    standardFooter: customStandardFooter({
      totalTokens: true,
      contextUsage: true,
    }),
    entries: [
      {
        type: "message",
        message: {
          role: "assistant",
          usage: {
            input: 1000,
            output: 500,
            cacheRead: 50000,
            cacheWrite: 70000,
          },
        },
      },
    ],
  })

  assert.equal(lines[0], "")
  assert.equal(lines[1], "T1.5k 10.0%/128k")
  assert.doesNotMatch(lines[1], /↑|↓|R50k|W70k|T122k/)
})

test("cost and subscription marker are independently configurable", () => {
  const entries = [
    {
      type: "message",
      message: {
        role: "assistant",
        usage: { cost: { total: 1.25 } },
      },
    },
  ]

  const both = renderTestFooter({
    quotaWindow: "hidden",
    entries,
    standardFooter: customStandardFooter({
      cost: true,
      subscriptionMarker: true,
    }),
  })[1]
  assert.equal(both, "$1.250 (sub)")

  const costOnly = renderTestFooter({
    quotaWindow: "hidden",
    entries,
    standardFooter: customStandardFooter({ cost: true }),
  })[1]
  assert.equal(costOnly, "$1.250")

  const subscriptionOnly = renderTestFooter({
    quotaWindow: "hidden",
    entries,
    standardFooter: customStandardFooter({ subscriptionMarker: true }),
  })[1]
  assert.equal(subscriptionOnly, "(sub)")
})

test("custom location and model components omit unused separators", () => {
  const location = renderTestFooter({
    quotaWindow: "hidden",
    branch: "main",
    sessionName: "session-name",
    standardFooter: customStandardFooter({
      gitBranch: true,
      sessionName: true,
    }),
  })
  assert.equal(location[0], "(main) • session-name")

  const sessionOnly = renderTestFooter({
    quotaWindow: "hidden",
    sessionName: "session-name",
    standardFooter: customStandardFooter({ sessionName: true }),
  })
  assert.equal(sessionOnly[0], "session-name")

  const modelOnly = renderTestFooter({
    quotaWindow: "hidden",
    standardFooter: customStandardFooter({ model: true }),
  })
  assert.match(modelOnly[1], /^\s+gpt-5\.5$/)
  assert.doesNotMatch(modelOnly[1], /•|\(openai-codex\)/)

  const providerOnly = renderTestFooter({
    quotaWindow: "hidden",
    providerCount: 2,
    standardFooter: customStandardFooter({ provider: true }),
  })
  assert.match(providerOnly[1], /^\s+\(openai-codex\)$/)

  const modelAndThinking = renderTestFooter({
    quotaWindow: "hidden",
    model: {
      id: "gpt-5.5",
      provider: "openai-codex",
      reasoning: true,
    },
    standardFooter: customStandardFooter({
      model: true,
      thinkingLevel: true,
    }),
  })
  assert.match(modelAndThinking[1], /^\s+gpt-5\.5 • thinking off$/)
})

test("custom footer truncates cleanly at narrow widths", () => {
  const lines = renderTestFooter({
    quotaWindow: "hidden",
    width: 18,
    branch: "long-branch-name",
    sessionName: "long-session-name",
    standardFooter: customStandardFooter({
      workingDirectory: true,
      gitBranch: true,
      sessionName: true,
      contextUsage: true,
      model: true,
      thinkingLevel: true,
    }),
  })

  const plainLines = lines.map(stripAnsi)
  assert.ok(plainLines.every((line) => line.length <= 18))
  assert.match(plainLines[0], /\.\.\.$/)
})

test("standard footer checklist renders, previews, and saves multiple fields", async () => {
  const result = await runStandardFooterEditor({
    inputs: [" ", "\x1b[B", " ", "\r"],
  })

  const initial = result.renders[0].join("\n")
  assert.match(initial, /Standard footer fields/)
  assert.match(initial, /Mode: Default • first change switches to Custom/)
  assert.match(initial, /› \[x\] Working directory/)
  assert.match(initial, /  \[x\] Input tokens/)
  assert.match(initial, /  \[ \] Total tokens/)
  assert.match(initial, /↑↓ navigate • space toggle • enter save • esc cancel/)

  assert.match(result.renders[1].join("\n"), /› \[ \] Working directory/)
  assert.match(result.renders[1].join("\n"), /Mode: Custom • unsaved changes/)
  assert.match(result.renders[2].join("\n"), /› \[x\] Git branch/)
  assert.match(result.renders[3].join("\n"), /› \[ \] Git branch/)
  assert.equal(result.customDoneCalls, 1)
  assert.equal(result.state.requestRenderCalls, 3)
  assert.equal(result.tui.requestRenderCalls, 3)
  assert.ok(result.persistedDuringInput.every((persisted) => !persisted))
  assert.equal(result.persistedConfig.standardFooter.mode, "custom")
  assert.equal(result.persistedConfig.standardFooter.workingDirectory, false)
  assert.equal(result.persistedConfig.standardFooter.gitBranch, false)
  assert.deepEqual(result.notifications, [
    { message: "Standard footer fields updated.", level: "info" },
  ])
})

test("standard footer checklist navigation is bounded and truncates safely", async () => {
  const inputs = [
    "\x1b[A",
    ...Array(STANDARD_FOOTER_FIELD_OPTIONS.length + 2).fill("\x1b[B"),
    "\r",
  ]
  const result = await runStandardFooterEditor({ inputs, width: 18 })
  const plainRenders = result.renders.map((lines) => lines.map(stripAnsi))

  assert.ok(
    plainRenders.flat().every((line) => line.length <= 18),
    plainRenders.flat().join("\n"),
  )
  assert.match(plainRenders[1].join("\n"), /› \[x\] Working dir/)
  assert.match(plainRenders.at(-1).join("\n"), /› \[x\] Thinking le/)
  assert.equal(result.persistedConfig, undefined)
  assert.equal(result.state.footerConfig.standardFooter.mode, "default")
})

test("standard footer editor preserves Default and Custom mode semantics", async (t) => {
  await t.test("Default plus Enter remains Default", async () => {
    const result = await runStandardFooterEditor({ inputs: ["\r"] })
    assert.equal(result.state.footerConfig.standardFooter.mode, "default")
    assert.equal(result.persistedConfig, undefined)
  })

  await t.test("Default plus one toggle saves Custom", async () => {
    const result = await runStandardFooterEditor({ inputs: [" ", "\r"] })
    assert.equal(result.state.footerConfig.standardFooter.mode, "custom")
    assert.equal(
      result.state.footerConfig.standardFooter.workingDirectory,
      false,
    )
    assert.equal(result.persistedConfig.standardFooter.mode, "custom")
  })

  await t.test("Default plus two toggles remains Default", async () => {
    const result = await runStandardFooterEditor({
      inputs: [" ", " ", "\r"],
    })
    assert.equal(result.state.footerConfig.standardFooter.mode, "default")
    assert.equal(result.persistedConfig, undefined)
  })

  await t.test("restoring several Default fields remains Default", async () => {
    const result = await runStandardFooterEditor({
      inputs: [" ", "\x1b[B", " ", "\x1b[A", " ", "\x1b[B", " ", "\r"],
    })
    assert.equal(result.state.footerConfig.standardFooter.mode, "default")
    assert.equal(result.persistedConfig, undefined)
  })

  await t.test("Custom plus Enter remains Custom", async () => {
    const initialConfig = {
      standardFooter: customStandardFooter({ totalTokens: true }),
    }
    const result = await runStandardFooterEditor({
      initialConfig,
      inputs: ["\r"],
    })
    assert.deepEqual(
      result.state.footerConfig.standardFooter,
      normalizeFooterConfig(initialConfig).standardFooter,
    )
    assert.equal(result.persistedConfig, undefined)
  })

  await t.test("modified Custom fields save as Custom", async () => {
    const result = await runStandardFooterEditor({
      initialConfig: { standardFooter: customStandardFooter() },
      inputs: [" ", "\r"],
    })
    assert.equal(result.state.footerConfig.standardFooter.mode, "custom")
    assert.equal(
      result.state.footerConfig.standardFooter.workingDirectory,
      true,
    )
    assert.equal(result.persistedConfig.standardFooter.mode, "custom")
  })

  await t.test("Custom values equal to defaults remain Custom", async () => {
    const result = await runStandardFooterEditor({
      initialConfig: {
        standardFooter: { ...DEFAULT_STANDARD_FOOTER_CONFIG, mode: "custom" },
      },
      inputs: ["\r"],
    })
    assert.equal(result.state.footerConfig.standardFooter.mode, "custom")
    assert.equal(result.persistedConfig, undefined)
  })
})

test("standard footer editor rolls back Esc and Ctrl+C without persisting", async (t) => {
  for (const [name, cancelKey] of [
    ["Esc", "\x1b"],
    ["Ctrl+C", "\x03"],
  ]) {
    await t.test(name, async () => {
      const initialConfig = {
        quotaWindow: "both",
        standardFooter: customStandardFooter({ totalTokens: true }),
      }
      const result = await runStandardFooterEditor({
        initialConfig,
        inputs: [" ", "\x1b[B", " ", cancelKey],
        persistInitial: true,
      })

      assert.deepEqual(
        result.state.footerConfig,
        normalizeFooterConfig(initialConfig),
      )
      assert.equal(result.persistedUnchanged, true)
      assert.equal(result.notifications.length, 0)
      assert.equal(result.state.requestRenderCalls, 3)
    })
  }
})

test("standard footer draft previews immediately and cancel restores it", async () => {
  const initialConfig = {
    quotaWindow: "hidden",
    standardFooter: customStandardFooter({
      totalTokens: true,
      contextUsage: true,
    }),
  }
  const result = await runStandardFooterEditor({
    initialConfig,
    inputs: ["\x1b[B", "\x1b[B", "\x1b[B", " ", "\x1b"],
    persistInitial: true,
  })
  const footerOptions = {
    quotaWindow: "hidden",
    entries: [
      {
        type: "message",
        message: {
          role: "assistant",
          usage: {
            input: 34000,
            output: 1000,
            cacheRead: 18000,
            cacheWrite: 7000,
          },
        },
      },
    ],
    contextUsage: { contextWindow: 272000, percent: 4.2 },
  }

  const before = renderTestFooter({
    ...footerOptions,
    standardFooter: normalizeFooterConfig(initialConfig).standardFooter,
  })[1]
  const preview = renderTestFooter({
    ...footerOptions,
    standardFooter: result.previewConfigs[3].standardFooter,
  })[1]
  const after = renderTestFooter({
    ...footerOptions,
    standardFooter: result.state.footerConfig.standardFooter,
  })[1]

  assert.equal(before, "T35k 4.2%/272k")
  assert.equal(preview, "↑34k T35k 4.2%/272k")
  assert.equal(after, before)
  assert.doesNotMatch(preview, /R18k|W7k|T60k/)
  assert.equal(result.persistedUnchanged, true)
})

test("standard footer mode selection and reset still persist", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "pi-chatgpt-limit-config-"))
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR
  process.env.PI_CODING_AGENT_DIR = tempDir

  try {
    let handler
    const state = {
      footerConfig: normalizeFooterConfig({
        standardFooter: customStandardFooter({ totalTokens: true }),
      }),
      requestRender() {},
    }
    registerChatGptLimitFooterCommand(
      { registerCommand: (_name, command) => (handler = command.handler) },
      state,
    )
    const selections = ["Footer mode (Custom)", "Default"]
    const ctx = {
      ui: {
        select: async () => selections.shift(),
        confirm: async () => true,
        notify() {},
      },
    }

    await handler("", ctx)
    assert.equal(state.footerConfig.standardFooter.mode, "default")

    ctx.ui.select = async () => "Reset to Pi defaults"
    await handler("", ctx)
    assert.deepEqual(
      state.footerConfig.standardFooter,
      DEFAULT_STANDARD_FOOTER_CONFIG,
    )

    const restoredState = {}
    await restoreFooterConfig(
      { sessionManager: { getBranch: () => [] } },
      restoredState,
    )
    assert.deepEqual(
      restoredState.footerConfig.standardFooter,
      DEFAULT_STANDARD_FOOTER_CONFIG,
    )
  } finally {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir
    await rm(tempDir, { recursive: true, force: true })
  }
})

test("real pi TUI standard footer checklist saves, cancels, and preserves Default", async (t) => {
  const down = "\\033\\[B"
  const enter = "\\r"
  const escape = "\\033"
  const openFields = `${down}${enter}`
  const token = fakeJwt({
    "https://api.openai.com/auth": { chatgpt_account_id: "acct_fields" },
  })
  const server = await startUsageServer((_req, res) => {
    sendUsageResponse(res)
  })

  try {
    await t.test("multiple toggles stay open and save together", async () => {
      const initialConfig = normalizeFooterConfig({})
      const expectedConfig = normalizeFooterConfig({
        standardFooter: {
          ...DEFAULT_STANDARD_FOOTER_CONFIG,
          mode: "custom",
          workingDirectory: false,
          gitBranch: false,
        },
      })
      const output = await runRealPiTuiExpect({
        baseUrl: server.baseUrl,
        apiKey: token,
        command: "/chatgpt-limit-footer",
        readyText: "gpt-5.5",
        initialConfig,
        expectedConfig,
        scriptBody: `${expectBlock("Standard footer fields")}
send "${expectSendLiteral(openFields)}"
${expectBlock("Mode: Default • first change switches to Custom")}
send " "
${expectExactBlock("› [ ] Working directory")}
send "${expectSendLiteral(down)}"
${expectExactBlock("› [x] Git branch")}
send " "
${expectExactBlock("› [ ] Git branch")}
send "${expectSendLiteral(enter)}"
${expectBlock("Standard footer fields updated.")}`,
      })
      assert.match(stripAnsi(output), /› \[ \] Working directory/)
      assert.match(stripAnsi(output), /› \[ \] Git branch/)
    })

    await t.test("Esc restores the saved configuration", async () => {
      const initialConfig = normalizeFooterConfig({
        standardFooter: customStandardFooter({
          totalTokens: true,
          contextUsage: true,
        }),
      })
      await runRealPiTuiExpect({
        baseUrl: server.baseUrl,
        apiKey: token,
        command: "/chatgpt-limit-footer",
        readyText: "gpt-5.5",
        initialConfig,
        expectedConfig: initialConfig,
        scriptBody: `${expectBlock("Standard footer fields")}
send "${expectSendLiteral(openFields)}"
${expectBlock("Mode: Custom")}
send " "
${expectExactBlock("› [x] Working directory")}
send "${expectSendLiteral(escape)}"
${expectBlock("0.0%/272k")}`,
      })
    })

    await t.test("toggling back keeps Default mode", async () => {
      const initialConfig = normalizeFooterConfig({})
      await runRealPiTuiExpect({
        baseUrl: server.baseUrl,
        apiKey: token,
        command: "/chatgpt-limit-footer",
        readyText: "gpt-5.5",
        initialConfig,
        expectedConfig: initialConfig,
        scriptBody: `${expectBlock("Standard footer fields")}
send "${expectSendLiteral(openFields)}"
${expectBlock("Mode: Default • first change switches to Custom")}
send " "
${expectExactBlock("› [ ] Working directory")}
send " "
${expectExactBlock("› [x] Working directory")}
send "${expectSendLiteral(enter)}"
${expectBlock("gpt-5.5")}`,
      })
    })
  } finally {
    await server.close()
  }
})

test("real pi TUI renders the ChatGPT weekly percentage in the footer", async () => {
  const token = fakeJwt({
    "https://api.openai.com/auth": {
      chatgpt_account_id: "acct_test",
      chatgpt_plan_type: "pro",
    },
    "https://api.openai.com/profile": {
      email: "user@example.com",
    },
  })

  const server = await startUsageServer((req, res) => {
    assert.equal(req.url, "/backend-api/wham/usage")
    assert.equal(req.headers.authorization, `Bearer ${token}`)
    assert.equal(req.headers["chatgpt-account-id"], "acct_test")

    sendUsageResponse(res, {
      planType: "pro",
      fiveHourUsed: 25.4,
      weeklyUsed: 42.2,
      fiveHourResetSeconds: 3600,
      weeklyResetSeconds: 86400,
    })
  })

  try {
    const { output } = await runRealPiTui({
      baseUrl: server.baseUrl,
      apiKey: token,
    })

    assert.ok(
      server.requests.length > 0,
      "expected real pi extension to call the mocked ChatGPT usage API",
    )
    assert.match(output, /gpt-5\.5/)
    assert.match(output, /42%/)
  } finally {
    await server.close()
  }
})

test("real pi TUI loads global footer configuration", async (t) => {
  const token = fakeJwt({
    "https://api.openai.com/auth": { chatgpt_account_id: "acct_global" },
  })
  const server = await startUsageServer((_req, res) => {
    sendUsageResponse(res)
  })

  try {
    await t.test("custom display", async () => {
      const { output } = await runRealPiTui({
        baseUrl: server.baseUrl,
        apiKey: token,
        initialConfig: { quotaWindow: "both", displayMode: "remaining" },
        waitFor: (text) => stripAnsi(text).includes("5h 75% left / W 58% left"),
      })

      assert.match(stripAnsi(output), /5h 75% left \/ W 58% left/)
    })

    await t.test("hidden display", async () => {
      const requestCount = server.requests.length
      const { output } = await runRealPiTui({
        baseUrl: server.baseUrl,
        apiKey: token,
        initialConfig: { quotaWindow: "hidden", displayMode: "used" },
        waitFor: (text) =>
          server.requests.length > requestCount &&
          stripAnsi(text).includes("gpt-5.5"),
        settleMs: 500,
      })

      assert.doesNotMatch(stripAnsi(output), /W 42%|5h 25%/)
    })
  } finally {
    await server.close()
  }
})

test("real pi TUI cancels footer previews and resets defaults", async () => {
  const down = "\\033\\[B"
  const enter = "\\r"
  const escape = "\\033"
  const displayModeMenu = `${down}${down}${enter}`
  const resetMenu = `${down}${down}${down}${down}${enter}`
  const defaultConfig = {
    quotaWindow: "weekly",
    displayMode: "used",
    footerPosition: "second",
  }
  const token = fakeJwt({
    "https://api.openai.com/auth": { chatgpt_account_id: "acct_reset" },
  })
  const server = await startUsageServer((_req, res) => {
    sendUsageResponse(res)
  })

  try {
    const previewOutput = await runRealPiTuiExpect({
      baseUrl: server.baseUrl,
      apiKey: token,
      initialConfig: defaultConfig,
      expectedConfig: defaultConfig,
      scriptBody: `${expectBlock("Configure footer display mode")}
send "${expectSendLiteral(displayModeMenu)}"
${expectBlock("How should the footer value be shown?")}
send "${expectSendLiteral(down)}"
${expectBlock("W 42% · ~2d")}
send "${expectSendLiteral(escape)}"
${expectBlock("gpt-5.5")}`,
    })
    const previewText = stripAnsi(previewOutput)
    const previewIndex = previewText.lastIndexOf("W 42% · ~2d")
    assert.ok(previewIndex >= 0, previewText)
    assert.ok(previewText.lastIndexOf("W 42%") > previewIndex, previewText)

    const resetOutput = await runRealPiTuiExpect({
      baseUrl: server.baseUrl,
      apiKey: token,
      initialConfig: { quotaWindow: "both", displayMode: "remainingCompact" },
      readyText: "W 58% left",
      expectedConfig: defaultConfig,
      scriptBody: `${expectBlock("Reset footer settings to defaults")}
send "${expectSendLiteral(resetMenu)}"
${expectBlock("Reset ChatGPT footer settings?")}
send "${expectSendLiteral(enter)}"
${expectBlock("ChatGPT footer settings reset to defaults.")}`,
    })
    assert.match(stripAnsi(resetOutput), /settings reset to defaults/)
  } finally {
    await server.close()
  }
})

test("real pi TUI previews and saves footer display configuration options", async (t) => {
  const up = "\\033\\[A"
  const down = "\\033\\[B"
  const enter = "\\r"
  const displayModeMenu = `${down}${down}${enter}`
  const footerLimitMenu = `${down}${enter}`
  const footerPositionMenu = `${down}${down}${down}${enter}`
  const cases = [
    {
      name: "5-hour limit",
      mainKeys: footerLimitMenu,
      optionKeys: `${down}${enter}`,
      submenuText: "Display which ChatGPT limit in footer?",
      expectText: "ChatGPT footer display: 5-hour usage",
      expectedConfig: {
        quotaWindow: "fiveHour",
        displayMode: "used",
        footerPosition: "second",
      },
    },
    {
      name: "both 5-hour and weekly limits",
      mainKeys: footerLimitMenu,
      optionKeys: `${down}${down}${enter}`,
      submenuText: "Display which ChatGPT limit in footer?",
      expectText: "ChatGPT footer display: Both 5-hour and weekly",
      expectedConfig: {
        quotaWindow: "both",
        displayMode: "used",
        footerPosition: "second",
      },
    },
    {
      name: "hidden footer limit",
      mainKeys: footerLimitMenu,
      optionKeys: `${down}${down}${down}${enter}`,
      submenuText: "Display which ChatGPT limit in footer?",
      expectText:
        "ChatGPT footer display: Hide usage from footer (usage hidden).",
      expectedConfig: {
        quotaWindow: "hidden",
        displayMode: "used",
        footerPosition: "second",
      },
    },
    {
      name: "used percent with reset",
      mainKeys: displayModeMenu,
      optionKeys: `${down}${enter}`,
      submenuText: "How should the footer value be shown?",
      expectText:
        "ChatGPT footer mode: Used percent with reset, e.g. W 42% · ~2d",
      expectedConfig: {
        quotaWindow: "weekly",
        displayMode: "compact",
        footerPosition: "second",
      },
    },
    {
      name: "pace percent with state",
      mainKeys: displayModeMenu,
      optionKeys: `${down}${down}${enter}`,
      submenuText: "How should the footer value be shown?",
      expectText:
        "ChatGPT footer mode: Pace percent with state, e.g. WP 13% (reserve)",
      expectedConfig: {
        quotaWindow: "weekly",
        displayMode: "pace",
        footerPosition: "second",
      },
    },
    {
      name: "pace percent",
      mainKeys: displayModeMenu,
      optionKeys: `${down}${down}${down}${enter}`,
      submenuText: "How should the footer value be shown?",
      expectText: "ChatGPT footer mode: Pace percent, e.g. WP -13%",
      expectedConfig: {
        quotaWindow: "weekly",
        displayMode: "paceCompact",
        footerPosition: "second",
      },
    },
    {
      name: "pace percent with reset",
      mainKeys: displayModeMenu,
      optionKeys: `${down}${down}${down}${down}${enter}`,
      submenuText: "How should the footer value be shown?",
      expectText:
        "ChatGPT footer mode: Pace percent with reset, e.g. WP -13% · ~2d",
      expectedConfig: {
        quotaWindow: "weekly",
        displayMode: "paceResetCompact",
        footerPosition: "second",
      },
    },
    {
      name: "remaining percent",
      mainKeys: displayModeMenu,
      optionKeys: `${down}${down}${down}${down}${down}${enter}`,
      submenuText: "How should the footer value be shown?",
      expectText: "ChatGPT footer mode: Remaining percent, e.g. W 58% left",
      expectedConfig: {
        quotaWindow: "weekly",
        displayMode: "remaining",
        footerPosition: "second",
      },
    },
    {
      name: "remaining percent with reset",
      mainKeys: displayModeMenu,
      optionKeys: `${down}${down}${down}${down}${down}${down}${enter}`,
      submenuText: "How should the footer value be shown?",
      expectText:
        "ChatGPT footer mode: Remaining percent with reset, e.g. W 58% left · ~2d",
      expectedConfig: {
        quotaWindow: "weekly",
        displayMode: "remainingCompact",
        footerPosition: "second",
      },
    },
    {
      name: "first footer line",
      mainKeys: footerPositionMenu,
      optionKeys: `${up}${enter}`,
      submenuText: "Where should the ChatGPT limit be shown?",
      expectText: "ChatGPT footer position: First line, right aligned",
      expectedConfig: {
        quotaWindow: "weekly",
        displayMode: "used",
        footerPosition: "first",
      },
    },
    {
      name: "third footer line",
      mainKeys: footerPositionMenu,
      optionKeys: `${down}${enter}`,
      submenuText: "Where should the ChatGPT limit be shown?",
      expectText: "ChatGPT footer position: Third line, right aligned",
      expectedConfig: {
        quotaWindow: "weekly",
        displayMode: "used",
        footerPosition: "third",
      },
    },
  ]

  for (const testCase of cases) {
    await t.test(testCase.name, async () => {
      const token = fakeJwt({
        "https://api.openai.com/auth": { chatgpt_account_id: "acct_config" },
      })
      const server = await startUsageServer((_req, res) => {
        sendUsageResponse(res)
      })

      try {
        await runRealPiTuiExpect({
          baseUrl: server.baseUrl,
          apiKey: token,
          mainKeys: testCase.mainKeys,
          optionKeys: testCase.optionKeys,
          submenuText: testCase.submenuText,
          expectText: testCase.expectText,
          expectedConfig: testCase.expectedConfig,
        })
      } finally {
        await server.close()
      }
    })
  }
})

test("real pi TUI still fetches usage when PI_OFFLINE is set", async () => {
  const token = fakeJwt({
    "https://api.openai.com/auth": { chatgpt_account_id: "acct_offline" },
  })

  const server = await startUsageServer((_req, res) => {
    sendUsageResponse(res, {
      fiveHourUsed: 1,
      fiveHourResetSeconds: 3600,
      weeklyResetSeconds: 86400,
    })
  })

  try {
    const { output } = await runRealPiTui({
      baseUrl: server.baseUrl,
      apiKey: token,
      extraEnv: { PI_OFFLINE: "1" },
    })

    assert.ok(
      server.requests.length > 0,
      `expected usage fetch even when PI_OFFLINE=1; output was:\n${output}`,
    )
  } finally {
    await server.close()
  }
})
