package com.fuellog;

import static org.assertj.core.api.Assertions.*;

import com.fuellog.identity.repositories.UserAccountRepository;
import com.fuellog.identity.services.PasswordChangeService;

import java.net.URI;
import java.net.http.*;
import java.sql.Timestamp;
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

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
class BiometricSessionIT {
    private static final PostgreSQLContainer database = new PostgreSQLContainer("postgres:18-alpine");
    private static final String PASSWORD = "Biometric test password 42!";
    @DynamicPropertySource static void database(DynamicPropertyRegistry properties) {
        database.start();
        properties.add("spring.datasource.url", database::getJdbcUrl);
        properties.add("spring.datasource.username", database::getUsername);
        properties.add("spring.datasource.password", database::getPassword);
    }
    @AfterAll static void stopDatabase() { database.stop(); }
    @LocalServerPort int port;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    @Autowired UserAccountRepository users;
    @Autowired PasswordChangeService passwords;
    @Autowired PlatformTransactionManager transactions;
    private final HttpClient http = HttpClient.newHttpClient();

    @Test void enrollmentCreatesSeparateHashedCredentialWithoutAccessToken() throws Exception {
        var owner = account();
        var enrolled = enroll(owner);
        assertThat(enrolled.body().propertyNames()).containsExactlyInAnyOrder("refresh_token", "refresh_expires_at", "session_id");
        String credential = enrolled.body().path("refresh_token").asString();
        UUID biometric = id(enrolled.body());
        assertThat(credential).matches("[A-Za-z0-9_-]{43}").isNotEqualTo(owner.refresh());
        assertThat(biometric).isNotEqualTo(owner.session());
        assertThat(jdbc.queryForObject("select device_label from user_sessions where id=?", String.class, biometric))
                .isEqualTo("BIOMETRIC_LOGIN");
        assertThat(jdbc.queryForObject("select token_hash from refresh_tokens where session_id=?", String.class, biometric))
                .matches("[0-9a-f]{64}").isNotEqualTo(credential);
        var created = jdbc.queryForObject("select created_at from user_sessions where id=?", Timestamp.class, biometric).toInstant();
        assertThat(Instant.parse(enrolled.body().path("refresh_expires_at").asString()))
                .isEqualTo(created.atZone(ZoneOffset.UTC).plusMonths(6).toInstant());
        assertThat(request("GET", "/me", owner.access(), null).status()).isEqualTo(200);
    }

    @Test void logoutRevokesActiveSessionWhileBiometricLoginCreatesFreshRefreshableSession() throws Exception {
        var owner = account();
        var biometric = enroll(owner).body();
        assertThat(request("POST", "/auth/logout", owner.access(), null).status()).isEqualTo(204);
        assertThat(request("GET", "/me", owner.access(), null).status()).isEqualTo(401);
        assertThat(refresh(owner.refresh()).status()).isEqualTo(401);
        var login = biometricLogin(secret(biometric));
        assertThat(login.status()).as("%s", login.body()).isEqualTo(200);
        assertThat(login.cache()).contains("no-store");
        var active = login.body().path("session");
        var rotated = login.body().path("biometric");
        assertThat(id(active)).isNotEqualTo(owner.session()).isNotEqualTo(id(biometric));
        assertThat(id(rotated)).isEqualTo(id(biometric));
        assertThat(secret(rotated)).isNotEqualTo(secret(biometric));
        assertThat(rotated.path("refresh_expires_at")).isEqualTo(biometric.path("refresh_expires_at"));
        assertThat(request("GET", "/me", active.path("access_token").asString(), null).status()).isEqualTo(200);
        assertThat(refresh(secret(active)).status()).isEqualTo(200);
    }

    @Test void credentialPurposesCannotBeCrossUsedEvenAfterRotation() throws Exception {
        var owner = account();
        var biometric = enroll(owner).body();
        assertThat(refresh(secret(biometric)).status()).isEqualTo(401);
        assertThat(biometricLogin(owner.refresh()).status()).isEqualTo(401);
        var active = refresh(owner.refresh());
        assertThat(active.status()).isEqualTo(200);
        assertThat(biometricLogin(owner.refresh()).status()).isEqualTo(401);
        assertThat(refresh(secret(active.body())).status()).isEqualTo(200);
        var login = biometricLogin(secret(biometric));
        assertThat(login.status()).isEqualTo(200);
        assertThat(refresh(secret(biometric)).status()).isEqualTo(401);
        assertThat(biometricLogin(secret(login.body().path("biometric"))).status()).isEqualTo(200);
    }

    @Test void replayCommitsBiometricAndEveryDerivedActiveSessionRevocation() throws Exception {
        var owner = account();
        var biometric = enroll(owner).body();
        var login = biometricLogin(secret(biometric));
        assertThat(login.status()).isEqualTo(200);
        var nextLogin = biometricLogin(secret(login.body().path("biometric")));
        assertThat(nextLogin.status()).isEqualTo(200);
        var replay = biometricLogin(secret(biometric));
        assertThat(replay.status()).isEqualTo(401);
        assertThat(replay.body().path("code").asString()).isEqualTo("REFRESH_TOKEN_REUSED");
        assertThat(jdbc.queryForObject("select revocation_reason from user_sessions where id=?", String.class, id(biometric)))
                .isEqualTo("TOKEN_REUSE");
        assertThat(jdbc.queryForObject("select count(*) from refresh_tokens where session_id=? and revoked_at is null", Integer.class, id(biometric))).isZero();
        assertThat(biometricLogin(secret(nextLogin.body().path("biometric"))).status()).isEqualTo(401);
        for (var active : List.of(login.body().path("session"), nextLogin.body().path("session"))) {
            assertThat(request("GET", "/me", active.path("access_token").asString(), null).status()).isEqualTo(401);
            assertThat(refresh(secret(active)).status()).isEqualTo(401);
        }
        assertThat(refresh(owner.refresh()).status()).isEqualTo(200);
    }

    @Test void deletionChecksOwnershipAndPurposeAndRevokesOnlyRememberedCredential() throws Exception {
        var owner = account();
        var stranger = account();
        var biometric = enroll(owner).body();
        var login = biometricLogin(secret(biometric));
        assertThat(login.status()).isEqualTo(200);
        String path = "/me/biometric-session/" + id(biometric);
        assertThat(request("DELETE", path, stranger.access(), null).status()).isEqualTo(404);
        assertThat(request("DELETE", "/me/biometric-session/" + owner.session(), owner.access(), null).status()).isEqualTo(404);
        assertThat(request("DELETE", path, null, null).status()).isEqualTo(401);
        var removed = request("DELETE", path, owner.access(), null);
        assertThat(removed.status()).isEqualTo(204);
        assertThat(removed.cache()).contains("no-store");
        assertThat(request("DELETE", path, owner.access(), null).status()).isEqualTo(204);
        assertThat(biometricLogin(secret(login.body().path("biometric"))).status()).isEqualTo(401);
        assertThat(request("GET", "/me", login.body().path("session").path("access_token").asString(), null).status()).isEqualTo(200);
        assertThat(refresh(secret(login.body().path("session"))).status()).isEqualTo(200);
        assertThat(refresh(owner.refresh()).status()).isEqualTo(200);
        assertThat(refresh(stranger.refresh()).status()).isEqualTo(200);
    }

    @Test void disabledAccountsAndPasswordChangesBlockRememberedCredentials() throws Exception {
        var disabled = account();
        var disabledBiometric = enroll(disabled).body();
        jdbc.update("update users set disabled_at=now() where id=?", disabled.user());
        assertThat(biometricLogin(secret(disabledBiometric)).status()).isEqualTo(401);
        var owner = account();
        var biometric = enroll(owner).body();
        assertThat(request("POST", "/me/password", owner.access(),
                Map.of("currentPassword", PASSWORD, "newPassword", "Next password 43!")).status()).isEqualTo(204);
        assertThat(biometricLogin(secret(biometric)).status()).isEqualTo(401);
        assertThat(jdbc.queryForObject("select revocation_reason from user_sessions where id=?", String.class, id(biometric)))
                .isEqualTo("PASSWORD_CHANGED");
        assertThat(jdbc.queryForObject("select count(*) from refresh_tokens where session_id=? and revoked_at is null", Integer.class, id(biometric))).isZero();
    }

    @Test void bothAbsoluteSessionAndTokenDeadlinesAreEnforced() throws Exception {
        for (String table : List.of("user_sessions", "refresh_tokens")) {
            var biometric = enroll(account()).body();
            String column = table.equals("user_sessions") ? "created_at" : "issued_at";
            String selector = table.equals("user_sessions") ? "id" : "session_id";
            jdbc.update("update " + table + " set " + column + "=now()-interval '2 days',expires_at=now()-interval '1 day' where " + selector + "=?", id(biometric));
            var expired = biometricLogin(secret(biometric));
            assertThat(expired.status()).isEqualTo(401);
            assertThat(expired.body().path("code").asString()).isEqualTo("REFRESH_TOKEN_EXPIRED");
        }
    }

    @Test void loginFailureRollsBackRotationAndNewActiveSession() throws Exception {
        var owner = account();
        var biometric = enroll(owner).body();
        var originalToken = jdbc.queryForList("select * from refresh_tokens where session_id=?", id(biometric));
        int count = jdbc.queryForObject("select count(*) from user_sessions where user_id=?", Integer.class, owner.user());
        jdbc.execute("create function biometric_reject_active() returns trigger language plpgsql as $$ begin if new.user_id='" + owner.user() + "'::uuid and new.device_label is null then raise exception 'Planned active session failure'; end if; return new; end $$");
        jdbc.execute("create trigger biometric_reject_active before insert on user_sessions for each row execute function biometric_reject_active()");
        try {
            assertThat(biometricLogin(secret(biometric)).status()).isEqualTo(503);
            assertThat(jdbc.queryForList("select * from refresh_tokens where session_id=?", id(biometric))).isEqualTo(originalToken);
            assertThat(jdbc.queryForObject("select count(*) from user_sessions where user_id=?", Integer.class, owner.user())).isEqualTo(count);
        } finally {
            jdbc.execute("drop trigger biometric_reject_active on user_sessions");
            jdbc.execute("drop function biometric_reject_active()");
        }
        assertThat(biometricLogin(secret(biometric)).status()).isEqualTo(200);
    }

    @Test void simultaneousLoginKeepsUseOnceAndCommitsReplayRevocation() throws Exception {
        var biometric = enroll(account()).body();
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var start = new CountDownLatch(1);
            Callable<Response> call = () -> { start.await(); return biometricLogin(secret(biometric)); };
            var first = executor.submit(call);
            var second = executor.submit(call);
            start.countDown();
            var results = List.of(first.get(20, TimeUnit.SECONDS), second.get(20, TimeUnit.SECONDS));
            assertThat(results.stream().map(Response::status).toList()).containsExactlyInAnyOrder(200, 401);
            var login = results.stream().filter(result -> result.status() == 200).findFirst().orElseThrow();
            assertThat(biometricLogin(secret(login.body().path("biometric"))).status()).isEqualTo(401);
            assertThat(refresh(secret(login.body().path("session"))).status()).isEqualTo(401);
        }
    }

    @Test void replayRevocationFailureRollsBackEverySessionAndRefreshFamily() throws Exception {
        var owner = account();
        var biometric = enroll(owner).body();
        var login = biometricLogin(secret(biometric));
        assertThat(login.status()).isEqualTo(200);
        var originalSessions = jdbc.queryForList("select * from user_sessions where user_id=? order by id", owner.user());
        var originalTokens = jdbc.queryForList("select t.* from refresh_tokens t join user_sessions s on s.id=t.session_id where s.user_id=? order by t.id", owner.user());
        jdbc.execute("create function biometric_reject_replay_revocation() returns trigger language plpgsql as $$ begin if new.session_id='" + id(login.body().path("session")) + "'::uuid then raise exception 'Planned replay revocation failure'; end if; return new; end $$");
        jdbc.execute("create trigger biometric_reject_replay_revocation before update of revoked_at on refresh_tokens for each row execute function biometric_reject_replay_revocation()");
        try {
            assertThat(biometricLogin(secret(biometric)).status()).isEqualTo(503);
            assertThat(jdbc.queryForList("select * from user_sessions where user_id=? order by id", owner.user())).isEqualTo(originalSessions);
            assertThat(jdbc.queryForList("select t.* from refresh_tokens t join user_sessions s on s.id=t.session_id where s.user_id=? order by t.id", owner.user())).isEqualTo(originalTokens);
        } finally {
            jdbc.execute("drop trigger biometric_reject_replay_revocation on refresh_tokens");
            jdbc.execute("drop function biometric_reject_replay_revocation()");
        }
        assertThat(biometricLogin(secret(biometric)).status()).isEqualTo(401);
        assertThat(refresh(secret(login.body().path("session"))).status()).isEqualTo(401);
    }

    @Test void migrationFromV10PreservesLegacySessionsAndAddsRootReference() {
        String schema = "biometric_upgrade_" + UUID.randomUUID().toString().replace("-", "");
        try {
            var source = jdbc.getDataSource();
            org.flywaydb.core.Flyway.configure().dataSource(source).schemas(schema).defaultSchema(schema).target("10").load().migrate();
            UUID user = UUID.randomUUID(), session = UUID.randomUUID();
            jdbc.update("insert into " + schema + ".users(id,name,email,password_hash) values (?,'Legacy',?,'legacy-hash')", user, user + "@example.test");
            jdbc.update("insert into " + schema + ".user_sessions(id,user_id,expires_at) values (?,?,now()+interval '1 day')", session, user);
            var previous = jdbc.queryForList("select id,user_id,expires_at,revoked_at,created_at,last_used_at,version from " + schema + ".user_sessions");
            var migration = org.flywaydb.core.Flyway.configure().dataSource(source).schemas(schema).defaultSchema(schema).target("11").load();
            assertThat(migration.migrate().migrationsExecuted).isEqualTo(1);
            assertThat(migration.migrate().migrationsExecuted).isZero();
            assertThat(jdbc.queryForList("select id,user_id,expires_at,revoked_at,created_at,last_used_at,version from " + schema + ".user_sessions")).isEqualTo(previous);
            assertThat(jdbc.queryForObject("select biometric_parent_session_id from " + schema + ".user_sessions where id=?", UUID.class, session)).isNull();
            assertThatThrownBy(() -> jdbc.update("update " + schema + ".user_sessions set biometric_parent_session_id=? where id=?", UUID.randomUUID(), session))
                    .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
            assertThat(jdbc.queryForObject("select count(*) from pg_indexes where schemaname=? and indexname='ix_sessions_biometric_parent'", Integer.class, schema)).isEqualTo(1);
        } finally { jdbc.execute("drop schema if exists " + schema + " cascade"); }
    }

    @Test void enrollmentRequiresActiveSessionAndPublicLoginValidatesWithoutLeakingSecrets() throws Exception {
        var owner = account();
        assertThat(request("POST", "/me/biometric-session", null, null).status()).isEqualTo(401);
        for (Object invalid : List.of(Map.of(), Map.of("refresh_token", "bad-secret"), Map.of("refresh_token", 123))) {
            var rejected = request("POST", "/auth/biometric-login", "invalid-expired-access", invalid);
            assertThat(rejected.status()).isIn(400, 422);
            assertThat(rejected.cache()).contains("no-store");
            assertThat(rejected.raw()).doesNotContain("bad-secret");
        }
        assertThat(request("POST", "/auth/logout", owner.access(), null).status()).isEqualTo(204);
        assertThat(request("POST", "/me/biometric-session", owner.access(), null).status()).isEqualTo(401);
    }

    @Test void enrollmentRequiresCurrentRefreshProofWithoutConsumingOrRevokingActiveSession() throws Exception {
        var owner = account();
        assertThat(request("POST", "/me/biometric-session", owner.access(), null).status()).isEqualTo(400);
        assertThat(request("POST", "/me/biometric-session", owner.access(), Map.of()).status()).isEqualTo(422);
        var stranger = account();
        assertThat(request("POST", "/me/biometric-session", owner.access(), Map.of("refresh_token", stranger.refresh())).status()).isEqualTo(401);
        var rotated = refresh(owner.refresh());
        assertThat(rotated.status()).isEqualTo(200);
        var conflict = request("POST", "/me/biometric-session", owner.access(), Map.of("refresh_token", owner.refresh()));
        assertThat(conflict.status()).isEqualTo(409);
        assertThat(conflict.body().path("code").asString()).isEqualTo("BIOMETRIC_SESSION_REFRESH_CONFLICT");
        assertThat(conflict.cache()).contains("no-store");
        var enrolled = request("POST", "/me/biometric-session", owner.access(), Map.of("refresh_token", secret(rotated.body())));
        assertThat(enrolled.status()).isEqualTo(201);
        assertThat(request("GET", "/me", owner.access(), null).status()).isEqualTo(200);
        assertThat(refresh(secret(rotated.body())).status()).isEqualTo(200);
        assertThat(refresh(stranger.refresh()).status()).isEqualTo(200);
    }

    @Test void reenrollmentFromDerivedSessionCannotEscapeReplayOfAnyBiometricCredentialInRootFamily() throws Exception {
        for (boolean replayRoot : List.of(true, false)) {
            var owner = account();
            var root = enroll(owner).body();
            var independent = enroll(owner).body();
            var firstLogin = biometricLogin(secret(root));
            assertThat(firstLogin.status()).isEqualTo(200);
            var firstActive = firstLogin.body().path("session");
            var derivedOwner = new Account(owner.user(), firstActive.path("access_token").asString(), secret(firstActive), id(firstActive));
            var derived = enroll(derivedOwner).body();
            var secondLogin = biometricLogin(secret(derived));
            assertThat(secondLogin.status()).isEqualTo(200);
            assertThat(biometricLogin(secret(replayRoot ? root : derived)).status()).isEqualTo(401);
            assertThat(biometricLogin(secret(firstLogin.body().path("biometric"))).status()).isEqualTo(401);
            assertThat(biometricLogin(secret(secondLogin.body().path("biometric"))).status()).isEqualTo(401);
            for (var active : List.of(firstActive, secondLogin.body().path("session"))) {
                assertThat(request("GET", "/me", active.path("access_token").asString(), null).status()).isEqualTo(401);
                assertThat(refresh(secret(active)).status()).isEqualTo(401);
            }
            assertThat(refresh(owner.refresh()).status()).isEqualTo(200);
            assertThat(biometricLogin(secret(independent)).status()).isEqualTo(200);
        }
    }

    @Test void passwordChangeSerializesWithEnrollmentAndBiometricLoginBeforeIssuingNewSessions() throws Exception {
        for (boolean enrollment : List.of(true, false)) {
            var owner = account();
            var biometric = enrollment ? null : enroll(owner).body();
            try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
                Future<Response> pending = new TransactionTemplate(transactions).execute(status -> {
                    users.lockById(owner.user()).orElseThrow();
                    var request = executor.submit(() -> enrollment
                            ? request("POST", "/me/biometric-session", owner.access(), Map.of("refresh_token", owner.refresh()))
                            : biometricLogin(secret(biometric)));
                    awaitCredentialLock();
                    passwords.changePassword(owner.user(), owner.session(), PASSWORD, "Next password 43!", null);
                    return request;
                });
                assertThat(pending.get(15, TimeUnit.SECONDS).status()).isEqualTo(401);
            }
            assertThat(jdbc.queryForObject("select count(*) from user_sessions where user_id=? and revoked_at is null", Integer.class, owner.user())).isZero();
        }
    }

    private void awaitCredentialLock() {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
        while (System.nanoTime() < deadline) {
            jdbc.execute("select pg_stat_clear_snapshot()");
            if (jdbc.queryForObject("select count(*) from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like '%users%'", Integer.class) > 0) return;
            try { Thread.sleep(20); } catch (InterruptedException error) { Thread.currentThread().interrupt(); throw new AssertionError(error); }
        }
        throw new AssertionError("Biometric request did not wait for the credential lock");
    }

    private Account account() throws Exception {
        String email = UUID.randomUUID() + "@example.test";
        var registration = request("POST", "/auth/register", null, Map.of("name", "Biometric test", "email", email, "password", PASSWORD));
        assertThat(registration.status()).isEqualTo(201);
        var login = request("POST", "/auth/login", null, Map.of("email", email, "password", PASSWORD));
        assertThat(login.status()).isEqualTo(200);
        return new Account(UUID.fromString(registration.body().path("id").asString()), login.body().path("access_token").asString(), secret(login.body()), id(login.body()));
    }
    private Response enroll(Account owner) throws Exception {
        var response = request("POST", "/me/biometric-session", owner.access(), Map.of("refresh_token", owner.refresh()));
        assertThat(response.status()).as("%s", response.body()).isEqualTo(201);
        assertThat(response.cache()).contains("no-store");
        return response;
    }
    private Response biometricLogin(String token) throws Exception {
        return request("POST", "/auth/biometric-login", "invalid-expired-access", Map.of("refresh_token", token));
    }
    private Response refresh(String token) throws Exception { return request("POST", "/auth/refresh", null, Map.of("refresh_token", token)); }
    private UUID id(JsonNode body) { return UUID.fromString(body.path("session_id").asString()); }
    private String secret(JsonNode body) { return body.path("refresh_token").asString(); }
    private Response request(String method, String path, String access, Object body) throws Exception {
        var builder = HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/v1" + path)).timeout(Duration.ofSeconds(30));
        if (access != null) builder.header("Authorization", "Bearer " + access);
        if (body != null) builder.header("Content-Type", "application/json");
        var response = http.send(builder.method(method, body == null ? HttpRequest.BodyPublishers.noBody()
                : HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body))).build(), HttpResponse.BodyHandlers.ofString());
        return new Response(response.statusCode(), response.body().isEmpty() ? json.nullNode() : json.readTree(response.body()),
                response.body(), response.headers().firstValue("Cache-Control").orElse(""));
    }
    private record Account(UUID user, String access, String refresh, UUID session) {
        @Override public String toString() { return "Account[redacted]"; }
    }
    private record Response(int status, JsonNode body, String raw, String cache) {}
}
