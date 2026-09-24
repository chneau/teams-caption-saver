import type { AttendeeReport, CaptionEntry } from "../types/captions.js";

export function formatAsJsonl(
	title: string,
	transcript: CaptionEntry[],
	attendeeReport?: AttendeeReport | null,
): string {
	const meta = JSON.stringify({
		type: "meta",
		title,
		generatedAt: new Date().toISOString(),
		totalLines: transcript.length,
		attendees: attendeeReport?.attendeeList ?? [],
	});

	const lines = transcript.map((entry) =>
		JSON.stringify({
			type: "caption",
			time: entry.Time,
			speaker: entry.Name,
			text: entry.Text,
			timestampMs: entry.TimestampMs,
		}),
	);

	return [meta, ...lines].join("\n");
}

export function formatAsJson(
	title: string,
	transcript: CaptionEntry[],
	attendeeReport?: AttendeeReport | null,
	metadata?: Record<string, unknown>,
): string {
	return JSON.stringify(
		{
			title,
			exportedAt: new Date().toISOString(),
			metadata: metadata ?? {},
			attendeeReport: attendeeReport ?? null,
			transcript,
		},
		null,
		2,
	);
}

export function formatAsCsv(transcript: CaptionEntry[]): string {
	const escapeCsv = (str: string) => `"${str.replace(/"/g, '""')}"`;
	const header = "Time,Speaker,Text\n";
	const rows = transcript
		.map(
			(e) => `${escapeCsv(e.Time)},${escapeCsv(e.Name)},${escapeCsv(e.Text)}`,
		)
		.join("\n");
	return header + rows;
}
