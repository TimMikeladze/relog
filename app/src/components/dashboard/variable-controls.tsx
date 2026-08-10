import type { DashboardVariable, VariableOption } from "@/types";

/**
 * Renders one input per declared dashboard variable.
 *
 * There is deliberately no per-variable special-casing here: the control is
 * chosen from `type`, its choices come from the declaration, and its value
 * flows back by name. Adding a new kind of filter to a dashboard is a data
 * change, not a code change — which is the whole point of declaring variables
 * rather than hardcoding a service and project dropdown.
 */
export function VariableControls({
	variables,
	values,
	options,
	onChange,
}: {
	variables: DashboardVariable[];
	values: Record<string, string>;
	options: Record<string, VariableOption[]>;
	onChange: (name: string, value: string) => void;
}) {
	if (variables.length === 0) return null;
	return (
		<>
			{variables.map((v) => (
				<VariableControl
					key={v.name}
					variable={v}
					value={values[v.name] ?? ""}
					options={options[v.name] ?? v.options ?? []}
					onChange={(next) => onChange(v.name, next)}
				/>
			))}
		</>
	);
}

const CONTROL_CLASS =
	"rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground";

function VariableControl({
	variable,
	value,
	options,
	onChange,
}: {
	variable: DashboardVariable;
	value: string;
	options: VariableOption[];
	onChange: (value: string) => void;
}) {
	const label = variable.label ?? variable.name;

	if (variable.type === "select") {
		const includeAll = variable.includeAll !== false;
		// A value that no longer appears in the options — a service that stopped
		// logging, a site that was renamed — is kept as a choice so the
		// dashboard doesn't silently widen its scope behind the user's back.
		const missing = value && !options.some((o) => o.value === value);
		return (
			<select
				className={CONTROL_CLASS}
				value={value}
				title={variable.description ?? label}
				aria-label={label}
				onChange={(e) => onChange(e.target.value)}
			>
				{includeAll && <option value="">All {label.toLowerCase()}</option>}
				{missing && <option value={value}>{value} (not in range)</option>}
				{options.map((o) => (
					<option key={o.value} value={o.value}>
						{o.label}
					</option>
				))}
			</select>
		);
	}

	return (
		<input
			className={`${CONTROL_CLASS} w-32`}
			type={variable.type === "number" ? "number" : "text"}
			value={value}
			placeholder={label}
			title={variable.description ?? label}
			aria-label={label}
			onChange={(e) => onChange(e.target.value)}
		/>
	);
}
