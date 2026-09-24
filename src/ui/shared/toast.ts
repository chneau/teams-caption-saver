let toastTimer: ReturnType<typeof setTimeout> | null = null;

export function showToast(
	message: string,
	optionsOrUndo?:
		| {
				toastId?: string;
				durationMs?: number;
				onUndo?: () => void;
		  }
		| (() => void),
): void {
	const options =
		typeof optionsOrUndo === "function"
			? { onUndo: optionsOrUndo }
			: optionsOrUndo;
	const toastId = options?.toastId || "toast";
	const durationMs = options?.durationMs || 3500;
	const toast = document.getElementById(toastId);
	if (!toast) return;

	if (toastTimer) clearTimeout(toastTimer);
	toast.innerHTML = message;

	if (options?.onUndo) {
		const undoBtn = document.createElement("button");
		undoBtn.type = "button";
		undoBtn.className = "toast-undo";
		undoBtn.textContent = "Undo";
		undoBtn.addEventListener("click", () => {
			toast.classList.remove("show");
			if (toastTimer) clearTimeout(toastTimer);
			options.onUndo?.();
		});
		toast.appendChild(undoBtn);
	}

	toast.classList.add("show");

	toastTimer = setTimeout(() => {
		toast.classList.remove("show");
	}, durationMs);
}

export async function copyToClipboard(text: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		return false;
	}
}
