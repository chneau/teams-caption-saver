import {
	applyAliases,
	applyAliasesToAttendeeReport,
	buildExportFilename,
	formatTranscript,
	parseWebVtt,
} from "../formatters/index.js";
import {
	saveTranscriptsToDirectory,
	verifyDirectoryPermission,
} from "../storage/fsAccess.js";
import {
	clearAllMeetings,
	deleteMeeting,
	getDirectoryHandle,
	getMeeting,
	saveLiveMeeting,
} from "../storage/idb.js";
import { getSettings, saveSettings } from "../storage/settings.js";
import type { ExportFormat, ServiceWorkerMessage } from "../types/captions.js";

// Dynamic Content Script Registration for granted SharePoint/Stream tenants
async function updateContentScripts(): Promise<void> {
	const settings = await getSettings();
	const granted = settings.grantedTenants || [];

	try {
		const existing = await chrome.scripting.getRegisteredContentScripts();
		const ids = existing.map((s) => s.id);
		if (ids.length > 0) {
			await chrome.scripting.unregisterContentScripts({ ids });
		}

		if (granted.length > 0) {
			const matches = granted.map((origin) => `${origin.replace(/\/$/, "")}/*`);

			// Register isolated relay
			await chrome.scripting.registerContentScripts([
				{
					id: "stream_relay",
					matches,
					js: ["content/relay.js"],
					runAt: "document_start",
					world: "ISOLATED",
				},
				{
					id: "stream_interceptor",
					matches,
					js: ["content/interceptor.js"],
					runAt: "document_start",
					world: "MAIN",
				},
			]);
		}
	} catch (err) {
		console.debug("[Service Worker] Error updating content scripts:", err);
	}
}

// Downloads API export helper
async function triggerDownload(
	filename: string,
	content: string,
	mimeType = "text/plain",
): Promise<number> {
	const blob = new Blob([content], { type: mimeType });
	const reader = new FileReader();

	return new Promise((resolve, reject) => {
		reader.onloadend = () => {
			const base64Url = reader.result as string;
			chrome.downloads.download(
				{
					url: base64Url,
					filename,
					saveAs: false,
				},
				(downloadId) => {
					if (chrome.runtime.lastError) {
						reject(chrome.runtime.lastError);
					} else {
						resolve(downloadId);
					}
				},
			);
		};
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(blob);
	});
}

async function exportMeetingToDownloads(
	meetingId: string,
	format: ExportFormat,
): Promise<number> {
	const meeting = await getMeeting(meetingId);
	if (!meeting) throw new Error("Meeting not found");

	const settings = await getSettings();
	const transcript = applyAliases(meeting.transcript, settings.aliases);
	const attendeeReport = applyAliasesToAttendeeReport(
		meeting.attendeeReport,
		settings.aliases,
	);
	const date = new Date(meeting.startedAt);
	const filename = buildExportFilename(meeting.title, date, format);

	const { content, mimeType } = formatTranscript(format, {
		title: meeting.title,
		transcript,
		attendeeReport,
		startedAt: meeting.startedAt,
		source: meeting.source,
	});

	return triggerDownload(filename, content, mimeType);
}

// Badge management
function updateBadge(text = "", color = "#1a73e8"): void {
	chrome.action.setBadgeText({ text });
	if (text) {
		chrome.action.setBadgeBackgroundColor({ color });
	}
}

// Listen to messages
chrome.runtime.onMessage.addListener((rawMessage, _sender, sendResponse) => {
	const message = rawMessage as ServiceWorkerMessage;

	(async () => {
		switch (message.action) {
			case "flush_live_captions": {
				const settings = await getSettings();
				const aliasedCaptions = applyAliases(
					message.captions,
					settings.aliases,
				);
				const aliasedAttendees = applyAliasesToAttendeeReport(
					message.attendeeReport,
					settings.aliases,
				);

				await saveLiveMeeting(
					message.meetingId,
					message.title,
					message.startedAt,
					aliasedCaptions,
					aliasedAttendees,
					"live",
					"live",
				);

				if (settings.autoSaveDirectory) {
					await saveTranscriptsToDirectory(
						message.title,
						message.startedAt,
						aliasedCaptions,
						aliasedAttendees,
						settings.defaultFormats,
						settings.subfolderPattern,
						"live",
					);
				}

				updateBadge("REC", "#E53935");
				sendResponse({ success: true });
				break;
			}

			case "finalize_live_meeting": {
				const settings = await getSettings();
				const aliasedCaptions = applyAliases(
					message.captions,
					settings.aliases,
				);
				const aliasedAttendees = applyAliasesToAttendeeReport(
					message.attendeeReport,
					settings.aliases,
				);

				await saveLiveMeeting(
					message.meetingId,
					message.title,
					message.startedAt,
					aliasedCaptions,
					aliasedAttendees,
					"complete",
					"live",
				);

				if (settings.autoSaveDirectory) {
					await saveTranscriptsToDirectory(
						message.title,
						message.startedAt,
						aliasedCaptions,
						aliasedAttendees,
						settings.defaultFormats,
						settings.subfolderPattern,
						"live",
					);
				}

				if (settings.autoSaveDownloads) {
					for (const fmt of settings.defaultFormats) {
						await exportMeetingToDownloads(message.meetingId, fmt).catch(
							() => {},
						);
					}
				}

				updateBadge("");
				sendResponse({ success: true });
				break;
			}

			case "recording_transcript_found": {
				const parsed = parseWebVtt(message.webvtt);
				if (parsed.length === 0) {
					sendResponse({ success: false, reason: "empty_transcript" });
					return;
				}

				const settings = await getSettings();
				const aliasedCaptions = applyAliases(parsed, settings.aliases);
				const meetingId = `stream_${Date.now()}_${Math.random()
					.toString(36)
					.substring(2, 8)}`;
				const startedAt = Date.now();

				await saveLiveMeeting(
					meetingId,
					message.title,
					startedAt,
					aliasedCaptions,
					null,
					"complete",
					"stream",
				);

				if (settings.autoSaveDirectory) {
					await saveTranscriptsToDirectory(
						message.title,
						startedAt,
						aliasedCaptions,
						null,
						settings.defaultFormats,
						settings.subfolderPattern,
						"stream",
					);
				}

				if (settings.autoSaveDownloads) {
					for (const fmt of settings.defaultFormats) {
						await exportMeetingToDownloads(meetingId, fmt).catch(() => {});
					}
				}

				updateBadge("SAVED", "#43A047");
				setTimeout(() => updateBadge(""), 4000);
				sendResponse({ success: true, meetingId });
				break;
			}

			case "export_meeting": {
				const downloadId = await exportMeetingToDownloads(
					message.meetingId,
					message.format,
				);
				sendResponse({ success: true, downloadId });
				break;
			}

			case "delete_meeting": {
				await deleteMeeting(message.meetingId);
				sendResponse({ success: true });
				break;
			}

			case "clear_all_meetings": {
				await clearAllMeetings();
				sendResponse({ success: true });
				break;
			}

			case "get_settings": {
				const settings = await getSettings();
				sendResponse({ settings });
				break;
			}

			case "save_settings": {
				await saveSettings(message.settings);
				if (message.settings.grantedTenants) {
					await updateContentScripts();
				}
				sendResponse({ success: true });
				break;
			}

			case "check_directory_handle": {
				const handle = await getDirectoryHandle();
				if (!handle) {
					sendResponse({ status: "no_handle" });
					return;
				}
				const granted = await verifyDirectoryPermission(handle, false);
				sendResponse({
					status: granted ? "granted" : "prompt_needed",
					name: handle.name,
				});
				break;
			}

			case "grant_tenant": {
				const settings = await getSettings();
				const set = new Set(settings.grantedTenants || []);
				set.add(message.origin);
				await saveSettings({ grantedTenants: Array.from(set) });
				await updateContentScripts();
				sendResponse({ success: true });
				break;
			}

			case "revoke_tenant": {
				const settings = await getSettings();
				const set = new Set(settings.grantedTenants || []);
				set.delete(message.origin);
				await saveSettings({ grantedTenants: Array.from(set) });
				await updateContentScripts();
				sendResponse({ success: true });
				break;
			}

			case "open_viewer": {
				const viewerUrl = chrome.runtime.getURL(
					message.meetingId
						? `ui/viewer/viewer.html?meetingId=${encodeURIComponent(
								message.meetingId,
							)}`
						: "ui/viewer/viewer.html",
				);
				chrome.tabs.create({ url: viewerUrl });
				sendResponse({ success: true });
				break;
			}

			default:
				sendResponse({ error: "Unknown action" });
		}
	})().catch((err: Error) => {
		sendResponse({ error: err.message });
	});

	return true; // Keep channel open for async response
});

// Setup on startup and install
chrome.runtime.onInstalled.addListener(() => {
	updateContentScripts();
});

chrome.runtime.onStartup.addListener(() => {
	updateContentScripts();
});

chrome.tabs.onRemoved.addListener(() => {
	chrome.tabs.query(
		{ url: ["*://teams.microsoft.com/*", "*://teams.live.com/*"] },
		(tabs) => {
			if (!tabs || tabs.length === 0) {
				updateBadge("");
			}
		},
	);
});
