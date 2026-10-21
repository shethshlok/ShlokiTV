import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { nextRedirectRequest, upstream } from "./providerProxy.mjs";

function fixture(responses, addresses = ["8.8.8.8"]) {
	const calls = [];
	return {
		calls,
		network: {
			resolve4: () => Promise.resolve(addresses),
			request(url, options, callback) {
				const call = { url, options };
				calls.push(call);
				options.lookup(url.hostname, {}, (error, address, family) => {
					call.pinned = { error, address, family };
				});
				const request = new EventEmitter();
				request.end = () =>
					queueMicrotask(() => {
						const response = Object.assign(
							new EventEmitter(),
							responses.shift(),
						);
						response.resume = () => {
							/* Fixture redirects have no body to drain. */
						};
						callback(response);
						response.emit("end");
						request.emit("close");
					});
				request.destroy = (error) => {
					request.emit("error", error);
					request.emit("close");
				};
				return request;
			},
		},
	};
}

test("supports provider HEAD probes and returns file length with no response body", async () => {
	const { network, calls } = fixture([
		{
			statusCode: 200,
			statusMessage: "OK",
			headers: {
				"content-length": "123456",
				"accept-ranges": "bytes",
				"content-type": "video/mp4",
			},
		},
	]);
	const result = await upstream(
		{ url: "https://provider.example/video.mp4", method: "HEAD" },
		new Set(["provider.example"]),
		0,
		network,
	);
	assert.equal(calls[0].options.method, "HEAD");
	assert.deepEqual(calls[0].pinned, {
		error: null,
		address: "8.8.8.8",
		family: 4,
	});
	assert.equal(result.body, "");
	assert.equal(result.headers["content-length"], "123456");
	assert.equal(result.headers["accept-ranges"], "bytes");
});

test("preserves HEAD across redirects and forwards bounded range requests", async () => {
	const { network, calls } = fixture([
		{ statusCode: 302, headers: { location: "/video.mp4" } },
		{ statusCode: 200, headers: { "content-length": "123456" } },
	]);
	await upstream(
		{
			url: "https://provider.example/start",
			method: "HEAD",
			headers: { Range: "bytes=0-1023" },
		},
		new Set(["provider.example"]),
		0,
		network,
	);
	assert.deepEqual(
		calls.map((call) => call.options.method),
		["HEAD", "HEAD"],
	);
	assert.equal(calls[1].options.headers.range, "bytes=0-1023");
	assert.equal(
		nextRedirectRequest(
			{ method: "POST" },
			"https://provider.example/",
			"/next",
			302,
		).method,
		"GET",
	);
});

test("still refuses private DNS, unapproved redirects and write methods", async () => {
	const privateFixture = fixture([], ["127.0.0.1"]);
	await assert.rejects(
		upstream(
			{ url: "https://provider.example/" },
			new Set(["provider.example"]),
			0,
			privateFixture.network,
		),
		/Private destination/,
	);
	assert.equal(privateFixture.calls.length, 0);
	const redirectFixture = fixture([
		{ statusCode: 302, headers: { location: "https://unapproved.example/" } },
	]);
	await assert.rejects(
		upstream(
			{ url: "https://provider.example/" },
			new Set(["provider.example"]),
			0,
			redirectFixture.network,
		),
		/Destination is not allowed/,
	);
	assert.equal(redirectFixture.calls.length, 1);
	const writeFixture = fixture([]);
	await assert.rejects(
		upstream(
			{ url: "https://provider.example/", method: "DELETE" },
			new Set(["provider.example"]),
			0,
			writeFixture.network,
		),
		/Method is not allowed/,
	);
	assert.equal(writeFixture.calls.length, 0);
});
