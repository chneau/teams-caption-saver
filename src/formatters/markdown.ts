import type { AttendeeReport, CaptionEntry } from "../types/captions.js";

export function formatAsMarkdown(
	title: string,
	transcript: CaptionEntry[],
	attendeeReport?: AttendeeReport | null,
	metadata?: { startedAt?: number; source?: string },
): string {
	let output = `# ${title || "Meeting Transcript"}\n\n`;

	if (metadata?.startedAt) {
		output += `**Date:** ${new Date(metadata.startedAt).toLocaleString()}\n`;
	}
	if (metadata?.source) {
		output += `**Source:** ${
			metadata.source === "stream"
				? "Stream / SharePoint Recording"
				: "Teams Live Captions"
		}\n`;
	}
	output += `**Total Lines:** ${transcript.length}\n\n`;

	if (attendeeReport && attendeeReport.totalUniqueAttendees > 0) {
		output += "## Meeting Attendees\n\n";
		output += `- **Total Attendees:** ${attendeeReport.totalUniqueAttendees}\n`;
		output += `- **Meeting Start:** ${new Date(
			attendeeReport.meetingStartTime,
		).toLocaleString()}\n\n`;
		output += "### Attendee List\n\n";
		for (const name of attendeeReport.attendeeList) {
			output += `- ${name}\n`;
		}
		output += "\n---\n\n";
	}

	output += "## Transcript\n\n";
	for (const entry of transcript) {
		output += `**[${entry.Time}] ${entry.Name}**  \n${entry.Text}\n\n`;
	}

	return output;
}
