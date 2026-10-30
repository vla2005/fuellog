package com.fuellog.identity.configurations;

import com.fuellog.identity.repositories.UserAccountRepository;
import com.fuellog.identity.repositories.UserSessionRepository;
import com.fuellog.identity.security.SecurityProblems;
import com.fuellog.identity.security.SessionCheckingJwtDecoder;

import java.time.*;
import java.security.*;
import java.security.interfaces.*;
import java.util.*;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.source.ImmutableJWKSet;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.*;
import org.springframework.core.env.Environment;
import org.springframework.core.io.Resource;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.converter.RsaKeyConverters;
import org.springframework.security.crypto.password.*;
import org.springframework.security.oauth2.core.*;
import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.oauth2.jwt.*;
import org.springframework.security.oauth2.server.resource.web.DefaultBearerTokenResolver;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

@Configuration
@EnableConfigurationProperties(IdentitySecurityProperties.class)
class IdentitySecurityConfiguration {
    static boolean publicCredentials(String method, String path) {
        return "POST".equals(method) && Set.of("/api/v1/auth/register", "/api/v1/auth/login", "/api/v1/auth/refresh", "/api/v1/auth/2fa/verify").contains(path);
    }
    @Bean Clock identityClock() { return Clock.systemUTC(); }
    @Bean PasswordEncoder passwordEncoder() { return Pbkdf2PasswordEncoder.defaultsForSpringSecurity_v5_8(); }
    @Bean RSAKey identitySigningKey(IdentitySecurityProperties properties, Environment environment) throws Exception {
        Resource privateKey = properties.privateKey(), publicKey = properties.publicKey();
        if (privateKey != null && publicKey != null) {
            RSAPrivateKey secret;
            RSAPublicKey visible;
            try (var input = privateKey.getInputStream()) { secret = RsaKeyConverters.pkcs8().convert(input); }
            try (var input = publicKey.getInputStream()) { visible = RsaKeyConverters.x509().convert(input); }
            if (secret == null || visible == null || visible.getModulus().bitLength() < 2048 || !secret.getModulus().equals(visible.getModulus()))
                throw new IllegalArgumentException("Matching RSA keys of at least 2048 bits required");
            return new RSAKey.Builder(visible).privateKey(secret).keyID("fuellog").build();
        }
        if (privateKey != null || publicKey != null || !environment.matchesProfiles("local", "test"))
            throw new IllegalStateException("Configure fuellog.security.private-key and public-key; ephemeral keys require local/test profile");
        KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA"); generator.initialize(2048);
        KeyPair pair = generator.generateKeyPair();
        return new RSAKey.Builder((RSAPublicKey) pair.getPublic()).privateKey((RSAPrivateKey) pair.getPrivate()).keyID(UUID.randomUUID().toString()).build();
    }
    @Bean JwtEncoder jwtEncoder(RSAKey key) { return new NimbusJwtEncoder(new ImmutableJWKSet<>(new JWKSet(key))); }
    @Bean JwtDecoder jwtDecoder(RSAKey key, IdentitySecurityProperties properties, UserSessionRepository sessions,
            UserAccountRepository users, Clock identityClock) throws Exception {
        NimbusJwtDecoder decoder = NimbusJwtDecoder.withPublicKey(key.toRSAPublicKey()).signatureAlgorithm(SignatureAlgorithm.RS256).build();
        JwtTimestampValidator timestamps = new JwtTimestampValidator(Duration.ofSeconds(30)); timestamps.setClock(identityClock);
        OAuth2TokenValidator<Jwt> claims = jwt -> {
            boolean valid;
            try {
                UUID.fromString(jwt.getSubject()); UUID.fromString(jwt.getClaimAsString("sid")); UUID.fromString(jwt.getId());
                valid = jwt.getAudience().contains(properties.audience()) && "access".equals(jwt.getClaimAsString("token_use"))
                        && jwt.getIssuedAt() != null && jwt.getNotBefore() != null && jwt.getExpiresAt() != null
                        && !jwt.getIssuedAt().isAfter(identityClock.instant().plusSeconds(30))
                        && jwt.getExpiresAt().isAfter(jwt.getIssuedAt());
            } catch (RuntimeException e) { valid = false; }
            if (!valid) return OAuth2TokenValidatorResult.failure(new OAuth2Error("ACCESS_TOKEN_INVALID"));
            if (!identityClock.instant().isBefore(jwt.getExpiresAt().plusSeconds(30)))
                return OAuth2TokenValidatorResult.failure(new OAuth2Error("ACCESS_TOKEN_EXPIRED"));
            return OAuth2TokenValidatorResult.success();
        };
        decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(new JwtIssuerValidator(properties.issuer()), timestamps, claims));
        return new SessionCheckingJwtDecoder(decoder, sessions, users, identityClock);
    }
    @Bean UrlBasedCorsConfigurationSource identityCors(Environment environment) {
        var origins = Arrays.stream(environment.getRequiredProperty("fuellog.cors.allowed-origins").split(","))
                .map(String::trim).filter(origin -> !origin.isEmpty()).toList();
        if (origins.stream().anyMatch(origin -> origin.contains("*")))
            throw new IllegalArgumentException("CORS origins must be explicit; wildcards are not allowed");
        var cors = new CorsConfiguration();
        cors.setAllowedOrigins(origins);
        cors.setAllowedMethods(List.of("GET", "POST", "PUT", "PATCH", "OPTIONS"));
        cors.setAllowedHeaders(List.of("Authorization", "Content-Type", "If-Match"));
        cors.setExposedHeaders(List.of("ETag"));
        cors.setAllowCredentials(false);
        var source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/api/v1/**", cors);
        return source;
    }
    @Bean SecurityFilterChain identitySecurity(HttpSecurity http, UrlBasedCorsConfigurationSource identityCors) throws Exception {
        DefaultBearerTokenResolver resolver = new DefaultBearerTokenResolver();
        http.cors(cors -> cors.configurationSource(identityCors))
                .csrf(csrf -> csrf.disable()).sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .requestCache(c -> c.disable()).formLogin(c -> c.disable()).httpBasic(c -> c.disable()).logout(c -> c.disable())
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers(request -> publicCredentials(request.getMethod(), request.getServletPath())).permitAll()
                        .requestMatchers(org.springframework.http.HttpMethod.GET, "/actuator/health").permitAll()
                        .anyRequest().authenticated())
                .exceptionHandling(errors -> errors.authenticationEntryPoint((request, response, error) -> SecurityProblems.authentication(response, error))
                        .accessDeniedHandler((request, response, error) -> SecurityProblems.write(response, 403, "ACCESS_DENIED")))
                .oauth2ResourceServer(resource -> resource
                        .bearerTokenResolver(request -> publicCredentials(request.getMethod(), request.getServletPath()) ? null : resolver.resolve(request))
                        .authenticationEntryPoint((request, response, error) -> SecurityProblems.authentication(response, error))
                        .jwt(jwt -> {}));
        return http.build();
    }
}
