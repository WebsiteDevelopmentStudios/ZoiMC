package dev.zoimc.renderheartbeat;

import org.bukkit.Bukkit;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.plugin.java.JavaPlugin;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.concurrent.atomic.AtomicBoolean;

public final class RenderHeartbeatPlugin extends JavaPlugin {
    private HttpClient httpClient;
    private int taskId = -1;
    private final AtomicBoolean requestInFlight = new AtomicBoolean(false);

    private volatile Instant lastAttemptAt;
    private volatile Instant lastSuccessAt;
    private volatile Integer lastHttpStatus;
    private volatile Boolean lastRequestSucceeded;
    private volatile String lastError;

    @Override
    public void onEnable() {
        saveDefaultConfig();

        long intervalSeconds = Math.max(60L, getConfig().getLong("interval-seconds", 300L));
        long timeoutSeconds = Math.max(3L, getConfig().getLong("timeout-seconds", 15L));
        String endpoint = getConfig().getString(
                "url", "https://minecraft-bedrock-keepalive.onrender.com/health"
        );

        try {
            URI uri = URI.create(endpoint);
            if (!"https".equalsIgnoreCase(uri.getScheme()) && !"http".equalsIgnoreCase(uri.getScheme())) {
                throw new IllegalArgumentException("URL must use HTTP or HTTPS");
            }
            httpClient = HttpClient.newBuilder()
                    .connectTimeout(Duration.ofSeconds(timeoutSeconds))
                    .followRedirects(HttpClient.Redirect.NORMAL)
                    .build();
        } catch (Exception exception) {
            getLogger().severe("Invalid Render heartbeat configuration: " + exception.getMessage());
            Bukkit.getPluginManager().disablePlugin(this);
            return;
        }

        long intervalTicks = intervalSeconds * 20L;
        // Run HTTP I/O asynchronously so the Minecraft main thread is never blocked.
        taskId = Bukkit.getScheduler().runTaskTimerAsynchronously(
                this, () -> ping(endpoint, timeoutSeconds), 20L, intervalTicks
        ).getTaskId();

        getLogger().info("Render heartbeat enabled; endpoint=" + endpoint
                + ", interval=" + intervalSeconds + "s");
    }

    private void ping(String endpoint, long timeoutSeconds) {
        if (!requestInFlight.compareAndSet(false, true)) {
            return;
        }

        lastAttemptAt = Instant.now();
        try {
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(endpoint))
                    .timeout(Duration.ofSeconds(timeoutSeconds))
                    .header("User-Agent", "ZoiMCRenderHeartbeat/1.0")
                    .header("Accept", "application/json")
                    .GET()
                    .build();

            HttpResponse<Void> response = httpClient.send(request, HttpResponse.BodyHandlers.discarding());
            int status = response.statusCode();
            lastHttpStatus = status;
            if (status >= 200 && status < 300) {
                lastRequestSucceeded = true;
                lastSuccessAt = Instant.now();
                lastError = null;
                getLogger().fine("Render heartbeat succeeded (HTTP " + status + ").");
            } else {
                lastRequestSucceeded = false;
                lastError = "HTTP " + status;
                getLogger().warning("Render heartbeat returned HTTP " + status + ".");
            }
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            lastRequestSucceeded = false;
            lastError = "Request interrupted";
            getLogger().warning("Render heartbeat was interrupted.");
        } catch (Exception exception) {
            lastRequestSucceeded = false;
            lastError = exception.getMessage() == null
                    ? exception.getClass().getSimpleName()
                    : exception.getClass().getSimpleName() + ": " + exception.getMessage();
            getLogger().warning("Render heartbeat failed: " + exception.getMessage());
        } finally {
            requestInFlight.set(false);
        }
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!command.getName().equalsIgnoreCase("renderheartbeat")) {
            return false;
        }
        if (args.length != 1 || !args[0].equalsIgnoreCase("status")) {
            sender.sendMessage("Usage: /renderheartbeat status");
            return true;
        }

        sender.sendMessage("=== Render Heartbeat Status ===");
        sender.sendMessage("Request in progress: " + requestInFlight.get());
        sender.sendMessage("Last attempt: " + formatTime(lastAttemptAt));
        sender.sendMessage("Last result: " + formatResult());
        sender.sendMessage("Last HTTP status: " + (lastHttpStatus == null ? "N/A" : lastHttpStatus));
        sender.sendMessage("Last successful request: " + formatTime(lastSuccessAt));
        if (lastError != null) {
            sender.sendMessage("Last error: " + lastError);
        }
        return true;
    }

    private String formatResult() {
        if (lastRequestSucceeded == null) {
            return "No request completed yet";
        }
        return lastRequestSucceeded ? "SUCCESS" : "FAILED";
    }

    private String formatTime(Instant time) {
        return time == null ? "Never" : time.toString() + " (UTC)";
    }

    @Override
    public void onDisable() {
        if (taskId != -1) {
            Bukkit.getScheduler().cancelTask(taskId);
            taskId = -1;
        }
        getLogger().info("Render heartbeat disabled.");
    }
}
