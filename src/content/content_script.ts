import {
	normalizeText,
	type RawDomLine,
	reconcileSnapshots,
} from "../formatters/dedup.js";
import type {
	AttendeeEvent,
	AttendeeReport,
	CaptionEntry,
	CurrentAttendee,
} from "../types/captions.js";

(() => {
	const TIMING = {
		FLUSH_INTERVAL: 2500,
		ATTENDEE_INTERVAL: 30000,
		AUTO_ENABLE_DEBOUNCE: 4000,
		BUTTON_CLICK_DELAY: 400,
	};

	const SELECTORS = {
		CAPTIONS_RENDERER:
			'[data-tid="closed-caption-v2-window-wrapper"], [data-tid="closed-captions-renderer"]',
		AUTHOR: '[data-tid="author"]',
		CAPTION_TEXT: '[data-tid="closed-caption-text"]',
		MEETING_TITLE: [
			'[data-tid="calls-header-title"]',
			'[data-tid="call-title"]',
			'[data-tid="meeting-title"]',
			'[data-tid="call-roster-title"]',
			"#call-title",
		],
		LEAVE_BUTTONS: [
			"button[data-tid='hangup-main-btn']",
			"button[data-tid='hangup-leave-button']",
			"button[data-tid='hangup-end-meeting-button']",
			"div#hangup-button button",
			"#hangup-button",
			"[data-tid='call-hangup']",
			"[aria-label*='Leave']",
			"[aria-label*='Hang up']",
			"[aria-label*='Leave call']",
		].join(","),
		MORE_BUTTON:
			"button[data-tid='more-button'], button[id='callingButtons-showMoreBtn']",
		TURN_ON_CAPTIONS_BUTTON:
			"div[id='closed-captions-button'], button[data-tid='closed-captions-button']",
		ATTENDEE_TREE: "[role='tree'][aria-label='Attendees']",
		ATTENDEE_ITEM: "[data-tid^='participantsInCall-']",
		ATTENDEE_NAME: "[id^='roster-avatar-img-']",
		ATTENDEE_ROLE: "[data-tid='ts-roster-organizer-status']",
	};

	const TITLE_SUFFIX = /\s*[|｜]\s*Microsoft Teams\s*$/u;
	const UNREAD_BADGE = /^\(\d+\)\s*/u;
	const NON_MEETING_TITLES = new Set([
		"calendar",
		"chat",
		"activity",
		"calls",
		"files",
		"teams",
		"settings",
		"microsoft teams",
	]);
	const LEADING_SEGMENT = /^([^|｜]*)[|｜]\s*/u;

	function cleanTitle(raw: string | null | undefined): string {
		return String(raw ?? "")
			.replace(UNREAD_BADGE, "")
			.trim();
	}

	function stripSectionPrefixes(title: string): string {
		let value = title;
		let match = LEADING_SEGMENT.exec(value);
		while (
			match !== null &&
			NON_MEETING_TITLES.has(match[1]?.trim().toLowerCase() ?? "")
		) {
			value = value.slice(match[0].length).trim();
			match = LEADING_SEGMENT.exec(value);
		}
		return value;
	}

	function readMeetingTitleFromDom(): string | null {
		for (const selector of SELECTORS.MEETING_TITLE) {
			const el = document.querySelector(selector);
			const text = cleanTitle(el?.textContent);
			if (text) return text;
		}
		const fromTab = stripSectionPrefixes(
			cleanTitle((document.title || "").replace(TITLE_SUFFIX, "")),
		);
		if (!fromTab || NON_MEETING_TITLES.has(fromTab.toLowerCase())) {
			return null;
		}
		return fromTab;
	}

	// State
	let transcriptArray: CaptionEntry[] = [];
	let meetingStartedAt = Date.now();
	let meetingId = `live_${meetingStartedAt}_${Math.random()
		.toString(36)
		.substring(2, 8)}`;
	let isCapturing = false;
	let isMeetingActive = false;
	let isFinalized = false;
	let autoEnableAttempted = 0;

	// Attendees state
	const allAttendeesSet = new Set<string>();
	const currentAttendeesMap = new Map<string, string>();
	const attendeeHistory: AttendeeEvent[] = [];

	function resetMeetingState(): void {
		meetingStartedAt = Date.now();
		meetingId = `live_${meetingStartedAt}_${Math.random()
			.toString(36)
			.substring(2, 8)}`;
		transcriptArray = [];
		allAttendeesSet.clear();
		currentAttendeesMap.clear();
		attendeeHistory.length = 0;
		isMeetingActive = true;
		isFinalized = false;
	}

	function getMeetingTitle(): string {
		return readMeetingTitleFromDom() || "Teams Meeting";
	}

	function getAttendeeReport(): AttendeeReport | null {
		if (allAttendeesSet.size === 0) return null;
		const currentList: CurrentAttendee[] = [];
		currentAttendeesMap.forEach((role, name) => {
			currentList.push({ name, role });
		});

		return {
			totalUniqueAttendees: allAttendeesSet.size,
			meetingStartTime: meetingStartedAt,
			lastUpdated: Date.now(),
			attendeeList: Array.from(allAttendeesSet),
			currentAttendees: currentList,
			attendeeHistory: [...attendeeHistory],
		};
	}

	function broadcastUpdate(isMeetingOver = false): void {
		chrome.runtime
			.sendMessage({
				action: "live_caption_update",
				meetingId,
				title: getMeetingTitle(),
				captions: transcriptArray,
				attendeeReport: getAttendeeReport(),
				isMeetingOver,
			})
			.catch(() => {
				// Viewer might not be open
			});
	}

	function flushToBackground(finalize = false): void {
		if (transcriptArray.length === 0 && allAttendeesSet.size === 0) return;
		if (!finalize && !isMeetingActive) return;

		if (finalize) {
			isMeetingActive = false;
			isFinalized = true;
		}

		chrome.runtime
			.sendMessage({
				action: finalize ? "finalize_live_meeting" : "flush_live_captions",
				meetingId,
				title: getMeetingTitle(),
				startedAt: meetingStartedAt,
				captions: transcriptArray,
				attendeeReport: getAttendeeReport(),
			})
			.catch((err) => {
				console.debug("[Teams Caption Saver] Flush failed:", err);
			});

		broadcastUpdate(finalize);
	}

	function findCaptionContainer(): Element | null {
		return document.querySelector(SELECTORS.CAPTIONS_RENDERER);
	}

	// Caption extraction and reconciliation
	function findCaptionLines(): Element[] {
		const container = findCaptionContainer();
		if (!container) return [];

		const compactMessages = Array.from(
			container.querySelectorAll(
				".fui-ChatMessageCompact, [data-tid='closed-caption-item']",
			),
		);
		if (compactMessages.length > 0) {
			return compactMessages;
		}

		const textNodes = Array.from(
			container.querySelectorAll(SELECTORS.CAPTION_TEXT),
		);
		if (textNodes.length > 0) {
			const lines: Element[] = [];
			const seen = new Set<Element>();
			for (const textEl of textNodes) {
				const lineEl =
					textEl.closest(
						".fui-ChatMessageCompact, [data-tid='closed-caption-item'], [role='region']",
					) ||
					textEl.parentElement ||
					textEl;
				if (!seen.has(lineEl)) {
					seen.add(lineEl);
					lines.push(lineEl);
				}
			}
			return lines;
		}

		return [];
	}

	function extractSpeakerAndText(node: Element): {
		speaker: string;
		text: string;
	} {
		const authorEl =
			node.querySelector(SELECTORS.AUTHOR) ||
			node.querySelector('[data-tid*="author"]') ||
			node.querySelector(".fui-ChatMessageCompact__author");
		const textEl =
			node.querySelector(SELECTORS.CAPTION_TEXT) ||
			node.querySelector('[data-tid*="caption-text"]') ||
			node;

		let speaker = authorEl?.textContent?.trim() || "";
		if (!speaker) {
			const parentAuthor = node
				.closest(".fui-ChatMessageCompact, [data-tid*='closed-caption']")
				?.querySelector(SELECTORS.AUTHOR);
			speaker = parentAuthor?.textContent?.trim() || "Speaker";
		}

		let rawText = "";
		if (textEl === node && authorEl) {
			rawText = Array.from(node.childNodes)
				.filter((n) => n !== authorEl && !authorEl.contains(n))
				.map((n) => n.textContent)
				.join(" ");
		} else {
			rawText = textEl.textContent || "";
		}

		return {
			speaker,
			text: normalizeText(rawText),
		};
	}

	let wasInMeeting = false;

	function isUserInMeeting(): boolean {
		const callEndedScreen = document.querySelector(
			"[data-tid='call-ended-screen'], [data-tid='call-ended-rating-screen'], [data-tid='meeting-ended'], [data-tid='call-end-survey'], [data-tid='post-call-survey'], [data-tid='call-rating-screen']",
		);
		if (callEndedScreen) {
			return false;
		}

		const leaveBtn = document.querySelector(SELECTORS.LEAVE_BUTTONS);
		return Boolean(leaveBtn);
	}

	function parseCaptions(): void {
		const inMeeting = isUserInMeeting();

		if (!inMeeting) {
			if (
				wasInMeeting &&
				isMeetingActive &&
				!isFinalized &&
				transcriptArray.length > 0
			) {
				wasInMeeting = false;
				flushToBackground(true);
			}
			return;
		}

		wasInMeeting = true;

		const container = findCaptionContainer();
		if (!container) return;

		const captionNodes = findCaptionLines();
		if (captionNodes.length === 0) return;

		const rawLines: RawDomLine[] = [];
		for (const node of captionNodes) {
			const { speaker, text } = extractSpeakerAndText(node);
			if (text) {
				rawLines.push({ speaker, text });
			}
		}

		if (rawLines.length === 0) return;

		if (isFinalized || !isMeetingActive) {
			resetMeetingState();
		}

		isMeetingActive = true;

		const now = new Date();
		const timeStr = `${now.getHours().toString().padStart(2, "0")}:${now
			.getMinutes()
			.toString()
			.padStart(2, "0")}:${now.getSeconds().toString().padStart(2, "0")}`;

		const changed = reconcileSnapshots(transcriptArray, rawLines, timeStr);
		if (changed) {
			broadcastUpdate(false);
		}
	}

	// Attendee tracking
	function updateAttendees(): void {
		if (!isUserInMeeting()) return;

		const attendeeItems = document.querySelectorAll(
			`${SELECTORS.ATTENDEE_ITEM}, [data-tid^='participantsInCall-']`,
		);

		const activeInThisCheck = new Set<string>();

		attendeeItems.forEach((item) => {
			const nameEl =
				item.querySelector(SELECTORS.ATTENDEE_NAME) ||
				item.querySelector("[aria-label]");
			const roleEl = item.querySelector(SELECTORS.ATTENDEE_ROLE);

			let name =
				nameEl?.getAttribute("aria-label") || nameEl?.textContent?.trim() || "";
			name = name.replace(/avatar image/i, "").trim();

			const role = roleEl?.textContent?.trim() || "Attendee";

			if (name) {
				activeInThisCheck.add(name);
				currentAttendeesMap.set(name, role);

				if (!allAttendeesSet.has(name)) {
					allAttendeesSet.add(name);
					attendeeHistory.push({
						name,
						action: "joined",
						timestamp: new Date().toISOString(),
					});
				}
			}
		});

		// Check for attendees who left
		for (const [name] of currentAttendeesMap) {
			if (activeInThisCheck.size > 0 && !activeInThisCheck.has(name)) {
				currentAttendeesMap.delete(name);
				attendeeHistory.push({
					name,
					action: "left",
					timestamp: new Date().toISOString(),
				});
			}
		}
	}

	// Auto-enable live captions
	function tryAutoEnableCaptions(): void {
		if (!isUserInMeeting()) return;

		const now = Date.now();
		if (now - autoEnableAttempted < TIMING.AUTO_ENABLE_DEBOUNCE) return;
		autoEnableAttempted = now;

		const activeLines = findCaptionLines();
		if (activeLines.length > 0) return; // Already on

		const moreBtn = document.querySelector<HTMLButtonElement>(
			SELECTORS.MORE_BUTTON,
		);
		if (!moreBtn) return;

		moreBtn.click();
		setTimeout(() => {
			const turnOnBtn = document.querySelector<HTMLElement>(
				SELECTORS.TURN_ON_CAPTIONS_BUTTON,
			);
			if (turnOnBtn) {
				turnOnBtn.click();
			} else {
				// Close the menu if caption button not found
				moreBtn.click();
			}
		}, TIMING.BUTTON_CLICK_DELAY);
	}

	let captionObserver: MutationObserver | null = null;
	let observedContainer: Element | null = null;
	let parseScheduled = false;

	function scheduleCaptionParse(): void {
		if (parseScheduled) return;
		parseScheduled = true;
		setTimeout(() => {
			parseScheduled = false;
			parseCaptions();
		}, 100);
	}

	function syncCaptionObserver(): void {
		const container = findCaptionContainer();
		if (container !== observedContainer) {
			if (captionObserver) {
				captionObserver.disconnect();
				captionObserver = null;
			}
			observedContainer = container;
			if (container) {
				captionObserver = new MutationObserver(() => {
					scheduleCaptionParse();
				});
				captionObserver.observe(container, {
					childList: true,
					subtree: true,
					characterData: true,
				});
				scheduleCaptionParse();
			}
		}
	}

	function checkMeetingActive(): void {
		const inMeeting = isUserInMeeting();

		if (wasInMeeting && !inMeeting) {
			wasInMeeting = false;
			if (captionObserver) {
				captionObserver.disconnect();
				captionObserver = null;
			}
			observedContainer = null;
			if (isMeetingActive && !isFinalized && transcriptArray.length > 0) {
				flushToBackground(true);
			}
			return;
		}

		if (!inMeeting) {
			return;
		}

		wasInMeeting = true;
		syncCaptionObserver();
	}

	// Initializing observers and loops
	function startCapture(): void {
		if (isCapturing) return;
		isCapturing = true;

		// Check settings for auto-enable
		chrome.storage.sync.get({ autoEnableCaptions: true }, (items) => {
			if (items.autoEnableCaptions) {
				setTimeout(tryAutoEnableCaptions, 1500);
			}
		});

		// Top-level observer only monitors structural additions/removals (no characterData storm)
		const structureObserver = new MutationObserver(() => {
			syncCaptionObserver();
		});

		structureObserver.observe(document.body, {
			childList: true,
			subtree: true,
		});

		// Consolidated polling loops
		setInterval(parseCaptions, 600);
		setInterval(updateAttendees, TIMING.ATTENDEE_INTERVAL);
		setInterval(() => {
			if (
				isUserInMeeting() &&
				isMeetingActive &&
				!isFinalized &&
				transcriptArray.length > 0
			) {
				flushToBackground(false);
			}
		}, TIMING.FLUSH_INTERVAL);
		setInterval(checkMeetingActive, 1000);

		// Initial check
		setTimeout(updateAttendees, 2000);
		syncCaptionObserver();

		// Listen for meeting end
		window.addEventListener("beforeunload", () => {
			if (isMeetingActive && !isFinalized && transcriptArray.length > 0) {
				flushToBackground(true);
			}
		});

		document.addEventListener("click", (e) => {
			const target = e.target as HTMLElement | null;
			if (target?.closest(SELECTORS.LEAVE_BUTTONS)) {
				if (isMeetingActive && !isFinalized && transcriptArray.length > 0) {
					wasInMeeting = false;
					setTimeout(() => flushToBackground(true), 200);
				}
			}
		});
	}

	// Start after DOM load
	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", startCapture);
	} else {
		startCapture();
	}
})();
