import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { LogEmptyState } from "./log-empty";

function renderEmpty(props: Partial<Parameters<typeof LogEmptyState>[0]> = {}) {
	const onUpdateFilters = vi.fn();
	const onClearFilters = vi.fn();
	render(
		<LogEmptyState
			filters={{}}
			onUpdateFilters={onUpdateFilters}
			onClearFilters={onClearFilters}
			{...props}
		/>,
	);
	return { onUpdateFilters, onClearFilters };
}

describe("LogEmptyState", () => {
	test("names the range and the filters that produced no rows", () => {
		renderEmpty({ filters: { from: "1h", level: "error,fatal", grep: "timeout" } });
		expect(screen.getByText("No logs found")).toBeInTheDocument();
		expect(screen.getByText(/last 1 hour/)).toBeInTheDocument();
		expect(screen.getByText(/level error, fatal and matching “timeout”/)).toBeInTheDocument();
	});

	// The screenshot that started this: a 1-minute window with no way to see
	// the window was the problem, let alone widen it.
	test("offers the next preset up from the current relative range", async () => {
		const { onUpdateFilters } = renderEmpty({ filters: { from: "1h" } });
		const widen = screen.getByRole("button", { name: "Widen to 3 hours" });
		widen.click();
		expect(onUpdateFilters).toHaveBeenCalledWith({ from: "3h", to: undefined });
	});

	test("offers all time when the range is absolute and has no wider preset", () => {
		const { onUpdateFilters } = renderEmpty({
			filters: { from: "2026-08-10T20:30:00.000Z", to: "2026-08-10T20:31:00.000Z" },
		});
		screen.getByRole("button", { name: "Search all time" }).click();
		expect(onUpdateFilters).toHaveBeenCalledWith({ from: undefined, to: undefined });
	});

	test("clears every filter on request", () => {
		const { onClearFilters } = renderEmpty({ filters: { from: "1h", service: "worker" } });
		screen.getByRole("button", { name: "Clear all filters" }).click();
		expect(onClearFilters).toHaveBeenCalled();
	});

	test("shows no recovery actions when nothing is filtered", () => {
		renderEmpty({ filters: {} });
		expect(screen.queryByRole("button")).toBeNull();
	});

	test("reports stream state instead of filters while live", () => {
		renderEmpty({ filters: { from: "1h" }, live: true, streamConnected: true });
		expect(screen.getByText("Waiting for logs…")).toBeInTheDocument();
		expect(screen.queryByText("No logs found")).toBeNull();
	});

	test("distinguishes a dropped live stream from an idle one", () => {
		renderEmpty({ filters: {}, live: true, streamConnected: false });
		expect(screen.getByText("Not connected")).toBeInTheDocument();
	});

	test("loading takes precedence over the empty message", () => {
		renderEmpty({ filters: { from: "1h" }, loading: true });
		expect(screen.getByText("Loading logs…")).toBeInTheDocument();
		expect(screen.queryByText("No logs found")).toBeNull();
	});
});
