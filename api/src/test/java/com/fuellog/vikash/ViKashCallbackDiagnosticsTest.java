package com.fuellog.vikash;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.fuellog.identity.models.UserAccount;
import com.fuellog.identity.repositories.UserAccountRepository;
import com.fuellog.identity.services.CurrentUserService;
import com.fuellog.platform.exceptions.ApiExceptionHandler;
import com.fuellog.vikash.configurations.ViKashProperties;
import com.fuellog.vikash.controllers.ViKashController;
import com.fuellog.vikash.exceptions.ViKashRemoteException;
import com.fuellog.vikash.models.ViKashRecords.Attempt;
import com.fuellog.vikash.dtos.ViKashDtos.Start;
import com.fuellog.vikash.repositories.ViKashRepository;
import com.fuellog.vikash.services.*;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.*;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.time.*;
import java.util.*;
import java.util.stream.Stream;
import javax.net.ssl.SSLHandshakeException;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionSystemException;
import tools.jackson.databind.ObjectMapper;

class ViKashCallbackDiagnosticsTest {
    final Instant now=Instant.parse("2026-11-01T12:00:00Z");
    final UserAccount user=new UserAccount("Sensitive Name","sensitive-email@example.test","sensitive-password-hash",now);
    final UUID sessionId=UUID.randomUUID(), attemptId=UUID.randomUUID();
    final String state="sensitive-state-"+"s".repeat(27), code="sensitive-authorization-code";
    final JdbcTemplate jdbc=mock(JdbcTemplate.class);
    final ViKashRepository store=spy(new ViKashRepository(jdbc));
    final UserAccountRepository users=mock(UserAccountRepository.class);
    final ViKashClient client=mock(ViKashClient.class);
    final ObjectMapper json=new ObjectMapper();
    final ViKashProperties config=new ViKashProperties(true,"https://api.example.test","fuellog","sensitive-client-secret",
        "https://fuellog.example.test/api/v1/integrations/vikash/callback","","fuellog://vikash-return");
    final CurrentUserService current=mock(CurrentUserService.class);
    final PlatformTransactionManager manager=mock(PlatformTransactionManager.class);
    final ViKashEncryption crypto=new ViKashEncryption(Base64.getEncoder().encodeToString(new byte[32]));
    final ViKashService service=new ViKashService(store,users,current,crypto,config,client,json,
        Clock.fixed(now,ZoneOffset.UTC),manager);
    final MockMvc http=MockMvcBuilders.standaloneSetup(new ViKashController(service))
        .setControllerAdvice(new ApiExceptionHandler()).build();
    final Logger logger=(Logger)LoggerFactory.getLogger(ViKashService.class);
    final ListAppender<ILoggingEvent> logs=new ListAppender<>();

    @BeforeEach void captureLogs() {
        logs.start(); logger.addAppender(logs);
        when(store.consume(anyString())).thenReturn(Optional.of(attempt(now.plusSeconds(180))));
        when(store.sessionValid(user.id(),sessionId,now)).thenReturn(true);
        when(store.authoritative(attemptId)).thenReturn(true);
        when(users.lockById(user.id())).thenReturn(Optional.of(user));
    }
    @AfterEach void releaseLogs() { logger.detachAppender(logs); logs.stop(); }

    @ParameterizedTest @NullSource @ValueSource(strings={"sensitive-malformed-state",""})
    void malformedStateHasSafeDiagnosticsWithoutConsumingAnAttempt(String input) throws Exception {
        assertRejected("MALFORMED_STATE",input,code);
        verify(store,never()).consume(anyString());
    }
    @Test void missingAttemptHasSafeDiagnostics() throws Exception {
        when(store.consume(anyString())).thenReturn(Optional.empty());
        assertRejected("ATTEMPT_NOT_FOUND",state,code);
    }
    @Test void consumedAttemptHasSafeDiagnostics() throws Exception {
        when(store.consume(anyString())).thenReturn(Optional.empty());
        when(jdbc.queryForObject(eq("select exists(select 1 from vikash_authorizations where state_hash=? and consumed_at is not null)"),eq(Boolean.class),anyString())).thenReturn(true);
        assertRejected("ATTEMPT_ALREADY_CONSUMED",state,code);
    }
    @Test void expiredAttemptHasSafeDiagnosticsBeforeCheckingSession() throws Exception {
        when(store.consume(anyString())).thenReturn(Optional.of(attempt(now)));
        assertRejected("ATTEMPT_EXPIRED",state,code);
        verify(store,never()).sessionValid(any(),any(),any());
    }
    @Test void invalidSessionHasSafeDiagnostics() throws Exception {
        when(store.sessionValid(user.id(),sessionId,now)).thenReturn(false);
        assertRejected("SESSION_INVALID",state,code);
        verify(store,never()).authoritative(any());
    }
    @ParameterizedTest @NullSource @ValueSource(strings={"", " ", "oversized"})
    void invalidCodeHasSafeDiagnosticsAndStillConsumesTheAttempt(String input) throws Exception {
        if ("oversized".equals(input)) input="sensitive-code-".repeat(150);
        assertRejected("INVALID_CODE",state,input);
        verify(store).consume(anyString());
        verify(store,never()).authoritative(any());
    }
    @Test void supersededAttemptHasSafeDiagnosticsUnderLock() throws Exception {
        when(store.authoritative(attemptId)).thenReturn(false);
        assertRejected("ATTEMPT_SUPERSEDED",state,code);
        verify(users).lockById(user.id());
        verify(store,times(1)).sessionValid(user.id(),sessionId,now);
    }
    @Test void sessionRevokedAfterConsumptionHasSafeDiagnosticsUnderLock() throws Exception {
        when(store.sessionValid(user.id(),sessionId,now)).thenReturn(true,false);
        assertRejected("SESSION_INVALID",state,code);
        verify(users).lockById(user.id());
        verify(store,times(2)).sessionValid(user.id(),sessionId,now);
    }
    @Test void providerDenialStillRedirectsWithoutRejectionLogsOrTokenExchange() throws Exception {
        assertThat(service.callback(state,code,"sensitive-provider-error")).isEqualTo("fuellog://vikash-return");
        assertThat(logs.list).isEmpty();
        verify(store).consume(anyString());
        verifyNoInteractions(client);
    }

    static Stream<Arguments> tokenFailures() {
        return Stream.of(
            Arguments.of(401,"invalid_client","INVALID_CLIENT","LINK_EXPIRED"),
            Arguments.of(400,"invalid_grant","INVALID_GRANT","UNAVAILABLE"),
            Arguments.of(400,"invalid_scope","INVALID_SCOPE","UNAVAILABLE"),
            Arguments.of(401,"sensitive-unknown-error","UNAVAILABLE","LINK_EXPIRED"),
            Arguments.of(503,"sensitive-unknown-error","UNAVAILABLE","UNAVAILABLE"),
            Arguments.of(502,"malformed","UNAVAILABLE","UNAVAILABLE"),
            Arguments.of(200,"invalid-token","INVALID_RESPONSE","INVALID_RESPONSE"),
            Arguments.of(200,"malformed","INVALID_RESPONSE","INVALID_RESPONSE"),
            Arguments.of(200,"oversized","INVALID_RESPONSE","INVALID_RESPONSE"));
    }
    @ParameterizedTest @MethodSource("tokenFailures")
    void tokenExchangeFailureHasCorrelatedAllowlistedDiagnosticsAndGenericPublicError(
        int status,String error,String reason,String functionalCode) throws Exception {
        String body=switch (error) {
            case "malformed" -> "sensitive-malformed-response";
            case "oversized" -> "sensitive-".repeat(120_000);
            case "invalid-token" -> "{\"token_type\":\"sensitive-invalid-type\",\"access_token\":\"sensitive-access-token\","
                +"\"refresh_token\":\"sensitive-refresh-token\",\"expires_in\":300,\"scope\":\"fuellog.catalog fuellog.entries\"}";
            default -> "{\"error\":\""+error+"\",\"error_description\":\"sensitive-provider-description\","
                +"\"error_uri\":\"https://sensitive.example.test?code=sensitive-code\",\"account\":\"sensitive-account\"}";
        };
        HttpServer remote=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        remote.createContext("/oauth2/token",exchange -> {
            exchange.getRequestBody().readAllBytes();
            byte[] bytes=body.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type","application/json");
            exchange.getResponseHeaders().add("Location","https://sensitive.example.test?code=sensitive-code");
            exchange.sendResponseHeaders(status,bytes.length);
            exchange.getResponseBody().write(bytes); exchange.close();
        });
        remote.start();
        try {
            var remoteConfig=new ViKashProperties(true,"http://127.0.0.1:"+remote.getAddress().getPort(),config.clientId,
                config.clientSecret,config.callbackUrl,"",config.nativeReturnUrl);
            ViKashClient realClient=new ViKashClient(remoteConfig,json);
            when(client.exchange(code,"sensitive-verifier")).thenAnswer(invocation -> {
                ViKashRemoteException failure=catchThrowableOfType(() -> realClient.exchange(code,"sensitive-verifier"),ViKashRemoteException.class);
                assertThat(failure).isNotNull();
                assertThat(failure.status()).isEqualTo(status == 200 ? 502 : status);
                assertThat(failure.code()).isEqualTo(functionalCode);
                assertThat(failure.getMessage()+failure+Arrays.toString(failure.getSuppressed())).doesNotContain("sensitive-");
                assertThat(failure.getCause()).isNull();
                throw failure;
            });

            var response=http.perform(get("/api/v1/integrations/vikash/callback").param("state",state).param("code",code))
                .andReturn().getResponse();

            assertTokenFailure(response.getStatus(),response.getContentAsString(),status,reason);
        } finally { remote.stop(0); }
    }

    static Stream<Arguments> networkFailures() {
        return Stream.of(
            Arguments.of(new HttpTimeoutException("sensitive-timeout"),"NETWORK_TIMEOUT"),
            Arguments.of(new SocketTimeoutException("sensitive-socket-timeout"),"NETWORK_TIMEOUT"),
            Arguments.of(new SSLHandshakeException("sensitive-tls"),"TLS"),
            Arguments.of(new UnknownHostException("sensitive-dns"),"DNS"),
            Arguments.of(new IOException("sensitive-wrapper",new java.nio.channels.UnresolvedAddressException()),"DNS"),
            Arguments.of(new IOException("sensitive-network"),"NETWORK_IO"),
            Arguments.of(new InterruptedException("sensitive-interruption"),"UNAVAILABLE"));
    }
    @ParameterizedTest @MethodSource("networkFailures")
    void networkFailureUsesOnlyExceptionClassesAndDoesNotRetainSensitiveCauses(Exception cause,String reason) throws Exception {
        HttpClient transport=mock(HttpClient.class);
        when(transport.send(any(HttpRequest.class),org.mockito.ArgumentMatchers.<HttpResponse.BodyHandler<String>>any())).thenThrow(cause);
        ViKashClient realClient=new ViKashClient(config,json);
        ReflectionTestUtils.setField(realClient,"http",transport);
        when(client.exchange(code,"sensitive-verifier")).thenAnswer(invocation -> {
            ViKashRemoteException failure=catchThrowableOfType(() -> realClient.exchange(code,"sensitive-verifier"),ViKashRemoteException.class);
            assertThat(failure).isNotNull();
            assertThat(failure.status()).isZero();
            assertThat(failure.code()).isEqualTo("UNAVAILABLE");
            assertThat(failure.getMessage()+failure+Arrays.toString(failure.getSuppressed())).doesNotContain("sensitive-");
            assertThat(failure.getCause()).isNull();
            assertThat(Thread.currentThread().isInterrupted()).isEqualTo(cause instanceof InterruptedException);
            Thread.interrupted();
            throw failure;
        });
        try {
            var response=http.perform(get("/api/v1/integrations/vikash/callback").param("state",state).param("code",code))
                .andReturn().getResponse();
            assertTokenFailure(response.getStatus(),response.getContentAsString(),0,reason);
        } finally { Thread.interrupted(); }
    }

    private void assertTokenFailure(int status,String body,int remoteStatus,String reason) {
        assertThat(status).isEqualTo(503);
        var problem=json.readTree(body);
        assertThat(problem.path("code").asString()).isEqualTo("VIKASH_UNAVAILABLE");
        assertThat(problem.path("detail").asString()).isEqualTo("ViKash indisponível. Tente novamente mais tarde.");
        assertThat(problem.path("fieldErrors").isEmpty()).isTrue();
        String correlationId=problem.path("correlationId").asString();
        assertThatCode(() -> UUID.fromString(correlationId)).doesNotThrowAnyException();
        assertThat(logs.list).hasSize(1);
        var event=logs.list.getFirst();
        assertThat(event.getLevel()).isEqualTo(Level.WARN);
        assertThat(event.getFormattedMessage()).isEqualTo("VIKASH_TOKEN_EXCHANGE_FAILED correlationId="+correlationId
            +" remoteStatus="+remoteStatus+" reason="+reason);
        assertThat(event.getThrowableProxy()).isNull();
        assertThat(body).doesNotContain("INVALID_CLIENT","INVALID_GRANT","INVALID_SCOPE","INVALID_RESPONSE","reason","remoteStatus","sensitive-");
        assertThat(body+event.getFormattedMessage()+Arrays.toString(event.getArgumentArray())).doesNotContain(
            "sensitive-",user.id().toString(),sessionId.toString(),attemptId.toString(),"Sensitive Name",config.callbackUrl,
            config.clientSecret,"Authorization","Basic ",Base64.getEncoder().encodeToString((config.clientId+":"+config.clientSecret)
                .getBytes(StandardCharsets.UTF_8)));
        verify(store).consume(anyString());
        verify(store,never()).connect(any(),any(),any(),any(),any());
        verify(store,never()).revoke(any());
        verify(store,never()).clearAttempts(any());
    }

    @ParameterizedTest @ValueSource(strings={"start","cancel","complete"})
    void lifecycleEventFollowsSuccessfulCommitWithoutSensitiveFields(String operation) {
        doAnswer(invocation -> {
            assertThat(logs.list).isEmpty();
            return null;
        }).when(manager).commit(any());

        lifecycle(operation);

        assertThat(logs.list).hasSize(1);
        var event=logs.list.getFirst();
        String expected=switch (operation) {
            case "start" -> "VIKASH_AUTHORIZATION_CREATED";
            case "cancel" -> "VIKASH_AUTHORIZATION_CANCELLATION_PROCESSED";
            default -> "VIKASH_AUTHORIZATION_COMPLETED";
        };
        assertThat(event.getLevel()).isEqualTo(Level.INFO);
        assertThat(event.getFormattedMessage()).isEqualTo(expected);
        assertThat(event.getArgumentArray()).isNullOrEmpty();
        assertThat(event.getThrowableProxy()).isNull();
    }
    @ParameterizedTest @ValueSource(strings={"start","cancel","complete"})
    void failedCommitDoesNotEmitLifecycleSuccess(String operation) {
        int[] commits={0};
        doAnswer(invocation -> {
            if (++commits[0] == ("complete".equals(operation) ? 2 : 1))
                throw new TransactionSystemException("sensitive-commit-failure");
            return null;
        }).when(manager).commit(any());

        assertThatThrownBy(() -> lifecycle(operation)).isInstanceOf(TransactionSystemException.class);

        assertThat(logs.list).isEmpty();
    }
    private void lifecycle(String operation) {
        when(current.requireUserId()).thenReturn(user.id());
        when(current.requireSessionId()).thenReturn(sessionId);
        when(client.authorizationUrl(anyString(),anyString())).thenReturn("https://api.example.test?state=sensitive-state");
        when(client.exchange(anyString(),anyString())).thenReturn(new ViKashClient.Tokens("sensitive-access-token","sensitive-refresh-token",300));
        switch (operation) {
            case "start" -> service.start(new Start("native"));
            case "cancel" -> service.cancelAuthorization();
            default -> service.callback(state,code,null);
        }
    }
    private Attempt attempt(Instant expiresAt) {
        return new Attempt(attemptId,user.id(),sessionId,crypto.encrypt(attemptId,"sensitive-verifier"),"native",expiresAt);
    }
    private void assertRejected(String reason,String inputState,String inputCode) throws Exception {
        var request=get("/api/v1/integrations/vikash/callback");
        if (inputState != null) request.param("state",inputState);
        if (inputCode != null) request.param("code",inputCode);
        var response=http.perform(request).andReturn().getResponse();
        assertThat(response.getStatus()).isEqualTo(400);
        String body=response.getContentAsString();
        var problem=json.readTree(body);
        assertThat(problem.path("code").asString()).isEqualTo("VIKASH_INVALID_STATE");
        assertThat(problem.path("detail").asString()).isEqualTo("Autorização inválida ou expirada. Inicie a conexão novamente.");
        assertThat(problem.path("fieldErrors").isEmpty()).isTrue();
        String correlationId=problem.path("correlationId").asString();
        assertThatCode(() -> UUID.fromString(correlationId)).doesNotThrowAnyException();
        assertThat(logs.list).hasSize(1);
        var event=logs.list.getFirst();
        assertThat(event.getLevel()).isEqualTo(Level.WARN);
        assertThat(event.getFormattedMessage()).isEqualTo("VIKASH_INVALID_STATE correlationId="+correlationId+" reason="+reason);
        assertThat(event.getThrowableProxy()).isNull();
        assertThat(body).doesNotContain(reason,"reason");
        String diagnostics=body+event.getFormattedMessage()+Arrays.toString(event.getArgumentArray());
        assertThat(diagnostics).doesNotContain("sensitive-",user.id().toString(),sessionId.toString(),attemptId.toString(),
            "Sensitive Name",config.callbackUrl,config.clientSecret);
        verifyNoInteractions(client);
        verify(store,never()).connect(any(),any(),any(),any(),any());
    }
}
