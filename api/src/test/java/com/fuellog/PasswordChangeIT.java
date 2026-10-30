package com.fuellog;

import com.fuellog.identity.repositories.UserAccountRepository;
import com.fuellog.identity.security.Totp;
import com.fuellog.identity.services.PasswordChangeService;
import com.fuellog.identity.services.SessionRevocationService;
import java.net.URI;
import java.net.http.*;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.*;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.postgresql.PostgreSQLContainer;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import static org.assertj.core.api.Assertions.*;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
class PasswordChangeIT {
    private static final PostgreSQLContainer database = new PostgreSQLContainer("postgres:18-alpine");
    @DynamicPropertySource static void database(DynamicPropertyRegistry properties) {
        database.start();
        properties.add("spring.datasource.url", database::getJdbcUrl);
        properties.add("spring.datasource.username", database::getUsername);
        properties.add("spring.datasource.password", database::getPassword);
    }
    @AfterAll static void stopDatabase() { database.stop(); }

    private static final String PASSWORD = " Original password 42! ";
    private static final String NEXT = " Changed password 43! ";
    private final HttpClient client = HttpClient.newHttpClient();
    @LocalServerPort int port;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    @Autowired PasswordEncoder encoder;
    @Autowired UserAccountRepository users;
    @Autowired PasswordChangeService passwords;
    @Autowired SessionRevocationService revocation;
    @Autowired PlatformTransactionManager transactions;
    @Autowired Totp totp;

    @Test void changesHashRevokesAllSessionsAndRefreshFamiliesAndPreservesOtherUsers() throws Exception {
        var owner = account();
        var otherSession = login(owner.email(), PASSWORD);
        var stranger = account();
        String originalHash = hash(owner);
        var originalOtherUser = jdbc.queryForList("select * from user_sessions where user_id=?", stranger.id());
        var result = change(owner, PASSWORD, NEXT, null);
        assertThat(result.status()).as("%s", result.body()).isEqualTo(204);
        assertThat(result.raw()).isEmpty();
        assertThat(result.cache()).contains("no-store");
        assertThat(hash(owner)).isNotEqualTo(originalHash).isNotEqualTo(NEXT);
        assertThat(encoder.matches(NEXT, hash(owner))).isTrue();
        assertThat(encoder.matches(PASSWORD, hash(owner))).isFalse();
        assertThat(jdbc.queryForObject("select version from users where id=?", Long.class, owner.id())).isEqualTo(1L);
        assertThat(jdbc.queryForObject("select count(*) from user_sessions where user_id=? and revoked_at is null", Integer.class, owner.id())).isZero();
        assertThat(jdbc.queryForObject("select count(*) from user_sessions where user_id=? and version>0 and revocation_reason='PASSWORD_CHANGED'", Integer.class, owner.id())).isEqualTo(2);
        assertThat(jdbc.queryForObject("select count(*) from refresh_tokens t join user_sessions s on s.id=t.session_id where s.user_id=? and t.revoked_at is null", Integer.class, owner.id())).isZero();
        for (String token : List.of(owner.access(), otherSession.body().path("access_token").asString()))
            assertThat(request("GET", "/me", token, null).status()).isEqualTo(401);
        for (String token : List.of(owner.refresh(), otherSession.body().path("refresh_token").asString()))
            assertThat(request("POST", "/auth/refresh", null, Map.of("refresh_token", token)).status()).isEqualTo(401);
        assertThat(login(owner.email(), PASSWORD).status()).isEqualTo(401);
        assertThat(login(owner.email(), NEXT.strip()).status()).isEqualTo(401);
        assertThat(login(owner.email(), NEXT).status()).isEqualTo(200);
        assertThat(request("GET", "/me", stranger.access(), null).status()).isEqualTo(200);
        assertThat(jdbc.queryForList("select * from user_sessions where user_id=?", stranger.id())).isEqualTo(originalOtherUser);
        assertThat(request("POST", "/auth/refresh", null, Map.of("refresh_token", stranger.refresh())).status()).isEqualTo(200);
    }

    @Test void validationErrorsKeepCredentialsAndSessionsAndUseFieldSpecific422() throws Exception {
        var owner = account();
        String originalHash = hash(owner);
        var originalSessions = jdbc.queryForList("select * from user_sessions where user_id=?", owner.id());
        var originalTokens = jdbc.queryForList("select t.* from refresh_tokens t join user_sessions s on s.id=t.session_id where s.user_id=?", owner.id());
        for (String invalid : Arrays.asList(null, "", "12345", "      ", "x".repeat(129), PASSWORD)) {
            assertValidation(change(owner, PASSWORD, invalid, null), "newPassword");
        }
        for (String invalid : Arrays.asList(null, "", "wrong-password", PASSWORD.strip(), "x".repeat(129))) {
            assertValidation(change(owner, invalid, NEXT, null), "currentPassword");
        }
        assertThat(hash(owner)).isEqualTo(originalHash);
        assertThat(jdbc.queryForList("select * from user_sessions where user_id=?", owner.id())).isEqualTo(originalSessions);
        assertThat(jdbc.queryForList("select t.* from refresh_tokens t join user_sessions s on s.id=t.session_id where s.user_id=?", owner.id())).isEqualTo(originalTokens);
        assertThat(request("GET", "/me", owner.access(), null).status()).isEqualTo(200);
        assertThat(request("POST", "/auth/refresh", null, Map.of("refresh_token", owner.refresh())).status()).isEqualTo(200);
    }

    @Test void acceptsSixAnd128CharactersAndRequiresAuthenticatedActiveAccount() throws Exception {
        for (String next : List.of(" abcd ", "x".repeat(128))) {
            var owner = account();
            assertThat(change(owner, PASSWORD, next, null).status()).isEqualTo(204);
            assertThat(login(owner.email(), next).status()).isEqualTo(200);
        }
        var owner = account();
        for (String token : Arrays.asList(null, "invalid"))
            assertThat(request("POST", "/me/password", token, Map.of("currentPassword", PASSWORD, "newPassword", NEXT)).status()).isEqualTo(401);
        String originalHash = hash(owner);
        jdbc.update("update users set disabled_at=now() where id=?", owner.id());
        assertThat(change(owner, PASSWORD, NEXT, null).status()).isEqualTo(401);
        assertThat(hash(owner)).isEqualTo(originalHash);
    }

    @Test void sharedRevocationPreservesOnlySpecifiedOwnedSessionAndItsFamily() throws Exception {
        var owner = account();
        var other = login(owner.email(), PASSWORD);
        var stranger = account();
        revocation.revokeUserSessions(owner.id(), "MFA_ENABLED", owner.session());
        assertThat(request("GET", "/me", owner.access(), null).status()).isEqualTo(200);
        assertThat(request("GET", "/me", other.body().path("access_token").asString(), null).status()).isEqualTo(401);
        assertThat(request("POST", "/auth/refresh", null, Map.of("refresh_token", other.body().path("refresh_token").asString())).status()).isEqualTo(401);
        assertThat(request("POST", "/auth/refresh", null, Map.of("refresh_token", owner.refresh())).status()).isEqualTo(200);
        revocation.revokeUserSessions(owner.id(), "PASSWORD_CHANGED", stranger.session());
        assertThat(request("GET", "/me", owner.access(), null).status()).isEqualTo(401);
        assertThat(request("GET", "/me", stranger.access(), null).status()).isEqualTo(200);
    }

    @Test void invalidFactorsPersistRateLimitWithoutChangingPasswordsOrSessions() throws Exception {
        var owner = account();
        enableFactor(owner);
        String originalHash = hash(owner);
        var originalSessions = jdbc.queryForList("select * from user_sessions where user_id=?", owner.id());
        assertValidation(change(owner, "incorrect", NEXT, "bad-code"), "currentPassword");
        assertValidation(change(owner, PASSWORD, "short", "bad-code"), "newPassword");
        assertThat(jdbc.queryForObject("select attempts from two_factor_attempts where scope=?", Integer.class, "user:" + owner.id() + ":factor")).isEqualTo(1);
        assertThat(change(owner, PASSWORD, NEXT, null).status()).isEqualTo(422);
        boolean limited = false;
        for (int attempt = 0; attempt < 6; attempt++) {
            var result = change(owner, PASSWORD, NEXT, "invalid-code");
            assertThat(result.status()).isIn(422, 429);
            if (result.status() == 429) {
                assertThat(result.body().path("code").asString()).isEqualTo("MFA_RATE_LIMITED");
                limited = true;
                break;
            }
        }
        assertThat(limited).isTrue();
        assertThat(hash(owner)).isEqualTo(originalHash);
        assertThat(jdbc.queryForList("select * from user_sessions where user_id=?", owner.id())).isEqualTo(originalSessions);
        assertThat(jdbc.queryForObject("select count(*) from two_factor_recovery_codes where user_id=?", Integer.class, owner.id())).isEqualTo(10);
        assertThat(request("GET", "/me", owner.access(), null).status()).isEqualTo(200);
        assertThat(request("POST", "/auth/refresh", null, Map.of("refresh_token", owner.refresh())).status()).isEqualTo(200);
    }

    @Test void acceptsRecoveryOrFreshTotpAndInvalidatesPreChangeLoginChallenge() throws Exception {
        for (boolean recovery : List.of(true, false)) {
            var owner = account();
            var factor = enableFactor(owner);
            var challenge = login(owner.email(), PASSWORD);
            assertThat(challenge.body().path("mfaRequired").asBoolean()).isTrue();
            String code = recovery ? factor.recovery().get(0) : totp.code(factor.secret(), Instant.now().plusSeconds(30));
            assertThat(change(owner, PASSWORD, NEXT, code).status()).isEqualTo(204);
            assertThat(jdbc.queryForObject("select count(*) from two_factor_recovery_codes where user_id=?", Integer.class, owner.id())).isEqualTo(recovery ? 9 : 10);
            assertThat(request("POST", "/auth/2fa/verify", null, Map.of("challengeToken", challenge.body().path("challengeToken").asString(), "code", factor.recovery().get(1))).status()).isEqualTo(401);
            assertThat(login(owner.email(), PASSWORD).status()).isEqualTo(401);
            var nextLogin = login(owner.email(), NEXT);
            assertThat(nextLogin.body().path("mfaRequired").asBoolean()).isTrue();
            assertThat(request("POST", "/auth/2fa/verify", null, Map.of("challengeToken", nextLogin.body().path("challengeToken").asString(), "code", factor.recovery().get(1))).status()).isEqualTo(200);
        }
    }

    @Test void revocationFailureRollsBackPasswordSessionsAndConsumedRecoveryCode() throws Exception {
        var owner = account();
        var factor = enableFactor(owner);
        String originalHash = hash(owner);
        var originalSessions = jdbc.queryForList("select * from user_sessions where user_id=?", owner.id());
        jdbc.execute("create function password_change_reject_revocation() returns trigger language plpgsql as $$ begin if new.session_id='" + owner.session() + "'::uuid then raise exception 'Planned revocation failure'; end if; return new; end $$");
        jdbc.execute("create trigger password_change_reject_revocation before update of revoked_at on refresh_tokens for each row execute function password_change_reject_revocation()");
        try {
            assertThat(change(owner, PASSWORD, NEXT, factor.recovery().get(0)).status()).isEqualTo(503);
            assertThat(hash(owner)).isEqualTo(originalHash);
            assertThat(jdbc.queryForList("select * from user_sessions where user_id=?", owner.id())).isEqualTo(originalSessions);
            assertThat(jdbc.queryForObject("select count(*) from two_factor_recovery_codes where user_id=?", Integer.class, owner.id())).isEqualTo(10);
            assertThat(request("GET", "/me", owner.access(), null).status()).isEqualTo(200);
        } finally {
            jdbc.execute("drop trigger password_change_reject_revocation on refresh_tokens");
            jdbc.execute("drop function password_change_reject_revocation()");
        }
        assertThat(change(owner, PASSWORD, NEXT, factor.recovery().get(0)).status()).isEqualTo(204);
    }

    @Test void concurrentLoginWaitsForCredentialLockAndCannotIssueSessionWithOldPassword() throws Exception {
        var owner = account();
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            Future<Response> login = new TransactionTemplate(transactions).execute(status -> {
                users.lockById(owner.id()).orElseThrow();
                var pending = executor.submit(() -> login(owner.email(), PASSWORD));
                awaitBlockedLogin();
                passwords.changePassword(owner.id(), owner.session(), PASSWORD, NEXT, null);
                return pending;
            });
            assertThat(login.get(15, TimeUnit.SECONDS).status()).isEqualTo(401);
        }
        assertThat(jdbc.queryForObject("select count(*) from user_sessions where user_id=? and revoked_at is null", Integer.class, owner.id())).isZero();
        assertThat(login(owner.email(), NEXT).status()).isEqualTo(200);
    }

    @Test void simultaneousChangesSerializeAndOnlyOneCanUseCurrentSession() throws Exception {
        var owner = account();
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var start = new CountDownLatch(1);
            Callable<Response> call = () -> { start.await(); return change(owner, PASSWORD, NEXT, null); };
            var first = executor.submit(call);
            var second = executor.submit(call);
            start.countDown();
            assertThat(List.of(first.get(20, TimeUnit.SECONDS).status(), second.get(20, TimeUnit.SECONDS).status()))
                    .containsExactlyInAnyOrder(204, 401);
        }
        assertThat(login(owner.email(), PASSWORD).status()).isEqualTo(401);
        assertThat(login(owner.email(), NEXT).status()).isEqualTo(200);
    }

    private void awaitBlockedLogin() {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
        while (System.nanoTime() < deadline) {
            // PostgreSQL caches activity statistics within this credential-locking transaction.
            jdbc.execute("select pg_stat_clear_snapshot()");
            if (jdbc.queryForObject("select count(*) from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like '%users%'", Integer.class) > 0) return;
            try { Thread.sleep(20); } catch (InterruptedException error) { Thread.currentThread().interrupt(); throw new AssertionError(error); }
        }
        throw new AssertionError("Login did not wait for the credential lock");
    }

    private Factor enableFactor(Account owner) throws Exception {
        var setup = request("POST", "/me/2fa/setup", owner.access(), Map.of("currentPassword", PASSWORD));
        assertThat(setup.status()).as("%s", setup.body()).isEqualTo(200);
        String secret = setup.body().path("secret").asString();
        var enabled = request("POST", "/me/2fa/enable", owner.access(), Map.of("code", totp.code(secret, Instant.now())));
        assertThat(enabled.status()).as("%s", enabled.body()).isEqualTo(200);
        return new Factor(secret, enabled.body().path("recoveryCodes").valueStream().map(JsonNode::asString).toList());
    }
    private Account account() throws Exception {
        String email = UUID.randomUUID() + "@example.test";
        var registered = request("POST", "/auth/register", null, Map.of("name", "Password test", "email", email, "password", PASSWORD));
        assertThat(registered.status()).isEqualTo(201);
        var login = login(email, PASSWORD);
        assertThat(login.status()).isEqualTo(200);
        return new Account(UUID.fromString(registered.body().path("id").asString()), email,
                login.body().path("access_token").asString(), login.body().path("refresh_token").asString(),
                UUID.fromString(login.body().path("session_id").asString()));
    }
    private Response login(String email, String password) throws Exception {
        return request("POST", "/auth/login", null, Map.of("email", email, "password", password));
    }
    private String hash(Account owner) { return jdbc.queryForObject("select password_hash from users where id=?", String.class, owner.id()); }
    private Response change(Account owner, String current, String next, String factor) throws Exception {
        var input = new LinkedHashMap<String, Object>();
        input.put("currentPassword", current); input.put("newPassword", next);
        if (factor != null) input.put("secondFactorCode", factor);
        return request("POST", "/me/password", owner.access(), input);
    }
    private void assertValidation(Response response, String field) {
        assertThat(response.status()).as("%s", response.body()).isEqualTo(422);
        assertThat(response.body().path("code").asString()).isEqualTo("VALIDATION_ERROR");
        assertThat(response.body().path("fieldErrors").has(field)).isTrue();
        assertThat(response.raw()).doesNotContain(PASSWORD, NEXT, "password_hash", "passwordHash");
    }
    private Response request(String method, String path, String token, Object body) throws Exception {
        var builder = HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/v1" + path)).timeout(java.time.Duration.ofSeconds(30));
        if (token != null) builder.header("Authorization", "Bearer " + token);
        if (body != null) builder.header("Content-Type", "application/json");
        var response = client.send(builder.method(method, body == null ? HttpRequest.BodyPublishers.noBody()
                : HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body))).build(), HttpResponse.BodyHandlers.ofString());
        return new Response(response.statusCode(), response.body().isEmpty() ? json.nullNode() : json.readTree(response.body()),
                response.body(), response.headers().firstValue("Cache-Control").orElse(""));
    }
    private record Account(UUID id, String email, String access, String refresh, UUID session) {
        @Override public String toString() { return "Account[redacted]"; }
    }
    private record Factor(String secret, List<String> recovery) {
        @Override public String toString() { return "Factor[redacted]"; }
    }
    private record Response(int status, JsonNode body, String raw, String cache) {}
}
