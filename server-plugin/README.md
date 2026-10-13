# ZoiMC Render Heartbeat Plugin

A Paper/Bukkit plugin for the Java server that also serves Bedrock players through GeyserMC. It periodically makes an HTTP GET request to the Render keepalive service's `/health` endpoint.

## Build

Requires JDK 21 and Gradle 8.10 or newer:

```sh
cd server-plugin
gradle build
```

The plugin jar is written to `server-plugin/build/libs/zoimc-render-heartbeat-1.0.0.jar`.

## Install

1. Build the jar (or download the CI artifact from the repository's GitHub Actions workflow).
2. Put the jar in the Paper server's `plugins/` directory.
3. Restart the server.
4. Edit `plugins/ZoiMCRenderHeartbeat/config.yml` if the Render URL or interval needs changing.

Default endpoint: `https://minecraft-bedrock-keepalive.onrender.com/health`  
Default interval: 300 seconds.

## Check heartbeat status

Run `/renderheartbeat status` in-game or from the Paper server console. It reports the last request attempt, whether it succeeded, the most recent HTTP status code, the last successful request time, and any recorded error. The command is available to operators by default through the `zoimc.renderheartbeat.status` permission.

The plugin uses Java's HTTP client on an asynchronous Bukkit scheduler task and does not block the server tick thread. Successful heartbeat messages are logged at DEBUG/FINE level; non-2xx responses and network errors are warnings.

## Notes

This is for Paper/Bukkit-compatible Java servers. GeyserMC lets Bedrock clients join that Java server; Bedrock clients do not change the plugin API. It does not install on the standalone Bedrock Dedicated Server or PocketMine-MP.

Periodic requests can help keep a free Render web service active, but they do not guarantee uninterrupted uptime and may be affected by Render's plan limits or policy changes.
