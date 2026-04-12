const SERVICE_PALETTE = [
	{ bar: "bg-blue-500/70", dot: "bg-blue-400", label: "text-blue-600 dark:text-blue-300" },
	{ bar: "bg-emerald-500/70", dot: "bg-emerald-400", label: "text-emerald-600 dark:text-emerald-300" },
	{ bar: "bg-violet-500/70", dot: "bg-violet-400", label: "text-violet-600 dark:text-violet-300" },
	{ bar: "bg-amber-500/70", dot: "bg-amber-400", label: "text-amber-600 dark:text-amber-300" },
	{ bar: "bg-cyan-500/70", dot: "bg-cyan-400", label: "text-cyan-600 dark:text-cyan-300" },
	{ bar: "bg-pink-500/70", dot: "bg-pink-400", label: "text-pink-600 dark:text-pink-300" },
	{ bar: "bg-lime-500/70", dot: "bg-lime-400", label: "text-lime-600 dark:text-lime-300" },
	{ bar: "bg-orange-500/70", dot: "bg-orange-400", label: "text-orange-600 dark:text-orange-300" },
	{ bar: "bg-teal-500/70", dot: "bg-teal-400", label: "text-teal-600 dark:text-teal-300" },
	{ bar: "bg-indigo-500/70", dot: "bg-indigo-400", label: "text-indigo-600 dark:text-indigo-300" },
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
