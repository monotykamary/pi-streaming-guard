# pi-streaming-guard

A temporary [Pi](https://github.com/earendil-works/pi) extension that keeps the TUI responsive while long assistant messages are streaming.

Pi 0.82.x rebuilds assistant Markdown components and rerenders all accumulated Markdown for every streamed delta. The work grows with the complete response on every frame. This extension preserves Pi's output while reusing assistant Markdown components and cached top-level Markdown tokens.

This compatibility shim is intended to be removed after the equivalent fix reaches Pi upstream.

## Compatibility

- Pi `0.82.x`
- Node.js `22.19.0` or newer
- Interactive TUI mode only

The extension fails closed on unsupported Pi versions rather than patching unknown internals.

## Install

Try the local checkout for one invocation:

```bash
pi -e /path/to/pi-streaming-guard
```

Install the local package:

```bash
pi install /path/to/pi-streaming-guard
```

## Commands

```text
/streaming-guard          Show current status
/streaming-guard on       Enable the guard for this session
/streaming-guard off      Disable the guard for this session
```

The guard is enabled by default in TUI sessions. It restores Pi's original prototypes during session shutdown and reload.

## What it changes

The extension temporarily patches two classes exported by Pi:

- `AssistantMessageComponent` retains compatible `Markdown` children between deltas.
- `Markdown` caches rendered top-level tokens whose source, following token type, reference-link context, and width are unchanged.

Reference-style link definitions invalidate the token cache because Marked resolves them through document-wide state. Theme invalidation also clears all extension caches.

A single enormous paragraph, list, or fenced code block is still one top-level Markdown token and must be rerendered in full. The upstream fix may additionally use lightweight rendering while thinking is live.

## Development

```bash
pnpm install
pnpm validate
pnpm benchmark
```

## License

MIT
