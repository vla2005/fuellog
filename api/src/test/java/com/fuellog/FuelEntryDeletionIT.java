package com.fuellog;

import static org.assertj.core.api.Assertions.assertThat;

import java.math.BigDecimal;
import java.net.URI;
import java.net.http.*;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.*;
import org.testcontainers.postgresql.PostgreSQLContainer;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
class FuelEntryDeletionIT {
    private static final PostgreSQLContainer postgres=new PostgreSQLContainer("postgres:18-alpine");
    @DynamicPropertySource static void database(DynamicPropertyRegistry properties) {
        postgres.start();
        properties.add("spring.datasource.url",postgres::getJdbcUrl);
        properties.add("spring.datasource.username",postgres::getUsername);
        properties.add("spring.datasource.password",postgres::getPassword);
    }
    @AfterAll static void stopDatabase() { postgres.stop(); }
    @LocalServerPort int port;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    private final HttpClient client=HttpClient.newHttpClient();

    @Test void deletionRequiresOwnerVehicleAndCurrentStrongVersion() throws Exception {
        String access=account(), vehicle=vehicle(access), otherVehicle=vehicle(access), outsider=account();
        var original=entry("2026-10-10T12:00:00Z",100); String route=create(access,vehicle,original);
        assertThat(request("DELETE",route,null,"\"0\"",null).status()).isEqualTo(401);
        assertThat(request("DELETE",route,outsider,"\"0\"",null).status()).isEqualTo(404);
        assertThat(request("DELETE",path(otherVehicle)+"/"+original.get("id"),access,"\"0\"",null).status()).isEqualTo(404);
        assertThat(request("DELETE",route,access,null,null).status()).isEqualTo(428);
        for (String tag:List.of("0","W/\"0\"","*","\"-1\"","\"00\"","\"9223372036854775808\""))
            assertThat(request("DELETE",route,access,tag,null).status()).as(tag).isEqualTo(400);
        var edited=put(access,route,"\"0\"",update(original)); assertThat(edited.status()).isEqualTo(200);
        assertThat(request("DELETE",route,access,"\"0\"",null).status()).isEqualTo(412);
        assertThat(get(access,route).body().path("id").asString()).isEqualTo(original.get("id"));
        var deleted=request("DELETE",route,access,edited.etag(),null);
        assertThat(deleted.status()).isEqualTo(204); assertThat(deleted.body().isNull()).isTrue();
        assertThat(request("GET",route,access,null,null).status()).isEqualTo(404);
        assertThat(request("PUT",route,access,edited.etag(),update(original)).status()).isEqualTo(404);
        assertThat(request("DELETE",route,access,edited.etag(),null).status()).isEqualTo(404);
        assertThat(get(access,path(vehicle)).body().path("totalElements").asInt()).isZero();
        var replay=request("POST",path(vehicle),access,null,original);
        assertThat(replay.status()).isEqualTo(409); assertThat(replay.body().path("code").asString()).isEqualTo("ENTRY_DELETED");
        assertThat(get(access,path(vehicle)).body().path("totalElements").asInt()).isZero();
    }

    @Test void deletingPurchaseRemovesItFromEveryAggregateAfterEditsAndInserts() throws Exception {
        String access=account(), vehicle=vehicle(access);
        create(access,vehicle,entry("2026-10-10T12:00:00Z",100));
        var middle=entry("2026-10-12T12:00:00Z",200);
        String route=create(access,vehicle,middle);
        var end=entry("2026-10-14T12:00:00Z",300); String endRoute=create(access,vehicle,end);
        String summary="/vehicles/"+vehicle+"/summary";
        assertThat(request("DELETE",route,access,"\"0\"",null).status()).isEqualTo(204);
        var metrics=get(access,summary).body();
        assertThat(metrics.path("purchaseCount").asInt()).isEqualTo(2);
        assertThat(metrics.path("paidTotal").asString()).isEqualTo("120.00");
        assertThat(metrics.path("purchasedLiters").asString()).isEqualTo("20.000");
        var input=update(end);
        assertThat(put(access,endRoute,"\"0\"",input).status()).isEqualTo(200);
        var inserted=entry("2026-10-13T12:00:00Z",250); create(access,vehicle,inserted);
        create(access,vehicle,entry("2026-10-16T12:00:00Z",400));
        for (String endpoint:List.of(summary,"/vehicles/"+vehicle+"/dashboard")) {
            var totals=get(access,endpoint).body();
            assertThat(totals.path("purchaseCount").asInt()).isEqualTo(4);
            assertThat(totals.path("paidTotal").asString()).isEqualTo("240.00");
            assertThat(totals.path("purchasedLiters").asString()).isEqualTo("40.000");
        }
    }

    @Test void deletingEveryPurchaseProducesEmptySummaryAndAllowsNewPurchases() throws Exception {
        String access=account(), vehicle=vehicle(access);
        String first=create(access,vehicle,entry("2026-10-10T12:00:00Z",100));
        String middle=create(access,vehicle,entry("2026-10-12T12:00:00Z",200));
        String last=create(access,vehicle,entry("2026-10-14T12:00:00Z",300));
        assertThat(request("DELETE",middle,access,"\"0\"",null).status()).isEqualTo(204);
        String summary="/vehicles/"+vehicle+"/summary";
        assertThat(request("DELETE",last,access,"\"0\"",null).status()).isEqualTo(204);
        assertThat(request("DELETE",first,access,"\"0\"",null).status()).isEqualTo(204);
        assertThat(get(access,summary).body().path("purchaseCount").asInt()).isZero();
        create(access,vehicle,entry("2026-10-16T12:00:00Z",400));
        assertThat(get(access,summary).body().path("purchaseCount").asInt()).isEqualTo(1);
        create(access,vehicle,entry("2026-10-18T12:00:00Z",500));
        assertThat(get(access,summary).body().path("purchaseCount").asInt()).isEqualTo(2);
        assertThat(get(access,"/vehicles/"+vehicle+"/dashboard").body().path("prices").size()).isEqualTo(2);
    }

    @Test void concurrentDeleteAndPutCannotBothAcceptTheSameVersion() throws Exception {
        String access=account(), vehicle=vehicle(access);
        var original=entry("2026-10-10T12:00:00Z",100); String route=create(access,vehicle,original);
        var statuses=parallel(()->request("DELETE",route,access,"\"0\"",null).status(),()->put(access,route,"\"0\"",update(original)).status());
        assertThat(statuses).isIn(List.of(204,404),List.of(412,200));
    }

    @Test void corsAllowsDeleteAndIfMatch() throws Exception {
        var preflight=HttpRequest.newBuilder(URI.create(base()+"/api/v1/vehicles/"+UUID.randomUUID()+"/fuel-entries/"+UUID.randomUUID()))
            .header("Origin","http://localhost:8081").header("Access-Control-Request-Method","DELETE")
            .header("Access-Control-Request-Headers","Authorization, If-Match").method("OPTIONS",HttpRequest.BodyPublishers.noBody()).build();
        var response=client.send(preflight,HttpResponse.BodyHandlers.ofString());
        assertThat(response.statusCode()).isEqualTo(200);
        assertThat(response.headers().firstValue("Access-Control-Allow-Methods").orElseThrow()).contains("DELETE");
        assertThat(response.headers().firstValue("Access-Control-Allow-Headers").orElseThrow()).containsIgnoringCase("If-Match");
    }

    private String account() throws Exception {
        String email=UUID.randomUUID()+"@example.test", password="Only-test-password-42!";
        assertThat(request("POST","/auth/register",null,null,Map.of("name","Teste edição","email",email,"password",password)).status()).isEqualTo(201);
        var login=request("POST","/auth/login",null,null,Map.of("email",email,"password",password));
        assertThat(login.status()).isEqualTo(200); return login.body().path("access_token").asString();
    }
    private String vehicle(String access) throws Exception {
        var result=request("POST","/vehicles",access,null,Map.of("nickname","Teste","allowedFuels",List.of("GASOLINE_REGULAR","ETHANOL")));
        assertThat(result.status()).isEqualTo(201); return result.body().path("id").asString();
    }
    private Map<String,Object> entry(String when, long odometer) {
        var input=new LinkedHashMap<String,Object>();
        input.put("id",UUID.randomUUID().toString()); input.put("occurredAt",when); input.put("timezone","America/Sao_Paulo");
        input.put("odometerKm",odometer); input.put("fuelType","GASOLINE_REGULAR");
        input.put("liters","10"); input.put("unitPrice","6"); input.put("paidTotal","60");
        input.put("latitude",new BigDecimal("-23.55052")); input.put("longitude",new BigDecimal("-46.633308")); return input;
    }
    private Map<String,Object> update(Map<String,Object> original) {
        var input=new LinkedHashMap<>(original); input.remove("id"); input.remove("latitude"); input.remove("longitude"); return input;
    }
    private UUID id(Map<String,Object> input) { return UUID.fromString(input.get("id").toString()); }
    private String create(String access,String vehicle,Map<String,Object> input) throws Exception {
        var result=request("POST",path(vehicle),access,null,input);
        assertThat(result.status()).as("%s",result.body()).isEqualTo(201); return path(vehicle)+"/"+input.get("id");
    }
    private Result get(String access,String route) throws Exception {
        var result=request("GET",route,access,null,null); assertThat(result.status()).as("%s",result.body()).isEqualTo(200); return result;
    }
    private Result put(String access,String route,String tag,Object body) throws Exception { return request("PUT",route,access,tag,body); }
    private Result request(String method,String path,String access,String tag,Object body) throws Exception {
        var builder=HttpRequest.newBuilder(URI.create(base()+"/api/v1"+path)).header("Accept","application/json");
        if (access!=null) builder.header("Authorization","Bearer "+access);
        if (tag!=null) builder.header("If-Match",tag);
        if (body!=null) builder.header("Content-Type","application/json");
        builder.method(method,body==null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body)));
        var response=client.send(builder.build(),HttpResponse.BodyHandlers.ofString());
        return new Result(response.statusCode(),response.body().isBlank() ? json.nullNode() : json.readTree(response.body()),response.headers().firstValue("ETag").orElse(null));
    }
    @SafeVarargs private final List<Integer> parallel(Callable<Integer>... calls) throws Exception {
        var ready=new CountDownLatch(calls.length); var start=new CountDownLatch(1);
        try (var pool=Executors.newFixedThreadPool(calls.length)) {
            var futures=new ArrayList<Future<Integer>>();
            for (var call:calls) futures.add(pool.submit(()->{ ready.countDown(); start.await(); return call.call(); }));
            assertThat(ready.await(10,TimeUnit.SECONDS)).isTrue(); start.countDown();
            var statuses=new ArrayList<Integer>(); for (var future:futures) statuses.add(future.get(30,TimeUnit.SECONDS)); return statuses;
        }
    }
    private String path(String vehicle) { return "/vehicles/"+vehicle+"/fuel-entries"; }
    private String base() { return "http://127.0.0.1:"+port; }
    private record Result(int status,JsonNode body,String etag) {}
}
