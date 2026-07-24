import { performance } from "node:perf_hooks";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { AssistantMessageComponent, initTheme } from "@earendil-works/pi-coding-agent";
import { installStreamingGuard } from "../src/patch.js";

const unit = "I am checking the implementation, comparing **state transitions**, and tracing `render()` costs.\n\n";

function textOf(length: number): string {
	return unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
}

function message(thinking: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "thinking", thinking }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "streaming-guard-benchmark",
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

function measure(length: number): number {
	const base = textOf(length);
	const component = new AssistantMessageComponent(message(base.slice(0, -1)));
	component.render(120);
	for (let index = 0; index < 5; index++) {
		component.updateContent(message(base + String(index % 10)));
		component.render(120);
	}
	global.gc?.();
	const iterations = length >= 100_000 ? 30 : 60;
	const start = performance.now();
	for (let index = 0; index < iterations; index++) {
		component.updateContent(message(base + String(index % 10)));
		component.render(120);
	}
	return (performance.now() - start) / iterations;
}

initTheme("dark");
const lengths = [5_000, 20_000, 50_000, 100_000];
const baseline = new Map(lengths.map((length) => [length, measure(length)]));
const handle = installStreamingGuard();
try {
	console.log("chars\tbaseline ms\tguarded ms\tspeedup");
	for (const length of lengths) {
		const guarded = measure(length);
		const current = baseline.get(length) ?? 0;
		console.log(`${length}\t${current.toFixed(3)}\t\t${guarded.toFixed(3)}\t\t${(current / guarded).toFixed(1)}x`);
	}
} finally {
	handle.dispose();
}
