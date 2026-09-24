import { describe, expect, it } from "bun:test";
import {
	buildExportFilename,
	formatTranscript,
	parseWebVtt,
	sanitizeFilename,
} from "../src/formatters/index.js";
import type { CaptionEntry } from "../src/types/captions.js";

describe("Filename building & sanitization", () => {
	it("sanitizes forbidden characters from filename", () => {
		expect(sanitizeFilename('Meeting: Project "Phoenix" / Q4?')).toBe(
			"Meeting_ Project _Phoenix_ _ Q4_",
		);
	});

	it("builds clean export filename with date and format", () => {
		const date = new Date(2026, 8, 24, 15, 30, 0); // Sep 24, 2026
		const filename = buildExportFilename("Sync Meeting", date, "md");
		expect(filename).toBe("2026-09-24_15-30-00_Sync Meeting.md");
	});
});

describe("Formatters Dispatcher", () => {
	const sampleCaptions: CaptionEntry[] = [
		{ Name: "Alice", Text: "Hello team", Time: "10:00:01" },
		{ Name: "Bob", Text: "Good morning", Time: "10:00:05" },
	];

	it("formats as Markdown", () => {
		const result = formatTranscript("md", {
			title: "Design Review",
			transcript: sampleCaptions,
			startedAt: 1700000000000,
		});

		expect(result.mimeType).toBe("text/markdown");
		expect(result.content).toContain("# Design Review");
		expect(result.content).toContain("**[10:00:01] Alice**");
		expect(result.content).toContain("Hello team");
	});

	it("formats as Plain Text", () => {
		const result = formatTranscript("txt", {
			title: "Design Review",
			transcript: sampleCaptions,
		});

		expect(result.mimeType).toBe("text/plain");
		expect(result.content).toContain("[10:00:01] Alice: Hello team");
		expect(result.content).toContain("[10:00:05] Bob: Good morning");
	});

	it("formats as WebVTT", () => {
		const result = formatTranscript("vtt", {
			title: "Design Review",
			transcript: sampleCaptions,
		});

		expect(result.mimeType).toBe("text/vtt");
		expect(result.content).toContain("WEBVTT");
		expect(result.content).toContain("<v Alice>Hello team");
	});

	it("formats as JSON Lines (JSONL)", () => {
		const result = formatTranscript("jsonl", {
			title: "Design Review",
			transcript: sampleCaptions,
		});

		expect(result.mimeType).toBe("application/x-ndjson");
		const lines = result.content.trim().split("\n");
		expect(lines.length).toBe(3); // 1 meta line + 2 caption lines
		const first = JSON.parse(lines[0] || "{}");
		expect(first.type).toBe("meta");
		expect(first.title).toBe("Design Review");
	});

	it("formats as JSON", () => {
		const result = formatTranscript("json", {
			title: "Design Review",
			transcript: sampleCaptions,
		});

		expect(result.mimeType).toBe("application/json");
		const parsed = JSON.parse(result.content);
		expect(parsed.title).toBe("Design Review");
		expect(parsed.transcript.length).toBe(2);
	});

	it("formats as CSV", () => {
		const result = formatTranscript("csv", {
			title: "Design Review",
			transcript: sampleCaptions,
		});

		expect(result.mimeType).toBe("text/csv");
		expect(result.content).toContain("Time,Speaker,Text");
		expect(result.content).toContain('"10:00:01","Alice","Hello team"');
	});
});

describe("WebVTT parser", () => {
	it("parses WebVTT content with voice tags correctly", () => {
		const vtt = `WEBVTT

00:00:01.000 --> 00:00:04.000
<v John Doe>Welcome everyone to the call.

00:00:04.500 --> 00:00:07.000
<v Jane Smith>Thanks for having us.`;

		const parsed = parseWebVtt(vtt);
		expect(parsed.length).toBe(2);
		expect(parsed[0]?.Name).toBe("John Doe");
		expect(parsed[0]?.Text).toBe("Welcome everyone to the call.");
		expect(parsed[1]?.Name).toBe("Jane Smith");
		expect(parsed[1]?.Text).toBe("Thanks for having us.");
	});
});
