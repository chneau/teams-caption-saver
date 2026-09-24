/**
 * ISOLATED-world relay script for Microsoft Stream / SharePoint player.
 * Listens for window.postMessage from interceptor.ts and forwards to service worker.
 */
(() => {
	const CHANNEL = "teams-caption-saver/recording-transcript";

	window.addEventListener("message", (event) => {
		if (
			event.source !== window ||
			!event.data ||
			event.data.channel !== CHANNEL
		) {
			return;
		}

		if (event.data.action === "transcript_intercepted") {
			const { title, url, webvtt } = event.data as {
				title: string;
				url: string;
				webvtt: string;
			};
			chrome.runtime
				.sendMessage({
					action: "recording_transcript_found",
					title,
					url,
					webvtt,
				})
				.catch((err) => {
					console.debug(
						"[Teams Caption Saver Relay] Could not send to background:",
						err,
					);
				});
		}
	});
})();
