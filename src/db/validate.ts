const BLOCKED_KEYWORDS =
	/\b(ATTACH|DETACH|LOAD_EXTENSION|INSTALL|LOAD|COPY|EXPORT|IMPORT|REINDEX|VACUUM|ALTER|CREATE|DROP|INSERT|UPDATE|DELETE|REPLACE|MERGE|TRUNCATE|GRANT|REVOKE|SET|CALL|EXECUTE|PREPARE|PRAGMA)\b/i;

/** Block DuckDB functions that can read/write files or access the network. */
const BLOCKED_FUNCTIONS =
	/\b(read_csv|read_csv_auto|read_parquet|read_json|read_json_auto|read_text|read_blob|write_csv|write_parquet|write_json|http_get|http_post|current_setting|current_database)\s*\(/i;

/** Block system catalog schemas and DuckDB introspection functions. */
const BLOCKED_SCHEMAS =
	/\b(information_schema|pg_catalog|duckdb_tables|duckdb_columns|duckdb_views|duckdb_indexes|duckdb_schemas|duckdb_types|duckdb_functions|duckdb_settings|duckdb_databases|duckdb_extensions|duckdb_constraints|duckdb_dependencies|duckdb_keywords|duckdb_sequences|duckdb_temporary_files|duckdb_secrets|glob|system\.)(?:\s*\(|\b)/i;

/** Detect dollar-quoted strings ($$...$$) which could hide blocked keywords. */
const DOLLAR_QUOTE = /\$\$/;

export class QueryValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "QueryValidationError";
	}
}

function skipQuoted(sql: string, i: number, quote: string): number {
	i++;
	while (i < sql.length) {
		if (sql[i] === quote && sql[i + 1] === quote) {
			i += 2;
		} else if (sql[i] === quote) {
			i++;
			break;
		} else {
			i++;
		}
	}
	return i;
}

export function stripSqlComments(sql: string): string {
	let result = "";
	let i = 0;
	while (i < sql.length) {
		if (sql[i] === "'" || sql[i] === '"') {
			const start = i;
			i = skipQuoted(sql, i, sql[i]!);
			result += sql.slice(start, i);
		} else if (sql[i] === "-" && sql[i + 1] === "-") {
			while (i < sql.length && sql[i] !== "\n") i++;
		} else if (sql[i] === "/" && sql[i + 1] === "*") {
			i += 2;
			while (i < sql.length && !(sql[i] === "*" && sql[i + 1] === "/")) i++;
			i += 2;
		} else {
			result += sql[i];
			i++;
		}
	}
	return result.trim();
}

export function blankQuotedStrings(sql: string): string {
	let result = "";
	let i = 0;
	while (i < sql.length) {
		if (sql[i] === "'" || sql[i] === '"') {
			const quote = sql[i]!;
			result += quote;
			i++;
			while (i < sql.length) {
				if (sql[i] === quote && sql[i + 1] === quote) {
					i += 2;
				} else if (sql[i] === quote) {
					result += quote;
					i++;
					break;
				} else {
					i++;
				}
			}
		} else {
			result += sql[i];
			i++;
		}
	}
	return result;
}

export function hasSemicolonOutsideQuotes(sql: string): boolean {
	let i = 0;
	while (i < sql.length) {
		if (sql[i] === "'" || sql[i] === '"') {
			i = skipQuoted(sql, i, sql[i]!);
		} else if (sql[i] === ";") {
			return true;
		} else {
			i++;
		}
	}
	return false;
}

export function validateQuery(sql: string, maxRows: number): string {
	if (typeof sql !== "string") {
		throw new QueryValidationError("SQL must be a string");
	}

	const stripped = stripSqlComments(sql);

	if (DOLLAR_QUOTE.test(stripped)) {
		throw new QueryValidationError("Dollar-quoted strings are not allowed");
	}

	if (hasSemicolonOutsideQuotes(stripped)) {
		throw new QueryValidationError("Multiple statements are not allowed");
	}

	const blanked = blankQuotedStrings(stripped);

	if (BLOCKED_KEYWORDS.test(blanked)) {
		throw new QueryValidationError("Statement contains a blocked keyword");
	}

	if (BLOCKED_FUNCTIONS.test(blanked)) {
		throw new QueryValidationError("Statement contains a blocked function");
	}

	if (BLOCKED_SCHEMAS.test(blanked)) {
		throw new QueryValidationError("Access to system catalogs is not allowed");
	}

	const trimmed = blanked.toUpperCase().trimStart();

	if (
		!trimmed.startsWith("SELECT") &&
		!trimmed.startsWith("EXPLAIN") &&
		!trimmed.startsWith("WITH")
	) {
		throw new QueryValidationError("Only SELECT, EXPLAIN, and WITH queries are allowed");
	}

	if (
		(trimmed.startsWith("SELECT") || trimmed.startsWith("WITH")) &&
		!/\bLIMIT\s+(\d+|\?)/i.test(blanked)
	) {
		return `${stripped} LIMIT ${maxRows}`;
	}

	return stripped;
}
