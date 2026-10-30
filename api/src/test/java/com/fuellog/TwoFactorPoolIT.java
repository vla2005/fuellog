package com.fuellog;

import static org.assertj.core.api.Assertions.*;
import com.fuellog.identity.dtos.IdentityDtos;
import com.fuellog.identity.dtos.TwoFactorDtos;
import com.fuellog.identity.security.*;
import com.fuellog.identity.services.*;
import com.fuellog.platform.exceptions.ApiException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.*;
import org.testcontainers.postgresql.PostgreSQLContainer;

@SpringBootTest(properties = {"spring.datasource.hikari.maximum-pool-size=2", "spring.datasource.hikari.minimum-idle=1",
        "spring.datasource.hikari.connection-timeout=3000"})
@ActiveProfiles("test")
class TwoFactorPoolIT {
    private static final PostgreSQLContainer postgres = new PostgreSQLContainer("postgres:18-alpine");
    @DynamicPropertySource static void database(DynamicPropertyRegistry properties) {
        postgres.start();
        properties.add("spring.datasource.url", postgres::getJdbcUrl);
        properties.add("spring.datasource.username", postgres::getUsername);
        properties.add("spring.datasource.password", postgres::getPassword);
    }
    @AfterAll static void stopDatabase() { postgres.stop(); }
    @Autowired JdbcTemplate jdbc;
    @Autowired PasswordEncoder passwords;
    @Autowired Totp totp;
    @Autowired TotpEncryption encryption;
    @Autowired PasswordChangeService changes;
    @Autowired IdentityService identity;
    @Autowired com.zaxxer.hikari.HikariDataSource dataSource;

    @Test void concurrentRejectionsCommitWithoutBorrowingASecondConnectionOrChangingCredentials() throws Exception {
        // Flyway needs two connections during bootstrap; constrain the actual auth operations to one.
        dataSource.setMaximumPoolSize(1);
        dataSource.getHikariPoolMXBean().softEvictConnections();
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
        while (dataSource.getHikariPoolMXBean().getTotalConnections() != 1 && System.nanoTime() < deadline) Thread.sleep(10);
        assertThat(dataSource.getHikariPoolMXBean().getTotalConnections()).isEqualTo(1);
        String password = "Only-test-password-42!", email = UUID.randomUUID() + "@example.test";
        String hash = passwords.encode(password);
        UUID user = UUID.randomUUID(), session = UUID.randomUUID();
        jdbc.update("insert into users(id,name,email,password_hash) values (?,'Pool test',?,?)", user, email, hash);
        jdbc.update("insert into user_sessions(id,user_id,created_at,expires_at) values (?,?,?,?)", session, user,
                Timestamp.from(Instant.now()), Timestamp.from(Instant.now().plusSeconds(3600)));
        jdbc.update("insert into user_two_factors(user_id,encrypted_secret,enabled,credential_version) values (?,?,true,0)",
                user, encryption.encrypt(user, totp.newSecret()));
        String recovery = new RefreshSecrets().generate();
        jdbc.update("insert into two_factor_recovery_codes(user_id,code_hash) values (?,?)", user, new RefreshSecrets().hash(recovery));
        CountDownLatch ready = new CountDownLatch(2), start = new CountDownLatch(1);
        try (var pool = Executors.newFixedThreadPool(2)) {
            var futures = new ArrayList<Future<Integer>>();
            for (int i = 0; i < 2; i++) futures.add(pool.submit(() -> {
                ready.countDown(); start.await(); return reject(user, session, password);
            }));
            assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue(); start.countDown();
            for (var future : futures) assertThat(future.get(15, TimeUnit.SECONDS)).isEqualTo(422);
        }
        for (int i = 0; i < 3; i++) assertThat(reject(user, session, password)).isEqualTo(422);
        assertThat(reject(user, session, password)).isEqualTo(429);
        assertThat(jdbc.queryForObject("select attempts from two_factor_attempts where scope=?", Integer.class, "user:" + user + ":factor")).isEqualTo(6);
        assertThat(jdbc.queryForObject("select password_hash from users where id=?", String.class, user)).isEqualTo(hash);
        assertThat(jdbc.queryForObject("select revoked_at from user_sessions where id=?", Timestamp.class, session)).isNull();
        assertThat(jdbc.queryForObject("select count(*) from two_factor_recovery_codes where user_id=?", Integer.class, user)).isEqualTo(1);
        var challenge = (TwoFactorDtos.Challenge) identity.login(email, password);
        assertThatThrownBy(() -> identity.verifyTwoFactor(challenge.challengeToken(), recovery))
                .isInstanceOfSatisfying(ApiException.class, error -> assertThat(error.status()).isEqualTo(429));
        assertThat(jdbc.queryForObject("select attempts from two_factor_attempts where scope=?", Integer.class,
                "challenge:" + new RefreshSecrets().hash(challenge.challengeToken()))).isEqualTo(1);
        jdbc.update("update two_factor_attempts set window_ends_at=now()-interval '1 second' where scope=?", "user:" + user + ":factor");
        IdentityDtos.TokenResponse authenticated = identity.verifyTwoFactor(challenge.challengeToken(), recovery);
        assertThat(authenticated.access_token()).isNotBlank();
        assertThat(jdbc.queryForObject("select count(*) from two_factor_recovery_codes where user_id=?", Integer.class, user)).isZero();
    }

    private int reject(UUID user, UUID session, String password) {
        try { changes.changePassword(user, session, password, "New-password-43!", "wrong"); return 204; }
        catch (ApiException error) { return error.status(); }
    }
}
