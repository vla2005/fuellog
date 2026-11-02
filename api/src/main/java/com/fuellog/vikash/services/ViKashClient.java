package com.fuellog.vikash.services;

import com.fuellog.vikash.configurations.ViKashProperties;
import com.fuellog.vikash.dtos.ViKashDtos.Catalog;
import com.fuellog.vikash.exceptions.ViKashRemoteException;
import com.fuellog.vikash.exceptions.ViKashRemoteException.Reason;
import java.net.*;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.nio.ByteBuffer;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.Flow;
import org.springframework.stereotype.Component;
import tools.jackson.databind.*;

@Component
public class ViKashClient {
    private static final int MAX_RESPONSE_BYTES = 1_000_000;
    private final ViKashProperties config;
    private final ObjectMapper json;
    private final HttpClient http=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).followRedirects(HttpClient.Redirect.NEVER).build();
    public ViKashClient(ViKashProperties config, ObjectMapper json) { this.config=config; this.json=json; }
    public record Tokens(String accessToken, String refreshToken, long expiresIn) {
        @Override public String toString() { return "Tokens[redacted]"; }
    }
    public record Remote(String etag, long version, String status, boolean manuallyModified) {}
    public String authorizationUrl(String state, String challenge) {
        return config.baseUrl+"/oauth2/authorize?"+form(Map.of("response_type","code","client_id",config.clientId,
            "redirect_uri",config.callbackUrl,"scope","fuellog.catalog fuellog.entries","state",state,
            "code_challenge",challenge,"code_challenge_method","S256"));
    }
    public Tokens exchange(String code, String verifier) {
        return token(Map.of("grant_type","authorization_code","code",code,"code_verifier",verifier,"redirect_uri",config.callbackUrl));
    }
    public Tokens refresh(String refresh) { return token(Map.of("grant_type","refresh_token","refresh_token",refresh)); }
    private Tokens token(Map<String,String> fields) {
        var response=send(request("/oauth2/token").header("Authorization",basic()).header("Content-Type","application/x-www-form-urlencoded")
            .POST(HttpRequest.BodyPublishers.ofString(form(fields))).build());
        JsonNode body=body(response);
        if (!"Bearer".equalsIgnoreCase(body.path("token_type").asString()) || body.path("access_token").asString().isBlank()
            || body.path("refresh_token").asString().isBlank() || body.path("expires_in").asLong() <= 0
            || !Set.of(body.path("scope").asString().split(" ")).containsAll(Set.of("fuellog.catalog","fuellog.entries")))
            throw new ViKashRemoteException(502,"INVALID_RESPONSE",response.statusCode(),Reason.INVALID_RESPONSE);
        return new Tokens(body.path("access_token").asString(),body.path("refresh_token").asString(),body.path("expires_in").asLong());
    }
    public void revoke(String token) {
        send(request("/oauth2/revoke").header("Authorization",basic()).header("Content-Type","application/x-www-form-urlencoded")
            .POST(HttpRequest.BodyPublishers.ofString(form(Map.of("token",token,"token_type_hint","refresh_token")))).build());
    }
    public Catalog catalog(String access) {
        var response=send(authorized("/api/integrations/v1/fuellog/catalog",access).GET().build());
        try {
            Catalog result=json.readValue(response.body(),Catalog.class);
            if (!"1".equals(result.apiVersion()) || !"BRL".equals(result.currency()) || result.categories() == null
                || result.accounts() == null || result.cards() == null || result.paymentMethods() == null || result.installments() == null
                || result.installments().min() != 1 || result.installments().max() > 120 || !result.installments().creditOnly())
                throw new IllegalArgumentException();
            return result;
        } catch (RuntimeException e) { throw new ViKashRemoteException(502,"INVALID_RESPONSE"); }
    }
    public Remote get(String access, String externalId) {
        try { return remote(send(authorized(path(externalId),access).GET().build())); }
        catch (ViKashRemoteException e) { if (e.status() == 404) return null; throw e; }
    }
    public Remote put(String access, String externalId, String payload, String etag) {
        var request=authorized(path(externalId),access).header("Content-Type","application/json");
        if (etag == null) request.header("If-None-Match","*"); else request.header("If-Match",etag);
        return remote(send(request.PUT(HttpRequest.BodyPublishers.ofString(payload)).build()));
    }
    public Remote delete(String access, String externalId, long version, String etag) {
        return remote(send(authorized(path(externalId)+"?version="+version,access).header("If-Match",etag).DELETE().build()));
    }
    private Remote remote(HttpResponse<String> response) {
        JsonNode body=body(response); String etag=response.headers().firstValue("ETag").orElse("");
        if (!etag.matches("\"[^\"\\r\\n]{1,250}\"") || body.path("version").asLong() < 1
            || !Set.of("ACTIVE","CANCELLED","MANUALLY_DELETED").contains(body.path("status").asString()))
            throw new ViKashRemoteException(502,"INVALID_RESPONSE");
        return new Remote(etag,body.path("version").asLong(),body.path("status").asString(),body.path("manuallyModified").asBoolean());
    }
    private HttpRequest.Builder authorized(String path, String access) { return request(path).header("Authorization","Bearer "+access); }
    private HttpRequest.Builder request(String path) { return HttpRequest.newBuilder(URI.create(config.baseUrl+path)).timeout(Duration.ofSeconds(10)).header("Accept","application/json"); }
    private String basic() {
        return "Basic "+Base64.getEncoder().encodeToString((encode(config.clientId)+":"+encode(config.clientSecret)).getBytes(StandardCharsets.UTF_8));
    }
    private static String path(String externalId) {
        if (!externalId.matches("[A-Za-z0-9._-]{1,100}")) throw new IllegalArgumentException("Invalid external ID");
        return "/api/integrations/v1/fuellog/refuelings/"+externalId;
    }
    private static String encode(String value) { return URLEncoder.encode(value,StandardCharsets.UTF_8); }
    private static String form(Map<String,String> values) { return values.entrySet().stream().map(e -> encode(e.getKey())+"="+encode(e.getValue())).collect(java.util.stream.Collectors.joining("&")); }
    private JsonNode body(HttpResponse<String> response) {
        try { return json.readTree(response.body()); }
        catch (RuntimeException e) { throw new ViKashRemoteException(502,"INVALID_RESPONSE",response.statusCode(),Reason.INVALID_RESPONSE); }
    }
    private HttpResponse<String> send(HttpRequest request) {
        HttpResponse<String> response;
        try { response=http.send(request,info -> new LimitedBodySubscriber(info)); }
        catch (InterruptedException e) { Thread.currentThread().interrupt(); throw new ViKashRemoteException(0,"UNAVAILABLE"); }
        catch (java.io.IOException e) {
            for (Throwable cause=e; cause != null; cause=cause.getCause()) {
                if (cause instanceof ResponseTooLargeException oversized)
                    throw new ViKashRemoteException(502,"INVALID_RESPONSE",oversized.status,Reason.INVALID_RESPONSE);
            }
            throw new ViKashRemoteException(0,"UNAVAILABLE",0,networkReason(e));
        }
        if (response.statusCode() < 200 || response.statusCode() >= 300) {
            String code=""; Reason reason=Reason.UNAVAILABLE;
            try {
                JsonNode error=json.readTree(response.body());
                code=error.path("code").asString();
                reason=switch (error.path("error").asString()) {
                    case "invalid_client" -> Reason.INVALID_CLIENT;
                    case "invalid_grant" -> Reason.INVALID_GRANT;
                    case "invalid_scope" -> Reason.INVALID_SCOPE;
                    default -> Reason.UNAVAILABLE;
                };
            } catch (RuntimeException e) { /* Only allowlisted diagnostics leave this boundary. */ }
            if (!Set.of("VERSION_CONFLICT","STALE_VERSION","CANCELLED","MANUALLY_DELETED","FINANCIAL_RESTRICTION",
                "PRECONDITION_FAILED","INVALID_REFERENCE").contains(code)) code=response.statusCode() == 401 ? "LINK_EXPIRED" : "UNAVAILABLE";
            throw new ViKashRemoteException(response.statusCode(),code,response.statusCode(),reason);
        }
        return response;
    }
    private static final class ResponseTooLargeException extends java.io.IOException {
        private final int status;
        private ResponseTooLargeException(int status) { super("ViKash response exceeds size limit"); this.status=status; }
    }
    /** Reject excess bytes before the string decoder buffers them, including chunked responses. */
    private static final class LimitedBodySubscriber implements HttpResponse.BodySubscriber<String> {
        private final HttpResponse.BodySubscriber<String> delegate;
        private final int status;
        private Flow.Subscription subscription;
        private int remaining=MAX_RESPONSE_BYTES;
        private boolean finished;
        private LimitedBodySubscriber(HttpResponse.ResponseInfo info) {
            delegate=HttpResponse.BodyHandlers.ofString().apply(info); status=info.statusCode();
        }
        @Override public CompletionStage<String> getBody() { return delegate.getBody(); }
        @Override public void onSubscribe(Flow.Subscription subscription) {
            this.subscription=subscription; delegate.onSubscribe(subscription);
        }
        @Override public void onNext(List<ByteBuffer> buffers) {
            if (finished) return;
            for (ByteBuffer buffer : buffers) {
                if (buffer.remaining() > remaining) {
                    finished=true; subscription.cancel(); delegate.onError(new ResponseTooLargeException(status)); return;
                }
                remaining-=buffer.remaining();
            }
            delegate.onNext(buffers);
        }
        @Override public void onError(Throwable error) { if (!finished) { finished=true; delegate.onError(error); } }
        @Override public void onComplete() { if (!finished) { finished=true; delegate.onComplete(); } }
    }
    private static Reason networkReason(java.io.IOException error) {
        for (Throwable cause=error; cause != null; cause=cause.getCause()) {
            if (cause instanceof HttpTimeoutException || cause instanceof SocketTimeoutException) return Reason.NETWORK_TIMEOUT;
            if (cause instanceof javax.net.ssl.SSLException) return Reason.TLS;
            if (cause instanceof UnknownHostException || cause instanceof java.nio.channels.UnresolvedAddressException) return Reason.DNS;
        }
        return Reason.NETWORK_IO;
    }
}
