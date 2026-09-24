import type { CaptionEntry } from "../types/captions.js";

function toVttTime(totalSeconds: number): string {
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = Math.floor(totalSeconds % 60);
	const ms = Math.floor((totalSeconds % 1) * 1000);
	const pad = (n: number) => n.toString().padStart(2, "0");
	const padMs = (n: number) => n.toString().padStart(3, "0");
	return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}.${padMs(ms)}`;
}

export function formatAsWebVtt(transcript: CaptionEntry[]): string {
	let vtt = "WEBVTT\n\n";
	transcript.forEach((entry, idx) => {
		const startSec = idx * 4;
		const endSec = startSec + 4;
		vtt += `${idx + 1}\n`;
		vtt += `${toVttTime(startSec)} --> ${toVttTime(endSec)}\n`;
		vtt += `<v ${entry.Name}>${entry.Text}\n\n`;
	});
	return vtt;
}

export function parseWebVtt(vttContent: string): CaptionEntry[] {
	const entries: CaptionEntry[] = [];
	const lines = vttContent.replace(/\r\n/g, "\n").split("\n");

	let currentTime = "";
	let currentSpeaker = "Speaker";
	let currentTextBuffer: string[] = [];

	const timeRegex =
		/(\d{2}:\d{2}(?::\d{2})?(?:\.\d{3})?)\s*-->\s*(\d{2}:\d{2}(?::\d{2})?(?:\.\d{3})?)/;
	const voiceRegex = /<v\s+([^>]+)>(.*)/;

	for (const rawLine of lines) {
		const line = rawLine.trim();
		if (!line || line === "WEBVTT" || line.startsWith("NOTE")) {
			if (currentTextBuffer.length > 0) {
				entries.push({
					Name: currentSpeaker,
					Text: currentTextBuffer.join(" ").trim(),
					Time: currentTime || "00:00:00",
				});
				currentTextBuffer = [];
			}
			continue;
		}

		const timeMatch = timeRegex.exec(line);
		if (timeMatch) {
			if (currentTextBuffer.length > 0) {
				entries.push({
					Name: currentSpeaker,
					Text: currentTextBuffer.join(" ").trim(),
					Time: currentTime || "00:00:00",
				});
				currentTextBuffer = [];
			}
			currentTime = timeMatch[1] ?? "00:00:00";
			continue;
		}

		const voiceMatch = voiceRegex.exec(line);
		if (voiceMatch) {
			currentSpeaker = voiceMatch[1]?.trim() || "Speaker";
			const text = voiceMatch[2]?.replace(/<\/v>/g, "").trim() || "";
			if (text) currentTextBuffer.push(text);
			continue;
		}

		if (/^\d+$/.test(line)) {
			continue; // Cue number
		}

		// Standard text line
		const cleaned = line.replace(/<[^>]+>/g, "").trim();
		if (cleaned) {
			currentTextBuffer.push(cleaned);
		}
	}

	if (currentTextBuffer.length > 0) {
		entries.push({
			Name: currentSpeaker,
			Text: currentTextBuffer.join(" ").trim(),
			Time: currentTime || "00:00:00",
		});
	}

	return entries;
}
