import { useCallback, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import type { Dashboard, DashboardVariable, VariableType } from "@/types";

const VALID_ID = /^[a-zA-Z0-9_-]{1,128}$/;
const VALID_VARIABLE_NAME = /^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/;
const RESERVED = new Set(["from", "to"]);

const TYPES: { value: VariableType; label: string; hint: string }[] = [
	{ value: "select", label: "Select", hint: "A dropdown. Choices come from a list or from SQL." },
	{ value: "text", label: "Text", hint: "Free text, substituted as a quoted string." },
	{ value: "number", label: "Number", hint: "Substituted as a bare numeric literal." },
];

const TIME_RANGES = ["1h", "6h", "24h", "7d", "30d"];

export interface DashboardEditorProps {
	initial?: Dashboard;
	onSave: (d: Omit<Dashboard, "createdAt" | "updatedAt">) => Promise<void>;
	onCancel: () => void;
}

/**
 * Creating and editing a dashboard is mostly about declaring its variables:
 * a dashboard is a set of widgets plus the things a viewer can change across
 * all of them at once. Widget SQL then reads those by name.
 */
export function DashboardEditor(props: DashboardEditorProps) {
	const editing = !!props.initial;
	const [id, setId] = useState(props.initial?.id ?? "");
	const [name, setName] = useState(props.initial?.name ?? "");
	const [description, setDescription] = useState(props.initial?.description ?? "");
	const [icon, setIcon] = useState(props.initial?.icon ?? "");
	const [defaultTimeRange, setDefaultTimeRange] = useState(
		props.initial?.defaultTimeRange ?? "24h",
	);
	const [variables, setVariables] = useState<DashboardVariable[]>(props.initial?.variables ?? []);
	const [error, setError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);

	const patchVariable = useCallback((index: number, patch: Partial<DashboardVariable>) => {
		setVariables((prev) => prev.map((v, i) => (i === index ? { ...v, ...patch } : v)));
	}, []);

	const save = useCallback(async () => {
		if (!VALID_ID.test(id)) {
			setError("Invalid id — use letters, digits, _ or -");
			return;
		}
		if (!name.trim()) {
			setError("Name required");
			return;
		}
		const seen = new Set<string>();
		for (const v of variables) {
			if (!VALID_VARIABLE_NAME.test(v.name)) {
				setError(`Invalid variable name "${v.name}" — must start with a letter or underscore`);
				return;
			}
			if (RESERVED.has(v.name)) {
				setError(`"${v.name}" is reserved — the time range always provides it`);
				return;
			}
			if (seen.has(v.name)) {
				setError(`Duplicate variable name "${v.name}"`);
				return;
			}
			seen.add(v.name);
		}

		setSaving(true);
		setError(null);
		try {
			await props.onSave({
				id,
				name,
				description: description || undefined,
				icon: icon || undefined,
				defaultTimeRange,
				variables,
				builtin: false,
			});
		} catch (err) {
			setError(err instanceof Error ? err.message : "Save failed");
		} finally {
			setSaving(false);
		}
	}, [id, name, description, icon, defaultTimeRange, variables, props]);

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
			<div className="flex h-full max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-border bg-background shadow-2xl">
				<div className="flex items-center justify-between border-b border-border p-3">
					<h2 className="text-sm font-semibold">{editing ? "Edit dashboard" : "New dashboard"}</h2>
					<button type="button" onClick={props.onCancel} className="rounded p-1 hover:bg-muted">
						<X className="h-4 w-4" />
					</button>
				</div>

				<div className="flex flex-1 flex-col gap-3 overflow-auto p-4 text-xs">
					<div className="grid grid-cols-2 gap-3">
						<label className="flex flex-col gap-1">
							<span className="text-muted-foreground">ID</span>
							<input
								disabled={editing}
								value={id}
								placeholder="my-dashboard"
								onChange={(e) => setId(e.target.value)}
								className="rounded-md border border-border bg-background px-2 py-1 disabled:opacity-60"
							/>
						</label>
						<label className="flex flex-col gap-1">
							<span className="text-muted-foreground">Name</span>
							<input
								value={name}
								onChange={(e) => setName(e.target.value)}
								className="rounded-md border border-border bg-background px-2 py-1"
							/>
						</label>
					</div>

					<label className="flex flex-col gap-1">
						<span className="text-muted-foreground">Description</span>
						<input
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							className="rounded-md border border-border bg-background px-2 py-1"
						/>
					</label>

					<div className="grid grid-cols-2 gap-3">
						<label className="flex flex-col gap-1">
							<span className="text-muted-foreground">Icon</span>
							<input
								value={icon}
								placeholder="Activity"
								onChange={(e) => setIcon(e.target.value)}
								className="rounded-md border border-border bg-background px-2 py-1"
							/>
							<span className="text-2xs text-muted-foreground">
								Any lucide.dev icon name. Unknown names fall back to a default.
							</span>
						</label>
						<label className="flex flex-col gap-1">
							<span className="text-muted-foreground">Default time range</span>
							<select
								value={defaultTimeRange}
								onChange={(e) => setDefaultTimeRange(e.target.value)}
								className="rounded-md border border-border bg-background px-2 py-1"
							>
								{TIME_RANGES.map((r) => (
									<option key={r} value={r}>
										{r}
									</option>
								))}
							</select>
						</label>
					</div>

					<div className="mt-2 flex items-center justify-between">
						<div>
							<span className="font-medium">Variables</span>
							<p className="text-2xs text-muted-foreground">
								Each becomes a control in the toolbar and a <code>{"${name}"}</code> placeholder in
								this dashboard's widget SQL.
								<code>{"${from}"}</code> and <code>{"${to}"}</code> always exist.
							</p>
						</div>
						<button
							type="button"
							onClick={() =>
								setVariables((prev) => [...prev, { name: "", type: "select", includeAll: true }])
							}
							className="flex items-center gap-1 rounded-md border border-border px-2 py-1"
						>
							<Plus className="h-3 w-3" /> Add
						</button>
					</div>

					{variables.length === 0 && (
						<p className="rounded-md border border-dashed border-border p-3 text-center text-2xs text-muted-foreground">
							No variables. Widgets on this dashboard can still use <code>{"${from}"}</code> and{" "}
							<code>{"${to}"}</code>.
						</p>
					)}

					{variables.map((v, i) => (
						<VariableRow
							// Index-keyed on purpose: names start empty and are edited
							// character by character, so a name key would remount the
							// row (and drop focus) on every keystroke.
							key={i}
							variable={v}
							onChange={(patch) => patchVariable(i, patch)}
							onRemove={() => setVariables((prev) => prev.filter((_, j) => j !== i))}
						/>
					))}

					{error && (
						<div className="rounded-sm bg-destructive/10 px-2 py-1 text-destructive">{error}</div>
					)}
				</div>

				<div className="flex items-center gap-2 border-t border-border p-3 text-xs">
					<div className="flex-1" />
					<button
						type="button"
						onClick={props.onCancel}
						className="rounded-md border border-border px-3 py-1.5"
					>
						Cancel
					</button>
					<button
						type="button"
						onClick={save}
						disabled={saving}
						className="rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground disabled:opacity-50"
					>
						{saving ? "Saving…" : "Save"}
					</button>
				</div>
			</div>
		</div>
	);
}

function VariableRow({
	variable,
	onChange,
	onRemove,
}: {
	variable: DashboardVariable;
	onChange: (patch: Partial<DashboardVariable>) => void;
	onRemove: () => void;
}) {
	const type = TYPES.find((t) => t.value === variable.type);
	return (
		<div className="flex flex-col gap-2 rounded-md border border-border p-2">
			<div className="flex items-center gap-2">
				<input
					value={variable.name}
					placeholder="name"
					onChange={(e) => onChange({ name: e.target.value })}
					className="w-32 rounded-md border border-border bg-background px-2 py-1 font-mono"
				/>
				<input
					value={variable.label ?? ""}
					placeholder="Label"
					onChange={(e) => onChange({ label: e.target.value || undefined })}
					className="flex-1 rounded-md border border-border bg-background px-2 py-1"
				/>
				<select
					value={variable.type}
					onChange={(e) => onChange({ type: e.target.value as VariableType })}
					className="rounded-md border border-border bg-background px-2 py-1"
				>
					{TYPES.map((t) => (
						<option key={t.value} value={t.value}>
							{t.label}
						</option>
					))}
				</select>
				<button
					type="button"
					onClick={onRemove}
					title="Remove variable"
					className="rounded p-1 text-destructive hover:bg-destructive/10"
				>
					<Trash2 className="h-3 w-3" />
				</button>
			</div>

			{type && <span className="text-2xs text-muted-foreground">{type.hint}</span>}

			{variable.type === "select" && (
				<>
					<label className="flex flex-col gap-1">
						<span className="text-muted-foreground">Options SQL</span>
						<textarea
							value={variable.optionsSql ?? ""}
							placeholder="SELECT DISTINCT service AS value FROM logs ORDER BY value"
							onChange={(e) => onChange({ optionsSql: e.target.value || undefined })}
							rows={2}
							className="rounded-md border border-border bg-background px-2 py-1 font-mono text-2xs"
						/>
						<span className="text-2xs text-muted-foreground">
							Returns a <code>value</code> column, optionally a <code>label</code> column. Leave
							empty to use the fixed list below.
						</span>
					</label>
					<label className="flex flex-col gap-1">
						<span className="text-muted-foreground">Fixed options</span>
						<input
							value={(variable.options ?? []).map((o) => o.value).join(", ")}
							placeholder="desktop, mobile, tablet"
							onChange={(e) => {
								const values = e.target.value
									.split(",")
									.map((s) => s.trim())
									.filter(Boolean);
								onChange({
									options: values.length
										? values.map((value) => ({ label: value, value }))
										: undefined,
								});
							}}
							className="rounded-md border border-border bg-background px-2 py-1"
						/>
					</label>
					<label className="flex items-center gap-2">
						<input
							type="checkbox"
							checked={variable.includeAll !== false}
							onChange={(e) => onChange({ includeAll: e.target.checked })}
						/>
						<span className="text-muted-foreground">Offer an "All" choice (substitutes NULL)</span>
					</label>
				</>
			)}

			<label className="flex flex-col gap-1">
				<span className="text-muted-foreground">Default value</span>
				<input
					value={variable.default == null ? "" : String(variable.default)}
					placeholder="(none)"
					onChange={(e) => onChange({ default: e.target.value || null })}
					className="rounded-md border border-border bg-background px-2 py-1"
				/>
			</label>
		</div>
	);
}
