export interface CaptionEntry {
	Name: string;
	Text: string;
	Time: string;
	TimestampMs?: number;
}

export interface AttendeeEvent {
	name: string;
	action: "joined" | "left";
	timestamp: string;
}

export interface CurrentAttendee {
	name: string;
	role: string;
}

export interface AttendeeReport {
	totalUniqueAttendees: number;
	meetingStartTime: string | number;
	lastUpdated: string | number;
	attendeeList: string[];
	currentAttendees: CurrentAttendee[];
	attendeeHistory: AttendeeEvent[];
}

export type MeetingStatus = "live" | "complete" | "recovered";
export type MeetingSource = "live" | "stream";

export interface MeetingMetadata {
	id: string;
	title: string;
	startedAt: number;
	endedAt?: number | null;
	status: MeetingStatus;
	lastFlush: number;
	captionCount: number;
	attendeeCount: number;
	attendeeReport?: AttendeeReport | null;
	source: MeetingSource;
	previewSnippet?: string;
}

export interface MeetingRecord extends MeetingMetadata {
	transcript: CaptionEntry[];
}

export type ExportFormat = "txt" | "md" | "vtt" | "json" | "jsonl" | "csv";

export interface ExtensionSettings {
	[key: string]: unknown;
	autoEnableCaptions: boolean;
	autoSaveDownloads: boolean;
	autoSaveDirectory: boolean;
	defaultFormats: ExportFormat[];
	aliases: Record<string, string>;
	grantedTenants: string[];
	subfolderPattern: "none" | "date" | "tenant" | "meeting";
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
	autoEnableCaptions: true,
	autoSaveDownloads: true,
	autoSaveDirectory: false,
	defaultFormats: ["md"],
	aliases: {},
	grantedTenants: [],
	subfolderPattern: "none",
};

export type ServiceWorkerMessage =
	| {
			action: "flush_live_captions";
			meetingId: string;
			title: string;
			startedAt: number;
			captions: CaptionEntry[];
			attendeeReport?: AttendeeReport | null;
	  }
	| {
			action: "finalize_live_meeting";
			meetingId: string;
			title: string;
			startedAt: number;
			captions: CaptionEntry[];
			attendeeReport?: AttendeeReport | null;
	  }
	| {
			action: "recording_transcript_found";
			title: string;
			url: string;
			webvtt: string;
			duration?: number;
	  }
	| { action: "get_status" }
	| { action: "export_meeting"; meetingId: string; format: ExportFormat }
	| { action: "export_all"; format: ExportFormat }
	| { action: "delete_meeting"; meetingId: string }
	| { action: "clear_all_meetings" }
	| { action: "set_aliases"; aliases: Record<string, string> }
	| { action: "get_settings" }
	| { action: "save_settings"; settings: Partial<ExtensionSettings> }
	| { action: "check_directory_handle" }
	| { action: "request_directory_handle" }
	| { action: "grant_tenant"; origin: string }
	| { action: "revoke_tenant"; origin: string }
	| { action: "open_viewer"; meetingId?: string };

export interface LiveBroadcastMessage {
	action: "live_caption_update";
	meetingId: string;
	title: string;
	captions: CaptionEntry[];
	attendeeReport?: AttendeeReport | null;
	isMeetingOver?: boolean;
}
