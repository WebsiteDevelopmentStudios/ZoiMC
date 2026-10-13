# Minecraft Bedrock Keepalive on Render

Set `MC_USERNAME` in Render to the Microsoft/Xbox identity used by the bot account. On first startup, the Bedrock protocol library may print a Microsoft device-login URL and code in service logs; complete that login there.

Environment variables:
- `MC_HOST` (default `zoimc.vexr.dev`)
- `MC_PORT` (default `19132`)
- `MC_USERNAME` (required)
- `LOOK_INTERVAL_MS` (default `45000`)
- `RECONNECT_MS` (default `15000`)

Deploy from the Render Blueprint in this repository. This uses `bedrock-protocol` for native Bedrock connections; Mineflayer itself targets Java Edition. Validate look-input packet compatibility against the server's Bedrock version. Free web services can spin down when idle; periodic HTTP requests are not a guarantee of uninterrupted 24/7 operation.
