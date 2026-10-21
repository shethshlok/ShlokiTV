// Exact hosts reviewed against the All-in-One-Nuvio providers during the
// 2026-10-20 Monk investigation. Keep this list in Git so deployments and
// rollbacks carry their provider compatibility with them. The private env
// file can approve additional hosts; scripts cannot approve their own targets.
const reviewedHosts = [
	"1.animezey23112022.workers.dev",
	"1.animezeydl.workers.dev",
	"1vegamovies.pics",
	"4khdhub.one",
	"anidb.app",
	"api.allanime.day",
	"api.movix.cash",
	"api.nakios.click",
	"api.purstream.club",
	"api.viduki.net",
	"cc.realbestia.com",
	"free.finepulfe.xyz",
	"hdghartv.cc",
	"hindmovie.icu",
	"moviesmod.uk.com",
	"new3.moviesdrive.beer",
	"panel.watchkaroabhi.com",
	"persianstremio.vercel.app",
	"uhdmovies.us.org",
];

export function providerHosts(extra = "") {
	return new Set(
		[...reviewedHosts, ...extra.split(",")]
			.map((host) => host.trim().toLowerCase())
			.filter(Boolean),
	);
}
