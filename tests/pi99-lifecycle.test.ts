import { getMarkdownTheme, initTheme } from "@earendil-works/pi-coding-agent";
import { Markdown } from "@earendil-works/pi-tui";
import { afterEach, beforeAll, expect, it } from "vitest";
import extension from "../src/index.js";
import { getStreamingGuardStatus, installStreamingGuard } from "../src/patch.js";

let dispose: (() => void) | undefined;
beforeAll(() => initTheme("dark", false));
afterEach(() => {
	dispose?.();
	dispose = undefined;
});
it("installs only in TUI, restores and reinstalls after shutdown", async () => {
	type Context = { mode: string; ui: { notify(message: string): void } };
	type Handler = (event: unknown, ctx: Context) => void;
	const handlers = new Map<string, Handler>();
	extension({
		on: (n: string, f: Handler) => handlers.set(n, f),
		registerCommand() {},
	} as unknown as Parameters<typeof extension>[0]);
	const ctx = {
		mode: "tui",
		ui: {
			notify(message: string) {
				throw new Error(message);
			},
		},
	};
	const start = handlers.get("session_start");
	const shutdown = handlers.get("session_shutdown");
	if (!start || !shutdown) throw new Error("Missing lifecycle registration");
	dispose = () => shutdown({}, ctx);
	start({}, { ...ctx, mode: "rpc" });
	expect(getStreamingGuardStatus().active).toBe(false);
	for (let i = 0; i < 2; i++) {
		start({}, ctx);
		expect(getStreamingGuardStatus()).toMatchObject({ active: true, supported: true, piVersion: "0.99.0" });
		dispose();
		expect(getStreamingGuardStatus().active).toBe(false);
	}
});
it("matches native rendering across resize, Unicode and theme invalidation", () => {
	const text = "## 界 🙂\n\n**bold**\n\n> nested *quote*\n\n- first\n- second";
	const widths = [12, 37, 80, 12];
	const expected = widths.map((w) => new Markdown(text, 1, 0, getMarkdownTheme()).render(w));
	const handle = installStreamingGuard();
	dispose = () => handle.dispose();
	const markdown = new Markdown(text, 1, 0, getMarkdownTheme());
	widths.forEach((width, i) => {
		markdown.invalidate();
		expect(markdown.render(width)).toEqual(expected[i]);
	});
	initTheme("light", false);
	markdown.invalidate();
	handle.dispose();
	const native = new Markdown(text, 1, 0, getMarkdownTheme()).render(37);
	const next = installStreamingGuard();
	dispose = () => next.dispose();
	expect(new Markdown(text, 1, 0, getMarkdownTheme()).render(37)).toEqual(native);
	initTheme("dark", false);
});
