import { cn } from "@/lib/utils";

function formatValue(value: unknown, indent: number): string {
	if (value === null || value === undefined) return "null";
	if (typeof value === "string") return `"${value}"`;
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	let serialized: string;
	try {
		// Cycle-safe replacer: log meta from web-app values can carry
		// circular refs (DOM nodes, React fibers), and a throw here would
		// crash the whole detail panel render.
		const seen = new WeakSet<object>();
		serialized = JSON.stringify(
			value,
			(_k, v) => {
				if (typeof v === "bigint") return v.toString();
				if (v && typeof v === "object") {
					if (seen.has(v as object)) return "[Circular]";
					seen.add(v as object);
				}
				return v;
			},
			2,
		);
	} catch {
		serialized = "[unserializable]";
	}
	return serialized
		.split("\n")
		.map((line, i) => (i === 0 ? line : " ".repeat(indent) + line))
		.join("\n");
}

export function JsonViewer({
	data,
	className,
}: {
	data: Record<string, unknown> | null | undefined;
	className?: string;
}) {
	if (!data || typeof data !== "object" || Object.keys(data).length === 0) {
		return <span className="text-muted-foreground italic">null</span>;
	}

	return (
		<pre
			className={cn(
				"overflow-x-auto rounded-md bg-muted/50 p-3 text-xs leading-relaxed",
				className,
			)}
		>
			{"{"}
			{"\n"}
			{Object.entries(data).map(([key, value], i, arr) => (
				<span key={key}>
					{"  "}
					<span className="text-blue-500 dark:text-blue-400">"{key}"</span>
					<span className="text-muted-foreground">: </span>
					<span className="text-foreground">{formatValue(value, 4)}</span>
					{i < arr.length - 1 ? "," : ""}
					{"\n"}
				</span>
			))}
			{"}"}
		</pre>
	);
}
