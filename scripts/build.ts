import { cp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const DIST = join(ROOT, "dist");
const SRC = join(ROOT, "src");
const PUBLIC = join(ROOT, "public");

async function build() {
	console.log("📦 Building Teams Caption Saver (TypeScript + Bun)...");

	// 1. Clean dist
	await rm(DIST, { recursive: true, force: true });
	await mkdir(DIST, { recursive: true });
	await mkdir(join(DIST, "background"), { recursive: true });
	await mkdir(join(DIST, "content"), { recursive: true });
	await mkdir(join(DIST, "ui/popup"), { recursive: true });
	await mkdir(join(DIST, "ui/viewer"), { recursive: true });
	await mkdir(join(DIST, "ui/options"), { recursive: true });
	await mkdir(join(DIST, "public"), { recursive: true });

	// 2. Bun build bundles
	const entrypoints = [
		{
			in: join(SRC, "background/service_worker.ts"),
			outdir: join(DIST, "background"),
		},
		{
			in: join(SRC, "content/content_script.ts"),
			outdir: join(DIST, "content"),
		},
		{ in: join(SRC, "content/interceptor.ts"), outdir: join(DIST, "content") },
		{ in: join(SRC, "content/relay.ts"), outdir: join(DIST, "content") },
		{ in: join(SRC, "ui/popup/popup.ts"), outdir: join(DIST, "ui/popup") },
		{ in: join(SRC, "ui/viewer/viewer.ts"), outdir: join(DIST, "ui/viewer") },
		{
			in: join(SRC, "ui/options/options.ts"),
			outdir: join(DIST, "ui/options"),
		},
	];

	for (const entry of entrypoints) {
		const result = await Bun.build({
			entrypoints: [entry.in],
			outdir: entry.outdir,
			target: "browser",
			format: "esm",
			minify: false,
			sourcemap: "inline",
		});

		if (!result.success) {
			console.error(`❌ Build failed for ${entry.in}:`, result.logs);
			process.exit(1);
		}
	}

	// 3. Copy static assets, HTML, and CSS
	const staticFiles = [
		{ from: join(PUBLIC, "manifest.json"), to: join(DIST, "manifest.json") },
		{ from: join(PUBLIC, "icon.png"), to: join(DIST, "icon.png") },
		{ from: join(PUBLIC, "icon.png"), to: join(DIST, "public/icon.png") },
		{
			from: join(SRC, "ui/popup/popup.html"),
			to: join(DIST, "ui/popup/popup.html"),
		},
		{
			from: join(SRC, "ui/popup/popup.css"),
			to: join(DIST, "ui/popup/popup.css"),
		},
		{
			from: join(SRC, "ui/viewer/viewer.html"),
			to: join(DIST, "ui/viewer/viewer.html"),
		},
		{
			from: join(SRC, "ui/viewer/viewer.css"),
			to: join(DIST, "ui/viewer/viewer.css"),
		},
		{
			from: join(SRC, "ui/options/options.html"),
			to: join(DIST, "ui/options/options.html"),
		},
		{
			from: join(SRC, "ui/options/options.css"),
			to: join(DIST, "ui/options/options.css"),
		},
	];

	for (const file of staticFiles) {
		await cp(file.from, file.to);
	}

	console.log("✅ Extension built successfully into dist/");

	// 4. Package CRX and ZIP for Chrome/Edge/Firefox installation
	const crxProc = Bun.spawnSync([
		"bun",
		"x",
		"crx3",
		"-z",
		join(DIST, "teams-caption-saver.zip"),
		"-o",
		join(DIST, "teams-caption-saver.crx"),
		"-p",
		join(ROOT, "key.pem"),
		join(DIST, "manifest.json"),
	]);

	await cp(
		join(DIST, "teams-caption-saver.zip"),
		join(DIST, "teams-caption-saver-firefox.zip"),
	);

	if (crxProc.exitCode === 0) {
		console.log("🎁 Packaged drag & drop extension files into dist/:");
		console.log(
			"   👉 CRX: dist/teams-caption-saver.crx (drag into chrome://extensions)",
		);
		console.log("   👉 ZIP: dist/teams-caption-saver.zip (Chrome / Edge)");
		console.log(
			"   👉 ZIP: dist/teams-caption-saver-firefox.zip (Firefox / AMO)",
		);
	}
}

build().catch((err) => {
	console.error("Build error:", err);
	process.exit(1);
});
