import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";

test("benchmark scans 200 mock hotels and reports successful pagination", async () => {
  const requestedOffsets = [];
  const server = createServer(async (request, response) => {
    if (request.url !== "/v1/public/smartstay/search" || request.method !== "POST") {
      response.writeHead(404).end();
      return;
    }
    let body = "";
    for await (const chunk of request) body += chunk;
    const payload = JSON.parse(body);
    requestedOffsets.push(payload.offset);
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({
      properties: Array.from({ length: 25 }, (_, index) => ({ id: payload.offset + index })),
      scanned: 25,
      nextOffset: payload.offset === 175 ? null : payload.offset + 25
    }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = server.address().port;
    const output = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["scripts/benchmark-smartstay-staging.mjs"], {
        env: { ...process.env,
          SMARTSTAY_BASE_URL: `http://127.0.0.1:${port}`,
          SMARTSTAY_ARRIVAL_DATE: "2030-11-10",
          SMARTSTAY_DEPARTURE_DATE: "2030-11-12"
        }
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, stdout, stderr }));
    });
    assert.equal(output.code, 0, output.stderr);
    const report = JSON.parse(output.stdout);
    assert.equal(report.propertiesScanned, 200);
    assert.equal(report.errors.length, 0);
    assert.equal(report.passed, true);
    assert.deepEqual(requestedOffsets, [0, 25, 50, 75, 100, 125, 150, 175]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("benchmark fails closed when staging has fewer than 200 properties", async () => {
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const payload = JSON.parse(body);
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({
      properties: Array.from({ length: 25 }, (_, index) => ({ id: payload.offset + index })),
      scanned: 25,
      nextOffset: null
    }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const child = spawn(process.execPath, ["scripts/benchmark-smartstay-staging.mjs"], {
      env: {
        ...process.env,
        SMARTSTAY_BASE_URL: `http://127.0.0.1:${server.address().port}`,
        SMARTSTAY_ARRIVAL_DATE: "2030-11-10",
        SMARTSTAY_DEPARTURE_DATE: "2030-11-12"
      }
    });
    let output = "";
    for await (const chunk of child.stdout) output += chunk;
    const exitCode = await new Promise((resolve) => child.on("close", resolve));
    assert.equal(exitCode, 1);
    const report = JSON.parse(output);
    assert.equal(report.propertiesScanned, 25);
    assert.equal(report.passed, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
