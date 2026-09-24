import type {
	AttendeeReport,
	CaptionEntry,
	MeetingMetadata,
	MeetingRecord,
	MeetingSource,
	MeetingStatus,
} from "../types/captions.js";

const DB_NAME = "teams_captions_db";
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
	if (dbPromise) return dbPromise;

	dbPromise = new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);

		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains("meetings")) {
				const meetings = db.createObjectStore("meetings", { keyPath: "id" });
				meetings.createIndex("startedAt", "startedAt");
			}
			if (!db.objectStoreNames.contains("transcripts")) {
				db.createObjectStore("transcripts", { keyPath: "meetingId" });
			}
			if (!db.objectStoreNames.contains("handles")) {
				db.createObjectStore("handles", { keyPath: "key" });
			}
		};

		request.onsuccess = () => resolve(request.result);
		request.onerror = () => {
			dbPromise = null;
			reject(request.error);
		};
	});

	return dbPromise;
}

async function withTransaction<T>(
	storeNames: string[],
	mode: IDBTransactionMode,
	fn: (tx: IDBTransaction) => Promise<T> | T,
): Promise<T> {
	const db = await openDatabase();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(storeNames, mode);
		let result: T;

		Promise.resolve()
			.then(() => fn(tx))
			.then((r) => {
				result = r;
			})
			.catch(reject);

		tx.oncomplete = () => resolve(result);
		tx.onerror = () => reject(tx.error);
		tx.onabort = () => reject(tx.error || new Error("Transaction aborted"));
	});
}

function promisifyRequest<T>(req: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

export async function saveLiveMeeting(
	meetingId: string,
	title: string,
	startedAt: number,
	transcript: CaptionEntry[],
	attendeeReport?: AttendeeReport | null,
	status: MeetingStatus = "live",
	source: MeetingSource = "live",
): Promise<void> {
	await withTransaction(["meetings", "transcripts"], "readwrite", (tx) => {
		const meetingsStore = tx.objectStore("meetings");
		const transcriptsStore = tx.objectStore("transcripts");

		let previewSnippet = "";
		if (transcript.length > 0) {
			const last = transcript[transcript.length - 1];
			if (last) {
				const snippetText =
					last.Text.length > 90 ? `${last.Text.slice(0, 87)}...` : last.Text;
				previewSnippet = `${last.Name}: "${snippetText}"`;
			}
		}

		const meta: MeetingMetadata = {
			id: meetingId,
			title,
			startedAt,
			endedAt: status === "complete" ? Date.now() : null,
			status,
			lastFlush: Date.now(),
			captionCount: transcript.length,
			attendeeCount: attendeeReport?.totalUniqueAttendees ?? 0,
			attendeeReport: attendeeReport ?? null,
			source,
			previewSnippet: previewSnippet || undefined,
		};

		meetingsStore.put(meta);
		if (transcript.length > 0 || !meta.previewSnippet) {
			transcriptsStore.put({ meetingId, transcript });
		}
	});
}

export async function updateMeetingStatus(
	meetingId: string,
	status: MeetingStatus,
): Promise<void> {
	await withTransaction(["meetings"], "readwrite", async (tx) => {
		const meetingsStore = tx.objectStore("meetings");
		const meta = await promisifyRequest<MeetingMetadata | undefined>(
			meetingsStore.get(meetingId),
		);
		if (meta) {
			meta.status = status;
			if (status === "complete" && !meta.endedAt) {
				meta.endedAt = Date.now();
			}
			meetingsStore.put(meta);
		}
	});
}

export async function getMeeting(
	meetingId: string,
): Promise<MeetingRecord | null> {
	return withTransaction(
		["meetings", "transcripts"],
		"readonly",
		async (tx) => {
			const meta = await promisifyRequest<MeetingMetadata | undefined>(
				tx.objectStore("meetings").get(meetingId),
			);
			if (!meta) return null;

			const trans = await promisifyRequest<
				{ meetingId: string; transcript: CaptionEntry[] } | undefined
			>(tx.objectStore("transcripts").get(meetingId));

			return {
				...meta,
				transcript: trans?.transcript ?? [],
			};
		},
	);
}

export async function getAllMeetings(): Promise<MeetingMetadata[]> {
	return withTransaction(["meetings"], "readonly", async (tx) => {
		const results =
			(await promisifyRequest<MeetingMetadata[]>(
				tx.objectStore("meetings").index("startedAt").getAll(),
			)) ?? [];
		return results.sort((a, b) => b.startedAt - a.startedAt);
	});
}

export async function deleteMeeting(meetingId: string): Promise<void> {
	await withTransaction(["meetings", "transcripts"], "readwrite", (tx) => {
		tx.objectStore("meetings").delete(meetingId);
		tx.objectStore("transcripts").delete(meetingId);
	});
}

export async function clearAllMeetings(): Promise<void> {
	await withTransaction(["meetings", "transcripts"], "readwrite", (tx) => {
		tx.objectStore("meetings").clear();
		tx.objectStore("transcripts").clear();
	});
}

// Storing Directory Handle (Structured Clone)
export async function saveDirectoryHandle(
	handle: FileSystemDirectoryHandle,
): Promise<void> {
	await withTransaction(["handles"], "readwrite", (tx) => {
		tx.objectStore("handles").put({
			key: "output_directory",
			handle,
			name: handle.name,
		});
	});
}

export async function getDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
	return withTransaction(["handles"], "readonly", async (tx) => {
		const res = await promisifyRequest<
			{ handle: FileSystemDirectoryHandle } | undefined
		>(tx.objectStore("handles").get("output_directory"));
		return res?.handle ?? null;
	});
}

export async function clearDirectoryHandle(): Promise<void> {
	await withTransaction(["handles"], "readwrite", (tx) => {
		tx.objectStore("handles").delete("output_directory");
	});
}
