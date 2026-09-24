import { DEFAULT_SETTINGS, type ExtensionSettings } from "../types/captions.js";

export async function getSettings(): Promise<ExtensionSettings> {
	try {
		const items = await chrome.storage.sync.get(
			DEFAULT_SETTINGS as Record<string, unknown>,
		);
		return {
			...DEFAULT_SETTINGS,
			...(items as Partial<ExtensionSettings>),
		};
	} catch {
		return DEFAULT_SETTINGS;
	}
}

export async function saveSettings(
	partial: Partial<ExtensionSettings>,
): Promise<void> {
	await chrome.storage.sync.set(partial);
}
