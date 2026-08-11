const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/**
 * `Intl` emits *only* the fractional part when `fractionalSecondDigits` is
 * passed without `hour`/`minute`/`second`. Four call sites did exactly that,
 * so timestamps rendered as bare milliseconds — "165" where "22:31:04.165"
 * belonged. Naming the fields is the fix, and having one helper is what keeps
 * it fixed.
 */
export function formatClockTime(ts: string | number | Date, fractionDigits: 1 | 2 | 3 = 3): string {
	const d = ts instanceof Date ? ts : new Date(ts);
	if (!Number.isFinite(d.getTime())) return String(ts);
	return d.toLocaleTimeString("en-US", {
		hour12: false,
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		fractionalSecondDigits: fractionDigits,
	});
}

/** `AUG 10 22:31:04.16 GMT-7` — the detail panel's absolute reading. */
export function formatFullTimestamp(ts: string | number | Date): string {
	const d = ts instanceof Date ? ts : new Date(ts);
	if (!Number.isFinite(d.getTime())) return String(ts);
	const tz = d.toLocaleTimeString("en-US", { timeZoneName: "shortOffset" }).split(" ").pop();
	const day = String(d.getDate()).padStart(2, "0");
	return `${MONTHS[d.getMonth()]} ${day} ${formatClockTime(d, 2)} ${tz}`;
}
