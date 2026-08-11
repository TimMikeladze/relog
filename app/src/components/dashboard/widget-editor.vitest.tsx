import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { WidgetEditor } from "./widget-editor";

// Mock apiPost so the editor's preview fetch doesn't hit the network.
vi.mock("@/api/client", () => ({
	apiPost: vi.fn(async () => ({ rows: [{ value: 1 }], count: 1, time_ms: 0 })),
}));

// CodeMirror is noisy under jsdom — mock EditorView to a no-op and let
// SQL stay at its initial useState value via the default.
vi.mock("@codemirror/view", async () => {
	const actual = await vi.importActual<typeof import("@codemirror/view")>("@codemirror/view");
	class NoopView {
		dom: HTMLDivElement;
		constructor() {
			this.dom = document.createElement("div");
		}
		destroy() {}
	}
	// Only the constructor is stubbed. The static extension builders stay real:
	// `sql-editor-theme` calls `EditorView.theme(...)` at module scope, so
	// dropping them makes the module fail to import at all.
	return {
		...actual,
		EditorView: Object.assign(NoopView, {
			updateListener: actual.EditorView.updateListener,
			theme: actual.EditorView.theme.bind(actual.EditorView),
			lineWrapping: actual.EditorView.lineWrapping,
		}),
	};
});

describe("WidgetEditor", () => {
	const baseProps = {
		filterFrom: 0,
		filterTo: 1000,
		dashboardId: "logs",
		variables: [{ name: "service", type: "select" as const }],
		values: { service: "" },
		onCancel: vi.fn(),
		onSave: vi.fn(async () => {}),
	};

	beforeEach(() => {
		vi.clearAllMocks();
	});

	test("rejects empty name on save", async () => {
		render(<WidgetEditor {...baseProps} />);
		const idInput = screen.getByLabelText("ID") as HTMLInputElement;
		fireEvent.change(idInput, { target: { value: "my-widget" } });
		fireEvent.click(screen.getByRole("button", { name: /save/i }));
		expect(baseProps.onSave).not.toHaveBeenCalled();
		// "Name required" also propagates into the preview renderer, so expect >=1.
		expect(screen.getAllByText(/name required/i).length).toBeGreaterThan(0);
	});

	test("rejects invalid id characters", async () => {
		render(<WidgetEditor {...baseProps} />);
		const idInput = screen.getByLabelText("ID") as HTMLInputElement;
		fireEvent.change(idInput, { target: { value: "bad id!" } });
		const nameInput = screen.getByLabelText("Name") as HTMLInputElement;
		fireEvent.change(nameInput, { target: { value: "X" } });
		fireEvent.click(screen.getByRole("button", { name: /save/i }));
		expect(baseProps.onSave).not.toHaveBeenCalled();
		expect(screen.getAllByText(/invalid id/i).length).toBeGreaterThan(0);
	});

	test("surfaces options JSON parse error inline", async () => {
		const { container } = render(<WidgetEditor {...baseProps} />);
		// Label wraps textarea; find it via DOM since label has no htmlFor hook.
		const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
		expect(textarea).not.toBeNull();
		fireEvent.change(textarea, { target: { value: "{not-valid-json" } });
		// Error appears inline somewhere in the document.
		expect(screen.getAllByText((t) => /expected|unexpected|json/i.test(t)).length).toBeGreaterThan(
			0,
		);
	});

	test("save fires with expected payload", async () => {
		const onSave = vi.fn(async () => {});
		render(<WidgetEditor {...baseProps} onSave={onSave} />);
		fireEvent.change(screen.getByLabelText("ID"), { target: { value: "good-id" } });
		fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Good" } });
		fireEvent.click(screen.getByRole("button", { name: /save/i }));
		// Save now runs an async EXPLAIN against the server before invoking
		// onSave; wait for the mocked apiPost promise chain to settle.
		await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
		expect(onSave).toHaveBeenCalledWith(
			expect.objectContaining({
				id: "good-id",
				name: "Good",
				kind: "stat",
				builtin: false,
			}),
		);
	});
});
