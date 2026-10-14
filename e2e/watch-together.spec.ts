import AxeBuilder from "@axe-core/playwright";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";

test.use({
	launchOptions: {
		args: [
			"--use-fake-device-for-media-stream",
			"--use-fake-ui-for-media-stream",
			"--autoplay-policy=no-user-gesture-required",
		],
	},
});
async function signIn(context: BrowserContext, id: string) {
	const response = await context.request.post("/dev/e2e-session", {
		data: {
			access_token: `fixture-${id}`,
			refresh_token: `fixture-refresh-${id}`,
			expires_in: 3600,
			user: { id },
		},
	});
	expect(response.ok()).toBe(true);
}
const movie = (page: Page) => page.locator("video").first();
async function ready(page: Page) {
	await expect
		.poll(
			() => movie(page).evaluate((v) => (v as HTMLVideoElement).readyState),
			{ timeout: 15_000 },
		)
		.toBeGreaterThanOrEqual(3);
}
async function joined(host: Page, guest: Page) {
	await host
		.getByRole("button", { name: "Watch together", exact: true })
		.click();
	await host.getByRole("button", { name: "Create watch room" }).click();
	const link = await host
		.getByRole("textbox", { name: "Watch room invite link" })
		.inputValue();
	await guest.goto(link);
	await ready(guest);
	await guest
		.getByRole("button", { name: "Join watch room", exact: true })
		.click();
	await expect(
		guest.getByText("Ready to watch", { exact: true }),
	).toBeVisible();
	return link;
}
test("two independent viewers synchronize, reconnect, call, and clean up", async ({
	browser,
	baseURL,
}) => {
	const a = await browser.newContext({
		baseURL,
		permissions: ["camera", "microphone"],
	});
	const b = await browser.newContext({
		baseURL,
		permissions: ["camera", "microphone"],
		viewport: { width: 390, height: 844 },
		isMobile: true,
		hasTouch: true,
	});
	try {
		await signIn(a, "watch-host");
		await signIn(b, "watch-guest");
		const host = await a.newPage(),
			guest = await b.newPage();
		await host.goto("/dev/player?fill=1");
		await ready(host);
		await joined(host, guest);
		await host
			.getByRole("button", { name: "Play together", exact: true })
			.click();
		await expect
			.poll(() => movie(guest).evaluate((v) => (v as HTMLVideoElement).paused))
			.toBe(false);
		// Guest commands must reach the host too.
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
			.poll(() => movie(host).evaluate((v) => (v as HTMLVideoElement).paused))
			.toBe(true);
		await host.getByRole("slider", { name: "Seek", exact: true }).fill("3");
		await expect
			.poll(() =>
				movie(guest).evaluate((v) => (v as HTMLVideoElement).currentTime),
			)
			.toBeCloseTo(3, 0);
		// Reload preserves membership and reattaches the player without creating a third viewer.
		await guest.reload();
		await ready(guest);
		await guest.getByRole("button", { name: /Watch room/ }).click();
		await expect(
			guest.getByText("Ready to watch", { exact: true }),
		).toBeVisible();
		// Two consenting browsers send and receive actual media tracks.
		await host.getByRole("button", { name: "Join video call" }).click();
		await guest.getByRole("button", { name: "Join video call" }).click();
		for (const page of [host, guest]) {
			await expect
				.poll(
					() =>
						page
							.getByTestId("remote-call")
							.evaluate(
								(v) =>
									(v as HTMLVideoElement).srcObject instanceof MediaStream &&
									((v as HTMLVideoElement).srcObject as MediaStream)
										.getTracks()
										.filter((t) => t.readyState === "live").length,
							),
					{ timeout: 20_000 },
				)
				.toBe(2);
			await expect
				.poll(
					() =>
						page
							.getByTestId("remote-call")
							.evaluate((v) => (v as HTMLVideoElement).videoWidth),
					{ timeout: 15_000 },
				)
				.toBeGreaterThan(0);
		}
		await host
			.getByRole("button", { name: "Close watch room controls" })
			.click();
		await expect
			.poll(() =>
				host
					.getByTestId("remote-call")
					.evaluate((v) => (v as HTMLVideoElement).videoWidth),
			)
			.toBeGreaterThan(0);
		await host.getByRole("button", { name: /Watch room/ }).click();
		await guest.getByRole("button", { name: "Mute mic", exact: true }).click();
		await expect
			.poll(() =>
				guest
					.getByTestId("local-call")
					.evaluate(
						(v) =>
							(
								(v as HTMLVideoElement).srcObject as MediaStream
							).getAudioTracks()[0].enabled,
					),
			)
			.toBe(false);
		await guest
			.getByRole("button", { name: "Camera off", exact: true })
			.click();
		await expect
			.poll(() =>
				guest
					.getByTestId("local-call")
					.evaluate(
						(v) =>
							(
								(v as HTMLVideoElement).srcObject as MediaStream
							).getVideoTracks()[0].enabled,
					),
			)
			.toBe(false);
		await guest
			.getByRole("button", { name: "Leave call", exact: true })
			.click();
		await expect(guest.getByTestId("local-call")).toHaveCount(0);
		const overflow = await guest.evaluate(
			() => document.documentElement.scrollWidth > innerWidth,
		);
		expect(overflow).toBe(false);
		await host
			.getByRole("button", { name: "Leave watch room", exact: true })
			.click();
		const viewers = guest.getByRole("list", { name: "Viewers" });
		await expect(viewers.getByRole("listitem")).toHaveCount(2);
		await expect(viewers).toContainText("Guest (you)");
		await expect(viewers).toContainText("host · ready");
	} finally {
		await a.close();
		await b.close();
	}
});

test("rooms reject unauthenticated and cross-origin requests", async ({
	request,
}) => {
	const unsigned = await request.post("/api/watch-together", {
		headers: { origin: "http://localhost:3000" },
		data: { action: "join", code: "does-not-exist" },
	});
	expect(unsigned.status()).toBe(401);
	await request.post("/dev/e2e-session", {
		data: {
			access_token: "fixture",
			refresh_token: "fixture",
			expires_in: 3600,
			user: { id: "api-test" },
		},
	});
	const crossed = await request.post("/api/watch-together", {
		headers: { origin: "https://unrelated.example" },
		data: { action: "join", code: "does-not-exist" },
	});
	expect(crossed.status()).toBe(403);
	const invalid = await request.post("/api/watch-together", {
		headers: { origin: "http://localhost:3000" },
		data: {
			action: "create",
			media: {
				type: "movie",
				id: "tt1",
				title: "Movie",
				label: "release",
				duration: -1,
			},
		},
	});
	expect(invalid.status()).toBe(400);
});

test("buffering, network interruptions, source replacement, and episode changes preserve room state", async ({
	browser,
	baseURL,
}) => {
	const a = await browser.newContext({ baseURL }),
		b = await browser.newContext({ baseURL });
	try {
		await signIn(a, "resilience-host");
		await signIn(b, "resilience-guest");
		const host = await a.newPage(),
			guest = await b.newPage();
		await host.goto("/dev/player");
		await ready(host);
		await joined(host, guest);
		// The room opens in the host's play state; hold it so positions stay put.
		await movie(host).evaluate((v) => (v as HTMLVideoElement).pause());
		await expect
			.poll(() => movie(guest).evaluate((v) => (v as HTMLVideoElement).paused))
			.toBe(true);
		await host.getByRole("slider", { name: "Seek", exact: true }).fill("3");
		await expect
			.poll(() =>
				movie(guest).evaluate((v) => (v as HTMLVideoElement).currentTime),
			)
			.toBeCloseTo(3, 0);
		await b.setOffline(true);
		await expect(
			host.getByText("Waiting for Guest to load", { exact: true }),
		).toBeVisible();
		await b.setOffline(false);
		await expect(
			guest.getByText("Ready to watch", { exact: true }),
		).toBeVisible({ timeout: 15_000 });
		await expect
			.poll(() =>
				movie(guest).evaluate((v) => (v as HTMLVideoElement).currentTime),
			)
			.toBeCloseTo(3, 0);
		// A replacement release keeps the same movie position.
		await host.goto("/dev/player?label=Replacement");
		await ready(host);
		await expect(guest.getByText("Host's source: Replacement")).toBeVisible();
		await expect
			.poll(() =>
				movie(guest).evaluate((v) => (v as HTMLVideoElement).currentTime),
			)
			.toBeCloseTo(3, 0);
		// The same session follows a different title; do not play the old media under a new clock.
		await host.goto("/dev/player?id=episode-two");
		await ready(host);
		await expect(
			guest.getByText("Waiting for your player to load", { exact: true }),
		).toBeVisible();
		await guest.goto("/dev/player?id=episode-two");
		await ready(guest);
		await guest.getByRole("button", { name: /Watch room/ }).click();
		await expect(
			guest.getByText("Ready to watch", { exact: true }),
		).toBeVisible();
		await expect
			.poll(() => movie(guest).evaluate((v) => (v as HTMLVideoElement).paused))
			.toBe(false);
	} finally {
		await a.close();
		await b.close();
	}
});

test("watch together stays reachable in the player toolbar and fullscreen", async ({
	page,
}) => {
	for (const viewport of [
		{ width: 320, height: 740 },
		{ width: 1280, height: 800 },
	]) {
		await page.setViewportSize(viewport);
		await page.goto("/dev/player?fill=1&info=1");
		await ready(page);
		await movie(page).evaluate((video) => (video as HTMLVideoElement).pause());
		const button = page.getByRole("button", {
			name: "Watch together",
			exact: true,
		});
		await expect(button).toBeVisible();
		const bounds = await button.boundingBox();
		expect(bounds).not.toBeNull();
		expect(bounds!.height).toBeGreaterThanOrEqual(44);
		expect(bounds!.x).toBeGreaterThanOrEqual(0);
		expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
		expect(
			await button.evaluate((element) => {
				const box = element.getBoundingClientRect();
				return element.contains(
					document.elementFromPoint(
						box.x + box.width / 2,
						box.y + box.height / 2,
					),
				);
			}),
		).toBe(true);
		await button.click();
		await expect(
			page.getByRole("region", { name: "Watch room controls" }),
		).toBeVisible();
		await page
			.getByRole("button", { name: "Close watch room controls" })
			.click();
		await page.getByRole("button", { name: "Fullscreen", exact: true }).click();
		await expect
			.poll(() =>
				page.evaluate(
					() => document.fullscreenElement === document.documentElement,
				),
			)
			.toBe(true);
		await button.click();
		await expect(
			page.getByRole("button", { name: "Create watch room" }),
		).toBeVisible();
		await page
			.getByRole("button", { name: "Close watch room controls" })
			.click();
		await page.evaluate(() => document.exitFullscreen());
	}
});

test("viewers connect before anything plays, then follow the first title picked", async ({
	browser,
	baseURL,
}) => {
	const a = await browser.newContext({ baseURL }),
		b = await browser.newContext({ baseURL });
	try {
		await signIn(a, "lobby-host");
		await signIn(b, "lobby-guest");
		const host = await a.newPage(),
			guest = await b.newPage();
		await host.goto("/dev/watch-together");
		// Retry until hydrated: a click on server-rendered markup does nothing.
		await expect(async () => {
			await host
				.getByRole("button", { name: "Watch together", exact: true })
				.click();
			await expect(host.getByText(/pick something together/)).toBeVisible({
				timeout: 1000,
			});
		}).toPass();
		await host.getByRole("textbox", { name: "Your name" }).fill("Shlok");
		await host.getByRole("button", { name: "Create watch room" }).click();
		await expect(
			host.getByText("Waiting for someone to join", { exact: true }),
		).toBeVisible();
		await expect(host.getByText("Nothing picked yet")).toBeVisible();
		const link = await host
			.getByRole("textbox", { name: "Watch room invite link" })
			.inputValue();
		const code = new URL(link).searchParams.get("room");
		expect(code).toBeTruthy();
		// The invite says who sent it and that nothing is playing yet.
		await guest.goto(`/dev/watch-together?room=${code}`);
		await expect(
			guest.getByText("Shlok invited you to watch together"),
		).toBeVisible();
		await expect(guest.getByText(/Nothing picked yet/)).toBeVisible();
		await guest.getByRole("textbox", { name: "Your name" }).fill("Friend");
		await guest.getByRole("button", { name: "Join watch room" }).click();
		for (const page of [host, guest]) {
			await expect(
				page.getByText("Pick something to watch", { exact: true }),
			).toBeVisible();
			await expect(
				page.getByRole("list", { name: "Viewers" }).getByRole("listitem"),
			).toHaveCount(2);
			await expect(
				page.getByRole("button", { name: "Watch room · 2/2" }),
			).toBeVisible();
		}
		expect(new URL(guest.url()).searchParams.has("room")).toBe(false);
		const audit = await new AxeBuilder({ page: host })
			.include("#watch-room-controls")
			.withTags(["wcag2a", "wcag2aa"])
			.analyze();
		expect(audit.violations).toEqual([]);
		// Whoever plays something first fills the room; the other viewer is told what it is.
		await guest.goto("/dev/player?id=lobby-pick");
		await ready(guest);
		await guest.getByRole("button", { name: /Watch room/ }).click();
		await expect(guest.getByText("Waiting for Shlok to load")).toBeVisible();
		await expect(host.getByText("Player harness")).toBeVisible();
		await host.goto("/dev/player?id=lobby-pick");
		await ready(host);
		await host.getByRole("button", { name: /Watch room/ }).click();
		await expect(
			host.getByText("Ready to watch", { exact: true }),
		).toBeVisible();
		await host
			.getByRole("button", { name: "Play together", exact: true })
			.click();
		for (const page of [host, guest]) {
			await expect
				.poll(() => movie(page).evaluate((v) => (v as HTMLVideoElement).paused))
				.toBe(false);
		}
		// The picker hosts it, and can send everyone back to choose again.
		await guest
			.getByRole("button", { name: "Pick something else", exact: true })
			.click();
		for (const page of [host, guest]) {
			await expect(
				page.getByText("Pick something to watch", { exact: true }),
			).toBeVisible();
			await expect
				.poll(() => movie(page).evaluate((v) => (v as HTMLVideoElement).paused))
				.toBe(true);
		}
	} finally {
		await a.close();
		await b.close();
	}
});

test("an expired invite explains itself and offers a new room", async ({
	page,
}) => {
	await signIn(page.context(), "expired-invite");
	await page.goto("/dev/watch-together?room=gone-for-good");
	await expect(page.getByText(/That invite has expired/)).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Create watch room" }),
	).toBeVisible();
	expect(new URL(page.url()).searchParams.has("room")).toBe(false);
});
