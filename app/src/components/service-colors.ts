/**
 * Hue identifies a service; it does not rank one. `bar` stays saturated
 * because a waterfall bar has to be legible as a shape, but `chip` is a low
 * alpha tint with coloured text — as a filled badge it out-shouted the level
 * colours, so a routine `info` row from a purple service read as more urgent
 * than a `warn` from a grey one.
 *
 * Class strings are written out in full because Tailwind only sees literals.
 * `hex` is the same colour as `dot`, for the places that need a raw CSS value
 * (an SVG stroke, an inline border). It used to live in a separate class-name
 * -> hex lookup table in span-detail, which would silently desync from this
 * one the moment a hue changed here.
 */
const SERVICE_PALETTE = [
	{
		bar: "bg-blue-500/70",
		dot: "bg-blue-400",
		hex: "#60a5fa",
		label: "text-blue-600 dark:text-blue-300",
		chip: "bg-blue-500/10 text-blue-700 ring-blue-500/20 dark:text-blue-300",
	},
	{
		bar: "bg-emerald-500/70",
		dot: "bg-emerald-400",
		hex: "#34d399",
		label: "text-emerald-600 dark:text-emerald-300",
		chip: "bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-300",
	},
	{
		bar: "bg-violet-500/70",
		dot: "bg-violet-400",
		hex: "#a78bfa",
		label: "text-violet-600 dark:text-violet-300",
		chip: "bg-violet-500/10 text-violet-700 ring-violet-500/20 dark:text-violet-300",
	},
	{
		bar: "bg-amber-500/70",
		dot: "bg-amber-400",
		hex: "#fbbf24",
		label: "text-amber-600 dark:text-amber-300",
		chip: "bg-amber-500/10 text-amber-700 ring-amber-500/20 dark:text-amber-300",
	},
	{
		bar: "bg-cyan-500/70",
		dot: "bg-cyan-400",
		hex: "#22d3ee",
		label: "text-cyan-600 dark:text-cyan-300",
		chip: "bg-cyan-500/10 text-cyan-700 ring-cyan-500/20 dark:text-cyan-300",
	},
	{
		bar: "bg-pink-500/70",
		dot: "bg-pink-400",
		hex: "#f472b6",
		label: "text-pink-600 dark:text-pink-300",
		chip: "bg-pink-500/10 text-pink-700 ring-pink-500/20 dark:text-pink-300",
	},
	{
		bar: "bg-lime-500/70",
		dot: "bg-lime-400",
		hex: "#a3e635",
		label: "text-lime-600 dark:text-lime-300",
		chip: "bg-lime-500/10 text-lime-700 ring-lime-500/20 dark:text-lime-300",
	},
	{
		bar: "bg-orange-500/70",
		dot: "bg-orange-400",
		hex: "#fb923c",
		label: "text-orange-600 dark:text-orange-300",
		chip: "bg-orange-500/10 text-orange-700 ring-orange-500/20 dark:text-orange-300",
	},
	{
		bar: "bg-teal-500/70",
		dot: "bg-teal-400",
		hex: "#2dd4bf",
		label: "text-teal-600 dark:text-teal-300",
		chip: "bg-teal-500/10 text-teal-700 ring-teal-500/20 dark:text-teal-300",
	},
	{
		bar: "bg-indigo-500/70",
		dot: "bg-indigo-400",
		hex: "#818cf8",
		label: "text-indigo-600 dark:text-indigo-300",
		chip: "bg-indigo-500/10 text-indigo-700 ring-indigo-500/20 dark:text-indigo-300",
	},
];

function hashString(str: string): number {
	let hash = 0;
	for (let i = 0; i < str.length; i++) {
		hash = (hash << 5) - hash + str.charCodeAt(i);
		hash |= 0;
	}
	return Math.abs(hash);
}

export type ServiceColor = (typeof SERVICE_PALETTE)[number];

export function getServiceColor(service: string): ServiceColor {
	return SERVICE_PALETTE[hashString(service) % SERVICE_PALETTE.length]!;
}
