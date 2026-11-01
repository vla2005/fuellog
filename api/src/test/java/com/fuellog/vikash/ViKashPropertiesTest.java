package com.fuellog.vikash;

import static org.assertj.core.api.Assertions.*;
import com.fuellog.vikash.configurations.ViKashProperties;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class ViKashPropertiesTest {
    @ParameterizedTest
    @ValueSource(strings={"", "  "})
    void nativeOnlyIntegrationDoesNotRequireAWebReturn(String webReturn) {
        assertThatCode(() -> properties(webReturn)).doesNotThrowAnyException();
    }

    @ParameterizedTest
    @ValueSource(strings={"https://app.example.test/vikash-return", "http://localhost:8081/vikash-return",
        "http://127.0.0.1:8081/vikash-return", "http://[::1]:8081/vikash-return"})
    void configuredWebReturnAcceptsOnlyExactHttpsOrLoopbackHttp(String webReturn) {
        assertThat(properties(webReturn).webReturnUrl).isEqualTo(webReturn);
    }

    @ParameterizedTest
    @ValueSource(strings={"http://app.example.test/vikash-return", "https://user@app.example.test/vikash-return",
        "https://app.example.test/vikash-return?next=other", "https://app.example.test/vikash-return#fragment"})
    void configuredWebReturnStillRejectsInsecureOrInexactDestinations(String webReturn) {
        assertThatThrownBy(() -> properties(webReturn)).isInstanceOf(IllegalStateException.class);
    }

    private ViKashProperties properties(String webReturn) {
        return new ViKashProperties(true,"https://api.example.test","fuellog","fixture-secret",
            "https://fuellog.example.test/api/v1/integrations/vikash/callback",webReturn,"fuellog://vikash-return");
    }
}
