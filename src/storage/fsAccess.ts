import {
	buildExportFilename,
	formatTranscript,
	sanitizeFilename,
} from "../formatters/index.js";
import type {
	AttendeeReport,
	CaptionEntry,
	ExportFormat,
} from "../types/captions.js";
import { getDirectoryHandle } from "./idb.js";

export async function verifyDirectoryPermission(
	handle: FileSystemDirectoryHandle,
	request = false,
): Promise<boolean> {
	const options: FileSystemHandlePermissionDescriptor = { mode: "readwrite" };
	if ((await handle.queryPermission(options)) === "granted") {
		return true;
	}
	if (request) {
		if ((await handle.requestPermission(options)) === "granted") {
			return true;
		}
	}
	return false;
}

async function getTargetSubdirectory(
	rootHandle: FileSystemDirectoryHandle,
	pattern: "none" | "date" | "tenant" | "meeting",
	title: string,
	date: Date = new Date(),
): Promise<FileSystemDirectoryHandle> {
	if (pattern === "none") return rootHandle;

	let subfolderName = "";
	if (pattern === "date") {
		const pad = (n: number) => n.toString().padStart(2, "0");
		subfolderName = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
			date.getDate(),
		)}`;
	} else if (pattern === "meeting") {
		subfolderName = sanitizeFilename(title);
	}

	if (!subfolderName) return rootHandle;

	try {
		return await rootHandle.getDirectoryHandle(subfolderName, { create: true });
	} catch {
		return rootHandle;
	}
}

async function writeContentToFile(
	dirHandle: FileSystemDirectoryHandle,
	filename: string,
	content: string,
): Promise<void> {
	const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
	const writable = await fileHandle.createWritable();
	await writable.write(content);
	await writable.close();
}

export async function saveTranscriptsToDirectory(
	title: string,
	startedAt: number,
	transcript: CaptionEntry[],
	attendeeReport: AttendeeReport | null | undefined,
	formats: ExportFormat[] = ["md", "txt"],
	pattern: "none" | "date" | "tenant" | "meeting" = "none",
	source: "live" | "stream" = "live",
): Promise<boolean> {
	const rootHandle = await getDirectoryHandle();
	if (!rootHandle) return false;

	const hasPermission = await verifyDirectoryPermission(rootHandle, false);
	if (!hasPermission) return false;

	const date = new Date(startedAt);
	const targetDir = await getTargetSubdirectory(
		rootHandle,
		pattern,
		title,
		date,
	);

	for (const fmt of formats) {
		const filename = buildExportFilename(title, date, fmt);
		const { content } = formatTranscript(fmt, {
			title,
			transcript,
			attendeeReport,
			startedAt,
			source,
		});

		if (content) {
			await writeContentToFile(targetDir, filename, content);
		}
	}

	return true;
}
