package com.fuellog.vikash;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import com.fuellog.identity.models.UserAccount;
import com.fuellog.identity.repositories.UserAccountRepository;
import com.fuellog.identity.services.CurrentUserService;
import com.fuellog.platform.exceptions.ApiException;
import com.fuellog.vikash.configurations.ViKashProperties;
import com.fuellog.vikash.dtos.ViKashDtos.Start;
import com.fuellog.vikash.models.ViKashRecords.Attempt;
import com.fuellog.vikash.repositories.ViKashRepository;
import com.fuellog.vikash.services.*;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.transaction.PlatformTransactionManager;
import tools.jackson.databind.ObjectMapper;

class ViKashAuthorizationTest {
    final Instant now=Instant.parse("2026-11-01T12:00:00Z");
    final UserAccount user=new UserAccount("Teste","native@example.test","fixture-hash",now);
    final UUID sessionId=UUID.randomUUID();
    final ViKashRepository store=mock(ViKashRepository.class);
    final UserAccountRepository users=mock(UserAccountRepository.class);
    final CurrentUserService current=mock(CurrentUserService.class);
    final PlatformTransactionManager manager=mock(PlatformTransactionManager.class);
    final ViKashEncryption crypto=new ViKashEncryption(Base64.getEncoder().encodeToString(new byte[32]));
    final ViKashProperties config=new ViKashProperties(true,"https://api.example.test","fuellog","fixture-secret",
        "https://fuellog.example.test/api/v1/integrations/vikash/callback","","fuellog://vikash-return");
    final ViKashClient client=spy(new ViKashClient(config,new ObjectMapper()));
    final ViKashService service=new ViKashService(store,users,current,crypto,config,client,new ObjectMapper(),
        Clock.fixed(now,ZoneOffset.UTC),manager);

    @Test void missingWebReturnRejectsStartBeforeAnyAttemptOrAuthorizationIsCreated() {
        when(current.requireUserId()).thenReturn(user.id());
        when(current.requireSessionId()).thenReturn(sessionId);
        when(users.lockById(user.id())).thenReturn(Optional.of(user));

        assertWebUnavailable(() -> service.start(new Start("web")));

        verifyNoInteractions(store,users,client,manager);
    }

    @Test void nativeOnlyStartKeepsTheInstalledAppReturnAndCreatesItsAttempt() {
        when(current.requireUserId()).thenReturn(user.id());
        when(current.requireSessionId()).thenReturn(sessionId);
        when(users.lockById(user.id())).thenReturn(Optional.of(user));

        var authorization=service.start(new Start("native"));

        assertThat(authorization.returnUrl()).isEqualTo("fuellog://vikash-return");
        assertThat(authorization.authorizationUrl()).startsWith("https://api.example.test/oauth2/authorize?")
            .contains("code_challenge_method=S256");
        verify(store).attempt(anyString(),argThat(attempt -> "native".equals(attempt.platform())
            && user.id().equals(attempt.userId()) && sessionId.equals(attempt.sessionId())));
    }

    @ParameterizedTest
    @NullSource
    @ValueSource(strings={"access_denied"})
    void legacyWebCallbackWithoutReturnFailsBeforeTokenExchangeOrConnection(String error) {
        UUID attemptId=UUID.randomUUID();
        var attempt=new Attempt(attemptId,user.id(),sessionId,crypto.encrypt(attemptId,"fixture-verifier"),"web",now.plusSeconds(180));
        when(store.consume(anyString())).thenReturn(Optional.of(attempt));
        when(store.sessionValid(user.id(),sessionId,now)).thenReturn(true);
        when(store.authoritative(attemptId)).thenReturn(true);
        when(users.lockById(user.id())).thenReturn(Optional.of(user));
        doReturn(new ViKashClient.Tokens("access","refresh",300)).when(client).exchange(anyString(),anyString());

        assertWebUnavailable(() -> service.callback("s".repeat(43),"fixture-code",error));

        verifyNoInteractions(client);
        verify(store,never()).connect(any(),any(),any(),any(),any());
    }

    private void assertWebUnavailable(org.assertj.core.api.ThrowableAssert.ThrowingCallable action) {
        assertThatThrownBy(action).isInstanceOfSatisfying(ApiException.class, error -> {
            assertThat(error.status()).isEqualTo(503);
            assertThat(error.code()).isEqualTo("VIKASH_WEB_NOT_CONFIGURED");
            assertThat(error.getMessage()).contains("web");
        });
    }
}
