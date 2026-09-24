import {
	applyAliases,
	applyAliasesToAttendeeReport,
	formatTranscript,
} from "../../formatters/index.js";
import {
	clearAllMeetings,
	deleteMeeting,
	getAllMeetings,
	getMeeting,
	saveDirectoryHandle,
	updateMeetingStatus,
} from "../../storage/idb.js";
import { getSettings } from "../../storage/settings.js";
import type { ExportFormat, MeetingMetadata } from "../../types/captions.js";
import { copyToClipboard, showToast } from "../shared/toast.js";

let allMeetings: MeetingMetadata[] = [];
let pendingDeleteTimer: ReturnType<typeof setTimeout> | null = null;
let pendingDeletedMeeting: MeetingMetadata | null = null;

function highlightText(text: string, query: string): string {
	if (!query) return escapeHtml(text);
	const escapedText = escapeHtml(text);
	const escapedQuery = escapeHtml(query);
	const regex = new RegExp(
		`(${escapedQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`,
		"gi",
	);
	return escapedText.replace(regex, "<mark>$1</mark>");
}

function updateLiveBanner(): void {
	const banner = document.getElementById("live-recording-banner");
	const bannerText = document.getElementById("live-banner-text");
	const bannerViewBtn = document.getElementById("btn-live-banner-view");
	if (!banner || !bannerText) return;

	const liveMeeting = allMeetings.find(
		(m) => m.status === "live" && Date.now() - m.lastFlush < 6000,
	);

	if (liveMeeting) {
		banner.classList.add("show");
		bannerText.innerHTML = `<strong>Live Recording:</strong> ${escapeHtml(
			liveMeeting.title,
		)} (${liveMeeting.captionCount} lines)`;
		if (bannerViewBtn) {
			bannerViewBtn.onclick = () => {
				chrome.runtime.sendMessage({
					action: "open_viewer",
					meetingId: liveMeeting.id,
				});
			};
		}
	} else {
		banner.classList.remove("show");
	}
}

async function renderMeetings(query = ""): Promise<void> {
	const container = document.getElementById("meeting-list");
	const matchCountEl = document.getElementById("search-match-count");
	if (!container) return;

	updateLiveBanner();

	const normalizedQuery = query.toLowerCase().trim();
	const filtered = allMeetings.filter((m) =>
		m.title.toLowerCase().includes(normalizedQuery),
	);

	if (matchCountEl) {
		if (normalizedQuery) {
			matchCountEl.textContent = `Showing ${filtered.length} of ${allMeetings.length} meetings`;
		} else if (allMeetings.length > 0) {
			matchCountEl.textContent = `${allMeetings.length} recorded meeting${
				allMeetings.length === 1 ? "" : "s"
			}`;
		} else {
			matchCountEl.textContent = "";
		}
	}

	if (filtered.length === 0) {
		container.innerHTML = `<div class="empty-state">${
			allMeetings.length === 0
				? "No meetings recorded yet.<br><span style='font-size: 11px;'>Start or join a Teams meeting with captions to capture transcripts.</span>"
				: `No meetings match "${escapeHtml(query)}"`
		}</div>`;
		return;
	}

	container.innerHTML = "";

	for (const meeting of filtered) {
		const card = document.createElement("div");
		card.className = "meeting-card";
		card.id = `card-${meeting.id}`;

		const dateStr = new Date(meeting.startedAt).toLocaleString();
		const isStream = meeting.source === "stream";
		const isLive = meeting.status === "live";

		let badgeClass = "complete";
		let badgeText = "Saved";
		if (isLive) {
			badgeClass = "live";
			badgeText = "Live";
		} else if (isStream) {
			badgeClass = "stream";
			badgeText = "Stream";
		}

		const titleHtml = highlightText(meeting.title, query);
		const snippetHtml = meeting.previewSnippet
			? `<div class="meeting-snippet">${escapeHtml(
					meeting.previewSnippet,
				)}</div>`
			: "";

		card.innerHTML = `
      <div class="meeting-header">
        <span class="meeting-title">${titleHtml}</span>
        <span class="badge ${badgeClass}">${badgeText}</span>
      </div>
      ${snippetHtml}
      <div class="meeting-meta">
        <span>📅 ${dateStr}</span>
        <span>💬 ${meeting.captionCount} lines</span>
        ${
					meeting.attendeeCount > 0
						? `<span>👥 ${meeting.attendeeCount} attendees</span>`
						: ""
				}
      </div>
      <div class="meeting-actions">
        <div class="export-control">
          <select class="format-select" id="fmt-${meeting.id}">
            <option value="md">Markdown (.md)</option>
            <option value="txt">Plain Text (.txt)</option>
            <option value="vtt">WebVTT (.vtt)</option>
            <option value="json">Full JSON (.json)</option>
            <option value="jsonl">JSON Lines (.jsonl)</option>
            <option value="csv">CSV (.csv)</option>
          </select>
          <button type="button" class="btn small" data-action="export" data-id="${meeting.id}">Download</button>
          <button type="button" class="btn small" data-action="copy" data-id="${meeting.id}" title="Copy Markdown transcript to clipboard">📋 Copy</button>
        </div>
        <div>
          <button type="button" class="btn small primary" data-action="view" data-id="${meeting.id}">View</button>
          <button type="button" class="btn small danger" data-action="delete" data-id="${meeting.id}" title="Delete meeting">🗑️</button>
        </div>
      </div>
    `;

		container.appendChild(card);
	}
}

function escapeHtml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

async function copyMeetingTranscript(meetingId: string): Promise<void> {
	const record = await getMeeting(meetingId);
	if (!record) {
		showToast("⚠️ Could not load meeting transcript");
		return;
	}

	const settings = await getSettings();
	const aliasedCaptions = applyAliases(record.transcript, settings.aliases);
	const aliasedAttendees = applyAliasesToAttendeeReport(
		record.attendeeReport,
		settings.aliases,
	);
	const { content: markdown } = formatTranscript("md", {
		title: record.title,
		transcript: aliasedCaptions,
		attendeeReport: aliasedAttendees,
		startedAt: record.startedAt,
		source: record.source,
	});

	const ok = await copyToClipboard(markdown);
	if (ok) {
		showToast("📋 Copied transcript to clipboard!");
	} else {
		showToast("⚠️ Clipboard copy failed");
	}
}

async function checkFolderStatus(): Promise<void> {
	const banner = document.getElementById("folder-banner");
	const statusText = document.getElementById("folder-status-text");
	if (!banner || !statusText) return;

	chrome.runtime.sendMessage(
		{ action: "check_directory_handle" },
		(response) => {
			if (chrome.runtime.lastError || !response) {
				statusText.textContent = "Folder sync: Not set";
				return;
			}

			if (response.status === "granted") {
				statusText.textContent = `📁 Syncing to: ${response.name}`;
				const pickBtn = document.getElementById("btn-pick-folder");
				if (pickBtn) pickBtn.textContent = "Change Folder";
			} else if (response.status === "prompt_needed") {
				statusText.textContent = `⚠️ Permission required: ${response.name}`;
				const pickBtn = document.getElementById("btn-pick-folder");
				if (pickBtn) pickBtn.textContent = "Re-grant Access";
			} else {
				statusText.textContent = "Folder sync: Not configured";
				const pickBtn = document.getElementById("btn-pick-folder");
				if (pickBtn) pickBtn.textContent = "Set Folder";
			}
		},
	);
}

async function refreshData(): Promise<void> {
	const latestMeetings = await getAllMeetings();
	const now = Date.now();
	for (const m of latestMeetings) {
		if (m.status === "live" && now - m.lastFlush > 6000) {
			m.status = "complete";
			m.endedAt = m.lastFlush;
			updateMeetingStatus(m.id, "complete").catch(() => {});
		}
	}
	allMeetings = latestMeetings;
	const searchVal =
		(document.getElementById("search-input") as HTMLInputElement)?.value || "";
	await renderMeetings(searchVal);
}

async function init(): Promise<void> {
	await refreshData();
	await checkFolderStatus();

	// Real-time live update listeners
	chrome.runtime.onMessage.addListener((message) => {
		if (
			message.action === "live_caption_update" ||
			message.action === "flush_live_captions" ||
			message.action === "finalize_live_meeting"
		) {
			refreshData();
		}
	});

	// Poll every 1.5s while popup is open to keep UI and line counts live
	setInterval(refreshData, 1500);

	// Live banner click
	document
		.getElementById("btn-live-banner-view")
		?.addEventListener("click", () => {
			const liveMeeting = allMeetings.find(
				(m) => m.status === "live" && Date.now() - m.lastFlush < 15000,
			);
			chrome.runtime.sendMessage({
				action: "open_viewer",
				meetingId: liveMeeting?.id,
			});
		});

	// Keyboard shortcut (/ to focus search)
	window.addEventListener("keydown", (e) => {
		const searchInput = document.getElementById(
			"search-input",
		) as HTMLInputElement | null;
		if (!searchInput) return;

		if (e.key === "/" && document.activeElement !== searchInput) {
			e.preventDefault();
			searchInput.focus();
			searchInput.select();
		} else if (e.key === "Escape" && document.activeElement === searchInput) {
			searchInput.value = "";
			searchInput.blur();
			renderMeetings();
		}
	});

	// Search input
	document.getElementById("search-input")?.addEventListener("input", (e) => {
		const val = (e.target as HTMLInputElement).value;
		renderMeetings(val);
	});

	// Action delegation
	document
		.getElementById("meeting-list")
		?.addEventListener("click", async (e) => {
			const target = e.target as HTMLElement | null;
			if (!target) return;

			const action = target.getAttribute("data-action");
			const meetingId = target.getAttribute("data-id");

			if (!meetingId) return;

			if (action === "export") {
				const select = document.getElementById(
					`fmt-${meetingId}`,
				) as HTMLSelectElement | null;
				const format = (select?.value || "md") as ExportFormat;

				target.textContent = "Saving...";
				chrome.runtime.sendMessage(
					{ action: "export_meeting", meetingId, format },
					() => {
						target.textContent = "Download";
						showToast(`✓ Exported ${format.toUpperCase()} to Downloads`);
					},
				);
			} else if (action === "copy") {
				await copyMeetingTranscript(meetingId);
			} else if (action === "view") {
				chrome.runtime.sendMessage({ action: "open_viewer", meetingId });
			} else if (action === "delete") {
				// Safe delete with 5-second Undo
				const toDeleteIndex = allMeetings.findIndex((m) => m.id === meetingId);
				if (toDeleteIndex === -1) return;

				// Commit previous pending deletion if any
				if (pendingDeleteTimer && pendingDeletedMeeting) {
					clearTimeout(pendingDeleteTimer);
					await deleteMeeting(pendingDeletedMeeting.id);
				}

				const [deleted] = allMeetings.splice(toDeleteIndex, 1);
				if (deleted) {
					pendingDeletedMeeting = deleted;
					const searchVal =
						(document.getElementById("search-input") as HTMLInputElement)
							?.value || "";
					renderMeetings(searchVal);

					showToast(`Meeting deleted.`, async () => {
						// Undo callback
						if (pendingDeleteTimer) clearTimeout(pendingDeleteTimer);
						if (pendingDeletedMeeting) {
							allMeetings.splice(toDeleteIndex, 0, pendingDeletedMeeting);
							pendingDeletedMeeting = null;
							renderMeetings(searchVal);
							showToast("✓ Meeting restored");
						}
					});

					pendingDeleteTimer = setTimeout(async () => {
						if (pendingDeletedMeeting) {
							await deleteMeeting(pendingDeletedMeeting.id);
							pendingDeletedMeeting = null;
						}
					}, 5000);
				}
			}
		});

	// Open Viewer
	document.getElementById("btn-open-viewer")?.addEventListener("click", () => {
		chrome.runtime.sendMessage({ action: "open_viewer" });
	});

	// Open Options
	document.getElementById("btn-open-options")?.addEventListener("click", () => {
		chrome.runtime.openOptionsPage();
	});

	// Clear All with safe confirmation
	document
		.getElementById("btn-clear-all")
		?.addEventListener("click", async () => {
			if (allMeetings.length === 0) {
				showToast("No meetings to clear");
				return;
			}
			if (
				window.confirm(
					`Are you sure you want to permanently delete ALL ${allMeetings.length} meeting records?`,
				)
			) {
				await clearAllMeetings();
				allMeetings = [];
				renderMeetings();
				showToast("✓ All history cleared");
			}
		});

	// Pick folder
	document
		.getElementById("btn-pick-folder")
		?.addEventListener("click", async () => {
			if (typeof window.showDirectoryPicker !== "function") {
				showToast(
					"Direct folder writing is not supported in this browser. Transcripts save to Downloads.",
				);
				return;
			}
			try {
				const handle = await window.showDirectoryPicker({ mode: "readwrite" });
				if (handle) {
					await saveDirectoryHandle(handle);
					await checkFolderStatus();
					showToast(`✓ Output folder set to "${handle.name}"`);
				}
			} catch {
				// User cancelled folder picker
			}
		});
}

document.addEventListener("DOMContentLoaded", init);
