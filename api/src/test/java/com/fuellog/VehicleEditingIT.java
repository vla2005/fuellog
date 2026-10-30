package com.fuellog;

import static org.assertj.core.api.Assertions.assertThat;

import java.math.BigDecimal;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.AfterAll;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.postgresql.PostgreSQLContainer;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
class VehicleEditingIT {
    private static final PostgreSQLContainer database=new PostgreSQLContainer("postgres:18-alpine");
    @DynamicPropertySource static void database(DynamicPropertyRegistry properties) {
        database.start();
        properties.add("spring.datasource.url",database::getJdbcUrl);
        properties.add("spring.datasource.username",database::getUsername);
        properties.add("spring.datasource.password",database::getPassword);
    }
    @AfterAll static void stopDatabase() { database.stop(); }
    private static final String PASSWORD="Only-test-password-42!";
    private final HttpClient client=HttpClient.newHttpClient();
    @LocalServerPort int port;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    @Autowired javax.sql.DataSource dataSource;

    @Test void editsPersistWithSameIdentityAndPreserveLegacyFieldsHistoryAndMetrics() throws Exception {
        String token=account();
        var created=vehicle(token);
        String route="/vehicles/"+created.body().path("id").asString();
        UUID id=UUID.fromString(created.body().path("id").asString());
        var original=jdbc.queryForMap("select user_id,created_at,brand,model_year,plate from vehicles where id=?",id);
        var first=request("POST",route+"/fuel-entries",token,entry("2026-10-01T12:00:00Z",10000),null);
        var last=request("POST",route+"/fuel-entries",token,entry("2026-10-02T12:00:00Z",10400),null);
        assertThat(first.status()).as("%s",first.body()).isEqualTo(201);
        assertThat(last.status()).as("%s",last.body()).isEqualTo(201);
        var history=jdbc.queryForList("select * from fuel_entries where vehicle_id=? order by occurred_at",id);
        var firstPersisted=request("GET",route+"/fuel-entries/"+first.body().path("id").asString(),token,null,null).body();
        var summary=request("GET",route+"/summary",token,null,null).body();
        var edit=request("PUT",route,token,update("  Novo modelo  "),created.etag());
        assertThat(edit.status()).as("%s",edit.body()).isEqualTo(200);
        assertThat(edit.body().path("id")).isEqualTo(created.body().path("id"));
        assertThat(edit.body().path("model").asString()).isEqualTo("Novo modelo");
        assertThat(edit.body().path("nickname").asString()).isEqualTo("Novo modelo");
        assertThat(edit.body().path("tankCapacityLiters").asString()).isEqualTo("55.123");
        assertThat(edit.body().path("currentOdometerKm").asLong()).isEqualTo(0);
        assertThat(edit.etag()).isEqualTo("\""+edit.body().path("version").asLong()+"\"").isNotEqualTo(created.etag());
        assertThat(request("GET",route,token,null,null).body()).isEqualTo(edit.body());
        assertThat(request("GET","/vehicles",token,null,null).body().get(0)).isEqualTo(edit.body());
        assertThat(jdbc.queryForMap("select user_id,created_at,brand,model_year,plate from vehicles where id=?",id)).isEqualTo(original);
        assertThat(jdbc.queryForObject("select tank_capacity_liters from vehicles where id=?",BigDecimal.class,id)).isEqualByComparingTo("55.123");
        assertThat(jdbc.queryForList("select * from fuel_entries where vehicle_id=? order by occurred_at",id)).isEqualTo(history);
        assertThat(request("GET",route+"/summary",token,null,null).body()).isEqualTo(summary);
        assertThat(request("GET",route+"/fuel-entries/"+first.body().path("id").asString(),token,null,null).body()).isEqualTo(firstPersisted);
        var rejected=request("POST",route+"/fuel-entries",token,entry("2026-10-03T12:00:00Z",10800),null);
        assertThat(rejected.status()).isEqualTo(422);
        assertThat(rejected.body().path("fieldErrors").has("fuelType")).isTrue();
        var ethanol=entry("2026-10-03T12:00:00Z",10800); ethanol.put("fuelType","ETHANOL");
        assertThat(request("POST",route+"/fuel-entries",token,ethanol,null).status()).isEqualTo(201);
        var cleared=request("PUT",route,token,Map.of("model","Novo modelo","allowedFuels",List.of("ETHANOL")),edit.etag());
        assertThat(cleared.status()).isEqualTo(200);
        assertThat(cleared.body().path("tankCapacityLiters").isNull()).isTrue();
        assertThat(cleared.body().path("currentOdometerKm").isNull()).isTrue();
        var unchanged=request("PUT",route,token,Map.of("model","Novo modelo","allowedFuels",List.of("ETHANOL")),cleared.etag());
        assertThat(unchanged.status()).isEqualTo(200);
        assertThat(unchanged.etag()).isNotEqualTo(cleared.etag());
    }

    @Test void enforcesAuthenticationOwnershipAndPreconditionsWithoutChangingData() throws Exception {
        String token=account(),stranger=account(); var created=vehicle(token);
        String route="/vehicles/"+created.body().path("id").asString();
        assertThat(request("PUT",route,null,update("X"),created.etag()).status()).isEqualTo(401);
        assertThat(request("PUT",route,"invalid",update("X"),created.etag()).status()).isEqualTo(401);
        for (String etag : new String[]{null,"\"0\"","\"999\"","invalid"})
            assertThat(request("PUT",route,stranger,update("X"),etag).status()).isEqualTo(404);
        assertThat(request("PUT","/vehicles/"+UUID.randomUUID(),token,update("X"),created.etag()).status()).isEqualTo(404);
        assertProblem(request("PUT",route,token,update("X"),null),428,"PRECONDITION_REQUIRED");
        assertProblem(request("PUT",route,token,update("X"),"\"999\""),412,"PRECONDITION_FAILED");
        for (String etag : List.of("0","*","W/\"0\"","\"-1\"","\"01\"","\"0\", \"1\"","\"9223372036854775808\""))
            assertProblem(request("PUT",route,token,update("X"),etag),400,"INVALID_IF_MATCH");
        assertThat(request("GET",route,token,null,null).body()).isEqualTo(created.body());
        var saved=request("PUT",route,token,update("Saved"),created.etag());
        assertThat(saved.status()).isEqualTo(200);
        assertProblem(request("PUT",route,token,update("Stale"),created.etag()),412,"PRECONDITION_FAILED");
        assertThat(request("GET",route,token,null,null).body()).isEqualTo(saved.body());
    }

    @Test void rejectsInvalidFieldsAndStrictJsonTypesWithoutPartialUpdates() throws Exception {
        String token=account(); var created=vehicle(token);
        String route="/vehicles/"+created.body().path("id").asString();
        for (var field : Map.<String,List<?>>of(
                "model",List.of(" ","x".repeat(61)),
                "allowedFuels",List.of(List.of()),
                "currentOdometerKm",List.of(-1L,9007199254740992L),
                "tankCapacityLiters",List.of("0","50.1234","100000","50,1")).entrySet()) {
            for (Object value : field.getValue()) {
                var input=update("Rejected"); input.put(field.getKey(),value);
                var response=request("PUT",route,token,input,created.etag());
                assertProblem(response,422,"VALIDATION_ERROR");
                assertThat(response.body().path("fieldErrors").has(field.getKey())).isTrue();
            }
        }
        for (String field : List.of("model","allowedFuels")) {
            var input=update("Rejected"); input.remove(field);
            assertThat(request("PUT",route,token,input,created.etag()).status()).isEqualTo(422);
            input.put(field,null);
            assertThat(request("PUT",route,token,input,created.etag()).status()).isEqualTo(422);
        }
        for (var field : Map.<String,List<?>>of(
                "currentOdometerKm",List.of(1.0,1.5,"12",true,new java.math.BigInteger("9223372036854775808")),
                "tankCapacityLiters",List.of(55.123,true),
                "allowedFuels",List.of(List.of("UNKNOWN"),List.of(1))).entrySet()) {
            for (Object value : field.getValue()) {
                var input=update("Rejected"); input.put(field.getKey(),value);
                assertProblem(request("PUT",route,token,input,created.etag()),400,"INVALID_REQUEST");
            }
        }
        assertThat(request("GET",route,token,null,null).body()).isEqualTo(created.body());
        var bounds=update("a".repeat(60)); bounds.put("currentOdometerKm",9007199254740991L); bounds.put("tankCapacityLiters","99999.999");
        assertThat(request("PUT",route,token,bounds,created.etag()).status()).isEqualTo(200);
    }

    @Test void simultaneousEditsHaveOneWinnerAndNeverLoseItsData() throws Exception {
        String token=account(); var created=vehicle(token);
        String route="/vehicles/"+created.body().path("id").asString();
        var ready=new CountDownLatch(2); var start=new CountDownLatch(1);
        try (var pool=Executors.newFixedThreadPool(2)) {
            var futures=new ArrayList<java.util.concurrent.Future<Result>>();
            for (String model : List.of("First","Second")) futures.add(pool.submit(()->{
                ready.countDown(); assertThat(start.await(10,TimeUnit.SECONDS)).isTrue();
                return request("PUT",route,token,update(model),created.etag());
            }));
            assertThat(ready.await(10,TimeUnit.SECONDS)).isTrue(); start.countDown();
            Result a=futures.get(0).get(20,TimeUnit.SECONDS),b=futures.get(1).get(20,TimeUnit.SECONDS);
            assertThat(List.of(a.status(),b.status())).containsExactlyInAnyOrder(200,412);
            Result winner=a.status()==200?a:b;
            assertThat(request("GET",route,token,null,null).body()).isEqualTo(winner.body());
        }
    }

    @Test void editsWaitForTheSameVehicleLockUsedByFuelCreation() throws Exception {
        String token=account(); var created=vehicle(token);
        String route="/vehicles/"+created.body().path("id").asString();
        UUID id=UUID.fromString(created.body().path("id").asString());
        try (var connection=dataSource.getConnection(); var pool=Executors.newSingleThreadExecutor()) {
            connection.setAutoCommit(false);
            try (var statement=connection.prepareStatement("select id from vehicles where id=? for update")) {
                statement.setObject(1,id); statement.executeQuery().close();
            }
            var future=pool.submit(()->request("PUT",route,token,update("After lock"),created.etag()));
            try {
                long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(10);
                while (jdbc.queryForObject("select count(*) from pg_stat_activity where datname=current_database() and wait_event_type='Lock'",Integer.class)==0
                        && System.nanoTime()<deadline) Thread.sleep(20);
                assertThat(jdbc.queryForObject("select count(*) from pg_stat_activity where datname=current_database() and wait_event_type='Lock'",Integer.class)).isPositive();
                assertThat(future.isDone()).isFalse();
            } finally { connection.rollback(); }
            assertThat(future.get(20,TimeUnit.SECONDS).status()).isEqualTo(200);
        }
    }

    @Test void corsAllowsConditionalPutAndExposesTheNewEtag() throws Exception {
        var response=client.send(HttpRequest.newBuilder(URI.create(base()+"/vehicles/"+UUID.randomUUID()))
                .header("Origin","http://localhost:8081").header("Access-Control-Request-Method","PUT")
                .header("Access-Control-Request-Headers","authorization,content-type,if-match")
                .method("OPTIONS",HttpRequest.BodyPublishers.noBody()).build(),HttpResponse.BodyHandlers.ofString());
        assertThat(response.statusCode()).isEqualTo(200);
        assertThat(response.headers().firstValue("Access-Control-Allow-Methods").orElseThrow()).contains("PUT");
        assertThat(response.headers().firstValue("Access-Control-Allow-Headers").orElseThrow().toLowerCase()).contains("if-match");
        String token=account(); var created=vehicle(token);
        var edited=request("PUT","/vehicles/"+created.body().path("id").asString(),token,update("CORS"),created.etag());
        assertThat(edited.status()).isEqualTo(200);
        assertThat(edited.response().headers().firstValue("Access-Control-Expose-Headers").orElseThrow()).contains("ETag");
    }

    @Test void errorPrecedenceKeepsStructuredJsonErrorsAndIdentitySecurityHeaders() throws Exception {
        String token=account();
        assertProblem(request("POST","/vehicles",token,Map.of("nickname","Bad type","allowedFuels",List.of("ETHANOL"),"tankCapacityLiters",50),null),400,"INVALID_REQUEST");
        var wrongPassword=request("POST","/auth/login",null,Map.of("email",UUID.randomUUID()+"@example.test","password",PASSWORD),null);
        assertThat(wrongPassword.status()).isEqualTo(401);
        assertThat(wrongPassword.response().headers().firstValue("Cache-Control")).contains("no-store");
        assertThat(wrongPassword.response().headers().firstValue("WWW-Authenticate")).contains("Bearer error=\"invalid_token\"");
        var validation=request("POST","/auth/register",null,Map.of("name","Editor","email","invalid","password",PASSWORD),null);
        assertProblem(validation,422,"VALIDATION_FAILED");
        assertThat(validation.response().headers().firstValue("Cache-Control")).contains("no-store");
        assertThat(validation.body().path("fieldErrors").has("email")).isTrue();
        var noSession=request("GET","/vehicles",null,null,null);
        assertThat(noSession.status()).isEqualTo(401);
        assertThat(noSession.response().headers().firstValue("WWW-Authenticate").orElseThrow()).startsWith("Bearer");
    }

    @Test void migrationUnlinksAcceptedFuelsFromExistingHistoryAndRetainsVehicleForeignKey() {
        String schema="vehicle_edit_"+UUID.randomUUID().toString().replace("-","");
        UUID owner=UUID.randomUUID(),vehicle=UUID.randomUUID(),entry=UUID.randomUUID();
        try {
            org.flywaydb.core.Flyway.configure().dataSource(dataSource).schemas(schema).defaultSchema(schema).target("3").load().migrate();
            jdbc.update("insert into "+schema+".users(id,name,email,password_hash) values (?,'Test',?,'test')",owner,schema+"@example.test");
            jdbc.update("insert into "+schema+".vehicles(id,user_id,nickname) values (?,?,'Legacy')",vehicle,owner);
            jdbc.update("insert into "+schema+".vehicle_allowed_fuels(vehicle_id,fuel_type) values (?,'GASOLINE_REGULAR')",vehicle);
            jdbc.update("insert into "+schema+".fuel_entries(id,vehicle_id,occurred_at,timezone,odometer_km,fuel_type,liters,unit_price,paid_total,tank_state,create_request_hash) "
                    +"values (?,?,now(),'America/Sao_Paulo',10000,'GASOLINE_REGULAR',40,6,240,'FULL',?)",entry,vehicle,"a".repeat(64));
            var history=jdbc.queryForMap("select * from "+schema+".fuel_entries where id=?",entry);
            org.junit.jupiter.api.Assertions.assertThrows(org.springframework.dao.DataIntegrityViolationException.class,
                    ()->jdbc.update("delete from "+schema+".vehicle_allowed_fuels where vehicle_id=?",vehicle));
            var migration=org.flywaydb.core.Flyway.configure().dataSource(dataSource).schemas(schema).defaultSchema(schema).target("4").load();
            assertThat(migration.migrate().migrationsExecuted).isEqualTo(1);
            assertThat(jdbc.update("delete from "+schema+".vehicle_allowed_fuels where vehicle_id=?",vehicle)).isEqualTo(1);
            assertThat(jdbc.queryForMap("select * from "+schema+".fuel_entries where id=?",entry)).isEqualTo(history);
            org.junit.jupiter.api.Assertions.assertThrows(org.springframework.dao.DataIntegrityViolationException.class,
                    ()->jdbc.update("update "+schema+".fuel_entries set vehicle_id=? where id=?",UUID.randomUUID(),entry));
            assertThat(migration.migrate().migrationsExecuted).isZero();
        } finally { jdbc.execute("drop schema if exists "+schema+" cascade"); }
    }

    private void assertProblem(Result result,int status,String code) {
        assertThat(result.status()).as("%s",result.body()).isEqualTo(status);
        assertThat(result.body().path("code").asString()).as("%s",result.body()).isEqualTo(code);
        assertThat(result.body().path("fieldErrors").isObject()).isTrue();
    }
    private String account() throws Exception {
        String email=UUID.randomUUID()+"@example.test";
        assertThat(request("POST","/auth/register",null,Map.of("name","Vehicle editor","email",email,"password",PASSWORD),null).status()).isEqualTo(201);
        var login=request("POST","/auth/login",null,Map.of("email",email,"password",PASSWORD),null);
        assertThat(login.status()).isEqualTo(200); return login.body().path("access_token").asString();
    }
    private Result vehicle(String token) throws Exception {
        var created=request("POST","/vehicles",token,Map.of("nickname","Old nickname","model","Old model","brand","Legacy brand",
                "modelYear",2020,"plate","ABC1D23","currentOdometerKm",15000,"tankCapacityLiters","40.000",
                "allowedFuels",List.of("GASOLINE_REGULAR","ETHANOL")),null);
        assertThat(created.status()).isEqualTo(201); return created;
    }
    private Map<String,Object> update(String model) {
        var value=new LinkedHashMap<String,Object>(); value.put("model",model); value.put("allowedFuels",List.of("ETHANOL"));
        value.put("currentOdometerKm",0L); value.put("tankCapacityLiters","55.123"); return value;
    }
    private Map<String,Object> entry(String occurredAt,long odometer) {
        var value=new LinkedHashMap<String,Object>(); value.put("id",UUID.randomUUID().toString()); value.put("occurredAt",occurredAt);
        value.put("timezone","America/Sao_Paulo"); value.put("odometerKm",odometer); value.put("fuelType","GASOLINE_REGULAR");
        value.put("liters","40"); value.put("unitPrice","6"); value.put("paidTotal","240"); value.put("tankState","FULL");
        value.put("latitude",new BigDecimal("-23.55052")); value.put("longitude",new BigDecimal("-46.633308")); return value;
    }
    private Result request(String method,String path,String token,Object body,String etag) throws Exception {
        var builder=HttpRequest.newBuilder(URI.create(base()+path)).timeout(java.time.Duration.ofSeconds(20))
                .header("Accept","application/json").header("Origin","http://localhost:8081");
        if(token!=null) builder.header("Authorization","Bearer "+token);
        if(etag!=null) builder.header("If-Match",etag);
        if(body!=null) builder.header("Content-Type","application/json");
        builder.method(method,body==null?HttpRequest.BodyPublishers.noBody():HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body)));
        var response=client.send(builder.build(),HttpResponse.BodyHandlers.ofString());
        return new Result(response.statusCode(),json.readTree(response.body()),response);
    }
    private String base() { return "http://127.0.0.1:"+port+"/api/v1"; }
    private record Result(int status,JsonNode body,HttpResponse<String> response) {
        String etag() { return response.headers().firstValue("ETag").orElseThrow(); }
    }
}
