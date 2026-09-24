import type {
	AttendeeReport,
	CaptionEntry,
	ExportFormat,
} from "../types/captions.js";
import { formatAsCsv, formatAsJson, formatAsJsonl } from "./jsonl.js";
import { formatAsMarkdown } from "./markdown.js";
import { formatAsTxt } from "./text.js";
import { formatAsWebVtt } from "./vtt.js";

export * from "./dedup.js";
export * from "./filename.js";
export * from "./jsonl.js";
export * from "./markdown.js";
export * from "./text.js";
export * from "./vtt.js";

interface FormatterPayload {
	title: string;
	transcript: CaptionEntry[];
	attendeeReport?: AttendeeReport | null;
	startedAt?: number;
	source?: string;
}

export function formatTranscript(
	format: ExportFormat,
	payload: FormatterPayload,
): { content: string; mimeType: string } {
	const { title, transcript, attendeeReport, startedAt, source } = payload;
	switch (format) {
		case "md":
			return {
				content: formatAsMarkdown(title, transcript, attendeeReport, {
					startedAt,
					source,
				}),
				mimeType: "text/markdown",
			};
		case "txt":
			return {
				content: formatAsTxt(transcript, attendeeReport),
				mimeType: "text/plain",
			};
		case "vtt":
			return {
				content: formatAsWebVtt(transcript),
				mimeType: "text/vtt",
			};
		case "jsonl":
			return {
				content: formatAsJsonl(title, transcript, attendeeReport),
				mimeType: "application/x-ndjson",
			};
		case "json":
			return {
				content: formatAsJson(title, transcript, attendeeReport, {
					startedAt,
					source,
				}),
				mimeType: "application/json",
			};
		case "csv":
			return {
				content: formatAsCsv(transcript),
				mimeType: "text/csv",
			};
		default:
			return {
				content: formatAsTxt(transcript, attendeeReport),
				mimeType: "text/plain",
			};
	}
}
