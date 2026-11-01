package com.fuellog.vikash.configurations;

import java.net.URI;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class ViKashProperties {
    public final boolean enabled;
    public final String baseUrl, clientId, clientSecret, callbackUrl, webReturnUrl, nativeReturnUrl;
    public ViKashProperties(@Value("${fuellog.vikash.enabled:false}") boolean enabled,
        @Value("${fuellog.vikash.base-url:}") String baseUrl, @Value("${fuellog.vikash.client-id:fuellog}") String clientId,
        @Value("${fuellog.vikash.client-secret:}") String clientSecret, @Value("${fuellog.vikash.callback-url:}") String callbackUrl,
        @Value("${fuellog.vikash.web-return-url:}") String webReturnUrl, @Value("${fuellog.vikash.native-return-url:}") String nativeReturnUrl) {
        this.enabled=enabled; this.baseUrl=baseUrl; this.clientId=clientId; this.clientSecret=clientSecret;
        this.callbackUrl=callbackUrl; this.webReturnUrl=webReturnUrl; this.nativeReturnUrl=nativeReturnUrl;
        if (enabled) {
            requireHttp(baseUrl,true); requireHttp(callbackUrl,false);
            if (!webReturnUrl.isBlank()) requireHttp(webReturnUrl,false);
            URI nativeUri=URI.create(nativeReturnUrl);
            if (!"fuellog".equals(nativeUri.getScheme()) || nativeUri.getFragment() != null || nativeUri.getRawQuery() != null
                || nativeUri.getUserInfo() != null || nativeUri.getHost() == null)
                throw new IllegalStateException("Configure an exact fuellog native return URI");
            if (clientId.isBlank() || clientSecret.isBlank()) throw new IllegalStateException("Configure ViKash client credentials");
        }
    }
    private static void requireHttp(String value, boolean origin) {
        URI uri;
        try { uri=URI.create(value); } catch (RuntimeException e) { throw new IllegalStateException("Invalid ViKash configuration URI"); }
        boolean loopback=java.util.Set.of("localhost","127.0.0.1","[::1]").contains(uri.getHost());
        if (!("https".equals(uri.getScheme()) || "http".equals(uri.getScheme()) && loopback) || uri.getHost() == null
            || uri.getUserInfo() != null || uri.getFragment() != null || uri.getRawQuery() != null
            || origin && uri.getRawPath() != null && !uri.getRawPath().isEmpty())
            throw new IllegalStateException("Configure exact HTTPS ViKash URIs (HTTP is limited to loopback)");
    }
    @Override public String toString() { return "ViKashProperties[redacted]"; }
}
