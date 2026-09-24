import {
	applyAliases,
	applyAliasesToAttendeeReport,
	formatTranscript,
} from "../../formatters/index.js";
import { getMeeting } from "../../storage/idb.js";
import { getSettings, saveSettings } from "../../storage/settings.js";
import type {
	AttendeeReport,
	CaptionEntry,
	ExportFormat,
	LiveBroadcastMessage,
} from "../../types/captions.js";
import { copyToClipboard, showToast } from "../shared/toast.js";

let currentMeetingId = "";
let currentTitle = "Waiting for Meeting...";
let currentStartedAt = 0;
let captions: CaptionEntry[] = [];
let attendeeReport: AttendeeReport | null = null;
let isMeetingOver = false;
let isHistorical = false;
let aliases: Record<string, string> = {};

let userScrolledUp = false;
let unreadCount = 0;

function getInitials(name: string): string {
	const parts = name.trim().split(/\s+/);
	if (parts.length === 1) return (parts[0]?.[0] ?? "?").toUpperCase();
	return `${parts[0]?.[0] ?? ""}${parts[parts.length - 1]?.[0] ?? ""}`.toUpperCase();
}

function renderHeader(): void {
	const titleEl = document.getElementById("meeting-title");
	const statusEl = document.getElementById("meeting-status");
	const timeEl = document.getElementById("meeting-time");
	const countEl = document.getElementById("caption-count");

	if (titleEl) titleEl.textContent = currentTitle;

	if (timeEl) {
		if (currentStartedAt > 0) {
			timeEl.textContent = `📅 Started: ${new Date(
				currentStartedAt,
			).toLocaleTimeString()}`;
		} else {
			timeEl.textContent = "📅 No active stream";
		}
	}

	if (countEl) countEl.textContent = `💬 ${captions.length} lines`;

	if (statusEl) {
		if (isHistorical) {
			statusEl.className = "badge history";
			statusEl.textContent = "SAVED";
		} else if (isMeetingOver) {
			statusEl.className = "badge complete";
			statusEl.textContent = "COMPLETE";
		} else if (captions.length > 0) {
			statusEl.className = "badge live";
			statusEl.textContent = "LIVE";
		} else {
			statusEl.className = "badge complete";
			statusEl.textContent = "IDLE";
		}
	}
}

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

function renderCaptions(): void {
	const container = document.getElementById("captions-container");
	const matchCountEl = document.getElementById("search-match-count");
	if (!container) return;

	const filter =
		(document.getElementById("filter-input") as HTMLInputElement)?.value
			.toLowerCase()
			.trim() || "";
	const aliased = applyAliases(captions, aliases);

	const filtered = filter
		? aliased.filter(
				(c) =>
					c.Name.toLowerCase().includes(filter) ||
					c.Text.toLowerCase().includes(filter),
			)
		: aliased;

	if (matchCountEl) {
		if (filter) {
			matchCountEl.textContent = `Showing ${filtered.length} of ${captions.length} lines`;
		} else {
			matchCountEl.textContent = "";
		}
	}

	if (filtered.length === 0) {
		if (captions.length === 0) {
			container.innerHTML = `
				<div class="empty-notice">
					<h3>No Active Captions Stream</h3>
					<p>Open Microsoft Teams on the web with live captions enabled to view and capture speech in real time.</p>
					<div class="tip-card">
						<strong>💡 Watching a Stream / SharePoint recording?</strong>
						<p>Play the video with closed captions toggled on in the video player once to extract the full transcript.</p>
					</div>
				</div>`;
		} else {
			container.innerHTML = `<div class="empty-notice"><p>No captions match "${escapeHtml(
				filter,
			)}"</p></div>`;
		}
		return;
	}

	container.innerHTML = "";

	for (const entry of filtered) {
		const card = document.createElement("div");
		card.className = "caption-card";

		const speakerHtml = highlightText(entry.Name, filter);
		const textHtml = highlightText(entry.Text, filter);

		card.innerHTML = `
      <div class="avatar" title="Click to rename speaker" data-speaker="${escapeHtml(
				entry.Name,
			)}">${getInitials(entry.Name)}</div>
      <div class="caption-body">
        <div class="caption-header">
          <span class="speaker-name" title="Click to rename" data-speaker="${escapeHtml(
						entry.Name,
					)}">${speakerHtml} ✏️</span>
          <span class="caption-time">${entry.Time}</span>
        </div>
        <div class="caption-text">${textHtml}</div>
      </div>
    `;

		container.appendChild(card);
	}

	const autoscroll = (
		document.getElementById("autoscroll-toggle") as HTMLInputElement
	)?.checked;

	if (autoscroll && !userScrolledUp) {
		container.scrollTop = container.scrollHeight;
	}
}

function renderAttendees(): void {
	const countEl = document.getElementById("attendee-count");
	const listEl = document.getElementById("attendees-list");
	if (!listEl) return;

	const report = applyAliasesToAttendeeReport(attendeeReport, aliases);

	if (!report || report.attendeeList.length === 0) {
		if (countEl) countEl.textContent = "0";
		listEl.innerHTML = '<div class="empty-muted">No attendees recorded.</div>';
		return;
	}

	if (countEl) countEl.textContent = report.totalUniqueAttendees.toString();
	listEl.innerHTML = "";

	for (const item of report.currentAttendees) {
		const row = document.createElement("div");
		row.className = "attendee-item";
		row.innerHTML = `
      <span>${escapeHtml(item.name)}</span>
      <span class="attendee-role">${escapeHtml(item.role)}</span>
    `;
		listEl.appendChild(row);
	}
}

function renderAliases(): void {
	const countEl = document.getElementById("alias-count");
	const listEl = document.getElementById("alias-list");
	if (!listEl) return;

	const entries = Object.entries(aliases);
	if (countEl) countEl.textContent = entries.length.toString();

	if (entries.length === 0) {
		listEl.innerHTML = '<div class="empty-muted">No aliases defined.</div>';
		return;
	}

	listEl.innerHTML = "";
	for (const [orig, rep] of entries) {
		const row = document.createElement("div");
		row.className = "alias-row";
		row.innerHTML = `
      <span>${escapeHtml(orig)} ➔ <strong>${escapeHtml(rep)}</strong></span>
      <button type="button" class="btn small danger" data-remove-alias="${escapeHtml(
				orig,
			)}">✕</button>
    `;
		listEl.appendChild(row);
	}
}

function escapeHtml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

async function copyAllTranscript(): Promise<void> {
	if (captions.length === 0) {
		showToast("⚠️ No transcript available to copy");
		return;
	}

	const aliasedCaptions = applyAliases(captions, aliases);
	const aliasedAttendees = applyAliasesToAttendeeReport(
		attendeeReport,
		aliases,
	);
	const { content: markdown } = formatTranscript("md", {
		title: currentTitle,
		transcript: aliasedCaptions,
		attendeeReport: aliasedAttendees,
		startedAt: currentStartedAt,
		source: isHistorical ? "saved" : "live",
	});

	const ok = await copyToClipboard(markdown);
	if (ok) {
		showToast("📋 Copied full transcript (Markdown) to clipboard!");
	} else {
		showToast("⚠️ Failed to write to clipboard");
	}
}

async function promptRenameSpeaker(speaker: string): Promise<void> {
	const current = aliases[speaker] || speaker;
	const replacement = window.prompt(`Rename speaker "${speaker}" to:`, current);
	if (replacement !== null) {
		const clean = replacement.trim();
		if (clean && clean !== speaker) {
			aliases[speaker] = clean;
			await saveSettings({ aliases });
			showToast(`✓ Renamed "${speaker}" to "${clean}"`);
			renderAliases();
			renderCaptions();
			renderAttendees();
		} else if (clean === speaker && aliases[speaker]) {
			delete aliases[speaker];
			await saveSettings({ aliases });
			showToast(`✓ Reset alias for "${speaker}"`);
			renderAliases();
			renderCaptions();
			renderAttendees();
		}
	}
}

async function checkSyncStatus(): Promise<void> {
	const syncPill = document.getElementById("folder-sync-status");
	if (!syncPill) return;

	chrome.runtime.sendMessage(
		{ action: "check_directory_handle" },
		(response) => {
			if (
				chrome.runtime.lastError ||
				!response ||
				response.status === "no_handle"
			) {
				syncPill.textContent = "📁 Folder sync: Not configured";
			} else if (response.status === "granted") {
				syncPill.textContent = `📁 Syncing to: ${response.name}`;
			} else {
				syncPill.textContent = `⚠️ Folder access paused: ${response.name}`;
			}
		},
	);
}

async function init(): Promise<void> {
	const settings = await getSettings();
	aliases = settings.aliases || {};

	const urlParams = new URLSearchParams(window.location.search);
	const meetingIdParam = urlParams.get("meetingId");

	if (meetingIdParam) {
		currentMeetingId = meetingIdParam;
		isHistorical = true;
		const meeting = await getMeeting(meetingIdParam);
		if (meeting) {
			currentTitle = meeting.title;
			currentStartedAt = meeting.startedAt;
			captions = meeting.transcript;
			attendeeReport = meeting.attendeeReport ?? null;
			isMeetingOver = meeting.status === "complete";
		}
	}

	renderHeader();
	renderCaptions();
	renderAttendees();
	renderAliases();
	checkSyncStatus();

	// Container scroll listener for smart autoscroll
	const container = document.getElementById("captions-container");
	const jumpBtn = document.getElementById("jump-to-live");
	const unreadPill = document.getElementById("unread-count");

	container?.addEventListener("scroll", () => {
		if (!container) return;
		const isNearBottom =
			container.scrollHeight - container.scrollTop - container.clientHeight <
			80;

		if (!isNearBottom) {
			userScrolledUp = true;
		} else {
			userScrolledUp = false;
			unreadCount = 0;
			if (jumpBtn) jumpBtn.hidden = true;
		}
	});

	jumpBtn?.addEventListener("click", () => {
		if (container) {
			container.scrollTop = container.scrollHeight;
			userScrolledUp = false;
			unreadCount = 0;
			if (jumpBtn) jumpBtn.hidden = true;
			const autoToggle = document.getElementById(
				"autoscroll-toggle",
			) as HTMLInputElement;
			if (autoToggle) autoToggle.checked = true;
		}
	});

	// Direct Speaker renaming delegation
	container?.addEventListener("click", (e) => {
		const target = (e.target as HTMLElement | null)?.closest("[data-speaker]");
		const speaker = target?.getAttribute("data-speaker");
		if (speaker) {
			promptRenameSpeaker(speaker);
		}
	});

	// Copy buttons
	document
		.getElementById("btn-header-copy")
		?.addEventListener("click", copyAllTranscript);
	document
		.getElementById("btn-sidebar-copy")
		?.addEventListener("click", copyAllTranscript);

	// Keyboard shortcuts (/ to search, Escape to clear)
	window.addEventListener("keydown", (e) => {
		const filterInput = document.getElementById(
			"filter-input",
		) as HTMLInputElement | null;
		if (!filterInput) return;

		if (
			e.key === "/" &&
			document.activeElement !== filterInput &&
			!(document.activeElement instanceof HTMLInputElement)
		) {
			e.preventDefault();
			filterInput.focus();
			filterInput.select();
		} else if (e.key === "Escape" && document.activeElement === filterInput) {
			filterInput.value = "";
			filterInput.blur();
			renderCaptions();
		}
	});

	// Listen for real-time updates
	chrome.runtime.onMessage.addListener((message) => {
		const msg = message as LiveBroadcastMessage;
		if (msg.action === "live_caption_update") {
			if (!meetingIdParam || msg.meetingId === meetingIdParam) {
				const previousCount = captions.length;
				currentMeetingId = msg.meetingId;
				currentTitle = msg.title;
				captions = msg.captions;
				attendeeReport = msg.attendeeReport ?? null;
				isMeetingOver = !!msg.isMeetingOver;
				isHistorical = false;

				if (userScrolledUp && captions.length > previousCount) {
					unreadCount += captions.length - previousCount;
					if (jumpBtn && unreadPill) {
						unreadPill.textContent = unreadCount.toString();
						jumpBtn.hidden = false;
					}
				}

				renderHeader();
				renderCaptions();
				renderAttendees();
			}
		}
	});

	// Filter input
	document.getElementById("filter-input")?.addEventListener("input", () => {
		renderCaptions();
	});

	// Add Alias manually
	document
		.getElementById("btn-add-alias")
		?.addEventListener("click", async () => {
			const origInput = document.getElementById(
				"alias-original",
			) as HTMLInputElement;
			const repInput = document.getElementById(
				"alias-replacement",
			) as HTMLInputElement;

			const orig = origInput?.value.trim();
			const rep = repInput?.value.trim();

			if (orig && rep) {
				aliases[orig] = rep;
				await saveSettings({ aliases });
				showToast(`✓ Set alias: "${orig}" ➔ "${rep}"`);
				if (origInput) origInput.value = "";
				if (repInput) repInput.value = "";
				renderAliases();
				renderCaptions();
				renderAttendees();
			}
		});

	// Remove Alias
	document
		.getElementById("alias-list")
		?.addEventListener("click", async (e) => {
			const target = e.target as HTMLElement | null;
			const removeKey = target?.getAttribute("data-remove-alias");
			if (removeKey && aliases[removeKey]) {
				delete aliases[removeKey];
				await saveSettings({ aliases });
				showToast(`✓ Removed alias for "${removeKey}"`);
				renderAliases();
				renderCaptions();
				renderAttendees();
			}
		});

	// Export buttons with toast notification
	document
		.querySelectorAll<HTMLButtonElement>(".export-buttons button")
		.forEach((btn) => {
			btn.addEventListener("click", () => {
				const format = btn.getAttribute("data-format") as ExportFormat;
				if (format && currentMeetingId) {
					const originalText = btn.textContent;
					btn.textContent = "Saving...";
					chrome.runtime.sendMessage(
						{ action: "export_meeting", meetingId: currentMeetingId, format },
						() => {
							btn.textContent = originalText;
							showToast(`✓ Exported ${format.toUpperCase()} to Downloads`);
						},
					);
				} else if (!currentMeetingId) {
					showToast("⚠️ No meeting loaded to export");
				}
			});
		});
}

document.addEventListener("DOMContentLoaded", init);
