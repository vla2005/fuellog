package com.fuellog;

import static org.assertj.core.api.Assertions.*;
import com.fuellog.identity.security.*;
import java.net.URI;
import java.net.http.*;
import java.sql.Timestamp;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.*;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.*;
import org.testcontainers.postgresql.PostgreSQLContainer;
import tools.jackson.databind.*;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
@Import(TwoFactorIT.TestClockConfiguration.class)
class TwoFactorIT {
    private static final PostgreSQLContainer postgres = new PostgreSQLContainer("postgres:18-alpine");
    private static final String PASSWORD = "Only-test-password-42!";
    private static final Instant NOW = Instant.parse("2026-10-27T12:00:00Z");
    @DynamicPropertySource static void database(DynamicPropertyRegistry properties) {
        postgres.start();
        properties.add("spring.datasource.url", postgres::getJdbcUrl);
        properties.add("spring.datasource.username", postgres::getUsername);
        properties.add("spring.datasource.password", postgres::getPassword);
    }
    @AfterAll static void stopDatabase() { postgres.stop(); }
    @LocalServerPort int port;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    @Autowired Totp totp;
    @Autowired TotpEncryption encryption;
    @Autowired TestClock clock;
    private final HttpClient client = HttpClient.newHttpClient();
    @BeforeEach void resetClock() { clock.current.set(NOW); }

    @Test void enrollmentNeedsPasswordSameSessionAndConfirmationThenRevokesOnlyOthers() throws Exception {
        var owner = account();
        var other = login(owner.email(), PASSWORD);
        var stranger = account();
        assertThat(request("GET", "/me/2fa", owner.access(), null).body().path("enabled").asBoolean()).isFalse();
        var wrong = request("POST", "/me/2fa/setup", owner.access(), Map.of("currentPassword", "wrong"));
        assertThat(wrong.status()).isEqualTo(422);
        assertThat(wrong.body().path("fieldErrors").has("currentPassword")).isTrue();
        var setup = setup(owner);
        String secret = setup.path("secret").asString();
        assertThat(setup.path("otpauthUri").asString()).startsWith("otpauth://totp/FuelLog%3A")
                .contains("%40example.test", "issuer=FuelLog", "algorithm=SHA1", "digits=6", "period=30");
        assertThat(Instant.parse(setup.path("expiresAt").asString())).isEqualTo(NOW.plusSeconds(300));
        String encrypted = jdbc.queryForObject("select encrypted_secret from user_two_factors where user_id=?", String.class, owner.id());
        assertThat(encrypted).doesNotContain(secret);
        assertThat(encryption.decrypt(owner.id(), encrypted)).isEqualTo(secret);
        assertThat(request("GET", "/me/2fa", owner.access(), null).body().path("enabled").asBoolean()).isFalse();
        assertCode(request("POST", "/me/2fa/enable", other.body().path("access_token").asString(),
                Map.of("code", totp.code(secret, NOW))), 422, "MFA_SETUP_INVALID");
        assertCode(request("POST", "/me/2fa/enable", stranger.access(), Map.of("code", totp.code(secret, NOW))), 422, "MFA_SETUP_INVALID");
        assertCode(request("POST", "/me/2fa/enable", owner.access(), Map.of("code", "invalid")), 422, "MFA_INVALID_CODE");
        var enabled = request("POST", "/me/2fa/enable", owner.access(), Map.of("code", totp.code(secret, NOW)));
        assertThat(enabled.status()).isEqualTo(200);
        assertThat(enabled.response().headers().firstValue("Cache-Control")).contains("no-store");
        var codes = enabled.body().path("recoveryCodes");
        assertThat(codes.size()).isEqualTo(10);
        assertThat(codes.valueStream().map(JsonNode::asString).distinct().count()).isEqualTo(10);
        for (var code : codes) {
            assertThat(Base64.getUrlDecoder().decode(code.asString())).hasSize(32);
            assertThat(jdbc.queryForList("select code_hash from two_factor_recovery_codes where user_id=?", String.class, owner.id()))
                    .doesNotContain(code.asString());
        }
        var status = request("GET", "/me/2fa", owner.access(), null);
        assertThat(status.body().path("enabled").asBoolean()).isTrue();
        assertThat(status.body().path("recoveryCodesRemaining").asInt()).isEqualTo(10);
        assertThat(status.body().has("secret")).isFalse();
        assertThat(request("GET", "/me", other.body().path("access_token").asString(), null).status()).isEqualTo(401);
        assertThat(refresh(other.body().path("refresh_token").asString()).status()).isEqualTo(401);
        assertThat(refresh(owner.refresh()).status()).isEqualTo(200);
        assertCode(request("POST", "/me/2fa/setup", owner.access(), Map.of("currentPassword", PASSWORD)), 409, "MFA_ALREADY_ENABLED");
        assertCode(request("POST", "/me/2fa/enable", owner.access(), Map.of("code", "123456")), 409, "MFA_ALREADY_ENABLED");
    }

    @Test void loginEmitsNoSessionUntilFactorAndRejectsTotpAndChallengeReplay() throws Exception {
        var enrolled = enrolled(); var owner = enrolled.account();
        int sessions = sessionCount(owner.id());
        int challenges = count("two_factor_challenges", owner.id());
        assertThat(login(owner.email(), "wrong").status()).isEqualTo(401);
        assertThat(login(UUID.randomUUID() + "@example.test", PASSWORD).status()).isEqualTo(401);
        assertThat(count("two_factor_challenges", owner.id())).isEqualTo(challenges);
        var challenge = challenge(owner);
        assertThat(challenge.has("access_token")).isFalse();
        assertThat(challenge.has("refresh_token")).isFalse();
        assertThat(challenge.has("session_id")).isFalse();
        assertThat(challenge.path("mfaRequired").asBoolean()).isTrue();
        assertThat(sessionCount(owner.id())).isEqualTo(sessions);
        String token = challenge.path("challengeToken").asString();
        assertThat(request("GET", "/me", token, null).status()).isEqualTo(401);
        assertThat(jdbc.queryForList("select token_hash from two_factor_challenges where user_id=?", String.class, owner.id())).doesNotContain(token);
        assertCode(verify(token, totp.code(enrolled.secret(), NOW)), 422, "MFA_INVALID_CODE");
        clock.advance(30);
        var logged = verify(token, totp.code(enrolled.secret(), clock.instant()));
        assertThat(logged.status()).isEqualTo(200);
        assertThat(logged.body().has("access_token")).isTrue();
        assertThat(request("GET", "/me", logged.body().path("access_token").asString(), null).status()).isEqualTo(200);
        assertThat(sessionCount(owner.id())).isEqualTo(sessions + 1);
        assertCode(verify(token, enrolled.codes().get(0)), 401, "MFA_CHALLENGE_INVALID");
        assertCode(verify(challenge(owner).path("challengeToken").asString(), totp.code(enrolled.secret(), clock.instant())), 422, "MFA_INVALID_CODE");
    }

    @Test void concurrentRecoveryConsumptionIsOneUseAcrossDifferentChallenges() throws Exception {
        var enrolled = enrolled(); var owner = enrolled.account();
        String first = challenge(owner).path("challengeToken").asString();
        String second = challenge(owner).path("challengeToken").asString();
        int sessions = sessionCount(owner.id());
        var statuses = parallel(() -> verify(first, enrolled.codes().get(0)).status(), () -> verify(second, enrolled.codes().get(0)).status());
        assertThat(statuses).containsExactlyInAnyOrder(200, 422);
        assertThat(sessionCount(owner.id())).isEqualTo(sessions + 1);
        assertThat(count("two_factor_recovery_codes", owner.id())).isEqualTo(9);
        assertThat(count("two_factor_challenges", owner.id())).isEqualTo(1);
    }

    @Test void concurrentChallengeUseCreatesExactlyOneSessionEvenWithDifferentRecoveryCodes() throws Exception {
        var enrolled = enrolled(); var owner = enrolled.account();
        String challenge = challenge(owner).path("challengeToken").asString();
        int sessions = sessionCount(owner.id());
        assertThat(parallel(() -> verify(challenge, enrolled.codes().get(0)).status(), () -> verify(challenge, enrolled.codes().get(1)).status()))
                .containsExactlyInAnyOrder(200, 401);
        assertThat(sessionCount(owner.id())).isEqualTo(sessions + 1);
        assertThat(count("two_factor_recovery_codes", owner.id())).isEqualTo(9);
    }

    @Test void persistentUserLimitSurvivesFailuresNewChallengesAndExpiresAfterFiveMinutes() throws Exception {
        var enrolled = enrolled(); var owner = enrolled.account();
        for (int i = 0; i < 4; i++)
            assertCode(verify(challenge(owner).path("challengeToken").asString(), "wrong"), 422, "MFA_INVALID_CODE");
        assertCode(verify(challenge(owner).path("challengeToken").asString(), enrolled.codes().get(0)), 429, "MFA_RATE_LIMITED");
        assertThat(count("two_factor_recovery_codes", owner.id())).isEqualTo(10);
        assertThat(sessionCount(owner.id())).isEqualTo(1);
        assertThat(jdbc.queryForObject("select attempts from two_factor_attempts where scope=?", Integer.class, "user:" + owner.id() + ":factor")).isEqualTo(6);
        clock.advance(300);
        assertThat(verify(challenge(owner).path("challengeToken").asString(), enrolled.codes().get(0)).status()).isEqualTo(200);
    }

    @Test void perChallengeLimitPersistsAndItsDeadlineIsExclusive() throws Exception {
        var enrolled = enrolled(); var owner = enrolled.account();
        String token = challenge(owner).path("challengeToken").asString();
        for (int i = 0; i < 4; i++) assertCode(verify(token, "wrong"), 422, "MFA_INVALID_CODE");
        assertCode(verify(token, "wrong"), 429, "MFA_RATE_LIMITED");
        assertCode(verify(token, "wrong"), 429, "MFA_RATE_LIMITED");
        String hash = new RefreshSecrets().hash(token);
        assertThat(jdbc.queryForObject("select attempts from two_factor_attempts where scope=?", Integer.class, "challenge:" + hash)).isEqualTo(6);
        clock.advance(300);
        assertCode(verify(token, enrolled.codes().get(0)), 401, "MFA_CHALLENGE_INVALID");
        assertCode(verify(new RefreshSecrets().generate(), enrolled.codes().get(0)), 401, "MFA_CHALLENGE_INVALID");
        assertCode(verify("malformed", enrolled.codes().get(0)), 401, "MFA_CHALLENGE_INVALID");
    }

    @Test void disableRequiresPasswordAndFactorPreservesCurrentAndInvalidatesEverythingOld() throws Exception {
        var enrolled = enrolled(); var owner = enrolled.account();
        String pending = challenge(owner).path("challengeToken").asString();
        var other = verify(challenge(owner).path("challengeToken").asString(), enrolled.codes().get(0));
        assertThat(other.status()).isEqualTo(200);
        var wrongPassword = request("POST", "/me/2fa/disable", owner.access(), Map.of("currentPassword", "wrong", "code", enrolled.codes().get(1)));
        assertThat(wrongPassword.status()).isEqualTo(422);
        assertThat(wrongPassword.body().path("fieldErrors").has("currentPassword")).isTrue();
        assertCode(request("POST", "/me/2fa/disable", owner.access(), Map.of("currentPassword", PASSWORD, "code", "wrong")), 422, "MFA_INVALID_CODE");
        assertThat(request("GET", "/me", owner.access(), null).status()).isEqualTo(200);
        assertThat(count("two_factor_recovery_codes", owner.id())).isEqualTo(9);
        var disabled = request("POST", "/me/2fa/disable", owner.access(), Map.of("currentPassword", PASSWORD, "code", enrolled.codes().get(1)));
        assertThat(disabled.status()).isEqualTo(204);
        assertThat(disabled.response().headers().firstValue("Cache-Control")).contains("no-store");
        assertThat(request("GET", "/me", owner.access(), null).status()).isEqualTo(200);
        assertThat(refresh(owner.refresh()).status()).isEqualTo(200);
        assertThat(request("GET", "/me", other.body().path("access_token").asString(), null).status()).isEqualTo(401);
        assertThat(refresh(other.body().path("refresh_token").asString()).status()).isEqualTo(401);
        assertThat(count("user_two_factors", owner.id())).isZero();
        assertThat(count("two_factor_recovery_codes", owner.id())).isZero();
        assertThat(count("two_factor_challenges", owner.id())).isZero();
        assertCode(verify(pending, enrolled.codes().get(2)), 401, "MFA_CHALLENGE_INVALID");
        var login = login(owner.email(), PASSWORD);
        assertThat(login.body().has("access_token")).isTrue();
        assertThat(login.body().has("mfaRequired")).isFalse();
    }

    @Test void passwordChangeRequiresFactorAndInvalidatesOldChallengesAndAllSessions() throws Exception {
        var enrolled = enrolled(); var owner = enrolled.account();
        String pending = challenge(owner).path("challengeToken").asString();
        String changed = "Changed-password-42!";
        var input = new LinkedHashMap<String, Object>();
        input.put("currentPassword", PASSWORD); input.put("newPassword", changed);
        assertCode(request("POST", "/me/password", owner.access(), input), 422, "MFA_INVALID_CODE");
        input.put("secondFactorCode", enrolled.codes().get(0));
        assertThat(request("POST", "/me/password", owner.access(), input).status()).isEqualTo(204);
        assertThat(request("GET", "/me", owner.access(), null).status()).isEqualTo(401);
        assertThat(refresh(owner.refresh()).status()).isEqualTo(401);
        assertCode(verify(pending, enrolled.codes().get(1)), 401, "MFA_CHALLENGE_INVALID");
        assertThat(login(owner.email(), PASSWORD).status()).isEqualTo(401);
        var next = login(owner.email(), changed);
        assertThat(next.body().path("mfaRequired").asBoolean()).isTrue();
        assertThat(verify(next.body().path("challengeToken").asString(), enrolled.codes().get(1)).status()).isEqualTo(200);
    }

    @Test void badFactorOnPasswordEndpointCommitsLimitsWithoutChangingCredentialsOrSessions() throws Exception {
        var enrolled = enrolled(); var owner = enrolled.account();
        String before = jdbc.queryForObject("select password_hash from users where id=?", String.class, owner.id());
        var input = Map.of("currentPassword", PASSWORD, "newPassword", "Changed-password-42!", "secondFactorCode", "wrong");
        for (int i = 0; i < 4; i++) assertCode(request("POST", "/me/password", owner.access(), input), 422, "MFA_INVALID_CODE");
        assertCode(request("POST", "/me/password", owner.access(), input), 429, "MFA_RATE_LIMITED");
        assertThat(jdbc.queryForObject("select password_hash from users where id=?", String.class, owner.id())).isEqualTo(before);
        assertThat(jdbc.queryForObject("select version from users where id=?", Long.class, owner.id())).isZero();
        assertThat(request("GET", "/me", owner.access(), null).status()).isEqualTo(200);
        assertThat(refresh(owner.refresh()).status()).isEqualTo(200);
        assertThat(count("two_factor_recovery_codes", owner.id())).isEqualTo(10);
    }

    @Test void pendingEnrollmentExpiresAndCredentialChangeInvalidatesIt() throws Exception {
        var owner = account();
        String secret = setup(owner).path("secret").asString();
        clock.advance(300);
        assertCode(request("POST", "/me/2fa/enable", owner.access(), Map.of("code", totp.code(secret, clock.instant()))), 422, "MFA_SETUP_INVALID");
        var updated = setup(owner);
        var retained = login(owner.email(), PASSWORD);
        assertThat(request("POST", "/me/password", retained.body().path("access_token").asString(),
                Map.of("currentPassword", PASSWORD, "newPassword", "Changed-password-42!")).status()).isEqualTo(204);
        // Keep the old session alive only in this fixture to isolate the credential-version check.
        jdbc.update("update user_sessions set revoked_at=null,revocation_reason=null where id=?", UUID.fromString(owner.sessionId()));
        assertCode(request("POST", "/me/2fa/enable", owner.access(), Map.of("code", totp.code(updated.path("secret").asString(), clock.instant()))), 422, "MFA_SETUP_INVALID");
        assertThat(request("GET", "/me/2fa", owner.access(), null).body().path("enabled").asBoolean()).isFalse();
    }

    @Test void publicVerificationMatchesOnlyExactMethodAndProtectedRoutesRequireAuthentication() throws Exception {
        for (String path : List.of("/me/2fa", "/me/2fa/setup", "/me/2fa/enable", "/me/2fa/disable"))
            assertThat(request(path.equals("/me/2fa") ? "GET" : "POST", path, null, null).status()).isEqualTo(401);
        assertThat(request("GET", "/auth/2fa/verify", null, null).status()).isEqualTo(401);
        assertThat(request("POST", "/auth/2fa/verify/extra", null, Map.of("challengeToken", "invalid", "code", "invalid")).status()).isEqualTo(401);
        assertCode(request("POST", "/auth/2fa/verify", "invalid-bearer-is-ignored-on-public-endpoint", Map.of("challengeToken", "invalid", "code", "invalid")), 401, "MFA_CHALLENGE_INVALID");
    }

    @Test void migrationFromV4PreservesExistingUsersPasswordsAndSessions() throws Exception {
        String schema = "mfa_upgrade_" + UUID.randomUUID().toString().replace("-", "");
        var source = jdbc.getDataSource();
        try {
            org.flywaydb.core.Flyway.configure().dataSource(source).schemas(schema).defaultSchema(schema).target("4").load().migrate();
            UUID user = UUID.randomUUID(), session = UUID.randomUUID();
            jdbc.update("insert into " + schema + ".users(id,name,email,password_hash) values (?,'Legacy',?,'legacy-hash')", user, user + "@example.test");
            jdbc.update("insert into " + schema + ".user_sessions(id,user_id,created_at,expires_at) values (?,?,?,?)", session, user, Timestamp.from(NOW), Timestamp.from(NOW.plusSeconds(3600)));
            var flyway = org.flywaydb.core.Flyway.configure().dataSource(source).schemas(schema).defaultSchema(schema).target("5").load();
            assertThat(flyway.migrate().migrationsExecuted).isEqualTo(1);
            assertThat(flyway.migrate().migrationsExecuted).isZero();
            assertThat(jdbc.queryForObject("select password_hash from " + schema + ".users where id=?", String.class, user)).isEqualTo("legacy-hash");
            assertThat(jdbc.queryForObject("select count(*) from " + schema + ".user_sessions where id=?", Integer.class, session)).isEqualTo(1);
            assertThat(jdbc.queryForObject("select count(*) from " + schema + ".user_two_factors", Integer.class)).isZero();
            assertThat(jdbc.queryForObject("select count(*) from " + schema + ".two_factor_recovery_codes", Integer.class)).isZero();
        } finally { jdbc.execute("drop schema if exists " + schema + " cascade"); }
    }

    private Account account() throws Exception {
        String email = UUID.randomUUID() + "@example.test";
        var registered = request("POST", "/auth/register", null, Map.of("name", "Test", "email", email, "password", PASSWORD));
        assertThat(registered.status()).isEqualTo(201);
        var login = login(email, PASSWORD);
        assertThat(login.status()).isEqualTo(200);
        return new Account(UUID.fromString(registered.body().path("id").asString()), email, login.body().path("access_token").asString(),
                login.body().path("refresh_token").asString(), login.body().path("session_id").asString());
    }
    private JsonNode setup(Account owner) throws Exception {
        var setup = request("POST", "/me/2fa/setup", owner.access(), Map.of("currentPassword", PASSWORD));
        assertThat(setup.status()).isEqualTo(200); return setup.body();
    }
    private Enrolled enrolled() throws Exception {
        var owner = account(); String secret = setup(owner).path("secret").asString();
        var enabled = request("POST", "/me/2fa/enable", owner.access(), Map.of("code", totp.code(secret, clock.instant())));
        assertThat(enabled.status()).isEqualTo(200);
        return new Enrolled(owner, secret, enabled.body().path("recoveryCodes").valueStream().map(JsonNode::asString).toList());
    }
    private JsonNode challenge(Account owner) throws Exception {
        var response = login(owner.email(), PASSWORD);
        assertThat(response.status()).isEqualTo(200); assertThat(response.body().path("mfaRequired").asBoolean()).isTrue();
        return response.body();
    }
    private Response login(String email, String password) throws Exception { return request("POST", "/auth/login", null, Map.of("email", email, "password", password)); }
    private Response verify(String challenge, String code) throws Exception { return request("POST", "/auth/2fa/verify", null, Map.of("challengeToken", challenge, "code", code)); }
    private Response refresh(String token) throws Exception { return request("POST", "/auth/refresh", null, Map.of("refresh_token", token)); }
    private int sessionCount(UUID user) { return jdbc.queryForObject("select count(*) from user_sessions where user_id=?", Integer.class, user); }
    private int count(String table, UUID user) { return jdbc.queryForObject("select count(*) from " + table + " where user_id=?", Integer.class, user); }
    private void assertCode(Response response, int status, String code) {
        assertThat(response.status()).as("HTTP status for %s", code).isEqualTo(status);
        assertThat(response.body().path("code").asString()).isEqualTo(code);
    }
    private Response request(String method, String path, String access, Object input) throws Exception {
        var builder = HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/v1" + path)).timeout(Duration.ofSeconds(30));
        if (access != null) builder.header("Authorization", "Bearer " + access);
        if (input != null) builder.header("Content-Type", "application/json");
        builder.method(method, input == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(json.writeValueAsString(input)));
        var response = client.send(builder.build(), HttpResponse.BodyHandlers.ofString());
        return new Response(response.statusCode(), response.body().isBlank() ? json.createObjectNode() : json.readTree(response.body()), response);
    }
    @SafeVarargs private final List<Integer> parallel(Callable<Integer>... calls) throws Exception {
        CountDownLatch ready = new CountDownLatch(calls.length), start = new CountDownLatch(1);
        try (var pool = Executors.newFixedThreadPool(calls.length)) {
            var futures = new ArrayList<Future<Integer>>();
            for (var call : calls) futures.add(pool.submit(() -> { ready.countDown(); start.await(); return call.call(); }));
            assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue(); start.countDown();
            var results = new ArrayList<Integer>(); for (var future : futures) results.add(future.get(40, TimeUnit.SECONDS));
            return results;
        }
    }
    private record Account(UUID id, String email, String access, String refresh, String sessionId) {}
    private record Enrolled(Account account, String secret, List<String> codes) {}
    private record Response(int status, JsonNode body, HttpResponse<String> response) {}
    @TestConfiguration(proxyBeanMethods = false)
    static class TestClockConfiguration { @Bean @Primary TestClock twoFactorTestClock() { return new TestClock(); } }
    static class TestClock extends Clock {
        final AtomicReference<Instant> current = new AtomicReference<>(NOW);
        void advance(long seconds) { current.updateAndGet(value -> value.plusSeconds(seconds)); }
        @Override public Instant instant() { return current.get(); }
        @Override public ZoneId getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(ZoneId zone) { return Clock.fixed(instant(), zone); }
    }
}
