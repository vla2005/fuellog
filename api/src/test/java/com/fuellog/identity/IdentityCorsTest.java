package com.fuellog.identity;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.mock.web.MockHttpServletRequest;

class IdentityCorsTest {
    @Test
    void configuredOriginsReplaceDefaultsAndCanDisableBrowserAccess() {
        var environment = new MockEnvironment().withProperty("fuellog.cors.allowed-origins", " https://app.example.com,https://preview.example.com ");
        var request = new MockHttpServletRequest("GET", "/api/v1/me");
        var source = new IdentitySecurityConfiguration().identityCors(environment);
        var configuration = source.getCorsConfiguration(request);
        assertThat(configuration).isNotNull();
        assertThat(configuration.checkOrigin("https://app.example.com")).isEqualTo("https://app.example.com");
        assertThat(configuration.checkOrigin("http://localhost:8081")).isNull();
        assertThat(configuration.getAllowCredentials()).isFalse();
        environment.setProperty("fuellog.cors.allowed-origins", "");
        assertThat(new IdentitySecurityConfiguration().identityCors(environment).getCorsConfiguration(request)
                .checkOrigin("https://app.example.com")).isNull();
    }

    @Test
    void wildcardConfigurationIsRejected() {
        var environment = new MockEnvironment().withProperty("fuellog.cors.allowed-origins", "*");
        assertThatThrownBy(() -> new IdentitySecurityConfiguration().identityCors(environment))
                .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("wildcards");
    }
}
