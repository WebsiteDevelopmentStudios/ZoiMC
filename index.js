import express from "express";
import bedrock from "bedrock-protocol";

const app = express();
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.MC_HOST || "zoimc.vexr.dev";
const MC_PORT = Number(process.env.MC_PORT || 19132);
const USERNAME = process.env.MC_USERNAME;
const LOOK_INTERVAL_MS = Number(process.env.LOOK_INTERVAL_MS || 45_000);
const RECONNECT_MS = Number(process.env.RECONNECT_MS || 15_000);
const CONNECT_WATCHDOG_MS = Number(process.env.CONNECT_WATCHDOG_MS || 180_000);

let client = null;
let reconnectTimer = null;
let lookTimer = null;
let connectWatchdogTimer = null;
let stopping = false;
let connected = false;
let connectionStage = "starting";
let lastError = null;
const startedAt = new Date().toISOString();
let lastConnectedAt = null;

app.get("/", (_req, res) => res.type("text").send("Minecraft Bedrock keepalive service is running.\n"));
app.get("/health", (_req, res) => res.status(200).json({
  ok: true, service: "minecraft-bedrock-keepalive", connected, connectionStage,
  host: HOST, port: MC_PORT, startedAt, lastConnectedAt, lastError
}));

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`HTTP server listening on 0.0.0.0:${PORT}`);
  connectBot();
});

function clearBotTimers() {
  if (lookTimer) clearInterval(lookTimer);
  lookTimer = null;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  if (connectWatchdogTimer) clearTimeout(connectWatchdogTimer);
  connectWatchdogTimer = null;
}
function scheduleReconnect() {
  if (stopping || reconnectTimer) return;
  reconnectTimer = setTimeout(() => { reconnectTimer = null; connectBot(); }, RECONNECT_MS);
  reconnectTimer.unref?.();
}
function connectBot() {
  if (stopping || client) return;
  if (!USERNAME) {
    lastError = "MC_USERNAME is required. Set it in the Render environment.";
    connectionStage = "configuration-error";
    console.error(lastError);
    scheduleReconnect();
    return;
  }
  console.log(`Connecting to Bedrock server ${HOST}:${MC_PORT} as ${USERNAME}`);
  lastError = null;
  connectionStage = "authenticating";
  try {
    const thisClient = bedrock.createClient({
      host: HOST,
      port: MC_PORT,
      username: USERNAME,
      version: "1.26.50",
      offline: false,
      // Keep the library's default title/platform options consistent.
      onMsaCode: (data) => {
        console.log("Microsoft device authentication required.");
        console.log(`Open ${data.verification_uri} and enter code ${data.user_code}`);
      }
    });
    client = thisClient;

    // Authentication has previously stalled without emitting an error. Log the
    // stage and recycle the client if neither join nor spawn occurs in time.
    connectWatchdogTimer = setTimeout(() => {
      if (client !== thisClient || connected || stopping) return;
      const message = `Connection watchdog expired after ${CONNECT_WATCHDOG_MS}ms at stage "${connectionStage}". No join/spawn event received.`;
      console.error(message);
      resetConnection(message);
    }, CONNECT_WATCHDOG_MS);
    connectWatchdogTimer.unref?.();

    thisClient.on("session", (profile) => {
      connectionStage = "server-login";
      console.log(`Microsoft/Xbox authentication completed; continuing to server login (profile: ${profile?.name || "unknown"}).`);
    });
    thisClient.on("connect", () => {
      connectionStage = "transport-connected";
      console.log("Bedrock transport connected; waiting for server login/spawn.");
    });
    thisClient.on("join", () => {
      connected = true; connectionStage = "joined";
      lastConnectedAt = new Date().toISOString(); lastError = null;
      if (connectWatchdogTimer) clearTimeout(connectWatchdogTimer);
      connectWatchdogTimer = null;
      console.log("Bedrock session joined."); startLookLoop();
    });
    thisClient.on("spawn", () => {
      connected = true; connectionStage = "spawned";
      lastConnectedAt = new Date().toISOString();
      if (connectWatchdogTimer) clearTimeout(connectWatchdogTimer);
      connectWatchdogTimer = null;
      console.log("Bedrock player spawned."); startLookLoop();
    });
    thisClient.on("kick", (reason) => {
      console.warn("Bedrock server kicked the bot:", JSON.stringify(reason));
    });
    thisClient.on("disconnect", (reason) => {
      console.warn("Bedrock disconnected:", reason); resetConnection("Disconnected from server");
    });
    thisClient.on("close", () => { console.warn("Bedrock connection closed."); resetConnection("Connection closed"); });
    thisClient.on("error", (err) => {
      lastError = err?.stack || err?.message || String(err);
      console.error("Bedrock client error:", lastError);
      resetConnection(err?.message || String(err));
    });
  } catch (err) {
    lastError = err?.stack || err?.message || String(err); console.error("Could not create Bedrock client:", lastError);
    resetConnection(err?.message || String(err));
  }
}
function startLookLoop() {
  if (lookTimer) return;
  let yaw = 0, pitch = 0;
  lookTimer = setInterval(() => {
    if (!client || !connected) return;
    try {
      yaw = (yaw + 12) % 360; pitch = pitch === 0 ? 2 : 0;
      const pos = client.entity?.position || { x: 0, y: 0, z: 0 };
      client.queue("player_auth_input", {
        pitch, yaw, position: { x: pos.x, y: pos.y, z: pos.z },
        move_vector: { x: 0, z: 0 }, head_yaw: yaw, input_data: {},
        input_mode: "mouse", play_mode: "normal", interaction_model: "touch",
        tick: BigInt(Date.now())
      });
    } catch (err) {
      lastError = `Look loop: ${err?.message || String(err)}`; console.error(lastError);
    }
  }, LOOK_INTERVAL_MS);
  lookTimer.unref?.();
}
function resetConnection(reason) {
  connected = false; connectionStage = "reconnecting";
  lastError = reason || lastError; clearBotTimers();
  const oldClient = client; client = null;
  if (oldClient) {
    try { oldClient.removeAllListeners(); } catch {}
    try { oldClient.close(); } catch {}
  }
  scheduleReconnect();
}
function shutdown(signal) {
  if (stopping) return;
  stopping = true; console.log(`Received ${signal}; shutting down.`);
  clearBotTimers(); connected = false; connectionStage = "stopping";
  try { client?.close(); } catch {}
  client = null;
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("unhandledRejection", (err) => {
  console.error("Unhandled promise rejection:", err?.stack || err); lastError = err?.message || String(err);
});
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err?.stack || String(err)); lastError = err?.message || String(err);
});
