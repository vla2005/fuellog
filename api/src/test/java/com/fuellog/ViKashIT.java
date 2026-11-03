package com.fuellog;

import static org.assertj.core.api.Assertions.*;
import com.fuellog.vikash.services.ViKashService;
import com.sun.net.httpserver.HttpServer;
import java.net.*;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.*;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
import com.fuellog.vikash.repositories.ViKashRepository;
import tools.jackson.databind.*;

// Explicit contract fixture: this is not a running ViKash installation.
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
class ViKashIT {
    static HttpServer remote;
    static String remoteBase;
    static ObjectMapper fixtureJson=new ObjectMapper();
    static Map<String,JsonNode> received=new ConcurrentHashMap<>();
    static AtomicInteger puts=new AtomicInteger();
    static AtomicInteger tokenCalls=new AtomicInteger();
    static Set<String> cancelled=ConcurrentHashMap.newKeySet();
    static volatile String verifier;
    static volatile int failWrites;
    static volatile boolean manual;
    static volatile boolean catalogUnavailable, refreshUnavailable, financialRestriction;
    @DynamicPropertySource static void configuration(DynamicPropertyRegistry p) throws Exception {
        remote=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        remote.createContext("/",exchange -> {
            String path=exchange.getRequestURI().getPath(), method=exchange.getRequestMethod();
            String text=new String(exchange.getRequestBody().readAllBytes(),StandardCharsets.UTF_8);
            int status=200; String body="{}";
            if (path.equals("/oauth2/token")) {
                tokenCalls.incrementAndGet();
                if (text.contains("code_verifier=")) verifier=Arrays.stream(text.split("&")).filter(v -> v.startsWith("code_verifier=")).map(v -> URLDecoder.decode(v.substring(14),StandardCharsets.UTF_8)).findFirst().orElseThrow();
                body="{\"access_token\":\"fixture-access\",\"refresh_token\":\"fixture-refresh\",\"token_type\":\"Bearer\",\"expires_in\":300,\"scope\":\"fuellog.catalog fuellog.entries\"}";
                if (text.contains("grant_type=refresh_token") && refreshUnavailable) status=503;
            } else if (path.endsWith("/catalog")) {
                body="{\"apiVersion\":\"1\",\"categories\":[{\"id\":\"default:1\",\"name\":\"Combustível\",\"kind\":\"DEFAULT\"}],\"accounts\":[{\"uuid\":\"account\",\"description\":\"Carteira\",\"type\":\"CARTEIRA\"}],\"cards\":[{\"uuid\":\"card\",\"description\":\"Cartão de teste\"}],\"paymentMethods\":[\"PIX\",\"CREDIT_CARD\"],\"installments\":{\"min\":1,\"max\":120,\"creditOnly\":true},\"currency\":\"BRL\"}";
            } else if (path.contains("/refuelings/")) {
                String id=path.substring(path.lastIndexOf('/')+1);
                JsonNode saved=received.get(id);
                if (method.equals("PUT")) {
                    puts.incrementAndGet();
                    String expected=saved == null ? null : "\"remote-"+saved.path("version").asLong()+(manual ? "-manual" : "")+"\"";
                    if (cancelled.contains(id)) { status=409; body="{\"code\":\"CANCELLED\"}"; }
                    else if (manual && !Objects.equals(expected,exchange.getRequestHeaders().getFirst("If-Match"))) { status=412; body="{\"code\":\"PRECONDITION_FAILED\"}"; }
                    else {
                        if (saved == null) assertThat(exchange.getRequestHeaders().getFirst("If-None-Match")).isEqualTo("*");
                        else assertThat(exchange.getRequestHeaders().getFirst("If-Match")).isEqualTo(expected);
                        received.put(id,fixtureJson.readTree(text)); saved=received.get(id);
                        manual=false;
                        status=saved.path("version").asLong() == 1 ? 201 : 200;
                        if (failWrites-- > 0) { exchange.close(); return; }
                    }
                } else if (saved == null) status=404;
                if (method.equals("DELETE") && saved != null) {
                    if (financialRestriction) { status=409; body="{\"code\":\"FINANCIAL_RESTRICTION\"}"; }
                    else { cancelled.add(id); ((tools.jackson.databind.node.ObjectNode)saved).put("version",Long.parseLong(exchange.getRequestURI().getQuery().substring(8))); }
                }
                if (status < 300 && saved != null) {
                    long version=method.equals("DELETE") ? Long.parseLong(exchange.getRequestURI().getQuery().substring(8)) : saved.path("version").asLong();
                    exchange.getResponseHeaders().add("ETag","\"remote-"+version+(manual ? "-manual" : "")+"\"");
                    body="{\"externalId\":\""+id+"\",\"version\":"+version+",\"status\":\""+(cancelled.contains(id) ? "CANCELLED" : "ACTIVE")+"\",\"financialUuid\":\"fixture\",\"financialKind\":\"TRANSACTION\",\"manuallyModified\":"+manual+"}";
                }
            }
            if (path.endsWith("/catalog") && catalogUnavailable) { status=503; body="{}"; }
            byte[] bytes=body.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type","application/json"); exchange.sendResponseHeaders(status,bytes.length);
            exchange.getResponseBody().write(bytes); exchange.close();
        });
        remote.start(); remoteBase="http://127.0.0.1:"+remote.getAddress().getPort();
        p.add("fuellog.vikash.enabled",() -> "true"); p.add("fuellog.vikash.worker-enabled",() -> "false");
        p.add("fuellog.vikash.base-url",() -> remoteBase); p.add("fuellog.vikash.client-secret",() -> "fixture-secret");
        p.add("fuellog.vikash.callback-url",() -> "http://127.0.0.1/callback");
        p.add("fuellog.vikash.web-return-url",() -> "http://127.0.0.1/vikash-return"); p.add("fuellog.vikash.native-return-url",() -> "fuellog://vikash-return");
        p.add("fuellog.vikash.encryption-key-base64",() -> "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=");
    }
    @AfterAll static void stop() { if (remote != null) remote.stop(0); }
    @BeforeEach void reset() { manual=false; failWrites=0; received.clear(); puts.set(0); tokenCalls.set(0); cancelled.clear(); catalogUnavailable=false; refreshUnavailable=false; financialRestriction=false; }
    @LocalServerPort int port;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    @Autowired ViKashService integration;
    @MockitoSpyBean ViKashRepository store;
    HttpClient client=HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NEVER).build();
    record Response(int status,JsonNode body,String location) {}
    Response call(String method,String path,String token,Object body,String tag) throws Exception {
        var b=HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+port+"/api/v1"+path));
        if (token != null) b.header("Authorization","Bearer "+token);
        if (tag != null) b.header("If-Match",tag);
        b.header("Content-Type","application/json").method(method,body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body)));
        var r=client.send(b.build(),HttpResponse.BodyHandlers.ofString());
        return new Response(r.statusCode(),r.body().isEmpty() ? json.nullNode() : json.readTree(r.body()),r.headers().firstValue("Location").orElse(null));
    }
    String account() throws Exception {
        String email="vikash-"+UUID.randomUUID()+"@example.test";
        assertThat(call("POST","/auth/register",null,RegistrationTestSupport.verified(jdbc, Map.of("name","Teste","email",email,"password","test-password")),null).status()).isEqualTo(201);
        return call("POST","/auth/login",null,Map.of("email",email,"password","test-password"),null).body().path("access_token").asString();
    }
    String connect(String token) throws Exception {
        var start=call("POST","/integrations/vikash/authorizations",token,Map.of("platform","web"),null);
        assertThat(start.status()).isEqualTo(200);
        Map<String,String> query=new HashMap<>();
        Arrays.stream(URI.create(start.body().path("authorizationUrl").asString()).getRawQuery().split("&")).forEach(p -> {
            var a=p.split("=",2); query.put(a[0],URLDecoder.decode(a[1],StandardCharsets.UTF_8));
        });
        var result=call("GET","/integrations/vikash/callback?state="+query.get("state")+"&code=fixture-code",null,null,null);
        assertThat(result.status()).isEqualTo(303);
        assertThat(result.location()).isEqualTo("http://127.0.0.1/vikash-return");
        assertThat(Base64.getUrlEncoder().withoutPadding().encodeToString(MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(StandardCharsets.US_ASCII)))).isEqualTo(query.get("code_challenge"));
        assertThat(call("GET","/integrations/vikash/callback?state="+query.get("state")+"&code=fixture-code",null,null,null).status()).isEqualTo(400);
        assertThat(call("GET","/integrations/vikash/catalog",token,null,null).status()).isEqualTo(200);
        return call("GET","/integrations/vikash",token,null,null).body().path("connectionId").asString();
    }
    Map<String,Object> choices() { return Map.of("categoryId","default:1","paymentMethod","PIX","accountId","account","installments",1); }
    Map<String,Object> entry(String connection) {
        var body=new LinkedHashMap<String,Object>();
        body.put("id",UUID.randomUUID().toString()); body.put("occurredAt","2026-10-30T12:00:00-03:00"); body.put("timezone","America/Sao_Paulo");
        body.put("odometerKm",100); body.put("fuelType","ETHANOL"); body.put("liters","10.000"); body.put("unitPrice","5.0000"); body.put("paidTotal","49.00");
        body.put("adjustmentReason","Desconto"); body.put("latitude",-23.55); body.put("longitude",-46.63);
        if (connection != null) body.put("vikash",Map.of("send",true,"connectionId",connection,"choices",choices()));
        return body;
    }
    String vehicle(String token) throws Exception { return call("POST","/vehicles",token,Map.of("nickname","Teste","allowedFuels",List.of("ETHANOL")),null).body().path("id").asString(); }

    @Test void nativeAuthorizationReturnsToTheInstalledAppAfterConsentOrDenial() throws Exception {
        for (String result : List.of("code=fixture-code","error=access_denied")) {
            var start=call("POST","/integrations/vikash/authorizations",account(),Map.of("platform","native"),null);
            assertThat(start.status()).isEqualTo(200);
            assertThat(start.body().path("returnUrl").asString()).isEqualTo("fuellog://vikash-return");
            String query=URI.create(start.body().path("authorizationUrl").asString()).getRawQuery();
            String state=Arrays.stream(query.split("&")).filter(p -> p.startsWith("state=")).findFirst().orElseThrow().substring(6);
            var callback=call("GET","/integrations/vikash/callback?state="+state+"&"+result,null,null,null);
            assertThat(callback.status()).isEqualTo(303);
            assertThat(callback.location()).isEqualTo("fuellog://vikash-return");
        }
    }

    @Test void independentAccountsPkceReplayAndRevocationAreSafe() throws Exception {
        String owner=account(), stranger=account(), connection=connect(owner);
        assertThat(call("GET","/integrations/vikash",stranger,null,null).body().path("status").asString()).isEqualTo("DISCONNECTED");
        assertThat(call("GET","/integrations/vikash/catalog",stranger,null,null).status()).isEqualTo(409);
        assertThat(jdbc.queryForObject("select access_cipher from vikash_connections where id=?",String.class,UUID.fromString(connection))).doesNotContain("fixture-access");
        assertThat(call("DELETE","/integrations/vikash",owner,null,null).status()).isEqualTo(200);
        assertThat(jdbc.queryForObject("select refresh_cipher from vikash_connections where id=?",String.class,UUID.fromString(connection))).isNull();
        assertThat(call("GET","/integrations/vikash",owner,null,null).body().path("status").asString()).isEqualTo("DISCONNECTED");
    }
    @Test void transactionSnapshotsPaidTotalAndReconcilesLostRemoteResponseWithoutDuplicate() throws Exception {
        String token=account(), connection=connect(token), vehicle=vehicle(token), path="/vehicles/"+vehicle+"/fuel-entries";
        var body=entry(connection); UUID id=UUID.fromString((String)body.get("id"));
        var created=call("POST",path,token,body,null); assertThat(created.status()).isEqualTo(201);
        assertThat(created.body().path("vikash").path("status").asString()).isEqualTo("PENDING");
        failWrites=1; integration.process(id);
        assertThat(call("GET",path+"/"+id,token,null,null).body().path("vikash").path("status").asString()).isEqualTo("ERROR");
        integration.process(id);
        assertThat(received).hasSize(1); assertThat(puts.get()).isEqualTo(1);
        var sent=received.values().iterator().next(); assertThat(sent.path("amount").decimalValue()).isEqualByComparingTo("49.00");
        assertThat(sent.has("latitude")).isFalse(); assertThat(sent.has("longitude")).isFalse();
        assertThat(call("GET",path+"/"+id,token,null,null).body().path("vikash").path("status").asString()).isEqualTo("SENT");
        assertThat(call("POST",path,token,body,null).status()).isEqualTo(200);
        body.put("vikash",Map.of("send",false)); assertThat(call("POST",path,token,body,null).status()).isEqualTo(409);
        assertThat(puts.get()).isEqualTo(1);
    }
    @Test void disconnectedLegacyWritesRemainValidAndFinancialFailureRollsBackIntentWithPurchase() throws Exception {
        String token=account(), vehicle=vehicle(token), path="/vehicles/"+vehicle+"/fuel-entries";
        assertThat(call("POST",path,token,entry(null),null).status()).isEqualTo(201);
        var invalid=entry(UUID.randomUUID().toString()); invalid.put("occurredAt","2026-10-31T12:00:00-03:00"); invalid.put("odometerKm",200);
        assertThat(call("POST",path,token,invalid,null).status()).isEqualTo(409);
        assertThat(jdbc.queryForObject("select count(*) from fuel_entries where id=?",Integer.class,UUID.fromString((String)invalid.get("id")))).isZero();
    }
    @Test void overwriteApprovesOnlyReviewedEtagAndNextLocalEditKeepsVersionIncreasing() throws Exception {
        String token=account(), connection=connect(token), path="/vehicles/"+vehicle(token)+"/fuel-entries";
        var body=entry(connection); UUID id=UUID.fromString((String)body.get("id"));
        assertThat(call("POST",path,token,body,null).status()).isEqualTo(201); integration.process(id);
        var edit=new LinkedHashMap<>(body); edit.remove("id"); edit.put("paidTotal","48.00");
        assertThat(call("PUT",path+"/"+id,token,edit,"\"0\"").status()).isEqualTo(200);
        manual=true; integration.process(id);
        assertThat(jdbc.queryForObject("select status from vikash_sync where entry_id=?",String.class,id)).isEqualTo("ACTION_REQUIRED");
        int writes=puts.get(); integration.process(id); assertThat(puts.get()).isEqualTo(writes);
        assertThat(call("POST","/integrations/vikash/entries/"+id+"/retry",token,Map.of("resolution","RETRY"),null).status()).isEqualTo(409);
        var preview=call("GET","/integrations/vikash/entries/"+id+"/remote",token,null,null).body();
        assertThat(call("POST","/integrations/vikash/entries/"+id+"/retry",token,Map.of("resolution","OVERWRITE","remoteEtag",preview.path("etag").asString()),null).status()).isEqualTo(204);
        integration.process(id);
        long approvedVersion=received.values().iterator().next().path("version").asLong();
        assertThat(approvedVersion).isEqualTo(3);
        assertThat(jdbc.queryForObject("select status from vikash_sync where entry_id=?",String.class,id)).isEqualTo("SENT");
        edit.put("paidTotal","47.00"); assertThat(call("PUT",path+"/"+id,token,edit,"\"1\"").status()).isEqualTo(200);
        integration.process(id);
        assertThat(received.values().iterator().next().path("version").asLong()).isEqualTo(4);
    }
    @Test void defaultsAreSnapshotsAndRemoteOutageNeverPreventsLocalSave() throws Exception {
        String token=account(), connection=connect(token), path="/vehicles/"+vehicle(token)+"/fuel-entries";
        assertThat(call("PUT","/integrations/vikash/preferences",token,Map.of("automaticSend",true,"choices",choices()),null).status()).isEqualTo(200);
        catalogUnavailable=true;
        var body=entry(null); UUID id=UUID.fromString((String)body.get("id"));
        assertThat(call("POST",path,token,body,null).status()).isEqualTo(201);
        integration.process(id); assertThat(jdbc.queryForObject("select status from vikash_sync where entry_id=?",String.class,id)).isEqualTo("ERROR");
        catalogUnavailable=false;
        var credit=Map.of("categoryId","default:1","paymentMethod","CREDIT_CARD","cardId","card","installments",3);
        assertThat(call("PUT","/integrations/vikash/preferences",token,Map.of("automaticSend",true,"choices",credit),null).status()).isEqualTo(200);
        assertThat(call("GET",path+"/"+id,token,null,null).body().path("vikash").path("choices").path("paymentMethod").asString()).isEqualTo("PIX");
        integration.process(id); assertThat(received.values().iterator().next().path("amount").decimalValue()).isEqualByComparingTo("49.00");
        assertThat(call("POST",path,token,body,null).status()).isEqualTo(200);
        assertThat(jdbc.queryForObject("select connection_id from vikash_sync where entry_id=?",UUID.class,id)).isEqualTo(UUID.fromString(connection));
    }
    @Test void revokedExpiredLinksAndOtherOwnersCannotDispatchOrMoveSnapshotsToNewLink() throws Exception {
        String token=account(), stranger=account(), connection=connect(token), path="/vehicles/"+vehicle(token)+"/fuel-entries";
        var body=entry(connection); UUID id=UUID.fromString((String)body.get("id")); assertThat(call("POST",path,token,body,null).status()).isEqualTo(201);
        assertThat(call("GET","/integrations/vikash/entries/"+id+"/remote",stranger,null,null).status()).isEqualTo(404);
        assertThat(call("POST","/integrations/vikash/entries/"+id+"/retry",stranger,Map.of("resolution","RETRY"),null).status()).isEqualTo(404);
        assertThat(call("DELETE","/integrations/vikash",token,null,null).status()).isEqualTo(200); integration.process(id); assertThat(puts.get()).isZero();
        String next=connect(token); var edit=new LinkedHashMap<>(body); edit.remove("id"); edit.put("vikash",Map.of("send",true,"connectionId",next,"choices",choices()));
        assertThat(call("PUT",path+"/"+id,token,edit,"\"0\"").status()).isEqualTo(409);
        edit.remove("vikash"); assertThat(call("PUT",path+"/"+id,token,edit,"\"0\"").status()).isEqualTo(200); integration.process(id); assertThat(puts.get()).isZero();
        jdbc.update("update vikash_connections set access_expires_at=now()-interval '1 hour' where id=?",UUID.fromString(next)); refreshUnavailable=true;
        assertThat(call("GET","/integrations/vikash/catalog",token,null,null).status()).isEqualTo(409);
        assertThat(call("GET","/integrations/vikash",token,null,null).body().path("status").asString()).isEqualTo("EXPIRED");
        int before=tokenCalls.get(); assertThat(call("GET","/integrations/vikash/catalog",token,null,null).status()).isEqualTo(409); assertThat(tokenCalls.get()).isEqualTo(before);
        assertThat(call("DELETE","/integrations/vikash",token,null,null).body().path("remoteRevoked").asBoolean()).isFalse();
        assertThat(call("DELETE","/integrations/vikash",token,null,null).body().path("remoteRevoked").asBoolean()).isFalse();
    }
    @Test void deleteAfterUncertainWriteReconcilesAndNeverResurrectsPaidPurchases() throws Exception {
        String token=account(), connection=connect(token), path="/vehicles/"+vehicle(token)+"/fuel-entries";
        var body=entry(connection); UUID id=UUID.fromString((String)body.get("id")); assertThat(call("POST",path,token,body,null).status()).isEqualTo(201);
        failWrites=1; integration.process(id);
        assertThat(call("DELETE",path+"/"+id,token,null,"\"0\"").status()).isEqualTo(204);
        financialRestriction=true; integration.process(id);
        assertThat(jdbc.queryForObject("select error_code from vikash_sync where entry_id=?",String.class,id)).isEqualTo("FINANCIAL_RESTRICTION");
        int count=puts.get(); integration.process(id); assertThat(puts.get()).isEqualTo(count);
        assertThat(call("POST",path,token,body,null).status()).isEqualTo(409);
        assertThat(jdbc.queryForObject("select operation from vikash_sync where entry_id=?",String.class,id)).isEqualTo("DELETE");
        var visible=call("GET","/integrations/vikash/deletions",token,null,null).body();
        assertThat(visible.path("items").get(0).path("code").asString()).isEqualTo("FINANCIAL_RESTRICTION");
        assertThat(call("GET","/integrations/vikash/deletions",account(),null,null).body().path("items").isEmpty()).isTrue();
        assertThat(call("GET","/integrations/vikash/deletions?page=-1",token,null,null).status()).isEqualTo(400);
        call("DELETE","/integrations/vikash",token,null,null);
        assertThat(call("GET","/integrations/vikash/deletions",token,null,null).body().path("items").get(0).path("code").asString()).isEqualTo("LINK_REVOKED");
    }
    @Test void incompleteInputsExpiredStateAndCancelledCallbackReturnControlledErrors() throws Exception {
        String token=account();
        assertThat(call("POST","/integrations/vikash/authorizations",token,Map.of(),null).status()).isEqualTo(422);
        call("POST","/integrations/vikash/authorizations",token,Map.of("platform","web"),null);
        jdbc.update("update vikash_authorizations set expires_at=now()-interval '1 second'");
        assertThat(call("GET","/integrations/vikash/callback?state=invalid&code=x",null,null,null).status()).isEqualTo(400);
        String connection=connect(token), path="/vehicles/"+vehicle(token)+"/fuel-entries";
        var body=entry(connection); assertThat(call("POST",path,token,body,null).status()).isEqualTo(201);
        assertThat(call("POST","/integrations/vikash/entries/"+body.get("id")+"/retry",token,Map.of(),null).status()).isEqualTo(422);
    }
    @Test void cancellingAfterStateConsumptionInvalidatesCallbackBeforeTokenExchange() throws Exception { interruptedCallback(false); }
    @Test void replacingAfterStateConsumptionInvalidatesOldCallbackBeforeTokenExchange() throws Exception { interruptedCallback(true); }
    private void interruptedCallback(boolean replace) throws Exception {
        String token=account();
        var start=call("POST","/integrations/vikash/authorizations",token,Map.of("platform","web"),null);
        String query=URI.create(start.body().path("authorizationUrl").asString()).getRawQuery();
        String state=Arrays.stream(query.split("&")).filter(p -> p.startsWith("state=")).findFirst().orElseThrow().substring(6);
        var consumed=new CountDownLatch(1); var resume=new CountDownLatch(1); var first=new java.util.concurrent.atomic.AtomicBoolean(true);
        doAnswer(invocation -> {
            boolean valid=(boolean)invocation.callRealMethod();
            if (first.getAndSet(false)) { consumed.countDown(); assertThat(resume.await(10,TimeUnit.SECONDS)).isTrue(); }
            return valid;
        }).when(store).sessionValid(any(UUID.class),any(UUID.class),any(Instant.class));
        try (var executor=Executors.newSingleThreadExecutor()) {
            var callback=executor.submit(() -> call("GET","/integrations/vikash/callback?state="+state+"&code=fixture-code",null,null,null));
            assertThat(consumed.await(10,TimeUnit.SECONDS)).isTrue();
            assertThat(call(replace ? "POST" : "DELETE","/integrations/vikash/authorizations",token,replace ? Map.of("platform","web") : null,null).status()).isEqualTo(replace ? 200 : 204);
            resume.countDown(); assertThat(callback.get(10,TimeUnit.SECONDS).status()).isEqualTo(400);
            assertThat(tokenCalls.get()).isZero();
        } finally { resume.countDown(); }
    }
    @Test void successfulCancellationHasDistinctConfirmationAndCannotResurrect() throws Exception {
        String token=account(), connection=connect(token), path="/vehicles/"+vehicle(token)+"/fuel-entries";
        var body=entry(connection); UUID id=UUID.fromString((String)body.get("id")); call("POST",path,token,body,null); integration.process(id);
        assertThat(call("DELETE",path+"/"+id,token,null,"\"0\"").status()).isEqualTo(204); integration.process(id); integration.process(id);
        var deletion=call("GET","/integrations/vikash/deletions",token,null,null).body().path("items").get(0);
        assertThat(deletion.path("status").asString()).isEqualTo("CANCELLED");
        assertThat(deletion.path("code").asString()).isEqualTo("CANCELLATION_CONFIRMED");
        assertThat(puts.get()).isEqualTo(1);
        assertThat(call("POST",path,token,body,null).status()).isEqualTo(409);
    }
}
