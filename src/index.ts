import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getStreamingGuardStatus, installStreamingGuard, type StreamingGuardHandle } from "./patch.js";

export default function streamingGuardExtension(pi: ExtensionAPI): void {
	let enabled = true;
	let handle: StreamingGuardHandle | undefined;

	const activate = (ctx: ExtensionContext, reportErrors: boolean): void => {
		if (!enabled || handle || ctx.mode !== "tui") return;
		try {
			handle = installStreamingGuard();
		} catch (error) {
			if (reportErrors) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(message, "warning");
			}
		}
	};

	const deactivate = (): void => {
		handle?.dispose();
		handle = undefined;
	};

	pi.on("session_start", (_event, ctx) => {
		activate(ctx, true);
	});

	pi.on("session_shutdown", () => {
		deactivate();
	});

	pi.registerCommand("streaming-guard", {
		description: "Show, enable, or disable the temporary streaming render guard",
		handler: async (args, ctx) => {
			const action = args.trim().toLowerCase() || "status";
			if (action === "on") {
				enabled = true;
				activate(ctx, true);
				ctx.ui.notify(
					handle ? "Streaming guard enabled" : "Streaming guard is unavailable",
					handle ? "info" : "warning",
				);
				return;
			}
			if (action === "off") {
				enabled = false;
				deactivate();
				ctx.ui.notify("Streaming guard disabled", "info");
				return;
			}
			if (action !== "status") {
				ctx.ui.notify("Usage: /streaming-guard [status|on|off]", "warning");
				return;
			}

			const status = getStreamingGuardStatus();
			const state = handle ? "enabled" : enabled ? "unavailable" : "disabled";
			ctx.ui.notify(`Streaming guard: ${state} (Pi ${status.piVersion})`, status.supported ? "info" : "warning");
		},
	});
}
