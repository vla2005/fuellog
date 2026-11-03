package com.fuellog;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.net.URI;
import java.net.http.*;
import java.sql.Timestamp;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;
import jakarta.mail.*;
import jakarta.mail.internet.MimeMessage;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.*;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mail.*;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.*;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import tools.jackson.databind.*;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "spring.mail.host=localhost", "fuellog.registration.mail-from=FuelLog <test@example.test>"})
@ActiveProfiles("test")
@Import(RegistrationIT.ClockConfiguration.class)
class RegistrationIT {
    static final Instant NOW = Instant.parse("2026-11-02T12:00:00Z");
    static final String PASSWORD = "Only-test-password-42!";
    @LocalServerPort int port;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper json;
    @Autowired PasswordEncoder passwords;
    @Autowired TestClock clock;
    @MockitoBean JavaMailSender mail;
    final HttpClient http = HttpClient.newHttpClient();
    final List<MimeMessage> delivered = new CopyOnWriteArrayList<>();

    @BeforeEach void resetState() {
        jdbc.update("delete from registration_codes");
        jdbc.update("delete from registration_attempts");
        delivered.clear(); clock.current.set(NOW); reset(mail);
        when(mail.createMimeMessage()).thenAnswer(call -> new MimeMessage(Session.getInstance(new Properties())));
        doAnswer(call -> { var message = (MimeMessage) call.getArgument(0); message.saveChanges(); delivered.add(message); return null; })
                .when(mail).send(any(MimeMessage.class));
    }

    @Test void requestSendsOnlyHashedExpiringCodeThenVerifiedRegistrationConsumesIt() throws Exception {
        String email = email();
        int sessions = jdbc.queryForObject("select count(*) from user_sessions", Integer.class);
        var challenge = issue(email.toUpperCase(Locale.ROOT));
        assertThat(challenge.statusCode()).as(challenge.body()).isEqualTo(202);
        assertThat(challenge.headers().firstValue("Cache-Control")).contains("no-store");
        var body = json.readTree(challenge.body());
        assertThat(body.propertyNames()).containsExactlyInAnyOrder("verificationId", "expiresAt", "resendAfterSeconds");
        assertThat(body.path("expiresAt").asString()).isEqualTo("2026-11-02T12:10:00Z");
        assertThat(body.path("resendAfterSeconds").asInt()).isEqualTo(60);
        assertThat(delivered).hasSize(1);
        assertThat(delivered.getFirst().isMimeType("multipart/related")).isTrue();
        String code = code();
        assertThat(delivered.getFirst().getAllRecipients()).extracting(Object::toString).containsExactly(email);
        String hash = jdbc.queryForObject("select code_hash from registration_codes where email=?", String.class, email);
        assertThat(hash).isNotEqualTo(code);
        assertThat(passwords.matches(code, hash)).isTrue();
        assertThat(jdbc.queryForObject("select count(*) from users where email=?", Integer.class, email)).isZero();
        assertThat(call("/auth/login", Map.of("email", email, "password", PASSWORD)).statusCode()).isEqualTo(401);
        var registered = register(email, body.path("verificationId").asString(), code);
        assertThat(registered.statusCode()).as(registered.body()).isEqualTo(201);
        assertThat(jdbc.queryForObject("select count(*) from user_sessions", Integer.class)).isEqualTo(sessions);
        assertError(register(email, body.path("verificationId").asString(), code), 400, "REGISTRATION_CODE_INVALID");
        assertThat(call("/auth/login", Map.of("email", email, "password", PASSWORD)).statusCode()).isEqualTo(200);
    }

    @Test void unverifiedAndMalformedCodeRequestsNeverCreateAccount() throws Exception {
        String email = email();
        var missing = call("/auth/register", Map.of("name", "Ana", "email", email, "password", PASSWORD));
        assertThat(missing.statusCode()).isEqualTo(422);
        String id = json.readTree(issue(email).body()).path("verificationId").asString();
        for (String invalid : List.of("12345", "1234567", "１２３４５６", "123 45"))
            assertThat(register(email, id, invalid).statusCode()).isEqualTo(422);
        assertThat(jdbc.queryForObject("select count(*) from users where email=?", Integer.class, email)).isZero();
    }

    @Test void wrongAttemptsCommitAndExhaustCodeAcrossRequestsIncludingCorrectFinalCode() throws Exception {
        String email = email(), id = json.readTree(issue(email).body()).path("verificationId").asString(), actual = code();
        String wrong = actual.equals("000000") ? "000001" : "000000";
        for (int i = 0; i < 5; i++) assertError(register(email, id, wrong), 400, "REGISTRATION_CODE_INVALID");
        assertThat(jdbc.queryForObject("select attempts from registration_codes where email=?", Integer.class, email)).isEqualTo(5);
        assertError(register(email, id, actual), 400, "REGISTRATION_CODE_INVALID");
        assertThat(jdbc.queryForObject("select count(*) from users where email=?", Integer.class, email)).isZero();
    }

    @Test void codeIsBoundToEmailAndExactExpiryAndResendInvalidatesPriorCode() throws Exception {
        String email = email(), id = json.readTree(issue(email).body()).path("verificationId").asString(), first = code();
        assertError(register(email(), id, first), 400, "REGISTRATION_CODE_INVALID");
        assertError(issue(email), 429, "REGISTRATION_RATE_LIMITED");
        clock.current.set(NOW.plusSeconds(60));
        String next = json.readTree(issue(email).body()).path("verificationId").asString(), second = code();
        assertThat(next).isNotEqualTo(id);
        assertError(register(email, id, first), 400, "REGISTRATION_CODE_INVALID");
        clock.current.set(NOW.plusSeconds(660));
        assertError(register(email, next, second), 400, "REGISTRATION_CODE_INVALID");
    }

    @Test void concurrentValidSubmissionsCreateOnlyOneAccount() throws Exception {
        String email = email(), id = json.readTree(issue(email).body()).path("verificationId").asString(), code = code();
        CountDownLatch start = new CountDownLatch(1);
        try (var pool = Executors.newFixedThreadPool(6)) {
            var results = new ArrayList<Future<Integer>>();
            for (int i = 0; i < 6; i++) results.add(pool.submit(() -> { start.await(); return register(email, id, code).statusCode(); }));
            start.countDown();
            var statuses = new ArrayList<Integer>();
            for (var result : results) statuses.add(result.get(20, TimeUnit.SECONDS));
            assertThat(statuses).filteredOn(status -> status == 201).hasSize(1);
            assertThat(statuses).filteredOn(status -> status == 400).hasSize(5);
        }
        assertThat(jdbc.queryForObject("select count(*) from users where email=?", Integer.class, email)).isEqualTo(1);
    }

    @Test void failedDeliveryInvalidatesCodeAndReturnsSafeUnavailable() throws Exception {
        doThrow(new MailSendException("Synthetic private delivery failure")).when(mail).send(any(MimeMessage.class));
        assertError(issue(email()), 503, "REGISTRATION_DELIVERY_UNAVAILABLE");
        assertThat(jdbc.queryForObject("select count(*) from registration_codes", Integer.class)).isZero();
    }

    @Test void existingAccountReceivesSameChallengeResponseAndCannotBeOverwritten() throws Exception {
        String email = email(); UUID user = UUID.randomUUID();
        jdbc.update("insert into users(id,name,email,password_hash) values (?,'Existing',?,?)", user, email, passwords.encode(PASSWORD));
        var issued = issue(email);
        assertThat(issued.statusCode()).isEqualTo(202);
        String id = json.readTree(issued.body()).path("verificationId").asString(), proof = code();
        assertError(register(email, id, proof), 409, "ACCOUNT_CONFLICT");
        assertThat(jdbc.queryForObject("select count(*) from registration_codes where email=?", Integer.class, email)).isZero();
        assertError(register(email, id, proof), 400, "REGISTRATION_CODE_INVALID");
        assertThat(jdbc.queryForObject("select id from users where email=?", UUID.class, email)).isEqualTo(user);
        assertThat(jdbc.queryForObject("select name from users where id=?", String.class, user)).isEqualTo("Existing");
        assertThat(call("/auth/login", Map.of("email", email, "password", PASSWORD)).statusCode()).isEqualTo(200);
    }

    @Test void concurrentWrongSubmissionsCannotBypassFiveAttemptBudget() throws Exception {
        String email = email(), id = json.readTree(issue(email).body()).path("verificationId").asString(), actual = code();
        String wrong = actual.equals("000000") ? "000001" : "000000";
        CountDownLatch start = new CountDownLatch(1);
        try (var pool = Executors.newFixedThreadPool(8)) {
            var results = new ArrayList<Future<Integer>>();
            for (int i = 0; i < 8; i++) results.add(pool.submit(() -> { start.await(); return register(email, id, wrong).statusCode(); }));
            start.countDown();
            for (var result : results) assertThat(result.get(20, TimeUnit.SECONDS)).isEqualTo(400);
        }
        assertThat(jdbc.queryForObject("select attempts from registration_codes where email=?", Integer.class, email)).isEqualTo(5);
        assertError(register(email, id, actual), 400, "REGISTRATION_CODE_INVALID");
    }

    @Test void activeStorageIsBoundedAndExpiredRowsAreCleanedInBatches() throws Exception {
        jdbc.update("""
                insert into registration_codes(email,verification_id,code_hash,sent_at,expires_at)
                select 'capacity-'||n||'@example.test',md5(n::text)::uuid,'hash',?,? from generate_series(1,10000) n
                """, Timestamp.from(NOW), Timestamp.from(NOW.plusSeconds(600)));
        assertError(issue(email()), 429, "REGISTRATION_RATE_LIMITED");
        assertThat(jdbc.queryForObject("select count(*) from registration_codes", Integer.class)).isEqualTo(10000);
        clock.current.set(NOW.plusSeconds(600));
        assertThat(issue(email()).statusCode()).isEqualTo(202);
        assertThat(jdbc.queryForObject("select count(*) from registration_codes", Integer.class)).isEqualTo(9901);
        jdbc.update("delete from registration_attempts");
        jdbc.update("""
                insert into registration_attempts(scope,attempts,window_ends_at)
                select 'a:'||md5(n::text)||md5(n::text),1,? from generate_series(1,20000) n
                """, Timestamp.from(NOW.plusSeconds(3600)));
        assertError(issue(email()), 429, "REGISTRATION_RATE_LIMITED");
        assertThat(jdbc.queryForObject("select count(*) from registration_attempts", Integer.class)).isEqualTo(20000);
        clock.current.set(NOW.plusSeconds(3600));
        assertThat(issue(email()).statusCode()).isEqualTo(202);
        assertThat(jdbc.queryForObject("select count(*) from registration_attempts", Integer.class)).isEqualTo(19902);
    }

    @Test void accountQuotaAndConnectorQuotaIgnoreSpoofedForwardedHeaders() throws Exception {
        String email = email();
        for (int i = 0; i < 5; i++) { clock.current.set(NOW.plusSeconds(i * 60)); assertThat(issue(email).statusCode()).isEqualTo(202); }
        clock.current.set(NOW.plusSeconds(300));
        assertError(issue(email), 429, "REGISTRATION_RATE_LIMITED");
        jdbc.update("delete from registration_attempts");
        for (int i = 0; i < 30; i++) assertThat(issue(email()).statusCode()).isEqualTo(202);
        assertError(issue(email()), 429, "REGISTRATION_RATE_LIMITED");
        assertThat(jdbc.queryForObject("select count(*) from registration_attempts where scope like 's:%'", Integer.class)).isEqualTo(1);
        assertThat(jdbc.queryForObject("select count(*) from login_attempts where scope like 'registration:%'", Integer.class)).isZero();
        clock.current.set(NOW.plusSeconds(3900));
        assertThat(issue(email()).statusCode()).isEqualTo(202);
    }

    @Test void migrationPreservesExistingUsersAndIsRepeatable() {
        String schema = "registration_" + UUID.randomUUID().toString().replace("-", "");
        try {
            var flyway = org.flywaydb.core.Flyway.configure().dataSource(jdbc.getDataSource()).schemas(schema).defaultSchema(schema).target("11").load();
            flyway.migrate(); UUID id = UUID.randomUUID();
            jdbc.update("insert into " + schema + ".users(id,name,email,password_hash) values (?,'Existing','existing@example.test','hash')", id);
            var upgrade = org.flywaydb.core.Flyway.configure().dataSource(jdbc.getDataSource()).schemas(schema).defaultSchema(schema).target("12").load();
            assertThat(upgrade.migrate().migrationsExecuted).isEqualTo(1);
            assertThat(upgrade.migrate().migrationsExecuted).isZero();
            assertThat(jdbc.queryForObject("select id from " + schema + ".users", UUID.class)).isEqualTo(id);
        } finally { jdbc.execute("drop schema if exists " + schema + " cascade"); }
    }

    String code() throws Exception { return java.util.regex.Pattern.compile("(?<![0-9])[0-9]{6}(?![0-9])").matcher(plainText(delivered.getLast())).results().map(java.util.regex.MatchResult::group).findFirst().orElseThrow(); }
    String plainText(Part part) throws Exception {
        if (part.isMimeType("text/plain")) return (String) part.getContent();
        if (part.isMimeType("multipart/*")) {
            Multipart content = (Multipart) part.getContent();
            for (int index = 0; index < content.getCount(); index++) {
                String text = plainText(content.getBodyPart(index));
                if (!text.isEmpty()) return text;
            }
        }
        return "";
    }
    String email() { return UUID.randomUUID() + "@example.test"; }
    HttpResponse<String> issue(String email) throws Exception { return call("/auth/registration-code", Map.of("email", email)); }
    HttpResponse<String> register(String email, String id, String code) throws Exception {
        return call("/auth/register", Map.of("name", "Ana", "email", email, "password", PASSWORD, "verificationId", id, "code", code));
    }
    HttpResponse<String> call(String path, Object body) throws Exception {
        return http.send(HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + "/api/v1" + path))
                .header("Content-Type", "application/json").header("X-Forwarded-For", UUID.randomUUID().toString())
                .POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body))).build(), HttpResponse.BodyHandlers.ofString());
    }
    void assertError(HttpResponse<String> response, int status, String code) throws Exception {
        assertThat(response.statusCode()).as(response.body()).isEqualTo(status);
        assertThat(json.readTree(response.body()).path("code").asString()).isEqualTo(code);
        assertThat(response.headers().firstValue("Cache-Control")).contains("no-store");
        assertThat(response.body()).doesNotContain("Synthetic private delivery failure");
    }
    @TestConfiguration static class ClockConfiguration { @Bean @Primary TestClock registrationClock() { return new TestClock(); } }
    static class TestClock extends Clock {
        final AtomicReference<Instant> current = new AtomicReference<>(NOW);
        @Override public ZoneId getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(ZoneId zone) { return this; }
        @Override public Instant instant() { return current.get(); }
    }
}
