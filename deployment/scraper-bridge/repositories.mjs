const PRIORITY = ["castle", "desiflix", "movieblast"];
const priority = (scraper) => {
	const index = PRIORITY.indexOf(scraper.id);
	return index < 0 ? PRIORITY.length : index;
};

// Start each repository independently. A slow manifest must not hold up
// providers from another repository. Metadata and downloads also run together.
export async function collectRepositories(rows, metadata, load, run) {
	const repositories = rows.map(async ({ url }) => {
		const [args, manifest] = await Promise.all([
			metadata,
			load(url).then(JSON.parse),
		]);
		const scrapers = (manifest.scrapers || [])
			.filter(
				(scraper) =>
					scraper.enabled !== false &&
					(!scraper.supportedTypes ||
						scraper.supportedTypes.includes(args.mediaType)),
			)
			.map((scraper) => ({
				...scraper,
				codeUrl: new URL(scraper.filename, url).href,
			}))
			.sort((a, b) => priority(a) - priority(b));
		await Promise.allSettled(scrapers.map((scraper) => run(scraper, args)));
		return scrapers.length;
	});
	// Observe failures immediately, including while metadata is still loading.
	const settled = Promise.allSettled(repositories);
	await metadata;
	return (await settled).reduce(
		(count, result) =>
			count + (result.status === "fulfilled" ? result.value : 0),
		0,
	);
}
