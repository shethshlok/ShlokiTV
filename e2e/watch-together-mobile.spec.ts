import { expect, test } from "@playwright/test";

test("mobile WebKit viewers can join, unlock playback, pause, and seek", async ({
	browser,
	baseURL,
}) => {
	const contexts = await Promise.all([
		browser.newContext({
			baseURL,
			viewport: { width: 390, height: 844 },
			isMobile: true,
			hasTouch: true,
		}),
		browser.newContext({
			baseURL,
			viewport: { width: 390, height: 844 },
			isMobile: true,
			hasTouch: true,
		}),
	]);
	try {
		for (const [index, context] of contexts.entries()) {
			const response = await context.request.post("/dev/e2e-session", {
				data: {
					access_token: `mobile-${index}`,
					refresh_token: `mobile-${index}`,
					expires_in: 3600,
					user: { id: `mobile-${index}` },
				},
			});
			expect(response.ok()).toBe(true);
		}
		const host = await contexts[0].newPage(),
			guest = await contexts[1].newPage();
		await host.goto("/dev/player");
		await expect
			.poll(() =>
				host
					.locator("video")
					.first()
					.evaluate((v) => (v as HTMLVideoElement).readyState),
			)
			.toBeGreaterThanOrEqual(3);
		await host
			.getByRole("button", { name: "Watch together", exact: true })
			.click();
		await host.getByRole("button", { name: "Create watch room" }).click();
		const invite = await host
			.getByRole("textbox", { name: "Watch room invite link" })
			.inputValue();
		await guest.goto(invite);
		await guest
			.getByRole("button", { name: "Join watch room", exact: true })
			.click();

		await host
			.getByRole("button", { name: "Play together", exact: true })
			.click();
		// WebKit may require a separate gesture on the guest before audible media plays.
		await guest
			.getByRole("button", { name: /Play together|Tap to enable playback/ })
			.click();

		for (const page of [host, guest]) {
			await expect
				.poll(() =>
					page
						.locator("video")
						.first()
						.evaluate((v) => (v as HTMLVideoElement).paused),
				)
				.toBe(false);
		}
		await guest
			.getByRole("button", { name: "Close watch room controls" })
			.click();
		await guest.evaluate(() =>
			document
				.querySelector("video")
				?.dispatchEvent(new MouseEvent("mousemove", { bubbles: true })),
		);
		await guest
			.getByRole("button", { name: "Pause", exact: true })
			.last()
			.click();

		await expect
			.poll(() =>
				host
					.locator("video")
					.first()
					.evaluate((v) => (v as HTMLVideoElement).paused),
			)
			.toBe(true);
		await host.getByRole("slider", { name: "Seek", exact: true }).fill("3");
		await expect
			.poll(() =>
				guest
					.locator("video")
					.first()
					.evaluate((v) => (v as HTMLVideoElement).currentTime),
			)
			.toBeCloseTo(3, 0);
		expect(
			await guest.evaluate(
				() => document.documentElement.scrollWidth > innerWidth,
			),
		).toBe(false);
	} finally {
		await Promise.all(contexts.map((c) => c.close()));
	}
});

test("mobile WebKit media fixture supports two independent viewers", async ({
	browser,
	baseURL,
}) => {
	const contexts = await Promise.all([
		browser.newContext({ baseURL }),
		browser.newContext({ baseURL }),
	]);
	try {
		const pages = await Promise.all(contexts.map((c) => c.newPage()));
		await Promise.all(pages.map((p) => p.goto("/dev/player")));
		await Promise.all(
			pages.map((p) =>
				p
					.locator("video")
					.first()
					.evaluate(async (v) => {
						const video = v as HTMLVideoElement;
						video.muted = true;
						void video.play().catch(() => {});
					}),
			),
		);
		for (const page of pages) {
			await expect
				.poll(() =>
					page
						.locator("video")
						.first()
						.evaluate((v) => (v as HTMLVideoElement).currentTime),
				)
				.toBeGreaterThan(1);
		}
	} finally {
		await Promise.all(contexts.map((c) => c.close()));
	}
});
