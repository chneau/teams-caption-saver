import type { AttendeeReport, CaptionEntry } from "../types/captions.js";

const DECORATION = /[\p{P}\p{S}\s]+/gu;
const REFINEMENT_PREFIX_RATIO = 0.5;

export function normalizeText(value: string | null | undefined): string {
	return String(value ?? "")
		.normalize("NFC")
		.replace(/\s+/gu, " ")
		.trim();
}

export function comparableText(value: string | null | undefined): string {
	return normalizeText(value).toLowerCase().replace(DECORATION, "");
}

export function sharedPrefixLength(a: string, b: string): number {
	const max = Math.min(a.length, b.length);
	let i = 0;
	while (i < max && a[i] === b[i]) i += 1;
	return i;
}

export function isRefinement(previous: string, next: string): boolean {
	const a = comparableText(previous);
	const b = comparableText(next);
	if (a === "" || b === "") return a === b;
	if (a === b || b.startsWith(a) || a.startsWith(b)) return true;
	const shared = sharedPrefixLength(a, b);
	return shared / Math.min(a.length, b.length) >= REFINEMENT_PREFIX_RATIO;
}

export interface RawDomLine {
	speaker: string;
	text: string;
}

export function reconcileSnapshots(
	existing: CaptionEntry[],
	domLines: RawDomLine[],
	timeStr: string,
): boolean {
	if (domLines.length === 0) return false;

	const cleaned = domLines
		.map((line) => ({
			speaker: line.speaker?.trim() || "Speaker",
			text: normalizeText(line.text),
		}))
		.filter((line) => line.text.length > 0);

	if (cleaned.length === 0) return false;

	if (existing.length === 0) {
		for (const line of cleaned) {
			existing.push({
				Name: line.speaker,
				Text: line.text,
				Time: timeStr,
				TimestampMs: Date.now(),
			});
		}
		return true;
	}

	function isMatch(entry: CaptionEntry, domLine: RawDomLine): boolean {
		const isSameSpeaker =
			entry.Name === domLine.speaker ||
			entry.Name === "Speaker" ||
			entry.Name === "Unknown user" ||
			domLine.speaker === "Speaker" ||
			domLine.speaker === "Unknown user";

		if (!isSameSpeaker) return false;
		if (entry.Text === domLine.text) return true;
		return isRefinement(entry.Text, domLine.text);
	}

	let bestK = -1;
	const searchStart = Math.max(0, existing.length - 10);

	for (let k = existing.length - 1; k >= searchStart; k--) {
		const candidate = existing[k];
		const domFirst = cleaned[0];
		if (candidate && domFirst && isMatch(candidate, domFirst)) {
			bestK = k;
			break;
		}
	}

	if (bestK === -1) {
		for (let i = 1; i < cleaned.length; i++) {
			const domItem = cleaned[i];
			if (!domItem) continue;
			for (let k = existing.length - 1; k >= searchStart; k--) {
				const candidate = existing[k];
				if (candidate && isMatch(candidate, domItem)) {
					bestK = k - i;
					break;
				}
			}
			if (bestK !== -1) break;
		}
	}

	let changed = false;

	if (bestK === -1) {
		for (const line of cleaned) {
			existing.push({
				Name: line.speaker,
				Text: line.text,
				Time: timeStr,
				TimestampMs: Date.now(),
			});
			changed = true;
		}
		return changed;
	}

	for (let j = 0; j < cleaned.length; j++) {
		const domLine = cleaned[j];
		if (!domLine) continue;
		const targetIndex = bestK + j;

		if (targetIndex < 0) {
			continue;
		}

		if (targetIndex < existing.length) {
			const entry = existing[targetIndex];
			if (!entry) continue;
			if (entry.Text !== domLine.text || entry.Name !== domLine.speaker) {
				if (
					domLine.text.length >= entry.Text.length ||
					isRefinement(entry.Text, domLine.text)
				) {
					entry.Text = domLine.text;
					changed = true;
				}
				if (
					(entry.Name === "Speaker" || entry.Name === "Unknown user") &&
					domLine.speaker !== "Speaker" &&
					domLine.speaker !== "Unknown user"
				) {
					entry.Name = domLine.speaker;
					changed = true;
				}
				if (changed) {
					entry.TimestampMs = Date.now();
				}
			}
		} else {
			existing.push({
				Name: domLine.speaker,
				Text: domLine.text,
				Time: timeStr,
				TimestampMs: Date.now(),
			});
			changed = true;
		}
	}

	return changed;
}

export async function sha256Hex(content: string): Promise<string> {
	const encoder = new TextEncoder();
	const data = encoder.encode(content);
	const hashBuffer = await crypto.subtle.digest("SHA-256", data);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function applyAliases(
	captions: CaptionEntry[],
	aliases: Record<string, string> = {},
): CaptionEntry[] {
	if (Object.keys(aliases).length === 0) return captions;
	return captions.map((entry) => {
		const aliased = aliases[entry.Name]?.trim();
		return {
			...entry,
			Name: aliased && aliased.length > 0 ? aliased : entry.Name,
		};
	});
}

export function applyAliasesToAttendeeReport(
	report: AttendeeReport | null | undefined,
	aliases: Record<string, string> = {},
): AttendeeReport | null | undefined {
	if (!report || Object.keys(aliases).length === 0) return report;
	return {
		...report,
		attendeeList: report.attendeeList.map(
			(name) => aliases[name]?.trim() || name,
		),
		currentAttendees: report.currentAttendees.map((att) => ({
			...att,
			name: aliases[att.name]?.trim() || att.name,
		})),
		attendeeHistory: report.attendeeHistory.map((ev) => ({
			...ev,
			name: aliases[ev.name]?.trim() || ev.name,
		})),
	};
}
