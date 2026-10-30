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
class FuelEntryEditingIT {
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

    @Test void getPutGetKeepsIdentityPrecisionGpsAndOriginalPostIdempotency() throws Exception {
        String access=account(), vehicle=vehicle(access);
        var original=entry("2026-10-10T12:00:00Z",100);
        String route=create(access,vehicle,original);
        var before=get(access,route);
        String hash=jdbc.queryForObject("select create_request_hash from fuel_entries where id=?",String.class,id(original));
        var update=update(original); update.put("liters","10.123"); update.put("unitPrice","6.1234");
        update.put("paidTotal","60.00"); update.put("adjustmentReason"," desconto "); update.put("notes","Corrigido");
        var edited=put(access,route,before.etag(),update);
        assertThat(edited.status()).as("%s",edited.body()).isEqualTo(200);
        assertThat(edited.etag()).isNotEqualTo(before.etag());
        assertThat(edited.body().path("id").asString()).isEqualTo(original.get("id"));
        assertThat(edited.body().path("vehicleId").asString()).isEqualTo(vehicle);
        assertThat(edited.body().path("liters").asString()).isEqualTo("10.123");
        assertThat(edited.body().path("unitPrice").asString()).isEqualTo("6.1234");
        assertThat(edited.body().path("paidTotal").asString()).isEqualTo("60.00");
        assertThat(edited.body().path("referenceTotal").asString()).isEqualTo("61.99");
        assertThat(edited.body().path("adjustmentAmount").asString()).isEqualTo("-1.99");
        assertThat(edited.body().path("adjustmentReason").asString()).isEqualTo("desconto");
        assertThat(edited.body().path("latitude")).isEqualTo(before.body().path("latitude"));
        assertThat(get(access,route).body()).isEqualTo(edited.body());
        assertThat(jdbc.queryForObject("select create_request_hash from fuel_entries where id=?",String.class,id(original))).isEqualTo(hash);
        var replay=request("POST",path(vehicle),access,null,original);
        assertThat(replay.status()).isEqualTo(200);
        assertThat(replay.body().path("idempotentReplay").asBoolean()).isTrue();
        assertThat(replay.body().path("notes").asString()).isEqualTo("Corrigido");
        assertThat(replay.etag()).isEqualTo(edited.etag());
        var changedPost=new LinkedHashMap<>(original); changedPost.put("paidTotal","59.99");
        assertThat(request("POST",path(vehicle),access,null,changedPost).status()).isEqualTo(409);
        assertThat(put(access,route,before.etag(),update).status()).isEqualTo(412);
        var unchanged=put(access,route,edited.etag(),update);
        assertThat(unchanged.status()).isEqualTo(200);
        assertThat(unchanged.etag()).isNotEqualTo(edited.etag());
        assertThat(get(access,path(vehicle)).body().path("totalElements").asInt()).isEqualTo(1);
    }

    @Test void centralAuthenticationAndOwnershipProtectBothIdsBeforePreconditions() throws Exception {
        String owner=account(), stranger=account(), vehicle=vehicle(owner), other=vehicle(owner);
        var original=entry("2026-10-10T12:00:00Z",100);
        String route=create(owner,vehicle,original); var input=update(original);
        assertThat(put(null,route,"\"0\"",input).status()).isEqualTo(401);
        assertThat(put(stranger,route,null,input).status()).isEqualTo(404);
        assertThat(put(owner,path(other)+"/"+original.get("id"),null,input).status()).isEqualTo(404);
        assertThat(put(owner,path(vehicle)+"/"+UUID.randomUUID(),null,input).status()).isEqualTo(404);
        assertThat(put(owner,path(UUID.randomUUID().toString())+"/"+original.get("id"),null,input).status()).isEqualTo(404);
        assertThat(get(owner,route).etag()).isEqualTo("\"0\"");
    }

    @Test void missingMalformedAndStaleEtagsNeverOverwrite() throws Exception {
        String access=account(), vehicle=vehicle(access);
        var original=entry("2026-10-10T12:00:00Z",100); String route=create(access,vehicle,original);
        var input=update(original); input.put("notes","must not persist");
        assertThat(put(access,route,null,input).body().path("code").asString()).isEqualTo("PRECONDITION_REQUIRED");
        assertThat(put(access,route,null,input).status()).isEqualTo(428);
        for (String tag:List.of("0","W/\"0\"","*","\"-1\"","\"00\"","\"0\", \"1\"","\"9223372036854775808\"")) {
            var result=put(access,route,tag,input);
            assertThat(result.status()).as(tag).isEqualTo(400);
            assertThat(result.body().path("code").asString()).isEqualTo("INVALID_IF_MATCH");
        }
        var stale=put(access,route,"\"1\"",input);
        assertThat(stale.status()).isEqualTo(412);
        assertThat(stale.body().path("code").asString()).isEqualTo("PRECONDITION_FAILED");
        assertThat(get(access,route).body().path("notes").isNull()).isTrue();
        assertThat(get(access,route).etag()).isEqualTo("\"0\"");
    }

    @Test void updateValidatesMoneyTimeFuelAndStrictInputWithoutRounding() throws Exception {
        String access=account(), vehicle=vehicle(access);
        var original=entry("2026-10-10T12:00:00Z",100); String route=create(access,vehicle,original);
        for (var invalid:List.of(Map.entry("liters","10.0000"),Map.entry("unitPrice","6.00000"),
                Map.entry("paidTotal","60.000"),Map.entry("liters","10000000"),Map.entry("liters","0"),
                Map.entry("paidTotal","59.94"),Map.entry("timezone","Invalid/Zone"),
                Map.entry("occurredAt",Instant.now().plusSeconds(600).toString()),Map.entry("fuelType","DIESEL_S10"))) {
            var input=update(original); input.put(invalid.getKey(),invalid.getValue());
            assertThat(put(access,route,"\"0\"",input).status()).as(invalid.toString()).isEqualTo(422);
        }
        for (var invalid:List.of(Map.entry("liters",10),Map.entry("unitPrice",6),Map.entry("paidTotal",60),
                Map.entry("odometerKm",1.5),Map.entry("odometerKm","100"),Map.entry("latitude","0"))) {
            var input=update(original); input.put(invalid.getKey(),invalid.getValue());
            var rejected=put(access,route,"\"0\"",input);
            assertThat(rejected.status()).as(invalid.toString()).isEqualTo(400);
            assertThat(rejected.body().path("code").asString()).isEqualTo("INVALID_REQUEST");
            assertThat(rejected.body().path("fieldErrors").isObject()).isTrue();
        }
        var invalidOdometer=update(original); invalidOdometer.put("odometerKm",-1);
        assertThat(put(access,route,"\"0\"",invalidOdometer).status()).isEqualTo(422);
        var tolerance=update(original); tolerance.put("paidTotal","59.95");
        assertThat(put(access,route,"\"0\"",tolerance).status()).isEqualTo(422);
        tolerance.put("adjustmentReason","Desconto");
        assertThat(put(access,route,"\"0\"",tolerance).status()).isEqualTo(200);
        var malformedPost=new LinkedHashMap<>(original); malformedPost.put("id",UUID.randomUUID().toString()); malformedPost.put("liters",10);
        var rejectedPost=request("POST",path(vehicle),access,null,malformedPost);
        assertThat(rejectedPost.status()).isEqualTo(400);
        assertThat(rejectedPost.body().path("code").asString()).isEqualTo("INVALID_REQUEST");
        assertThat(rejectedPost.body().path("fieldErrors").isObject()).isTrue();
    }

    @Test void newDateAndOdometerUseNeighborsExcludingTheEditedEntry() throws Exception {
        String access=account(), vehicle=vehicle(access);
        var first=entry("2026-10-10T12:00:00Z",100);
        var middle=entry("2026-10-12T12:00:00Z",200);
        var last=entry("2026-10-14T12:00:00Z",300);
        String firstRoute=create(access,vehicle,first), middleRoute=create(access,vehicle,middle), lastRoute=create(access,vehicle,last);
        var beforeFirst=get(access,firstRoute).body(); var beforeLast=get(access,lastRoute).body();
        var input=update(middle); input.put("odometerKm",99);
        assertThat(put(access,middleRoute,"\"0\"",input).status()).isEqualTo(422);
        input.put("odometerKm",301);
        assertThat(put(access,middleRoute,"\"0\"",input).status()).isEqualTo(422);
        input.put("odometerKm",200); input.put("occurredAt","2026-10-15T12:00:00Z");
        assertThat(put(access,middleRoute,"\"0\"",input).status()).isEqualTo(422);
        input.put("odometerKm",350);
        var moved=put(access,middleRoute,"\"0\"",input);
        assertThat(moved.status()).isEqualTo(200);
        input.put("occurredAt","2026-10-09T12:00:00Z"); input.put("odometerKm",50);
        var movedBack=put(access,middleRoute,moved.etag(),input);
        assertThat(movedBack.status()).isEqualTo(200);
        input.put("odometerKm",60);
        assertThat(put(access,middleRoute,movedBack.etag(),input).status()).isEqualTo(200);
        assertThat(get(access,path(vehicle)).body().path("items").get(2).path("id").asString()).isEqualTo(middle.get("id"));
        assertThat(get(access,firstRoute).body()).isEqualTo(beforeFirst);
        assertThat(get(access,lastRoute).body()).isEqualTo(beforeLast);
    }

    @Test void tiesPreserveExistingPartialFullAndGapRules() throws Exception {
        String access=account(), vehicle=vehicle(access);
        var first=entry("2026-10-10T12:00:00Z",100);
        var second=entry("2026-10-11T12:00:00Z",100);
        first.put("tankState","PARTIAL"); second.put("tankState","PARTIAL");
        create(access,vehicle,first); String route=create(access,vehicle,second);
        var input=update(second); input.put("occurredAt",first.get("occurredAt"));
        var tied=put(access,route,"\"0\"",input); assertThat(tied.status()).isEqualTo(200);
        for (var invalid:List.of(Map.entry("tankState","FULL"),Map.entry("historyGapBefore",true),Map.entry("odometerKm",101))) {
            var changed=new LinkedHashMap<>(input); changed.put(invalid.getKey(),invalid.getValue());
            var rejected=put(access,route,tied.etag(),changed);
            assertThat(rejected.status()).isEqualTo(422);
            assertThat(rejected.body().path("fieldErrors").has("occurredAt")).isTrue();
        }
    }

    @Test void concurrentPutsHaveOneWinnerAndCreateSharesTheVehicleLock() throws Exception {
        String access=account(), vehicle=vehicle(access);
        var original=entry("2026-10-10T12:00:00Z",100); String route=create(access,vehicle,original);
        var a=update(original); a.put("notes","A"); var b=update(original); b.put("notes","B");
        assertThat(parallel(()->put(access,route,"\"0\"",a).status(),()->put(access,route,"\"0\"",b).status()))
            .containsExactlyInAnyOrder(200,412);
        assertThat(get(access,route).body().path("version").asLong()).isEqualTo(1);
        var edited=update(original); edited.put("odometerKm",300);
        var inserted=entry("2026-10-11T12:00:00Z",200);
        assertThat(parallel(()->put(access,route,"\"1\"",edited).status(),
            ()->request("POST",path(vehicle),access,null,inserted).status()))
            .containsAnyOf(200,201).contains(422);
        var history=get(access,path(vehicle)).body().path("items");
        if (history.size()==2) {
            assertThat(history.get(0).path("odometerKm").asInt()).isEqualTo(200);
            assertThat(history.get(1).path("odometerKm").asInt()).isEqualTo(100);
        } else assertThat(history.get(0).path("odometerKm").asInt()).isEqualTo(300);
    }

    @Test void metricsAndConsumptionRecalculateFromEditedMoneyVolumeTankAndGap() throws Exception {
        String access=account(), vehicle=vehicle(access);
        create(access,vehicle,entry("2026-10-10T12:00:00Z",10000));
        var partial=entry("2026-10-12T12:00:00Z",10200); partial.put("tankState","PARTIAL");
        String route=create(access,vehicle,partial);
        create(access,vehicle,entry("2026-10-14T12:00:00Z",10500));
        String summary="/vehicles/"+vehicle+"/summary";
        assertThat(get(access,summary).body().path("periodConsumptionKmPerLiter").asString()).isEqualTo("25.00");
        var input=update(partial); input.put("liters","20"); input.put("paidTotal","120");
        var edited=put(access,route,"\"0\"",input); assertThat(edited.status()).isEqualTo(200);
        var metrics=get(access,summary).body();
        assertThat(metrics.path("paidTotal").asString()).isEqualTo("240.00");
        assertThat(metrics.path("purchasedLiters").asString()).isEqualTo("40.000");
        assertThat(metrics.path("cycleLiters").asString()).isEqualTo("30.000");
        assertThat(metrics.path("periodConsumptionKmPerLiter").asString()).isEqualTo("16.67");
        input.put("historyGapBefore",true);
        var gap=put(access,route,edited.etag(),input); assertThat(gap.status()).isEqualTo(200);
        assertThat(get(access,summary).body().path("periodConsumptionKmPerLiter").isNull()).isTrue();
        input.put("historyGapBefore",false); input.put("tankState","FULL");
        assertThat(put(access,route,gap.etag(),input).status()).isEqualTo(200);
        assertThat(get(access,summary).body().path("validCycleCount").asInt()).isEqualTo(2);
    }

    @Test void historicalCorrectionsPreserveLegacyGpsAndDoNotConsumePendingGap() throws Exception {
        String access=account(), vehicle=vehicle(access);
        var original=entry("2026-10-10T12:00:00Z",100); String route=create(access,vehicle,original);
        jdbc.update("update fuel_entries set latitude=null,longitude=null where id=?",id(original));
        jdbc.update("update vehicles set archived_at=now(),pending_history_gap_after='2026-10-09T12:00:00Z' where id=?",UUID.fromString(vehicle));
        var input=update(original); input.put("notes","Histórico");
        var edited=put(access,route,"\"0\"",input); assertThat(edited.status()).isEqualTo(200);
        assertThat(edited.body().path("latitude").isNull()).isTrue();
        assertThat(edited.body().path("longitude").isNull()).isTrue();
        assertThat(edited.body().path("historyGapBefore").asBoolean()).isFalse();
        assertThat(jdbc.queryForObject("select pending_history_gap_after is not null from vehicles where id=?",Boolean.class,UUID.fromString(vehicle))).isTrue();
    }

    @Test void replacingHistoricalGpsRequiresAValidPairAndNullPreservesIt() throws Exception {
        String access=account(), vehicle=vehicle(access);
        var original=entry("2026-10-10T12:00:00Z",100); String route=create(access,vehicle,original);
        for (Map<String,Object> pair:List.of(Map.<String,Object>of("latitude",0),Map.<String,Object>of("latitude",91,"longitude",0),
                Map.<String,Object>of("latitude",0,"longitude",181),Map.<String,Object>of("latitude",new BigDecimal("0.00000001"),"longitude",0))) {
            var input=update(original); input.putAll(pair);
            assertThat(put(access,route,"\"0\"",input).status()).isEqualTo(422);
        }
        var input=update(original); input.put("latitude",0); input.put("longitude",0);
        var edited=put(access,route,"\"0\"",input); assertThat(edited.status()).isEqualTo(200);
        assertThat(edited.body().path("latitude").asDouble()).isZero();
        input.put("latitude",null); input.put("longitude",null);
        var preserved=put(access,route,edited.etag(),input);
        assertThat(preserved.status()).isEqualTo(200);
        assertThat(preserved.body().path("latitude").asDouble()).isZero();
        assertThat(preserved.body().path("longitude").asDouble()).isZero();
    }

    @Test void historicalFuelCanRemainAfterAllowedFuelsChangeButNewSelectionMustBeAllowed() throws Exception {
        String access=account(), vehicle=vehicle(access);
        var original=entry("2026-10-10T12:00:00Z",100); String route=create(access,vehicle,original);
        jdbc.update("delete from vehicle_allowed_fuels where vehicle_id=? and fuel_type='GASOLINE_REGULAR'",UUID.fromString(vehicle));
        var input=update(original); input.put("notes","Corrigir sem mudar combustível histórico");
        var preserved=put(access,route,"\"0\"",input);
        assertThat(preserved.status()).as("%s",preserved.body()).isEqualTo(200);
        assertThat(preserved.body().path("fuelType").asString()).isEqualTo("GASOLINE_REGULAR");
        input.put("fuelType","DIESEL_S10");
        assertThat(put(access,route,preserved.etag(),input).status()).isEqualTo(422);
        input.put("fuelType","ETHANOL");
        var changed=put(access,route,preserved.etag(),input); assertThat(changed.status()).isEqualTo(200);
        input.put("fuelType","GASOLINE_REGULAR");
        assertThat(put(access,route,changed.etag(),input).status()).isEqualTo(422);
        var replay=request("POST",path(vehicle),access,null,original);
        assertThat(replay.status()).isEqualTo(200);
        assertThat(replay.body().path("fuelType").asString()).isEqualTo("ETHANOL");
        var newEntry=entry("2026-10-11T12:00:00Z",200);
        assertThat(request("POST",path(vehicle),access,null,newEntry).status()).isEqualTo(422);
    }

    @Test void corsAllowsPutIfMatchAndExposesEtag() throws Exception {
        var preflight=HttpRequest.newBuilder(URI.create(base()+"/api/v1/vehicles/"+UUID.randomUUID()+"/fuel-entries/"+UUID.randomUUID()))
            .header("Origin","http://localhost:8081").header("Access-Control-Request-Method","PUT")
            .header("Access-Control-Request-Headers","Authorization, Content-Type, If-Match").method("OPTIONS",HttpRequest.BodyPublishers.noBody()).build();
        var response=client.send(preflight,HttpResponse.BodyHandlers.ofString());
        assertThat(response.statusCode()).isEqualTo(200);
        assertThat(response.headers().firstValue("Access-Control-Allow-Methods").orElseThrow()).contains("PUT");
        assertThat(response.headers().firstValue("Access-Control-Allow-Headers").orElseThrow()).containsIgnoringCase("If-Match");
        assertThat(response.headers().firstValue("Access-Control-Expose-Headers").orElseThrow()).contains("ETag");
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
        input.put("tankState","FULL"); input.put("historyGapBefore",false);
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
