/**
 * Diagnostic only: checks whether Geyser's NetherNet HTTP signalling
 * endpoint is reachable from this machine. This does not join the server
 * or authenticate a Minecraft client.
 *
 * Usage:
 *   NETHERNET_SIGNAL_URL=http://zoimc.vexr.dev:10044/v1/join npm run check:nethernet
 */
const host = process.env.MC_HOST || "zoimc.vexr.dev";
const signalUrl = process.env.NETHERNET_SIGNAL_URL || `http://${host}:10044/v1/join`;
const timeoutMs = Number(process.env.NETHERNET_CHECK_TIMEOUT_MS || 8000);

let url;
try {
  url = new URL(signalUrl);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("URL must use http or https.");
  }
} catch (error) {
  console.error(`Invalid NETHERNET_SIGNAL_URL: ${error.message}`);
  process.exit(2);
}

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), timeoutMs);

try {
  console.log(`Checking Geyser NetherNet signalling endpoint: ${url.origin}${url.pathname}`);
  const response = await fetch(url, {
    method: "GET",
    redirect: "manual",
    signal: controller.signal,
    headers: { accept: "application/json" }
  });
  const body = await response.text();

  console.log(`HTTP status: ${response.status} ${response.statusText}`);
  console.log(`Content-Type: ${response.headers.get("content-type") || "(not provided)"}`);
  console.log(`Response body bytes: ${Buffer.byteLength(body, "utf8")}`);

  if (body.trim()) {
    try {
      const metadata = JSON.parse(body);
      const safeSummary = {};
      for (const key of ["version", "protocol", "serverName", "networkId"]) {
        if (metadata[key] !== undefined) safeSummary[key] = metadata[key];
      }
      console.log("Recognized metadata:", JSON.stringify(safeSummary));
      console.log("Metadata keys:", Object.keys(metadata).join(", ") || "(none)");
    } catch {
      console.log("Response body is not JSON; body contents were not printed.");
    }
  } else {
    console.log("Endpoint returned an empty body; this can be valid for some configurations.");
  }

  if (response.status >= 200 && response.status < 300) {
    console.log("Reachability check passed. This does not prove the full NetherNet login flow works.");
  } else {
    console.error("Reachability check did not return a successful HTTP status.");
    process.exitCode = 1;
  }
} catch (error) {
  if (error.name === "AbortError") {
    console.error(`Timed out after ${timeoutMs}ms. Check whether port 10044 is exposed and reachable from this network.`);
  } else {
    console.error(`Could not reach the signalling endpoint: ${error.message}`);
  }
  process.exitCode = 1;
} finally {
  clearTimeout(timeout);
}
