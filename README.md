<div align="center">

# 🛡️ pi-streaming-guard

**Keep [Pi](https://github.com/earendil-works/pi) fast while long responses are still arriving.**

_Long thinking traces should not make your terminal feel slower._

[![npm version](https://img.shields.io/npm/v/pi-streaming-guard?style=for-the-badge&logo=npm&color=cb3837)](https://www.npmjs.com/package/pi-streaming-guard)
[![checks](https://img.shields.io/github/actions/workflow/status/monotykamary/pi-streaming-guard/test.yml?branch=main&style=for-the-badge&label=checks)](https://github.com/monotykamary/pi-streaming-guard/actions/workflows/test.yml)
[![pi extension](https://img.shields.io/badge/pi-extension-8b5cf6?style=for-the-badge)](https://github.com/earendil-works/pi)
[![license](https://img.shields.io/badge/license-MIT-f4c430?style=for-the-badge)](LICENSE)

</div>

---

You keep using Pi exactly the way you always do. Streaming Guard quietly keeps completed Markdown blocks around instead of asking Pi to parse, style, wrap, and pad the entire accumulated response again for every incoming delta. Long reasoning traces stay responsive, the rendered output stays the same, and there is nothing new to invoke while you work.

This is a focused compatibility bridge for Pi 0.82.x–0.83.x. It is meant to disappear once the equivalent rendering fix ships upstream.

## Why Streaming Guard?

|     | Behavior | What you get |
| :-: | -------- | ------------ |
| ⚡ | **Incremental rendering** | Completed Markdown blocks are reused while only changed blocks are rendered again. |
| 🧠 | **Same transcript** | Headings, lists, links, code, thinking styles, spacing, and terminal wrapping stay intact. |
| 🫥 | **Invisible by default** | No workflow changes, prompts, tools, or model instructions. Install it and keep using Pi. |
| 🔁 | **Reload safe** | Reference-counted patches are restored cleanly on `/reload`, session replacement, and shutdown. |
| 🧯 | **Fails closed** | Unknown Pi versions are never patched; the extension reports that it is unavailable instead. |

## How it works

1. **Pi streams normally.** Assistant and thinking content arrive through the existing message path.
2. **The guard retains stable work.** Compatible `Markdown` components survive updates, and unchanged top-level tokens keep their rendered terminal lines.
3. **Pi draws the same output with less work.** Reference-link changes, width changes, and theme invalidation still trigger the required rerenders.

The patch is intentionally narrow: it touches the exported `AssistantMessageComponent` and `Markdown` prototypes only in interactive TUI sessions, and restores both when the session runtime shuts down.

## Install

Requires Node.js 22.19+ and Pi 0.82.x or 0.83.x.

```bash
pi install npm:pi-streaming-guard
```

Then start Pi normally. The guard enables itself for interactive sessions.

<details>
<summary>Other install methods</summary>

From GitHub:

```bash
pi install git:github.com/monotykamary/pi-streaming-guard
```

From a local checkout:

```bash
bun install
pi install /absolute/path/to/pi-streaming-guard
```

For one development run:

```bash
pi -e /absolute/path/to/pi-streaming-guard
```

</details>

## Commands

| Command | Action |
| ------- | ------ |
| `/streaming-guard` | Show status and the detected Pi version. |
| `/streaming-guard on` | Enable the guard for the current session. |
| `/streaming-guard off` | Restore Pi's original renderers for the current session. |

## Performance

Representative assistant-component benchmark on a 120-column terminal:

| Accumulated Markdown | Pi 0.82.x | Guarded | Speedup |
| -------------------: | --------: | ------: | ------: |
| 5,000 characters | 0.64 ms | 0.21 ms | 3.0× |
| 20,000 characters | 2.33 ms | 0.72 ms | 3.2× |
| 50,000 characters | 5.23 ms | 1.75 ms | 3.0× |
| 100,000 characters | 10.63 ms | 3.53 ms | 3.0× |

Run `bun run benchmark` on your machine for local numbers. Actual frame time varies with terminal width, Markdown shape, syntax highlighting, and color support.

## Scope and limitations

Marked resolves reference-style links through document-wide state, so changing a reference definition invalidates the token cache. Theme changes and width changes also invalidate the relevant output.

One enormous paragraph, list, or fenced code block is still a single top-level Markdown token and must be rerendered in full. The durable upstream solution may additionally use lightweight rendering while thinking is live.

When a Pi release includes the upstream fix, this extension will refuse that new release until its compatibility range is deliberately reviewed. At that point, uninstall it with:

```bash
pi remove npm:pi-streaming-guard
```

## Development

```bash
bun install
bun run validate
bun run benchmark
```

The test suite covers prototype restoration, component reuse, document-wide link invalidation, theme invalidation, and thousands of deterministic streaming-prefix transitions. Release checks also smoke-test loading through Pi's real extension loader.

## License

MIT
