package com.fuellog;

import com.fuellog.identity.repositories.UserAccountRepository;
import com.fuellog.identity.security.Totp;
import java.net.URI;
import java.net.http.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.*;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.postgresql.PostgreSQLContainer;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import static org.assertj.core.api.Assertions.*;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
class ProfileIT {
    private static final PostgreSQLContainer database = new PostgreSQLContainer("postgres:18-alpine");
    @DynamicPropertySource static void database(DynamicPropertyRegistry properties) {
        database.start();
        properties.add("spring.datasource.url", database::getJdbcUrl);
        properties.add("spring.datasource.username", database::getUsername);
        properties.add("spring.datasource.password", database::getPassword);
    }
    @AfterAll static void stopDatabase() { database.stop(); }
    private static final String PASSWORD = " Original password 42! ";
    private final HttpClient client = HttpClient.newHttpClient();
    @LocalServerPort int port;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    @Autowired Totp totp;
    @Autowired UserAccountRepository users;
    @Autowired PlatformTransactionManager transactions;

    @Test void persistsNormalizedProfilePreservingCredentialsSessionsAndOtherAccounts() throws Exception {
        var owner = account();
        var stranger = account();
        var original = user(owner);
        var other = user(stranger);
        var sessions = jdbc.queryForList("select * from user_sessions where user_id=?", owner.id());
        var tokens = jdbc.queryForList("select t.* from refresh_tokens t join user_sessions s on s.id=t.session_id where s.user_id=?", owner.id());
        String email = nextEmail();
        var body = new LinkedHashMap<>(input("  Ana Maria  ", "  " + email.toUpperCase(Locale.ROOT) + "  ", PASSWORD, null));
        body.put("userId", stranger.id().toString());
        var result = request("PATCH", "/me", owner.access(), body);
        assertThat(result.status()).as("%s", result.body()).isEqualTo(200);
        assertThat(result.cache()).contains("no-store");
        assertThat(result.body().path("id").asString()).isEqualTo(owner.id().toString());
        assertThat(result.body().path("name").asString()).isEqualTo("Ana Maria");
        assertThat(result.body().path("email").asString()).isEqualTo(email);
        assertThat(result.body().size()).isEqualTo(4);
        assertThat(request("GET", "/me", owner.access(), null).body()).isEqualTo(result.body());
        assertThat(user(owner)).containsEntry("password_hash", original.get("password_hash"))
                .containsEntry("preferred_timezone", original.get("preferred_timezone"));
        assertThat(user(stranger)).isEqualTo(other);
        assertThat(jdbc.queryForList("select * from user_sessions where user_id=?", owner.id())).isEqualTo(sessions);
        assertThat(jdbc.queryForList("select t.* from refresh_tokens t join user_sessions s on s.id=t.session_id where s.user_id=?", owner.id())).isEqualTo(tokens);
        assertThat(login(owner.email()).status()).isEqualTo(401);
        assertThat(login(email).status()).isEqualTo(200);
        assertThat(request("POST", "/auth/refresh", null, Map.of("refresh_token", owner.refresh())).status()).isEqualTo(200);
    }

    @Test void validatesRequiredFieldsNormalizedBoundsAndCurrentPasswordWithoutMutation() throws Exception {
        var owner = account();
        var original = user(owner);
        for (String name : Arrays.asList(null, "", "   ", "x".repeat(101)))
            assertError(update(owner, name, owner.email(), null, null), 422, "VALIDATION_ERROR", "name");
        for (String email : Arrays.asList(null, "", "   ", "invalid", "a@", "a".repeat(245) + "@example.test"))
            assertError(update(owner, "Ana", email, PASSWORD, null), 422, "VALIDATION_ERROR", "email");
        for (String password : Arrays.asList(null, "", "wrong", PASSWORD.strip(), "x".repeat(129)))
            assertError(update(owner, "Changed", nextEmail(), password, null), 422, "VALIDATION_ERROR", "currentPassword");
        assertThat(user(owner)).isEqualTo(original);
        for (String name : List.of("A", "x".repeat(100)))
            assertThat(update(owner, " " + name + " ", owner.email(), null, null).status()).isEqualTo(200);
        String email254 = "a".repeat(64) + "@" + "b".repeat(63) + "." + "c".repeat(63) + "." + "d".repeat(61);
        assertThat(email254).hasSize(254);
        assertThat(update(owner, "Ana", email254, PASSWORD, null).status()).isEqualTo(200);
    }

    @Test void unchangedNormalizedEmailAndNameOnlyBypassPasswordAndFactorEvenWithMfaEnabled() throws Exception {
        var owner = account();
        enableFactor(owner);
        long version = ((Number) user(owner).get("version")).longValue();
        assertThat(update(owner, "Profile test", " " + owner.email().toUpperCase(Locale.ROOT) + " ", null, null).status()).isEqualTo(200);
        assertThat(user(owner).get("version")).isEqualTo(version);
        assertThat(update(owner, "New name", owner.email(), "incorrect", "invalid-code").status()).isEqualTo(200);
        assertThat(attempts(owner)).isEqualTo(1);
        assertThat(recoveryCount(owner)).isEqualTo(10);
    }

    @Test void requiresAuthenticationAndSupportsPatchCorsPreflight() throws Exception {
        for (String access : Arrays.asList(null, "invalid"))
            assertThat(request("PATCH", "/me", access, input("Ana", nextEmail(), PASSWORD, null)).status()).isEqualTo(401);
        var preflight = client.send(HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/v1/me"))
                .header("Origin", "http://localhost:8081").header("Access-Control-Request-Method", "PATCH")
                .header("Access-Control-Request-Headers", "authorization,content-type")
                .method("OPTIONS", HttpRequest.BodyPublishers.noBody()).build(), HttpResponse.BodyHandlers.ofString());
        assertThat(preflight.statusCode()).isEqualTo(200);
        assertThat(preflight.headers().firstValue("Access-Control-Allow-Methods").orElse("")).contains("PATCH");
        assertThat(preflight.headers().firstValue("Access-Control-Allow-Origin").orElse("")).isEqualTo("http://localhost:8081");
    }

    @Test void duplicateEmailIsCaseInsensitiveConflictWithAtomicMfaRecoveryRollback() throws Exception {
        var owner = account();
        var stranger = account();
        var factor = enableFactor(owner);
        var original = user(owner);
        int attempts = attempts(owner);
        assertError(update(owner, "Changed", " " + stranger.email().toUpperCase(Locale.ROOT) + " ", PASSWORD, factor.recovery().get(0)),
                409, "ACCOUNT_CONFLICT", "email");
        assertThat(user(owner)).isEqualTo(original);
        assertThat(recoveryCount(owner)).isEqualTo(10);
        assertThat(attempts(owner)).isEqualTo(attempts);
        assertThat(update(owner, "Changed", nextEmail(), PASSWORD, factor.recovery().get(0)).status()).isEqualTo(200);
        assertThat(recoveryCount(owner)).isEqualTo(9);
        assertError(update(owner, "Again", nextEmail(), PASSWORD, factor.recovery().get(0)), 422, "MFA_INVALID_CODE", "code");
    }

    @Test void simultaneousClaimsHaveOneWinnerAnd409LoserWithoutPartialProfileUpdate() throws Exception {
        var first = account();
        var second = account();
        String email = nextEmail();
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var start = new CountDownLatch(1);
            var a = executor.submit(() -> { start.await(); return update(first, "First", email, PASSWORD, null); });
            var b = executor.submit(() -> { start.await(); return update(second, "Second", email.toUpperCase(Locale.ROOT), PASSWORD, null); });
            start.countDown();
            var ra = a.get(20, TimeUnit.SECONDS);
            var rb = b.get(20, TimeUnit.SECONDS);
            assertThat(List.of(ra.status(), rb.status())).containsExactlyInAnyOrder(200, 409);
            var loser = ra.status() == 409 ? first : second;
            assertError(ra.status() == 409 ? ra : rb, 409, "ACCOUNT_CONFLICT", "email");
            assertThat(user(loser)).containsEntry("name", "Profile test").containsEntry("email", loser.email());
        }
        assertThat(jdbc.queryForObject("select count(*) from users where email=?", Integer.class, email)).isEqualTo(1);
    }

    @Test void invalidMfaCommitsRateLimitButNeverChangesProfile() throws Exception {
        var owner = account();
        enableFactor(owner);
        var original = user(owner);
        assertError(update(owner, "Changed", nextEmail(), PASSWORD, null), 422, "MFA_INVALID_CODE", "code");
        assertError(update(owner, "Changed", nextEmail(), PASSWORD, "bad-code"), 422, "MFA_INVALID_CODE", "code");
        assertThat(attempts(owner)).isEqualTo(3);
        boolean limited = false;
        for (int attempt = 0; attempt < 4; attempt++) {
            var result = update(owner, "Changed", nextEmail(), PASSWORD, "invalid-code");
            assertThat(result.status()).isIn(422, 429);
            if (result.status() == 429) { assertThat(result.body().path("code").asString()).isEqualTo("MFA_RATE_LIMITED"); limited = true; break; }
        }
        assertThat(limited).isTrue();
        assertThat(user(owner)).isEqualTo(original);
        assertThat(recoveryCount(owner)).isEqualTo(10);
    }

    @Test void freshTotpSucceedsReplayFailsAndPreChangeChallengesAreInvalidated() throws Exception {
        var owner = account();
        var factor = enableFactor(owner);
        var challenge = login(owner.email());
        String code = totp.code(factor.secret(), Instant.now().plusSeconds(30));
        String email = nextEmail();
        assertThat(update(owner, "Changed", email, PASSWORD, code).status()).isEqualTo(200);
        var updated = user(owner);
        assertError(update(owner, "Again", nextEmail(), PASSWORD, code), 422, "MFA_INVALID_CODE", "code");
        assertThat(user(owner)).isEqualTo(updated);
        assertThat(request("POST", "/auth/2fa/verify", null, Map.of("challengeToken", challenge.body().path("challengeToken").asString(),
                "code", factor.recovery().get(0))).status()).isEqualTo(401);
        assertThat(login(owner.email()).status()).isEqualTo(401);
        var next = login(email);
        assertThat(next.body().path("mfaRequired").asBoolean()).isTrue();
        assertThat(request("POST", "/auth/2fa/verify", null, Map.of("challengeToken", next.body().path("challengeToken").asString(),
                "code", factor.recovery().get(0))).status()).isEqualTo(200);
        assertThat(request("GET", "/me", owner.access(), null).status()).isEqualTo(200);
    }

    @Test void emailChangeInvalidatesPendingSetupWithoutEnablingOrChangingFactor() throws Exception {
        var owner = account();
        var setup = request("POST", "/me/2fa/setup", owner.access(), Map.of("currentPassword", PASSWORD));
        String secret = setup.body().path("secret").asString();
        assertThat(update(owner, "Changed", nextEmail(), PASSWORD, null).status()).isEqualTo(200);
        var enable = request("POST", "/me/2fa/enable", owner.access(), Map.of("code", totp.code(secret, Instant.now())));
        assertThat(enable.status()).isEqualTo(422);
        assertThat(enable.body().path("code").asString()).isEqualTo("MFA_SETUP_INVALID");
        assertThat(request("GET", "/me/2fa", owner.access(), null).body().path("enabled").asBoolean()).isFalse();
    }

    @Test void revocationWhileWaitingForUserLockRejectsUpdate() throws Exception {
        var owner = account();
        var original = user(owner);
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            Future<Response> pending = new TransactionTemplate(transactions).execute(status -> {
                users.lockById(owner.id()).orElseThrow();
                var call = executor.submit(() -> update(owner, "Changed", owner.email(), null, null));
                long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
                boolean waiting = false;
                while (System.nanoTime() < deadline) {
                    jdbc.execute("select pg_stat_clear_snapshot()");
                    if (jdbc.queryForObject("select count(*) from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like '%users%'", Integer.class) > 0) { waiting = true; break; }
                    try { Thread.sleep(20); } catch (InterruptedException error) { throw new AssertionError(error); }
                }
                assertThat(waiting).as("Profile update waits for user lock").isTrue();
                jdbc.update("update user_sessions set revoked_at=now(),revocation_reason='LOGOUT' where id=?", owner.session());
                return call;
            });
            assertThat(pending.get(15, TimeUnit.SECONDS).status()).isEqualTo(401);
        }
        assertThat(user(owner)).isEqualTo(original);
    }

    private String nextEmail() { return UUID.randomUUID() + "@example.test"; }
    private Map<String, Object> user(Account owner) { return jdbc.queryForMap("select * from users where id=?", owner.id()); }
    private int recoveryCount(Account owner) { return jdbc.queryForObject("select count(*) from two_factor_recovery_codes where user_id=?", Integer.class, owner.id()); }
    private int attempts(Account owner) { return jdbc.queryForObject("select attempts from two_factor_attempts where scope=?", Integer.class, "user:" + owner.id() + ":factor"); }
    private Factor enableFactor(Account owner) throws Exception {
        var setup = request("POST", "/me/2fa/setup", owner.access(), Map.of("currentPassword", PASSWORD));
        assertThat(setup.status()).isEqualTo(200);
        String secret = setup.body().path("secret").asString();
        var result = request("POST", "/me/2fa/enable", owner.access(), Map.of("code", totp.code(secret, Instant.now())));
        assertThat(result.status()).as("%s", result.body()).isEqualTo(200);
        return new Factor(secret, result.body().path("recoveryCodes").valueStream().map(JsonNode::asString).toList());
    }
    private Account account() throws Exception {
        String email = nextEmail();
        var registered = request("POST", "/auth/register", null, Map.of("name", "Profile test", "email", email, "password", PASSWORD));
        assertThat(registered.status()).isEqualTo(201);
        var login = login(email);
        assertThat(login.status()).isEqualTo(200);
        return new Account(UUID.fromString(registered.body().path("id").asString()), email, login.body().path("access_token").asString(),
                login.body().path("refresh_token").asString(), UUID.fromString(login.body().path("session_id").asString()));
    }
    private Response login(String email) throws Exception { return request("POST", "/auth/login", null, Map.of("email", email, "password", PASSWORD)); }
    private Map<String, Object> input(String name, String email, String password, String code) {
        var input = new LinkedHashMap<String, Object>();
        input.put("name", name); input.put("email", email); input.put("currentPassword", password); input.put("secondFactorCode", code);
        return input;
    }
    private Response update(Account owner, String name, String email, String password, String code) throws Exception {
        return request("PATCH", "/me", owner.access(), input(name, email, password, code));
    }
    private void assertError(Response result, int status, String code, String field) {
        assertThat(result.status()).as("%s", result.body()).isEqualTo(status);
        assertThat(result.body().path("code").asString()).isEqualTo(code);
        assertThat(result.body().path("fieldErrors").has(field)).isTrue();
        assertThat(result.body().toString()).doesNotContain(PASSWORD, "password_hash", "passwordHash");
    }
    private Response request(String method, String path, String access, Object body) throws Exception {
        var builder = HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/v1" + path)).timeout(Duration.ofSeconds(30));
        if (access != null) builder.header("Authorization", "Bearer " + access);
        if (body != null) builder.header("Content-Type", "application/json");
        var result = client.send(builder.method(method, body == null ? HttpRequest.BodyPublishers.noBody()
                : HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body))).build(), HttpResponse.BodyHandlers.ofString());
        return new Response(result.statusCode(), result.body().isEmpty() ? json.nullNode() : json.readTree(result.body()), result.headers().firstValue("Cache-Control").orElse(""));
    }
    private record Account(UUID id, String email, String access, String refresh, UUID session) {}
    private record Factor(String secret, List<String> recovery) {}
    private record Response(int status, JsonNode body, String cache) {}
}
