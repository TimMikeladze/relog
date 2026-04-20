export interface SqlVars {
	from: number;
	to: number;
	service?: string | null;
	project?: string | null;
}

const KNOWN = new Set<string>(["from", "to", "service", "project"]);
const PLACEHOLDER = /\$\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;

function quote(value: string): string {
	return `'${value.replace(/'/g, "''")}'`;
}

export function substituteVars(sql: string, vars: SqlVars): string {
	return sql.replace(PLACEHOLDER, (_match, name: string) => {
		if (!KNOWN.has(name)) {
			throw new Error(`Unknown placeholder: ${name}`);
		}
		if (name === "from") return String(Math.floor(vars.from));
		if (name === "to") return String(Math.floor(vars.to));
		const v = vars[name as "service" | "project"];
		if (v == null || v === "") return "NULL";
		return quote(String(v));
	});
}
