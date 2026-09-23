# pi-chatgpt-limit

A [pi](https://pi.dev) extension that shows your ChatGPT Codex subscription usage inline in the footer.

It displays configurable ChatGPT Pro/Codex usage next to the active Codex model, and provides a command for detailed 5-hour and weekly usage windows.

## Preview

Example footer with the default weekly quota display:

```txt
~/project (main)
T35k 4.2%/272k                    gpt-5.5 • W 42%
```

### Quota windows

| Setting                | Footer example       |
| ---------------------- | -------------------- |
| Weekly usage (default) | `W 42%`              |
| 5-hour usage           | `5h 25%`             |
| Both                   | `5h 25% / W 42%`     |
| Hidden                 | No quota information |

### Display modes

| Mode                         | Example            |
| ---------------------------- | ------------------ |
| Used percent                 | `W 42%`            |
| Used percent with reset      | `W 42% · ~2d`      |
| Pace percent with state      | `WP 13% (reserve)` |
| Pace percent                 | `WP -13%`          |
| Pace percent with reset      | `WP -13% · ~2d`    |
| Remaining percent            | `W 58% left`       |
| Remaining percent with reset | `W 58% left · ~2d` |

Pace modes apply to the weekly quota. When both quota windows are displayed, the 5-hour window continues to show its used percentage:

```txt
5h 25% / WP -13%
```

### Footer position

Quota information can be placed on any of the three footer lines.

**First line**

```txt
~/project (main)                               W 42%
T35k 4.2%/272k                              gpt-5.5
```

**Second line (default)**

```txt
~/project (main)
T35k 4.2%/272k                    gpt-5.5 • W 42%
```

**Third line**

```txt
~/project (main)
T35k 4.2%/272k                              gpt-5.5
                                                W 42%
```

### Usage color thresholds

Quota colors are based on the percentage already used:

|     Usage | Theme color |
| --------: | ----------- |
|   `< 80%` | `dim`       |
|  `80–89%` | `warning`   |
| `90–100%` | `error`     |

The same thresholds apply regardless of whether the displayed value uses used, remaining, reset, or pace formatting.

## Install

```sh
pi install git:https://github.com/erathaowl/pi-chatgpt-limit
```

Then reload pi:

```txt
/reload
```

## Usage

The footer percentage appears only while using an `openai-codex` model authenticated via pi's `/login` flow.

For details, run `/chatgpt-limit` and choose **Show current usage details**, or print the same details directly without opening a menu:

```txt
/chatgpt-limit-usage
```

The direct command returns focus to the prompt immediately. The details include:

- plan
- account email when available
- 5-hour usage window
- weekly usage window
- reset times

### Footer configuration

The `/chatgpt-limit` menu configures the ChatGPT quota display:

- show weekly usage (default), 5-hour usage, both, or hide usage
- show used percent, used percent with reset, pace, remaining percent, or reset-aware variants
- place usage right-aligned on the first line, right-aligned on the second line (default), or right-aligned on a new third line
- reset footer settings to defaults

Examples:

- `W 42%`
- `W 42% · ~2d`
- `WP 13% (reserve)`
- `WP -13%`
- `WP -13% · ~2d`
- `W 58% left`
- `W 58% left · ~2d`
- `5h 25% / W 42%`

Use the dedicated standard-footer command to switch between Pi's default layout and a custom set of fields:

```txt
/chatgpt-limit-footer
```

It can independently show or hide the working directory, Git branch, session name, input/output/total/cache tokens, cost, subscription marker, context usage, provider, model, and thinking level.

#### Other providers

By default, `pi-chatgpt-limit` replaces Pi's footer only when the active provider is `openai-codex`. Other providers continue to use Pi's native footer. To use the configured standard footer with every provider, choose:

```txt
/chatgpt-limit-footer
→ Other providers
→ Enabled
```

The change applies immediately, as do later provider/model switches; `/reload` is not required. ChatGPT quota information is never shown for other providers, even when an old OpenAI usage snapshot is available.

For example, with the option disabled, an `openai-codex` model can show:

```txt
~/project (main)
T35k 4.2%/272k                    gpt-5.5 • W 42%
```

Switching to another provider restores Pi's native footer. With **Other providers** enabled, that provider instead uses the configured standard fields without quota output:

```txt
~/project (main)
T35k 4.2%/128k                      qwen3-coder
```

No `W`, `5h`, `WP`, or quota reset fragment is added for a non-`openai-codex` provider, regardless of the configured quota position.

#### Interactive standard-footer editor

Choose **Standard footer fields** to open a persistent checklist:

```txt
Standard footer fields
Mode: Custom

  [x] Working directory
  [x] Git branch
  [x] Session name
  [ ] Input tokens
  [ ] Output tokens
› [x] Total tokens
  [ ] Cache read tokens
  [ ] Cache write tokens
  [ ] Cost
  [ ] Subscription marker
  [x] Context usage
  [ ] Provider
  [x] Model
  [x] Thinking level

↑↓ navigate • space toggle • enter save • esc cancel
```

Controls:

| Key    | Action                       |
| ------ | ---------------------------- |
| ↑ / ↓  | Navigate                     |
| Space  | Toggle the selected field    |
| Enter  | Save all changes and close   |
| Esc    | Cancel all changes and close |
| Ctrl+C | Cancel all changes and close |

Space updates a checkbox without leaving the menu, so you can edit several fields in one visit. The footer preview updates immediately, but only Enter persists the final changes. Esc or Ctrl+C discards the entire draft and restores the previous footer.

Opening the editor in Default mode displays the canonical Pi defaults and does not itself switch modes. Saving a changed default field switches to Custom mode. If every field is returned to its initial default value before saving, the footer remains in Default mode. A footer already in Custom mode remains Custom.

For example, enable only **Total tokens** and **Context usage** in Custom mode for a compact statistics line:

```txt
T35k 4.2%/272k
```

This means Total tokens and Context usage are enabled and all other standard fields are disabled. **Total tokens = input + output**; cache reads and cache writes are excluded. ChatGPT quota placement is configured independently and can remain on the first, second, or third footer line.

Settings persist globally in `~/.pi/agent/chatgpt-limit.json`, so the same footer preference applies across pi sessions. The file uses this structure:

```json
{
  "quotaWindow": "weekly",
  "displayMode": "used",
  "footerPosition": "second",
  "standardFooter": {
    "mode": "custom",
    "showForOtherProviders": false,
    "workingDirectory": false,
    "gitBranch": false,
    "sessionName": false,
    "inputTokens": false,
    "outputTokens": false,
    "totalTokens": true,
    "cacheReadTokens": false,
    "cacheWriteTokens": false,
    "cost": false,
    "subscriptionMarker": false,
    "contextUsage": true,
    "provider": false,
    "model": false,
    "thinkingLevel": false
  }
}
```

Set `footerPosition` to `first`, `second`, or `third`. Missing or invalid settings fall back to the standard Pi-style footer. `showForOtherProviders` accepts only a boolean and defaults to `false`.

A minimal input can enable the custom footer on other providers while selecting a few fields:

```json
{
  "standardFooter": {
    "mode": "custom",
    "showForOtherProviders": true,
    "totalTokens": true,
    "contextUsage": true
  }
}
```

The persisted file is normalized and contains the complete standard-footer structure. Editing or canceling the visual-field checklist preserves `showForOtherProviders`. Selecting **Reset to Pi defaults** restores the canonical field set, Default mode, and `showForOtherProviders: false`; when another provider is active, Pi's native footer is restored immediately.

## Notes

This extension calls ChatGPT's usage endpoint:

```txt
GET https://chatgpt.com/backend-api/wham/usage
```

It uses the OAuth token already stored by pi for the active `openai-codex` provider.

Extensions run with local user permissions and can access pi auth storage. Review extensions before installing them.

## Contributing

See [CONTRIBUTING.md](https://github.com/erathaowl/pi-chatgpt-limit/blob/main/CONTRIBUTING.md) for development setup, PR expectations, and commit message guidance.

## Release

See [RELEASE.md](https://github.com/erathaowl/pi-chatgpt-limit/blob/main/RELEASE.md) for the release checklist, GitHub release publishing, npm verification, and announcement steps.

## License

MIT

## About this fork

This package is a fork of
[patlux/pi-chatgpt-limit](https://github.com/patlux/pi-chatgpt-limit).

It includes additional features and changes maintained independently under
the `@erathaowl` npm scope.

The original project is Copyright © its original authors and is distributed
under the MIT License.
