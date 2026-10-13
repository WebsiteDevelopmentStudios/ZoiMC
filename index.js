import express from "express";
import bedrock from "bedrock-protocol";

const app = express();
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.MC_HOST || "zoimc.vexr.dev";
const MC_PORT = Number(process.env.MC_PORT || 19132);
const USERNAME = process.env.MC_USERNAME;
const LOOK_INTERVAL_MS = Number(process.env.LOOK_INTERVAL_MS || 45_000);
const RECONNECT_MS = Number(process.env.RECONNECT_MS || 15_000);

let client = null;
let reconnectTimer = null;
let lookTimer = null;
let stopping = false;
let connected = false;
let lastError = null;
const startedAt = new Date().toISOString();
let lastConnectedAt = null;

app.get("/", (_req, res) => res.type("text").send("Minecraft Bedrock keepalive service is running.\n"));
app.get("/health", (_req, res) => res.status(200).json({
  ok: true, service: "minecraft-bedrock-keepalive", connected,
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
    console.error(lastError);
    scheduleReconnect();
    return;
  }
  console.log(`Connecting to Bedrock server ${HOST}:${MC_PORT} as ${USERNAME}`);
  lastError = null;
  try {
    client = bedrock.createClient({
      host: HOST,
      port: MC_PORT,
      username: USERNAME,
      offline: false,
      // MicrosoftAuthFlow requires an explicit authentication flow.
      flow: "live",
      authTitle: "0000000048183522",
      deviceType: "Android",
      deviceOS: 1,
      onMsaCode: (data) => {
        console.log("Microsoft device authentication required.");
        console.log(`Open ${data.verification_uri} and enter code ${data.user_code}`);
      }
    });
    client.on("join", () => {
      connected = true; lastConnectedAt = new Date().toISOString(); lastError = null;
      console.log("Bedrock session joined."); startLookLoop();
    });
    client.on("spawn", () => {
      connected = true; lastConnectedAt = new Date().toISOString();
      console.log("Bedrock player spawned."); startLookLoop();
    });
    client.on("kick", (reason) => {
      console.warn("Bedrock server kicked the bot:", JSON.stringify(reason));
    });
    client.on("disconnect", (reason) => {
      console.warn("Bedrock disconnected:", reason); resetConnection("Disconnected from server");
    });
    client.on("close", () => { console.warn("Bedrock connection closed."); resetConnection("Connection closed"); });
    client.on("error", (err) => {
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
  connected = false; lastError = reason || lastError; clearBotTimers();
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
  clearBotTimers(); connected = false;
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
  console.error("Uncaught exception:", err?.stack || err); lastError = err?.message || String(err);
});
