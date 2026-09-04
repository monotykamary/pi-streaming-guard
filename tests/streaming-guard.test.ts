import type { AssistantMessage } from "@earendil-works/pi-ai";
import { AssistantMessageComponent, getMarkdownTheme, initTheme } from "@earendil-works/pi-coding-agent";
import { Markdown } from "@earendil-works/pi-tui";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
	getStreamingGuardStatus,
	installStreamingGuard,
	isSupportedPiVersion,
	type StreamingGuardHandle,
} from "../src/patch.js";

const handles: StreamingGuardHandle[] = [];

function install(): StreamingGuardHandle {
	const handle = installStreamingGuard();
	handles.push(handle);
	return handle;
}

function message(thinking: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "thinking", thinking }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "streaming-guard-test",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: 0,
	};
}

function collectMarkdown(component: unknown): Markdown[] {
	if (component instanceof Markdown) return [component];
	if (typeof component !== "object" || component === null || !("child" in component)) return [];
	return collectMarkdown((component as { child: unknown }).child);
}

function markdownChildren(component: AssistantMessageComponent): Markdown[] {
	const assistant = component as unknown as { contentContainer: { children: unknown[] } };
	return assistant.contentContainer.children.flatMap(collectMarkdown);
}

beforeAll(() => {
	initTheme("dark");
});

afterEach(() => {
	for (const handle of handles.splice(0)) handle.dispose();
});

describe("streaming guard", () => {
	it("supports only the Pi release family it patches", () => {
		expect(isSupportedPiVersion("0.82.0")).toBe(true);
		expect(isSupportedPiVersion("0.82.9-beta.1")).toBe(true);
		expect(isSupportedPiVersion("0.83.0")).toBe(true);
		expect(isSupportedPiVersion("0.83.1-beta.1")).toBe(true);
		expect(isSupportedPiVersion("0.84.0")).toBe(true);
		expect(isSupportedPiVersion("0.84.1-beta.1")).toBe(true);
		expect(isSupportedPiVersion("0.85.0")).toBe(true);
		expect(isSupportedPiVersion("0.85.1-beta.1")).toBe(true);
		expect(isSupportedPiVersion("0.81.9")).toBe(false);
		expect(isSupportedPiVersion("0.86.0")).toBe(false);
	});

	it("reference-counts installs and restores the original prototypes", () => {
		const originalRender = Markdown.prototype.render;
		const originalUpdate = AssistantMessageComponent.prototype.updateContent;
		const first = install();
		const second = install();

		expect(Markdown.prototype.render).not.toBe(originalRender);
		expect(AssistantMessageComponent.prototype.updateContent).not.toBe(originalUpdate);
		expect(getStreamingGuardStatus().consumers).toBe(2);

		first.dispose();
		expect(Markdown.prototype.render).not.toBe(originalRender);
		expect(getStreamingGuardStatus().consumers).toBe(1);

		second.dispose();
		expect(Markdown.prototype.render).toBe(originalRender);
		expect(AssistantMessageComponent.prototype.updateContent).toBe(originalUpdate);
		expect(getStreamingGuardStatus().active).toBe(false);
	});

	it("retains compatible assistant Markdown components between deltas", () => {
		install();
		const component = new AssistantMessageComponent(message("First paragraph."));
		const first = markdownChildren(component);
		expect(first).toHaveLength(1);

		component.updateContent(message("First paragraph. More thinking."));
		const second = markdownChildren(component);
		expect(second).toHaveLength(1);
		expect(second[0]).toBe(first[0]);
	});

	it("matches fresh Markdown rendering for every streamed prefix", () => {
		const source = [
			"# Heading with **bold** and `code`",
			"",
			"Paragraph with [reference] and ~~strike~~.",
			"",
			"- one",
			"- two",
			"  - nested",
			"",
			"> quote with *emphasis*",
			"",
			"[reference]: https://example.com",
		].join("\n");
		const theme = getMarkdownTheme();
		const expected: string[][] = [];
		for (let end = 0; end <= source.length; end++) {
			expected.push(new Markdown(source.slice(0, end), 1, 0, theme).render(47));
		}

		install();
		const reused = new Markdown("", 1, 0, theme);
		for (let end = 0; end <= source.length; end++) {
			reused.setText(source.slice(0, end));
			expect(reused.render(47)).toEqual(expected[end]);
		}
	});

	it("matches fresh rendering across randomized Markdown prefixes", () => {
		let seed = 0x5eed1234;
		const random = (): number => {
			seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
			return seed / 2 ** 32;
		};
		const atoms = [
			"word",
			" ",
			"\n",
			"\n\n",
			"*",
			"**",
			"_",
			"`",
			"~",
			"~~",
			"- ",
			"1. ",
			"> ",
			"# ",
			"[ref]",
			"[ref]: https://example.com",
			"$x^2 + y^2$",
			String.raw`\[a \le b\]`,
			"|",
			"---",
		];
		const theme = getMarkdownTheme();

		for (let sample = 0; sample < 25; sample++) {
			let source = "";
			for (let index = 0; index < 50; index++) {
				source += atoms[Math.floor(random() * atoms.length)] ?? "";
			}
			const width = 20 + Math.floor(random() * 80);
			const expected: string[][] = [];
			for (let end = 0; end <= source.length; end++) {
				expected.push(new Markdown(source.slice(0, end), 1, 0, theme).render(width));
			}

			const handle = install();
			const reused = new Markdown("", 1, 0, theme);
			for (let end = 0; end <= source.length; end++) {
				reused.setText(source.slice(0, end));
				expect(reused.render(width)).toEqual(expected[end]);
			}
			handle.dispose();
		}
	});

	it("preserves transformed and LaTeX Markdown rendering", () => {
		const source = "Inline $x^2 + y^2$ math.\n\n$$\\sum_{i=1}^n i$$";
		const theme = getMarkdownTheme();
		const options = { transform: (text: string) => `## Transformed\n\n${text}` };
		const expected = new Markdown(source, 1, 0, theme, undefined, options).render(58);

		install();
		const guarded = new Markdown(source, 1, 0, theme, undefined, options);
		expect(guarded.render(58)).toEqual(expected);
	});

	it("clears incremental state when invalidated", () => {
		install();
		const theme = getMarkdownTheme();
		const markdown = new Markdown("One paragraph.\n\nSecond paragraph.", 1, 0, theme);
		const initial = markdown.render(60);
		markdown.invalidate();
		expect(markdown.render(60)).toEqual(initial);
	});
});
