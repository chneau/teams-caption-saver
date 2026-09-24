import type { AttendeeReport, CaptionEntry } from "../types/captions.js";

export function formatAsTxt(
	transcript: CaptionEntry[],
	attendeeReport?: AttendeeReport | null,
): string {
	let output = "";

	if (attendeeReport && attendeeReport.totalUniqueAttendees > 0) {
		output += "=== MEETING ATTENDEES ===\n";
		output += `Total Attendees: ${attendeeReport.totalUniqueAttendees}\n`;
		output += `Meeting Start: ${new Date(
			attendeeReport.meetingStartTime,
		).toLocaleString()}\n\n`;
		output += "Attendee List:\n";
		for (const name of attendeeReport.attendeeList) {
			output += `- ${name}\n`;
		}
		output += "\n=== TRANSCRIPT ===\n\n";
	}

	output += transcript
		.map((entry) => `[${entry.Time}] ${entry.Name}: ${entry.Text}`)
		.join("\n");
	return output;
}
