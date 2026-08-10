/**
 * The browser tracker, served verbatim from `GET /script.js`.
 *
 * It is a hand-written string rather than a compiled entrypoint so the server
 * can serve it with no build step, no bundler wiring, and no chance of dev and
 * prod disagreeing about what bytes go over the wire. It must stay
 * dependency-free, ES5-safe (it runs before any polyfill on old mobile
 * browsers), and small — this file is loaded on every page of every site being
 * measured, so bytes here are the single most-shipped thing in the project.
 *
 * Usage:
 *   <script defer src="https://relog.example.com/script.js" data-site="myapp"></script>
 *
 * Attributes: data-site (required), data-host (override collect origin),
 * data-auto (set "false" to disable automatic pageviews),
 * data-exclude-search ("true" drops query strings), data-domains
 * (comma-separated allowlist of hostnames to report from).
 */

const RAW_TRACKER = `(function () {
	var doc = document;
	var script = doc.currentScript;
	if (!script) {
		var all = doc.getElementsByTagName('script');
		script = all[all.length - 1];
	}
	if (!script) return;

	var attr = function (name) { return script.getAttribute('data-' + name); };
	var site = attr('site') || attr('website') || attr('id');
	if (!site) { return; }

	var host = attr('host');
	if (!host) {
		// Default to the origin the script itself was served from, so a single
		// script tag is the entire integration.
		var src = script.src || '';
		try { host = new URL(src, location.href).origin; } catch (e) { host = ''; }
	}
	host = host.replace(/\\/+$/, '');
	var endpoint = host + '/collect';

	var auto = attr('auto') !== 'false';
	var excludeSearch = attr('exclude-search') === 'true';
	var domains = (attr('domains') || '').split(',').map(function (d) { return d.trim(); }).filter(Boolean);

	// A staging clone or a locally-served copy of the site would otherwise
	// pollute production numbers.
	function allowed() {
		if (domains.length === 0) return true;
		var h = location.hostname;
		for (var i = 0; i < domains.length; i++) {
			var d = domains[i].replace(/^www\\./, '');
			if (h === d || h === 'www.' + d || h.slice(-(d.length + 1)) === '.' + d) return true;
		}
		return false;
	}

	// sessionStorage keeps one session per tab across reloads. When it is
	// unavailable (sandboxed iframe, hardened privacy mode) fall back to an
	// in-memory id rather than dropping the event.
	var SKEY = '__relog_sid';
	var memSid = null;
	function sessionId() {
		if (memSid) return memSid;
		var id;
		try {
			id = sessionStorage.getItem(SKEY);
			if (!id) { id = rand(); sessionStorage.setItem(SKEY, id); }
			return id;
		} catch (e) {
			memSid = rand();
			return memSid;
		}
	}
	function rand() {
		var s = '';
		if (window.crypto && crypto.getRandomValues) {
			var b = new Uint8Array(12);
			crypto.getRandomValues(b);
			for (var i = 0; i < b.length; i++) s += (b[i] + 256).toString(16).slice(1);
			return s;
		}
		return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
	}

	var screenSize = screen.width + 'x' + screen.height;
	var lastPath = null;
	var lastViewAt = 0;

	function currentPath() {
		return location.pathname + (excludeSearch ? '' : location.search);
	}

	function send(name, props, extra) {
		if (!allowed()) return;
		var payload = {
			site: site,
			name: name,
			session_id: sessionId(),
			hostname: location.hostname,
			path: currentPath(),
			// The full URL query is sent so the server can extract UTMs even when
			// data-exclude-search strips them from the stored path.
			query: location.search,
			title: doc.title,
			referrer: doc.referrer || '',
			screen: screenSize,
			language: navigator.language || '',
			touch: (navigator.maxTouchPoints || 0) > 0,
			ts: Date.now()
		};
		if (props) payload.props = props;
		if (extra) { for (var k in extra) { if (Object.prototype.hasOwnProperty.call(extra, k)) payload[k] = extra[k]; } }

		var body = JSON.stringify(payload);
		// text/plain is a CORS-safelisted content type, so neither path triggers
		// a preflight. The body is still JSON; the server parses it as such.
		// One saved round-trip per event on every cross-origin install.
		try {
			if (navigator.sendBeacon) {
				var blob = new Blob([body], { type: 'text/plain;charset=UTF-8' });
				if (navigator.sendBeacon(endpoint, blob)) return;
			}
		} catch (e) {}
		try {
			// keepalive so the final event of a visit survives the unload that
			// immediately follows it.
			fetch(endpoint, {
				method: 'POST',
				headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
				body: body,
				keepalive: true,
				credentials: 'omit',
				mode: 'cors'
			})['catch'](function () {});
		} catch (e) {}
	}

	// Time on page belongs to the page being left, not the one being opened.
	// Sending it with the next pageview would attribute every page's dwell
	// time to whatever the visitor read next.
	function leave(now) {
		if (lastPath === null) return;
		send('leave', null, { path: lastPath, duration_ms: now - lastViewAt });
	}

	function pageview() {
		var path = currentPath();
		var now = Date.now();
		// SPA routers fire several history events for one navigation; collapse
		// repeats of the same path inside a short window.
		if (path === lastPath && now - lastViewAt < 300) return;
		leave(now);
		lastPath = path;
		lastViewAt = now;
		send('pageview', null, null);
	}

	// Client-side routing produces no navigation event, so patch the two
	// history methods and listen for popstate/hashchange.
	function hookHistory() {
		var h = window.history;
		if (!h || !h.pushState) return;
		['pushState', 'replaceState'].forEach(function (m) {
			var orig = h[m];
			h[m] = function () {
				var r = orig.apply(this, arguments);
				pageview();
				return r;
			};
		});
		window.addEventListener('popstate', pageview);
		window.addEventListener('hashchange', pageview);
	}

	var relog = function (name, props) {
		if (typeof name !== 'string' || !name) return;
		send(name.slice(0, 128), props || null);
	};
	relog.pageview = pageview;
	relog.site = site;

	// Preserve calls queued before the script finished loading:
	//   window.relog = window.relog || function () { (window.relog.q = window.relog.q || []).push(arguments) }
	var queued = window.relog && window.relog.q;
	window.relog = relog;
	if (queued) {
		for (var i = 0; i < queued.length; i++) relog.apply(null, queued[i]);
	}

	// data-event attributes: <button data-relog-event="signup" data-relog-plan="pro">
	doc.addEventListener('click', function (e) {
		var el = e.target;
		while (el && el !== doc.body) {
			if (el.getAttribute) {
				var name = el.getAttribute('data-relog-event');
				if (name) {
					var props = {};
					var attrs = el.attributes;
					for (var i = 0; i < attrs.length; i++) {
						var a = attrs[i];
						if (a.name.indexOf('data-relog-') === 0 && a.name !== 'data-relog-event') {
							props[a.name.slice(11)] = a.value;
						}
					}
					relog(name, props);
					return;
				}
			}
			el = el.parentNode;
		}
	}, true);

	if (auto) {
		hookHistory();
		if (doc.readyState === 'complete' || doc.readyState === 'interactive') {
			pageview();
		} else {
			doc.addEventListener('DOMContentLoaded', pageview);
		}
		// Report time-on-page for the last view when the tab goes away.
		window.addEventListener('pagehide', function () {
			leave(Date.now());
			lastPath = null;
		});
	}
})();
`;

/**
 * Comment and indentation stripping only — no identifier mangling. The gzip
 * the server applies does most of the real work, and keeping the served
 * source readable makes the tracker auditable by the site owners who have to
 * take responsibility for putting it on their pages.
 */
function minify(src: string): string {
	return src
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0 && !line.startsWith("//"))
		.join("\n");
}

export const TRACKER_SCRIPT: string = minify(RAW_TRACKER);

/** Stable across a process lifetime; used for ETag/cache validation. */
export const TRACKER_ETAG: string = `W/"${Bun.hash(TRACKER_SCRIPT).toString(16)}"`;
