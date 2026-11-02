package com.fuellog.vikash;

import com.fuellog.vikash.configurations.ViKashProperties;
import com.fuellog.vikash.exceptions.ViKashRemoteException;
import com.fuellog.vikash.services.ViKashClient;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.*;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;
import static org.junit.jupiter.api.Assertions.*;

class ViKashResponseLimitTest {
    private static final int LIMIT = 1_000_000;
    private static final String TOKEN = "{\"token_type\":\"Bearer\",\"access_token\":\"access\",\"refresh_token\":\"refresh\",\"expires_in\":3600,\"scope\":\"fuellog.catalog fuellog.entries\"}";

    @Test void abortsAnOversizedChunkedResponseBeforeTheServerFinishesIt() throws Exception {
        CountDownLatch bodyWritten = new CountDownLatch(1);
        CountDownLatch finish = new CountDownLatch(1);
        var server = server();
        try {
            server.createContext("/oauth2/token", exchange -> {
                exchange.getResponseHeaders().add("Content-Type", "application/json; charset=UTF-8");
                exchange.sendResponseHeaders(200, 0);
                try (var output = exchange.getResponseBody()) {
                    try { output.write("x".repeat(LIMIT + 1).getBytes(StandardCharsets.UTF_8)); output.flush(); }
                    finally { bodyWritten.countDown(); }
                    try { finish.await(5, TimeUnit.SECONDS); }
                    catch (InterruptedException e) { Thread.currentThread().interrupt(); }
                }
            });
            server.start();
            try (var executor = Executors.newSingleThreadExecutor()) {
                Future<ViKashRemoteException> response = executor.submit(() -> assertThrows(ViKashRemoteException.class,
                    () -> client(server).exchange("code", "verifier")));
                try {
                    assertTrue(bodyWritten.await(3, TimeUnit.SECONDS));
                    assertInvalid(response.get(3, TimeUnit.SECONDS));
                    assertEquals(1, finish.getCount(), "The client must reject before EOF, rather than buffer then check");
                } finally { finish.countDown(); }
            }
        } finally { finish.countDown(); server.stop(0); }
    }

    @Test void measuresEncodedBytesInsteadOfDecodedCharacters() throws Exception {
        byte[] body = (TOKEN.substring(0, TOKEN.length() - 1) + ",\"padding\":\"" + "é".repeat(LIMIT / 2) + "\"}").getBytes(StandardCharsets.UTF_8);
        assertTrue(body.length > LIMIT);
        withResponse(body, client -> assertInvalid(assertThrows(ViKashRemoteException.class,
            () -> client.exchange("code", "verifier"))));
    }

    @Test void acceptsAnExactlyOneMegabyteValidResponse() throws Exception {
        String body = TOKEN + " ".repeat(LIMIT - TOKEN.length());
        withResponse(body.getBytes(StandardCharsets.UTF_8), client -> {
            var token = client.exchange("code", "verifier");
            assertEquals("access", token.accessToken());
            assertEquals("refresh", token.refreshToken());
        });
    }

    private void withResponse(byte[] body, java.util.function.Consumer<ViKashClient> assertion) throws Exception {
        var server = server();
        try {
            server.createContext("/oauth2/token", exchange -> {
                exchange.getResponseHeaders().add("Content-Type", "application/json; charset=UTF-8");
                exchange.sendResponseHeaders(200, 0);
                try (var output = exchange.getResponseBody()) { output.write(body); }
            });
            server.start();
            assertion.accept(client(server));
        } finally { server.stop(0); }
    }

    private HttpServer server() throws Exception { return HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0); }
    private ViKashClient client(HttpServer server) {
        return new ViKashClient(new ViKashProperties(false, "http://127.0.0.1:" + server.getAddress().getPort(),
            "fuellog", "test-secret", "http://127.0.0.1/callback", "", "fuellog://vikash-return"), JsonMapper.builder().build());
    }
    private void assertInvalid(ViKashRemoteException error) {
        assertEquals(502, error.status());
        assertEquals("INVALID_RESPONSE", error.code());
        assertEquals(200, error.remoteStatus());
        assertEquals(ViKashRemoteException.Reason.INVALID_RESPONSE, error.reason());
        assertNull(error.getCause(), "No remote response or credential may leak through exception causes");
    }
}
