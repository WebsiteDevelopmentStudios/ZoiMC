package dev.zoimc.renderheartbeat;

import org.bukkit.Bukkit;
import org.bukkit.plugin.java.JavaPlugin;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.concurrent.atomic.AtomicBoolean;

public final class RenderHeartbeatPlugin extends JavaPlugin {
    private HttpClient httpClient;
    private int taskId = -1;
    private final AtomicBoolean requestInFlight = new AtomicBoolean(false);

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
            if (status >= 200 && status < 300) {
                getLogger().fine("Render heartbeat succeeded (HTTP " + status + ").");
            } else {
                getLogger().warning("Render heartbeat returned HTTP " + status + ".");
            }
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            getLogger().warning("Render heartbeat was interrupted.");
        } catch (Exception exception) {
            getLogger().warning("Render heartbeat failed: " + exception.getMessage());
        } finally {
            requestInFlight.set(false);
        }
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
