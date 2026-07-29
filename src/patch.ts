import { AssistantMessageComponent, VERSION } from "@earendil-works/pi-coding-agent";
import { type Component, type Container, Markdown, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { Marked, type Token, Tokenizer, type Tokens } from "marked";

const STRICT_STRIKETHROUGH_REGEX = /^(~~)(?=[^\s~])((?:\\.|[^\\])*?(?:\\.|[^\s~\\]))\1(?=[^~]|$)/;
const PATCH_REGISTRY_KEY = Symbol.for("pi-streaming-guard.patch.v1");
const SUPPORTED_MAJOR = 0;
const MIN_SUPPORTED_MINOR = 82;
const MAX_SUPPORTED_MINOR = 83;

type AssistantMessage = Parameters<AssistantMessageComponent["updateContent"]>[0];
type StyleFunction = (text: string) => string;

interface DefaultTextStyleLike {
	color?: StyleFunction;
	bgColor?: StyleFunction;
	bold?: boolean;
	italic?: boolean;
	strikethrough?: boolean;
	underline?: boolean;
}

interface InternalMarkdown {
	text: string;
	paddingX: number;
	paddingY: number;
	defaultTextStyle?: DefaultTextStyleLike;
	theme: object;
	options: Record<string, unknown>;
	defaultStylePrefix: string | undefined;
	cachedText: string | undefined;
	cachedWidth: number | undefined;
	cachedLines: string[] | undefined;
	renderToken(token: Token, width: number, nextTokenType?: string): string[];
}

interface InternalAssistantMessageComponent {
	contentContainer: Container;
}

interface MarkdownPrototype {
	setText(this: Markdown, text: string): void;
	invalidate(this: Markdown): void;
	render(this: Markdown, width: number): string[];
	renderToken(token: Token, width: number, nextTokenType?: string): string[];
}

interface AssistantPrototype {
	updateContent(this: AssistantMessageComponent, message: AssistantMessage): void;
}

interface TokenRenderCache {
	raw: string;
	type: string;
	nextType: string | undefined;
	width: number;
	lines: string[];
}

interface MarkdownRenderState {
	linkSignature: string;
	tokens: TokenRenderCache[];
}

interface PatchRegistry {
	consumers: number;
	restore: () => void;
}

interface GlobalWithPatchRegistry {
	[PATCH_REGISTRY_KEY]?: PatchRegistry;
}

export interface StreamingGuardHandle {
	dispose(): void;
}

export interface StreamingGuardStatus {
	active: boolean;
	consumers: number;
	piVersion: string;
	supported: boolean;
}

class StrictStrikethroughTokenizer extends Tokenizer {
	override del(src: string): Tokens.Del | undefined {
		const match = STRICT_STRIKETHROUGH_REGEX.exec(src);
		if (!match) return undefined;

		const text = match[2];
		if (text === undefined) return undefined;
		return {
			type: "del",
			raw: match[0],
			text,
			tokens: this.lexer.inlineTokens(text),
		};
	}
}

const markdownParser = new Marked();
markdownParser.setOptions({
	tokenizer: new StrictStrikethroughTokenizer(),
});

function trimPartialClosingFences(tokens: readonly Token[]): void {
	const token = tokens[tokens.length - 1];
	if (token?.type === "list") {
		trimPartialClosingFences(token.items[token.items.length - 1]?.tokens ?? []);
		return;
	}
	if (token?.type === "blockquote") {
		trimPartialClosingFences(token.tokens ?? []);
		return;
	}
	if (token?.type !== "code") return;

	const marker = /^(`{3,}|~{3,})/.exec(token.raw)?.[1];
	const lastLine = token.raw.split("\n").pop();
	if (!marker || !lastLine || lastLine.length >= marker.length || lastLine !== marker[0]?.repeat(lastLine.length)) {
		return;
	}

	token.text = token.text.slice(0, -lastLine.length).replace(/\n$/, "");
}

function isImageLine(line: string): boolean {
	return line.includes("\u001b_G") || line.includes("\u001b]1337;File=");
}

function applyBackgroundToLine(line: string, width: number, background: StyleFunction): string {
	return background(line + " ".repeat(Math.max(0, width - visibleWidth(line))));
}

function internalMarkdown(markdown: Markdown): InternalMarkdown {
	return markdown as unknown as InternalMarkdown;
}

function clearRenderedOutput(markdown: InternalMarkdown): void {
	markdown.cachedText = undefined;
	markdown.cachedWidth = undefined;
	markdown.cachedLines = undefined;
}

function installMarkdownPatch(): () => void {
	const prototype = Markdown.prototype as unknown as MarkdownPrototype;
	if (typeof prototype.renderToken !== "function") {
		throw new Error("Pi Markdown internals are incompatible: renderToken() is unavailable");
	}

	const originalSetText = prototype.setText;
	const originalInvalidate = prototype.invalidate;
	const originalRender = prototype.render;
	const states = new WeakMap<Markdown, MarkdownRenderState>();

	prototype.setText = function setText(text: string): void {
		const markdown = internalMarkdown(this);
		if (markdown.text === text) return;
		markdown.text = text;
		clearRenderedOutput(markdown);
	};

	prototype.invalidate = function invalidate(): void {
		originalInvalidate.call(this);
		states.delete(this);
		internalMarkdown(this).defaultStylePrefix = undefined;
	};

	prototype.render = function render(width: number): string[] {
		const markdown = internalMarkdown(this);
		if (markdown.cachedLines && markdown.cachedText === markdown.text && markdown.cachedWidth === width) {
			return markdown.cachedLines;
		}

		const contentWidth = Math.max(1, width - markdown.paddingX * 2);
		if (!markdown.text || markdown.text.trim() === "") {
			const result: string[] = [];
			markdown.cachedText = markdown.text;
			markdown.cachedWidth = width;
			markdown.cachedLines = result;
			states.delete(this);
			return result;
		}

		const tokens = markdownParser.lexer(markdown.text.replace(/\t/g, "   "));
		trimPartialClosingFences(tokens);

		const leftMargin = " ".repeat(markdown.paddingX);
		const rightMargin = " ".repeat(markdown.paddingX);
		const background = markdown.defaultTextStyle?.bgColor;
		const linkSignature = JSON.stringify(tokens.links);
		const previousState = states.get(this);
		const previousTokens = previousState?.linkSignature === linkSignature ? previousState.tokens : [];
		const nextTokens: TokenRenderCache[] = [];
		const contentLines: string[] = [];

		for (let index = 0; index < tokens.length; index++) {
			const token = tokens[index];
			if (!token) continue;
			const nextType = tokens[index + 1]?.type;
			const cached = previousTokens[index];
			let lines: string[];

			if (
				cached &&
				cached.raw === token.raw &&
				cached.type === token.type &&
				cached.nextType === nextType &&
				cached.width === width
			) {
				lines = cached.lines;
			} else {
				const rendered = markdown.renderToken(token, contentWidth, nextType);
				const wrapped: string[] = [];
				for (const line of rendered) {
					if (isImageLine(line)) wrapped.push(line);
					else wrapped.push(...wrapTextWithAnsi(line, contentWidth));
				}

				lines = wrapped.map((line) => {
					if (isImageLine(line)) return line;
					const lineWithMargins = leftMargin + line + rightMargin;
					if (background) return applyBackgroundToLine(lineWithMargins, width, background);
					return lineWithMargins + " ".repeat(Math.max(0, width - visibleWidth(lineWithMargins)));
				});
			}

			nextTokens.push({ raw: token.raw, type: token.type, nextType, width, lines });
			contentLines.push(...lines);
		}

		states.set(this, { linkSignature, tokens: nextTokens });

		const emptyLine = " ".repeat(width);
		const emptyLines: string[] = [];
		for (let index = 0; index < markdown.paddingY; index++) {
			emptyLines.push(background ? applyBackgroundToLine(emptyLine, width, background) : emptyLine);
		}

		const result = emptyLines.concat(contentLines, emptyLines);
		markdown.cachedText = markdown.text;
		markdown.cachedWidth = width;
		markdown.cachedLines = result;
		return result.length > 0 ? result : [""];
	};

	return () => {
		prototype.setText = originalSetText;
		prototype.invalidate = originalInvalidate;
		prototype.render = originalRender;
	};
}

function styleShape(style: DefaultTextStyleLike | undefined): string {
	if (!style) return "none";
	return Object.entries(style)
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([key, value]) => `${key}:${typeof value === "function" ? "function" : JSON.stringify(value)}`)
		.join(",");
}

function installAssistantPatch(): () => void {
	const prototype = AssistantMessageComponent.prototype as unknown as AssistantPrototype;
	if (typeof prototype.updateContent !== "function") {
		throw new Error("Pi assistant internals are incompatible: updateContent() is unavailable");
	}

	const originalUpdateContent = prototype.updateContent;
	const retainedComponents = new WeakMap<AssistantMessageComponent, Markdown[]>();
	const objectIds = new WeakMap<object, number>();
	let nextObjectId = 1;

	const objectId = (value: object): number => {
		const existing = objectIds.get(value);
		if (existing !== undefined) return existing;
		const id = nextObjectId++;
		objectIds.set(value, id);
		return id;
	};

	const shape = (component: Markdown): string => {
		const markdown = internalMarkdown(component);
		return [
			markdown.paddingX,
			markdown.paddingY,
			objectId(markdown.theme),
			styleShape(markdown.defaultTextStyle),
			JSON.stringify(markdown.options),
		].join("|");
	};

	prototype.updateContent = function updateContent(message: AssistantMessage): void {
		const assistant = this as unknown as InternalAssistantMessageComponent;
		const previous = retainedComponents.get(this) ?? [];
		originalUpdateContent.call(this, message);

		const pools = new Map<string, Markdown[]>();
		for (const component of previous) {
			const key = shape(component);
			const pool = pools.get(key);
			if (pool) pool.push(component);
			else pools.set(key, [component]);
		}

		const retained: Markdown[] = [];
		assistant.contentContainer.children = assistant.contentContainer.children.map((child: Component) => {
			if (!(child instanceof Markdown)) return child;

			const replacement = pools.get(shape(child))?.shift();
			if (!replacement) {
				retained.push(child);
				return child;
			}

			replacement.setText(internalMarkdown(child).text);
			retained.push(replacement);
			return replacement;
		});
		retainedComponents.set(this, retained);
	};

	return () => {
		prototype.updateContent = originalUpdateContent;
	};
}

function applyPatches(): () => void {
	const restoreMarkdown = installMarkdownPatch();
	try {
		const restoreAssistant = installAssistantPatch();
		return () => {
			restoreAssistant();
			restoreMarkdown();
		};
	} catch (error) {
		restoreMarkdown();
		throw error;
	}
}

export function isSupportedPiVersion(version = VERSION): boolean {
	const [coreVersion] = version.split("-", 1);
	const [major, minor] = (coreVersion ?? "").split(".").map(Number);
	return (
		major === SUPPORTED_MAJOR && minor !== undefined && minor >= MIN_SUPPORTED_MINOR && minor <= MAX_SUPPORTED_MINOR
	);
}

export function getStreamingGuardStatus(): StreamingGuardStatus {
	const registry = (globalThis as GlobalWithPatchRegistry)[PATCH_REGISTRY_KEY];
	return {
		active: Boolean(registry && registry.consumers > 0),
		consumers: registry?.consumers ?? 0,
		piVersion: VERSION,
		supported: isSupportedPiVersion(),
	};
}

export function installStreamingGuard(): StreamingGuardHandle {
	if (!isSupportedPiVersion()) {
		throw new Error(`pi-streaming-guard supports Pi 0.82.x–0.83.x, but this process is running Pi ${VERSION}`);
	}

	const host = globalThis as GlobalWithPatchRegistry;
	let registry = host[PATCH_REGISTRY_KEY];
	if (!registry) {
		registry = { consumers: 0, restore: applyPatches() };
		host[PATCH_REGISTRY_KEY] = registry;
	}
	registry.consumers++;

	let disposed = false;
	return {
		dispose(): void {
			if (disposed) return;
			disposed = true;
			const current = host[PATCH_REGISTRY_KEY];
			if (!current) return;
			current.consumers = Math.max(0, current.consumers - 1);
			if (current.consumers > 0) return;
			current.restore();
			delete host[PATCH_REGISTRY_KEY];
		},
	};
}
