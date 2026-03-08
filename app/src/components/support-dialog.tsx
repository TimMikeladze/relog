import { useState } from "react";
import { ChevronDown, ChevronUp, Copy, Check, X, Star, Users, Heart, Share2, Info } from "lucide-react";

const GITHUB_URL = "https://github.com/TimMikeladze/relog";
const TWITTER_URL = "https://x.com/linesofcode";
const BLUESKY_URL = "https://bsky.app/profile/linesofcode.bsky.social";
const LINKEDIN_URL = "https://linkedin.com/in/tim-mikeladze";
const SPONSOR_URL = "https://github.com/sponsors/TimMikeladze";

const SHARE_TEXT = "Check out relog - the universal logging system\nhttps://github.com/TimMikeladze/relog";

function SocialButton({ icon, label, href }: { icon: React.ReactNode; label: string; href: string }) {
	return (
		<a
			href={href}
			target="_blank"
			rel="noopener noreferrer"
			className="flex flex-1 items-center justify-center gap-2 rounded-md border border-border px-3 py-2 text-xs font-medium transition-colors hover:bg-muted hover:text-foreground"
		>
			{icon}
			{label}
		</a>
	);
}

function Section({
	icon,
	title,
	description,
	children,
	collapsible,
	href,
}: {
	icon: React.ReactNode;
	title: string;
	description: string;
	children?: React.ReactNode;
	collapsible?: boolean;
	href?: string;
}) {
	const [open, setOpen] = useState(false);

	const header = (
		<div className="flex items-start gap-3">
			<div className="mt-0.5 text-muted-foreground">{icon}</div>
			<div className="flex-1">
				<div className="text-sm font-semibold">{title}</div>
				<div className="text-xs text-muted-foreground">{description}</div>
			</div>
			{collapsible && (
				<div className="mt-0.5 text-muted-foreground">
					{open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
				</div>
			)}
		</div>
	);

	if (href && !collapsible) {
		return (
			<a
				href={href}
				target="_blank"
				rel="noopener noreferrer"
				className="block rounded-lg border border-border p-4 transition-colors hover:bg-muted/50"
			>
				{header}
			</a>
		);
	}

	if (collapsible) {
		return (
			<div className="rounded-lg border border-border">
				<button
					type="button"
					onClick={() => setOpen(!open)}
					className="w-full cursor-pointer p-4 text-left transition-colors hover:bg-muted/50"
				>
					{header}
				</button>
				{open && <div className="border-t border-border p-4 pt-3 space-y-3">{children}</div>}
			</div>
		);
	}

	return (
		<div className="rounded-lg border border-border p-4 space-y-3">
			{header}
			{children}
		</div>
	);
}

export function SupportDialog({ onClose }: { onClose: () => void }) {
	const [copied, setCopied] = useState(false);

	const handleCopy = () => {
		navigator.clipboard.writeText(SHARE_TEXT);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
			<div className="w-full max-w-lg rounded-lg border border-border bg-card p-6 shadow-lg max-h-[85vh] overflow-y-auto">
				<div className="flex items-center justify-between mb-2">
					<h2 className="text-sm font-semibold">support</h2>
					<button
						type="button"
						onClick={onClose}
						className="rounded p-1 cursor-pointer text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
					>
						<X className="h-4 w-4" />
					</button>
				</div>
				<p className="mb-4 text-xs text-muted-foreground">
					relog is free and open source. here are some ways you can support it:
				</p>

				<div className="space-y-3">
					<Section
						icon={<Star className="h-4 w-4" />}
						title="star on github"
						description="help others discover relog"
						href={GITHUB_URL}
					/>

					<Section
						icon={<Users className="h-4 w-4" />}
						title="follow the developer"
						description="stay updated on new features"
					>
						<div className="flex gap-2">
							<SocialButton icon={<TwitterIcon />} label="Twitter" href={TWITTER_URL} />
							<SocialButton icon={<BlueskyIcon />} label="Bluesky" href={BLUESKY_URL} />
							<SocialButton icon={<LinkedInIcon />} label="LinkedIn" href={LINKEDIN_URL} />
							<SocialButton icon={<GitHubIcon />} label="GitHub" href={GITHUB_URL} />
						</div>
					</Section>

					<Section
						icon={<Heart className="h-4 w-4" />}
						title="sponsor"
						description="support ongoing development"
						href={SPONSOR_URL}
					/>

					<Section
						icon={<Share2 className="h-4 w-4" />}
						title="share us"
						description="spread the word on social media"
						collapsible
					>
						<div className="flex items-start gap-2 rounded-md border border-border bg-muted/30 p-3">
							<span className="flex-1 text-xs text-muted-foreground whitespace-pre-line">{SHARE_TEXT}</span>
							<button
								type="button"
								onClick={handleCopy}
								className="shrink-0 rounded p-1 cursor-pointer text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
							>
								{copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
							</button>
						</div>
						<div className="flex gap-2">
							<SocialButton
								icon={<TwitterIcon />}
								label="Twitter"
								href={`https://x.com/intent/tweet?text=${encodeURIComponent(SHARE_TEXT)}`}
							/>
							<SocialButton
								icon={<BlueskyIcon />}
								label="Bluesky"
								href={`https://bsky.app/intent/compose?text=${encodeURIComponent(SHARE_TEXT)}`}
							/>
							<SocialButton
								icon={<LinkedInIcon />}
								label="LinkedIn"
								href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(GITHUB_URL)}`}
							/>
						</div>
					</Section>

					<Section
						icon={<Info className="h-4 w-4" />}
						title="about"
						description="learn more about the project"
						href={GITHUB_URL}
					/>
				</div>
			</div>
		</div>
	);
}

function TwitterIcon() {
	return (
		<svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current">
			<path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
		</svg>
	);
}

function BlueskyIcon() {
	return (
		<svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current">
			<path d="M12 10.8c-1.087-2.114-4.046-6.053-6.798-7.995C2.566.944 1.561 1.266.902 1.565.139 1.908 0 3.08 0 3.768c0 .69.378 5.65.624 6.479.785 2.627 3.625 3.5 6.22 3.245-3.926.67-7.54 2.295-4.142 7.244C5.97 24.45 11.14 21.088 12 17.2c.86 3.888 5.67 7.072 9.298 3.536 3.474-5.093-.332-6.63-4.142-7.244 2.595.255 5.435-.618 6.22-3.245.246-.83.624-5.789.624-6.478 0-.69-.139-1.861-.902-2.206-.659-.298-1.664-.62-4.3 1.24C16.046 4.748 13.087 8.687 12 10.8" />
		</svg>
	);
}

function LinkedInIcon() {
	return (
		<svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current">
			<path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
		</svg>
	);
}

function GitHubIcon() {
	return (
		<svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current">
			<path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
		</svg>
	);
}
