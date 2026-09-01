# pi-chatgpt-limit

A [pi](https://pi.dev) extension that shows your ChatGPT Codex subscription usage inline in the footer.

It displays configurable ChatGPT Pro/Codex usage next to the active Codex model, and provides a command for detailed 5-hour and weekly usage windows.

## Preview

![Footer preview](https://github.com/patlux/pi-chatgpt-limit/releases/download/preview-assets/footer-preview.png)

Footer display variants and color thresholds:

![Footer display variants and color thresholds](https://github.com/patlux/pi-chatgpt-limit/releases/download/preview-assets/footer-variants-readable.png)

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

For details, run:

```txt
/chatgpt-limit
```

This shows:

- plan
- account email when available
- 5-hour usage window
- weekly usage window
- reset times

### Footer configuration

The `/chatgpt-limit` menu configures the ChatGPT quota display:

- show weekly usage (default), 5-hour usage, both, or hide usage
- show used percent, used percent with reset, remaining percent, or remaining percent with reset
- place usage right-aligned on the first line, right-aligned on the second line (default), or right-aligned on a new third line
- reset footer settings to defaults

Examples:

- `W 42%`
- `W 42% · ~2d`
- `W 58% left`
- `W 58% left · ~2d`
- `5h 25% / W 42%`

Use the dedicated standard-footer command to switch between Pi's default layout and a custom set of fields:

```txt
/chatgpt-limit-footer
```

It can independently show or hide the working directory, Git branch, session name, input/output/total/cache tokens, cost, subscription marker, context usage, provider, model, and thinking level. **Total tokens** is `input + output`; cache reads and cache writes are never included.

For example, enable only **Total tokens** and **Context usage** in Custom mode for a compact statistics line:

```txt
T35k 4.2%/272k
```

Settings persist globally in `~/.pi/agent/chatgpt-limit.json`, so the same footer preference applies across pi sessions. The file uses this structure:

```json
{
  "quotaWindow": "weekly",
  "displayMode": "used",
  "footerPosition": "second",
  "standardFooter": {
    "mode": "custom",
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

Set `footerPosition` to `first`, `second`, or `third`. Missing or invalid settings fall back to the standard Pi-style footer. Selecting **Reset to Pi defaults** restores the canonical field set regardless of previous custom toggles.

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
