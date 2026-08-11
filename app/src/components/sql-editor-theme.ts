import { HighlightStyle } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

/**
 * CodeMirror styling derived from the app's own tokens.
 *
 * Replaces `@codemirror/theme-one-dark`, which shipped its own `#282c34`
 * background and slate selection colours — a blue-grey slab sitting on a
 * near-black app. Everything here is a CSS variable, so the editor follows the
 * theme instead of being painted for one of them.
 */
export const sqlEditorTheme = EditorView.theme({
	"&": {
		fontSize: "12px",
		maxHeight: "220px",
		color: "var(--color-foreground)",
		backgroundColor: "transparent",
	},
	".cm-scroller": {
		overflow: "auto",
		fontFamily: "var(--font-mono)",
		lineHeight: "1.6",
	},
	".cm-content": {
		fontFamily: "var(--font-mono)",
		padding: "10px 0",
		caretColor: "var(--color-primary)",
	},
	".cm-gutters": {
		backgroundColor: "transparent",
		border: "none",
		color: "var(--color-muted-foreground)",
	},
	"&.cm-focused": { outline: "none" },
	".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--color-primary)" },
	// The active line is a hairline tint, not a full-width slab. One Dark's
	// version was the loudest element on the whole Query view.
	".cm-activeLine": {
		backgroundColor: "color-mix(in oklch, var(--color-foreground) 4%, transparent)",
	},
	".cm-activeLineGutter": { backgroundColor: "transparent" },
	"&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
		backgroundColor: "color-mix(in oklch, var(--color-primary) 28%, transparent)",
	},
	".cm-selectionMatch": {
		backgroundColor: "color-mix(in oklch, var(--color-primary) 18%, transparent)",
	},
	".cm-matchingBracket, &.cm-focused .cm-matchingBracket": {
		backgroundColor: "color-mix(in oklch, var(--color-primary) 22%, transparent)",
		outline: "none",
	},
	".cm-placeholder": { color: "var(--color-muted-foreground)" },
	".cm-tooltip": {
		background: "var(--color-popover)",
		border: "1px solid var(--color-border)",
		borderRadius: "6px",
		color: "var(--color-popover-foreground)",
	},
	".cm-tooltip-autocomplete > ul > li[aria-selected]": {
		background: "var(--color-accent)",
		color: "var(--color-accent-foreground)",
	},
});

/**
 * Syntax colours drawn from the validated categorical slots, so the editor
 * uses the same hues as the charts rather than a second, unrelated palette.
 * Both themes re-step automatically because the slots are theme-scoped vars.
 */
export const sqlHighlightStyle = HighlightStyle.define([
	{ tag: [t.keyword, t.operatorKeyword, t.modifier], color: "var(--series-7)", fontWeight: "600" },
	{ tag: [t.string, t.special(t.string)], color: "var(--series-3)" },
	{ tag: [t.number, t.bool, t.null], color: "var(--series-2)" },
	{ tag: [t.function(t.variableName), t.function(t.propertyName)], color: "var(--series-1)" },
	{ tag: [t.typeName, t.className], color: "var(--series-6)" },
	{ tag: [t.propertyName, t.attributeName], color: "var(--series-5)" },
	{
		tag: [t.comment, t.lineComment, t.blockComment],
		color: "var(--color-muted-foreground)",
		fontStyle: "italic",
	},
	{
		tag: [t.operator, t.punctuation, t.separator, t.bracket],
		color: "var(--color-muted-foreground)",
	},
	{ tag: t.variableName, color: "var(--color-foreground)" },
	{ tag: t.invalid, color: "var(--color-destructive)" },
]);
