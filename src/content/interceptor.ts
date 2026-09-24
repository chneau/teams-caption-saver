/**
 * MAIN-world transcript interceptor for Microsoft Stream / SharePoint player.
 * Wraps window.fetch to clone transcript responses (streamContent / signed URLs)
 * without interfering with media playback.
 */
(() => {
	const CHANNEL = "teams-caption-saver/recording-transcript";
	const INSTALLED = "__teamsCaptionSaverTranscriptTee";

	const originalFetch = window.fetch;
	if (
		typeof originalFetch !== "function" ||
		(window as unknown as Record<string, boolean>)[INSTALLED] === true
	) {
		return;
	}
	(window as unknown as Record<string, boolean>)[INSTALLED] = true;

	function urlOf(resource: unknown): string {
		if (typeof resource === "string") return resource;
		if (resource instanceof URL) return resource.href;
		if (
			resource &&
			typeof resource === "object" &&
			"url" in resource &&
			typeof resource.url === "string"
		) {
			return resource.url;
		}
		return "";
	}

	function isTranscriptUrl(url: string): boolean {
		if (!url) return false;
		const lower = url.toLowerCase();
		return (
			lower.includes("streamcontent") ||
			lower.includes("/transcript") ||
			lower.includes(".vtt") ||
			lower.includes("contenttype=transcript") ||
			(lower.includes("temporarydownloadurl") && lower.includes("transcript"))
		);
	}

	const customFetch: typeof window.fetch = Object.assign(async function (
		this: unknown,
		...args: Parameters<typeof fetch>
	): Promise<Response> {
		const url = urlOf(args[0]);
		const responsePromise = originalFetch.apply(this, args);

		if (isTranscriptUrl(url)) {
			responsePromise
				.then(async (response) => {
					if (!response.ok) return;
					try {
						const clone = response.clone();
						const text = await clone.text();
						if (text && (text.includes("WEBVTT") || text.includes("-->"))) {
							window.postMessage(
								{
									channel: CHANNEL,
									action: "transcript_intercepted",
									url,
									title: document.title || "Recorded Meeting",
									webvtt: text,
								},
								"*",
							);
						}
					} catch (e) {
						console.debug(
							"[Teams Caption Saver] Error cloning transcript response:",
							e,
						);
					}
				})
				.catch(() => {});
		}

		return responsePromise;
	}, originalFetch);

	window.fetch = customFetch;
})();
