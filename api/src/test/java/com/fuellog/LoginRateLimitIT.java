package com.fuellog;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import com.fuellog.identity.configurations.LoginRateLimitProperties;
import com.fuellog.identity.repositories.LoginAttemptRepository;
import com.fuellog.identity.services.IdentityService;
import com.fuellog.identity.services.LoginRateLimit;
import com.fuellog.platform.exceptions.ApiException;
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
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.*;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.postgresql.PostgreSQLContainer;
import tools.jackson.databind.ObjectMapper;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "fuellog.security.login-rate-limit.account-attempts=2", "fuellog.security.login-rate-limit.source-attempts=3",
        "fuellog.security.login-rate-limit.max-scopes=30"})
@ActiveProfiles("test")
@Import(LoginRateLimitIT.TestClockConfiguration.class)
class LoginRateLimitIT {
    private static final PostgreSQLContainer postgres = new PostgreSQLContainer("postgres:18-alpine");
    private static final Instant NOW = Instant.parse("2026-11-02T12:00:00Z");
    private static final String PASSWORD = "Only-test-password-42!";
    @DynamicPropertySource static void database(DynamicPropertyRegistry properties) {
        postgres.start();
        properties.add("spring.datasource.url", postgres::getJdbcUrl);
        properties.add("spring.datasource.username", postgres::getUsername);
        properties.add("spring.datasource.password", postgres::getPassword);
    }
    @AfterAll static void stopDatabase() { postgres.stop(); }
    @LocalServerPort int port;
    @Autowired JdbcTemplate jdbc;
    @Autowired IdentityService identity;
    @Autowired LoginRateLimit limiter;
    @Autowired LoginRateLimitProperties limits;
    @Autowired PlatformTransactionManager transactions;
    @Autowired TestClock clock;
    @Autowired ObjectMapper json;
    @MockitoSpyBean PasswordEncoder passwords;
    private final HttpClient http = HttpClient.newHttpClient();

    @BeforeEach void resetBudgets() {
        jdbc.update("delete from login_attempts");
        clock.current.set(NOW);
        clearInvocations(passwords);
    }

    @Test void exhaustedPasswordAttemptsStopBeforeTheEncoderForExistingMissingAndDisabledAccounts() {
        int sessionsBefore = jdbc.queryForObject("select count(*) from user_sessions", Integer.class);
        for (String state : List.of("active", "missing", "disabled")) {
            jdbc.update("delete from login_attempts");
            String email = state + "-" + UUID.randomUUID() + "@example.test";
            if (!"missing".equals(state)) {
                var user = identity.register("Login quota", email, PASSWORD);
                if ("disabled".equals(state)) jdbc.update("update users set disabled_at=? where id=?", Timestamp.from(NOW), user.id());
            }
            clearInvocations(passwords);
            assertLoginFailure(email.toUpperCase(Locale.ROOT), "wrong", "peer-1", 401);
            assertLoginFailure(" " + email + " ", "wrong", "peer-2", 401);
            assertLoginFailure(email, PASSWORD, "peer-3", 429);
            verify(passwords, times(2)).matches(eq("wrong"), anyString());
            verify(passwords, never()).matches(eq(PASSWORD), anyString());
            assertThat(jdbc.queryForObject("select attempts from login_attempts where scope like 'a:%'", Integer.class)).isEqualTo(3);
        }
        assertThat(jdbc.queryForObject("select count(*) from user_sessions", Integer.class)).isEqualTo(sessionsBefore);
    }

    @Test void sourceQuotaStopsChangingAccountsWithoutCreatingMoreAccountBuckets() {
        for (int attempt = 0; attempt < 3; attempt++) assertLoginFailure(attempt + "@example.test", "wrong", "same-peer", 401);
        assertLoginFailure("fourth@example.test", "wrong", "same-peer", 429);
        verify(passwords, times(3)).matches(eq("wrong"), anyString());
        assertThat(jdbc.queryForObject("select count(*) from login_attempts", Integer.class)).isEqualTo(4);
        assertThat(jdbc.queryForObject("select attempts from login_attempts where scope like 's:%'", Integer.class)).isEqualTo(4);
    }

    @Test void forwardedHeadersCannotChooseAnotherSourceAndRejectionsAreNotCached() throws Exception {
        for (int attempt = 0; attempt < 3; attempt++) assertThat(loginHttp(attempt + "@example.test", "192.0.2." + attempt).statusCode()).isEqualTo(401);
        var rejected = loginHttp("fourth@example.test", "198.51.100.12");
        assertThat(rejected.statusCode()).isEqualTo(429);
        assertThat(rejected.headers().firstValue("Cache-Control")).contains("no-store");
        assertThat(json.readTree(rejected.body()).path("code").asString()).isEqualTo("LOGIN_RATE_LIMITED");
        assertThat(jdbc.queryForObject("select count(*) from login_attempts where scope like 's:%'", Integer.class)).isEqualTo(1);
    }

    @Test void databaseFailuresFailClosedBeforePasswordVerificationAndKeepNoStore() throws Exception {
        jdbc.execute("alter table login_attempts rename to unavailable_login_attempts");
        try {
            var response = loginHttp("missing@example.test", "192.0.2.1");
            assertThat(response.statusCode()).isEqualTo(503);
            assertThat(response.headers().firstValue("Cache-Control")).contains("no-store");
            assertThat(json.readTree(response.body()).path("code").asString()).isEqualTo("AUTH_DEPENDENCY_UNAVAILABLE");
            verify(passwords, never()).matches(anyString(), anyString());
        } finally { jdbc.execute("alter table unavailable_login_attempts rename to login_attempts"); }
    }

    @Test void multipleLimiterInstancesAtomicallyEnforceAccountAndSourceBudgets() throws Exception {
        assertConcurrentBudget(true, 2);
        jdbc.update("delete from login_attempts");
        assertConcurrentBudget(false, 3);
    }

    private void assertConcurrentBudget(boolean sameAccount, int expectedAccepted) throws Exception {
        var first = newLimiter(limits);
        var second = newLimiter(limits);
        CountDownLatch start = new CountDownLatch(1);
        try (var pool = Executors.newFixedThreadPool(8)) {
            var futures = new ArrayList<Future<Boolean>>();
            for (int index = 0; index < 16; index++) {
                final int attempt = index;
                futures.add(pool.submit(() -> {
                    start.await();
                    try {
                        (attempt % 2 == 0 ? first : second).attempt(sameAccount ? "same@example.test" : attempt + "@example.test",
                                sameAccount ? "peer-" + attempt : "same-peer");
                        return true;
                    } catch (ApiException error) { assertThat(error.status()).isEqualTo(429); return false; }
                }));
            }
            start.countDown();
            int accepted = 0;
            for (var result : futures) if (result.get(20, TimeUnit.SECONDS)) accepted++;
            assertThat(accepted).isEqualTo(expectedAccepted);
        }
        String scope = sameAccount ? "a:%" : "s:%";
        assertThat(jdbc.queryForObject("select attempts from login_attempts where scope like ?", Integer.class, scope)).isEqualTo(expectedAccepted + 1);
    }

    @Test void reservationsSurviveOuterRollbackAndUnexpectedPasswordTransactionFailures() {
        new TransactionTemplate(transactions).executeWithoutResult(status -> {
            limiter.attempt("outer@example.test", "outer-peer");
            status.setRollbackOnly();
        });
        assertThat(jdbc.queryForObject("select count(*) from login_attempts", Integer.class)).isEqualTo(2);
        newLimiter(limits).attempt("outer@example.test", "other-peer");
        assertThatThrownBy(() -> limiter.attempt("outer@example.test", "third-peer"))
                .isInstanceOfSatisfying(ApiException.class, error -> assertThat(error.status()).isEqualTo(429));
        doThrow(new IllegalStateException("Synthetic password failure")).when(passwords).matches(eq("unexpected"), anyString());
        assertThatThrownBy(() -> identity.login("unexpected@example.test", "unexpected", "unexpected-peer")).isInstanceOf(IllegalStateException.class);
        assertLoginFailure("unexpected@example.test", "wrong", "unexpected-peer", 401);
        assertLoginFailure("unexpected@example.test", "wrong", "unexpected-peer", 429);
    }

    @Test void rejectedAttemptsDoNotExtendTheWindowAndLegitimateLoginResumesAtExpiry() {
        String email = UUID.randomUUID() + "@example.test";
        identity.register("Expiry", email, PASSWORD);
        assertLoginFailure(email, "wrong", "expiry-peer", 401);
        assertLoginFailure(email, "wrong", "expiry-peer", 401);
        clock.current.set(NOW.plusSeconds(299));
        for (int i = 0; i < 3; i++) assertLoginFailure(email, PASSWORD, "expiry-peer", 429);
        clock.current.set(NOW.plusSeconds(300));
        assertThat(identity.login(email, PASSWORD, "expiry-peer")).isInstanceOf(com.fuellog.identity.dtos.IdentityDtos.TokenResponse.class);
        assertThat(jdbc.queryForObject("select count(*) from login_attempts where attempts=1", Integer.class)).isEqualTo(2);
    }

    @Test void capacityIsBoundedWithoutEvictingActiveBucketsAndExpiryReopensSpace() throws Exception {
        var bounded = newLimiter(new LoginRateLimitProperties(2,3,300,3));
        bounded.attempt("first@example.test", "first-peer");
        assertThatThrownBy(() -> bounded.attempt("second@example.test", "second-peer")).isInstanceOf(ApiException.class);
        assertThat(jdbc.queryForObject("select count(*) from login_attempts", Integer.class)).isEqualTo(3);
        bounded.attempt("first@example.test", "first-peer");
        assertThatThrownBy(() -> bounded.attempt("first@example.test", "first-peer")).isInstanceOf(ApiException.class);
        assertThat(jdbc.queryForObject("select max(attempts) from login_attempts where scope like 'a:%'", Integer.class)).isEqualTo(3);
        clock.current.set(NOW.plusSeconds(300));
        bounded.attempt("second@example.test", "second-peer");
        assertThat(jdbc.queryForObject("select count(*) from login_attempts", Integer.class)).isEqualTo(2);
    }

    @Test void concurrentNewScopesCannotExceedStorageCapacity() throws Exception {
        var bounded = newLimiter(new LoginRateLimitProperties(2,3,300,5));
        assertConcurrentCapacity(bounded);
    }

    @Test void poolSnapshotIsolationCannotBypassStorageCapacity() throws Exception {
        try (var snapshotPool = new com.zaxxer.hikari.HikariDataSource()) {
            snapshotPool.setJdbcUrl(postgres.getJdbcUrl());
            snapshotPool.setUsername(postgres.getUsername());
            snapshotPool.setPassword(postgres.getPassword());
            snapshotPool.setMaximumPoolSize(8);
            snapshotPool.setTransactionIsolation("TRANSACTION_REPEATABLE_READ");
            var snapshotJdbc = new JdbcTemplate(snapshotPool);
            var snapshotTransactions = new org.springframework.jdbc.datasource.DataSourceTransactionManager(snapshotPool);
            var bounded = new LoginRateLimit(new LoginAttemptRepository(snapshotJdbc,
                    new LoginRateLimitProperties(2,3,300,5)), clock, snapshotTransactions);
            assertConcurrentCapacity(bounded);
        }
    }

    private void assertConcurrentCapacity(LoginRateLimit bounded) throws Exception {
        CountDownLatch start = new CountDownLatch(1);
        try (var pool = Executors.newFixedThreadPool(8)) {
            var futures = new ArrayList<Future<Boolean>>();
            for (int index = 0; index < 16; index++) {
                final int attempt = index;
                futures.add(pool.submit(() -> {
                    start.await();
                    try { bounded.attempt(attempt + "@example.test", "peer-" + attempt); return true; }
                    catch (ApiException error) { assertThat(error.status()).isEqualTo(429); return false; }
                }));
            }
            start.countDown();
            int accepted = 0;
            for (var result : futures) if (result.get(20, TimeUnit.SECONDS)) accepted++;
            assertThat(accepted).isEqualTo(2);
        }
        assertThat(jdbc.queryForObject("select count(*) from login_attempts", Integer.class)).isEqualTo(5);
    }

    @Test void cleanupDeletesAtMostOneHundredExpiredScopesPerReservation() {
        for (int index = 0; index < 201; index++) jdbc.update("insert into login_attempts(scope,attempts,window_ends_at) values (?,1,?)",
                "a:" + String.format("%064x", index), Timestamp.from(NOW.minusSeconds(1)));
        newLimiter(new LoginRateLimitProperties(2,3,300,500)).attempt("cleanup@example.test", "cleanup-peer");
        assertThat(jdbc.queryForObject("select count(*) from login_attempts where window_ends_at<=?", Integer.class, Timestamp.from(NOW))).isEqualTo(101);
        assertThat(jdbc.queryForObject("select count(*) from login_attempts", Integer.class)).isEqualTo(103);
    }

    @Test void migrationAddsOnlyIndependentLoginStateAndIsRepeatable() {
        String schema = "login_migration_" + UUID.randomUUID().toString().replace("-", "");
        try {
            var source = jdbc.getDataSource();
            org.flywaydb.core.Flyway.configure().dataSource(source).schemas(schema).defaultSchema(schema).target("9").load().migrate();
            UUID user = UUID.randomUUID();
            jdbc.update("insert into " + schema + ".users(id,name,email,password_hash) values (?,'Existing','existing@example.test','hash')", user);
            var migration = org.flywaydb.core.Flyway.configure().dataSource(source).schemas(schema).defaultSchema(schema).target("10").load();
            assertThat(migration.migrate().migrationsExecuted).isEqualTo(1);
            assertThat(migration.migrate().migrationsExecuted).isZero();
            assertThat(jdbc.queryForObject("select id from " + schema + ".users", UUID.class)).isEqualTo(user);
            assertThat(jdbc.queryForObject("select count(*) from " + schema + ".login_attempts", Integer.class)).isZero();
            assertThat(jdbc.queryForObject("select count(*) from pg_indexes where schemaname=? and indexname='ix_login_attempts_expiry'", Integer.class, schema)).isEqualTo(1);
        } finally { jdbc.execute("drop schema if exists " + schema + " cascade"); }
    }

    private LoginRateLimit newLimiter(LoginRateLimitProperties policy) {
        return new LoginRateLimit(new LoginAttemptRepository(jdbc, policy), clock, transactions);
    }
    private void assertLoginFailure(String email, String password, String source, int expectedStatus) {
        assertThatThrownBy(() -> identity.login(email, password, source)).isInstanceOfSatisfying(ApiException.class,
                error -> assertThat(error.status()).isEqualTo(expectedStatus));
    }
    private HttpResponse<String> loginHttp(String email, String forwarded) throws Exception {
        return http.send(HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + "/api/v1/auth/login"))
                .header("Content-Type", "application/json").header("X-Forwarded-For", forwarded)
                .header("Forwarded", "for=" + forwarded).POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(Map.of("email", email, "password", "wrong"))))
                .build(), HttpResponse.BodyHandlers.ofString());
    }
    @TestConfiguration static class TestClockConfiguration {
        @Bean @Primary TestClock loginTestClock() { return new TestClock(); }
    }
    static class TestClock extends Clock {
        final AtomicReference<Instant> current = new AtomicReference<>(NOW);
        @Override public ZoneId getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(ZoneId zone) { return this; }
        @Override public Instant instant() { return current.get(); }
    }
}
