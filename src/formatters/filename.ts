export function sanitizeFilename(title: string): string {
	if (!title) return "Meeting";
	const parts = title.split("|");
	const meetingName = parts.length > 2 ? (parts[1] ?? "") : (parts[0] ?? "");
	const cleanedName = meetingName.replace("Microsoft Teams", "").trim();
	const sanitized = cleanedName
		.replace(/[<>:"/\\|?*]/g, "_")
		.split("")
		.map((ch) => (ch.charCodeAt(0) < 32 ? "_" : ch))
		.join("")
		.trim();
	return sanitized.length > 0 ? sanitized : "Meeting";
}

export function formatTimestamp(date: Date = new Date()): string {
	const pad = (n: number) => n.toString().padStart(2, "0");
	const year = date.getFullYear();
	const month = pad(date.getMonth() + 1);
	const day = pad(date.getDate());
	const hours = pad(date.getHours());
	const minutes = pad(date.getMinutes());
	const seconds = pad(date.getSeconds());
	return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
}

export function buildExportFilename(
	title: string,
	date: Date = new Date(),
	ext: string,
): string {
	const safeTitle = sanitizeFilename(title);
	const stamp = formatTimestamp(date);
	const cleanExt = ext.startsWith(".") ? ext.slice(1) : ext;
	return `${stamp}_${safeTitle}.${cleanExt}`;
}
