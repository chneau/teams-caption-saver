import { verifyDirectoryPermission } from "../../storage/fsAccess.js";
import {
	clearDirectoryHandle,
	getDirectoryHandle,
	saveDirectoryHandle,
} from "../../storage/idb.js";
import { getSettings, saveSettings } from "../../storage/settings.js";
import type { ExportFormat, ExtensionSettings } from "../../types/captions.js";
import { showToast } from "../shared/toast.js";

let settings: ExtensionSettings;

async function updateFolderUI(): Promise<void> {
	const folderNameEl = document.getElementById("folder-name");
	const btnPick = document.getElementById(
		"btn-pick-folder",
	) as HTMLButtonElement;
	const btnRegrant = document.getElementById(
		"btn-regrant",
	) as HTMLButtonElement;
	const btnClear = document.getElementById(
		"btn-clear-folder",
	) as HTMLButtonElement;

	const handle = await getDirectoryHandle();
	if (!handle) {
		if (folderNameEl) folderNameEl.textContent = "No folder chosen";
		if (btnPick) btnPick.textContent = "Choose Folder";
		if (btnRegrant) btnRegrant.hidden = true;
		if (btnClear) btnClear.hidden = true;
		return;
	}

	const hasPerm = await verifyDirectoryPermission(handle, false);
	if (folderNameEl) {
		folderNameEl.textContent = `${handle.name} ${
			hasPerm ? "(Connected & Ready)" : "(Permission Needed - Click Re-grant)"
		}`;
	}

	if (btnPick) btnPick.textContent = "Change Folder";
	if (btnRegrant) btnRegrant.hidden = hasPerm;
	if (btnClear) btnClear.hidden = false;
}

function renderTenants(): void {
	const listEl = document.getElementById("tenant-list");
	if (!listEl) return;

	const tenants = settings.grantedTenants || [];
	if (tenants.length === 0) {
		listEl.innerHTML =
			'<li class="empty-muted">No custom origins registered.</li>';
		return;
	}

	listEl.innerHTML = "";
	for (const tenant of tenants) {
		const li = document.createElement("li");
		li.className = "tenant-item";
		li.innerHTML = `
      <span>${escapeHtml(tenant)}</span>
      <button type="button" class="btn small danger" data-revoke="${escapeHtml(
				tenant,
			)}">Revoke</button>
    `;
		listEl.appendChild(li);
	}
}

function escapeHtml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

async function init(): Promise<void> {
	settings = await getSettings();

	const autoSaveDir = document.getElementById(
		"auto-save-directory",
	) as HTMLInputElement;
	const subfolder = document.getElementById(
		"subfolder-pattern",
	) as HTMLSelectElement;
	const autoEnable = document.getElementById(
		"auto-enable-captions",
	) as HTMLInputElement;
	const autoDownloads = document.getElementById(
		"auto-save-downloads",
	) as HTMLInputElement;

	if (autoSaveDir) autoSaveDir.checked = settings.autoSaveDirectory;
	if (subfolder) subfolder.value = settings.subfolderPattern;
	if (autoEnable) autoEnable.checked = settings.autoEnableCaptions;
	if (autoDownloads) autoDownloads.checked = settings.autoSaveDownloads;

	document
		.querySelectorAll<HTMLInputElement>('input[name="format"]')
		.forEach((cb) => {
			cb.checked = settings.defaultFormats.includes(cb.value as ExportFormat);
		});

	await updateFolderUI();
	renderTenants();

	// Listeners for setting toggles with toast notifications
	autoSaveDir?.addEventListener("change", async () => {
		await saveSettings({ autoSaveDirectory: autoSaveDir.checked });
		showToast(
			autoSaveDir.checked
				? "✓ Direct folder writing enabled"
				: "✓ Direct folder writing paused",
		);
	});

	subfolder?.addEventListener("change", async () => {
		await saveSettings({
			subfolderPattern:
				subfolder.value as ExtensionSettings["subfolderPattern"],
		});
		showToast("✓ Folder organization structure updated");
	});

	autoEnable?.addEventListener("change", async () => {
		await saveSettings({ autoEnableCaptions: autoEnable.checked });
		showToast(
			autoEnable.checked
				? "✓ Auto-turn on captions enabled"
				: "✓ Auto-turn on captions disabled",
		);
	});

	autoDownloads?.addEventListener("change", async () => {
		await saveSettings({ autoSaveDownloads: autoDownloads.checked });
		showToast(
			autoDownloads.checked
				? "✓ Auto-download copy enabled"
				: "✓ Auto-download copy disabled",
		);
	});

	// Format selection with error prevention
	document
		.querySelectorAll<HTMLInputElement>('input[name="format"]')
		.forEach((cb) => {
			cb.addEventListener("change", async () => {
				const selected: ExportFormat[] = [];
				document
					.querySelectorAll<HTMLInputElement>('input[name="format"]:checked')
					.forEach((c) => {
						selected.push(c.value as ExportFormat);
					});

				if (selected.length === 0) {
					cb.checked = true;
					selected.push(cb.value as ExportFormat);
					showToast("⚠️ At least one format must remain selected");
					return;
				}

				await saveSettings({ defaultFormats: selected });
				showToast("✓ Default export formats updated");
			});
		});

	// Pick folder
	document
		.getElementById("btn-pick-folder")
		?.addEventListener("click", async () => {
			if (typeof window.showDirectoryPicker !== "function") {
				showToast(
					"Direct folder writing is not supported in this browser. Please enable 'Auto-save copy to Downloads' instead.",
				);
				return;
			}
			try {
				const handle = await window.showDirectoryPicker({ mode: "readwrite" });
				if (handle) {
					await saveDirectoryHandle(handle);
					await updateFolderUI();
					showToast(`✓ Output folder set to "${handle.name}"`);
				}
			} catch {
				// Cancelled
			}
		});

	// Regrant permission
	document
		.getElementById("btn-regrant")
		?.addEventListener("click", async () => {
			const handle = await getDirectoryHandle();
			if (handle) {
				const granted = await verifyDirectoryPermission(handle, true);
				await updateFolderUI();
				if (granted) {
					showToast(`✓ Permission re-granted for "${handle.name}"`);
				} else {
					showToast("⚠️ Permission request denied");
				}
			}
		});

	// Clear folder
	document
		.getElementById("btn-clear-folder")
		?.addEventListener("click", async () => {
			if (window.confirm("Disconnect local output folder sync?")) {
				await clearDirectoryHandle();
				await updateFolderUI();
				showToast("✓ Folder sync disconnected");
			}
		});

	// Add Tenant with inline validation
	const tenantInput = document.getElementById(
		"tenant-input",
	) as HTMLInputElement;
	const tenantError = document.getElementById("tenant-error") as HTMLElement;

	document
		.getElementById("btn-add-tenant")
		?.addEventListener("click", async () => {
			let origin = tenantInput?.value.trim();
			if (!origin) {
				if (tenantError) {
					tenantError.textContent =
						"Please enter an origin URL (e.g. https://company.sharepoint.com)";
					tenantError.hidden = false;
					tenantInput.classList.add("error");
				}
				return;
			}

			if (!origin.startsWith("http://") && !origin.startsWith("https://")) {
				origin = `https://${origin}`;
			}

			try {
				const url = new URL(origin);
				origin = `${url.protocol}//${url.host}`;
				if (!origin.startsWith("https://")) {
					origin = origin.replace("http://", "https://");
				}
			} catch {
				if (tenantError) {
					tenantError.textContent =
						"Invalid origin. Please enter a domain like company.sharepoint.com";
					tenantError.hidden = false;
					tenantInput.classList.add("error");
				}
				return;
			}

			if (tenantError) tenantError.hidden = true;
			tenantInput.classList.remove("error");

			chrome.runtime.sendMessage(
				{ action: "grant_tenant", origin },
				async () => {
					settings = await getSettings();
					if (tenantInput) tenantInput.value = "";
					renderTenants();
					showToast(`✓ Registered tenant origin: ${origin}`);
				},
			);
		});

	tenantInput?.addEventListener("input", () => {
		if (tenantError) tenantError.hidden = true;
		tenantInput.classList.remove("error");
	});

	// Revoke Tenant
	document
		.getElementById("tenant-list")
		?.addEventListener("click", async (e) => {
			const target = e.target as HTMLElement | null;
			const origin = target?.getAttribute("data-revoke");
			if (origin) {
				chrome.runtime.sendMessage(
					{ action: "revoke_tenant", origin },
					async () => {
						settings = await getSettings();
						renderTenants();
						showToast(`✓ Revoked origin: ${origin}`);
					},
				);
			}
		});
}

document.addEventListener("DOMContentLoaded", init);
