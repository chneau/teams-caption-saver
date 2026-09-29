import { describe, expect, it } from "bun:test";
import {
	applyAliases,
	applyAliasesToAttendeeReport,
	comparableText,
	isRefinement,
	normalizeText,
	reconcileSnapshots,
	sharedPrefixLength,
} from "../src/formatters/dedup.js";
import type { CaptionEntry, RawDomLine } from "../src/types/captions.js";

describe("Text normalization & comparison", () => {
	it("normalizes whitespace and trims", () => {
		expect(normalizeText("   Hello   world!  \n  ")).toBe("Hello world!");
		expect(normalizeText(null)).toBe("");
		expect(normalizeText(undefined)).toBe("");
	});

	it("produces comparable text by stripping punctuation and symbols", () => {
		expect(comparableText("Hello, World!")).toBe("helloworld");
		expect(comparableText("Call quality... record a short message.")).toBe(
			"callqualityrecordashortmessage",
		);
	});

	it("calculates shared prefix length correctly", () => {
		expect(sharedPrefixLength("abcdef", "abcxyz")).toBe(3);
		expect(sharedPrefixLength("hello", "world")).toBe(0);
	});

	it("identifies speech refinements accurately", () => {
		expect(isRefinement("Hello", "Hello world")).toBe(true);
		expect(isRefinement("Call quality", "Call quality record a message")).toBe(
			true,
		);
		expect(
			isRefinement(
				"Call quality record a short message after the beep",
				"Call quality record a short message after the beep.",
			),
		).toBe(true);
		expect(isRefinement("Completely different", "Something else")).toBe(false);
	});
});

describe("reconcileSnapshots", () => {
	it("initializes empty transcript with first snapshot", () => {
		const existing: CaptionEntry[] = [];
		const domLines: RawDomLine[] = [
			{ speaker: "Echo", text: "Call quality record a short message" },
		];

		const changed = reconcileSnapshots(existing, domLines, "10:00:00");
		expect(changed).toBe(true);
		expect(existing.length).toBe(1);
		expect(existing[0]?.Name).toBe("Echo");
		expect(existing[0]?.Text).toBe("Call quality record a short message");
	});

	it("refines existing line in-place when speech extends", () => {
		const existing: CaptionEntry[] = [
			{
				Name: "Echo",
				Text: "Call quality record",
				Time: "10:00:00",
			},
		];
		const domLines: RawDomLine[] = [
			{
				speaker: "Echo",
				text: "Call quality record a short message after the beep.",
			},
		];

		const changed = reconcileSnapshots(existing, domLines, "10:00:01");
		expect(changed).toBe(true);
		expect(existing.length).toBe(1);
		expect(existing[0]?.Text).toBe(
			"Call quality record a short message after the beep.",
		);
	});

	it("updates speaker name from Unknown user to recognized speaker", () => {
		const existing: CaptionEntry[] = [
			{
				Name: "Unknown user",
				Text: "Call quality",
				Time: "10:00:00",
			},
		];
		const domLines: RawDomLine[] = [
			{
				speaker: "Echo",
				text: "Call quality record a short message.",
			},
		];

		const changed = reconcileSnapshots(existing, domLines, "10:00:01");
		expect(changed).toBe(true);
		expect(existing.length).toBe(1);
		expect(existing[0]?.Name).toBe("Echo");
		expect(existing[0]?.Text).toBe("Call quality record a short message.");
	});

	it("appends new distinct utterance without duplicating previous ones", () => {
		const existing: CaptionEntry[] = [
			{
				Name: "Echo",
				Text: "Call quality record a short message after the beep.",
				Time: "10:00:00",
			},
		];
		const domLines: RawDomLine[] = [
			{
				speaker: "Echo",
				text: "Call quality record a short message after the beep.",
			},
			{
				speaker: "Echo",
				text: "Your message will then be played back to you.",
			},
		];

		const changed = reconcileSnapshots(existing, domLines, "10:00:02");
		expect(changed).toBe(true);
		expect(existing.length).toBe(2);
		expect(existing[0]?.Text).toBe(
			"Call quality record a short message after the beep.",
		);
		expect(existing[1]?.Text).toBe(
			"Your message will then be played back to you.",
		);
	});

	it("handles multi-line rolling DOM snapshots without repeating previous lines", () => {
		const existing: CaptionEntry[] = [
			{ Name: "Charles Neau", Text: "Zero.", Time: "10:01:44" },
			{ Name: "James Mullineaux", Text: "Right.", Time: "10:01:45" },
			{ Name: "Charles Neau", Text: "You're not.", Time: "10:01:46" },
			{ Name: "Charles Neau", Text: "Better are you.", Time: "10:01:46" },
			{
				Name: "James Mullineaux",
				Text: "Yeah, not too bad.",
				Time: "10:01:47",
			},
			{
				Name: "James Mullineaux",
				Text: "Not too bad on I'm somehow I think I'll get my degree in data science at the moment.",
				Time: "10:01:50",
			},
			{ Name: "Charles Neau", Text: "That's good.", Time: "10:01:56" },
			{
				Name: "James Mullineaux",
				Text: "Got John's asking me for data and stuff and it's.",
				Time: "10:01:59",
			},
		];

		// Next DOM snapshot contains overlapping lines and 1 new line
		const domSnapshot: RawDomLine[] = [
			{ Name: "Charles Neau", speaker: "Charles Neau", text: "That's good." },
			{
				Name: "James Mullineaux",
				speaker: "James Mullineaux",
				text: "Got John's asking me for data and stuff and it's.",
			},
			{
				Name: "James Mullineaux",
				speaker: "James Mullineaux",
				text: "Oh, you've. You've gone black. Hang on.",
			},
		];

		const changed = reconcileSnapshots(existing, domSnapshot, "10:02:11");
		expect(changed).toBe(true);
		// Should only have added the 1 new line, making length 9 (not 11)
		expect(existing.length).toBe(9);
		expect(existing[8]?.Text).toBe("Oh, you've. You've gone black. Hang on.");

		// Next snapshot identical (no new utterances)
		const changedAgain = reconcileSnapshots(existing, domSnapshot, "10:02:12");
		expect(changedAgain).toBe(false);
		expect(existing.length).toBe(9);
	});
});

describe("Alias application", () => {
	it("applies speaker aliases correctly", () => {
		const entries: CaptionEntry[] = [
			{ Name: "John Doe", Text: "Hello", Time: "10:00:00" },
			{ Name: "Jane Smith", Text: "Hi", Time: "10:00:01" },
		];
		const aliases = { "John Doe": "Johnny" };

		const aliased = applyAliases(entries, aliases);
		expect(aliased[0]?.Name).toBe("Johnny");
		expect(aliased[1]?.Name).toBe("Jane Smith");
	});

	it("applies aliases to attendee report", () => {
		const report = {
			totalUniqueAttendees: 2,
			meetingStartTime: Date.now(),
			lastUpdated: Date.now(),
			attendeeList: ["John Doe", "Jane Smith"],
			currentAttendees: [{ name: "John Doe", role: "Presenter" }],
			attendeeHistory: [
				{
					name: "John Doe",
					action: "joined" as const,
					timestamp: "2026-09-24",
				},
			],
		};
		const aliases = { "John Doe": "Johnny" };

		const aliased = applyAliasesToAttendeeReport(report, aliases);
		expect(aliased?.attendeeList).toEqual(["Johnny", "Jane Smith"]);
		expect(aliased?.currentAttendees[0]?.name).toBe("Johnny");
		expect(aliased?.attendeeHistory[0]?.name).toBe("Johnny");
	});
});
