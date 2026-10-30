package com.fuellog;

import com.fuellog.fueling.dtos.FuelEntryDtos;
import com.fuellog.fueling.models.FuelCommand;
import java.math.BigDecimal;
import java.net.URI;
import java.net.http.*;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.*;
import org.testcontainers.postgresql.PostgreSQLContainer;
import tools.jackson.databind.*;
import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
class FuelAmountValidationIT {
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

    @Test void validatesNormalAndDiscountedWritesAndRetainsEtagAndIdempotency() throws Exception {
        String access=account(), path=vehiclePath(access);
        var input=entry("33.333","6.0000","200.00");
        var created=request("POST",path,access,null,input);
        assertThat(created.status()).as("%s",created.body()).isEqualTo(201);
        assertThat(created.body().path("liters").asString()).isEqualTo("33.333");
        assertThat(request("POST",path,access,null,input).body().path("idempotentReplay").asBoolean()).isTrue();
        var update=new LinkedHashMap<>(input); update.remove("id");
        update.put("liters","40"); update.put("paidTotal","230.00"); update.put("adjustmentReason","Desconto");
        String route=path+"/"+input.get("id");
        var discounted=request("PUT",route,access,created.etag(),update);
        assertThat(discounted.status()).as("%s",discounted.body()).isEqualTo(200);
        assertThat(discounted.body().path("paidTotal").asString()).isEqualTo("230.00");
        assertThat(new BigDecimal(discounted.body().path("liters").asString())).isEqualByComparingTo("40.000");
        assertThat(discounted.etag()).isNotEqualTo(created.etag());
        assertThat(request("PUT",route,access,created.etag(),update).status()).isEqualTo(412);
        update.put("paidTotal","240.01");
        assertThat(request("PUT",route,access,discounted.etag(),update).status()).isEqualTo(422);
        update.remove("adjustmentReason"); update.put("paidTotal","240.04");
        assertThat(request("PUT",route,access,discounted.etag(),update).status()).isEqualTo(422);
        assertThat(request("GET",route,access,null,null).body().path("paidTotal").asString()).isEqualTo("230.00");
        var tampered=entry("1","6","6.04");
        assertThat(request("POST",path,access,null,tampered).status()).isEqualTo(422);
        tampered.put("adjustmentReason","Desconto");
        assertThat(request("POST",path,access,null,tampered).status()).isEqualTo(422);
    }

    @Test void migrationAllowsRoundedQuotientAndLegacyDateOnlyEditAndReplay() throws Exception {
        String access=account(), path=vehiclePath(access);
        var high=entry("0.001","999999.9999","500.00");
        assertThat(request("POST",path,access,null,high).status()).isEqualTo(201);
        var old=entry("1","6","6.00");
        var created=request("POST",path,access,null,old);
        assertThat(created.status()).isEqualTo(201);
        old.put("paidTotal","6.04");
        UUID vehicleId=UUID.fromString(path.split("/")[2]);
        var legacyCommand=FuelCommand.normalize(vehicleId,json.readValue(json.writeValueAsString(old),FuelEntryDtos.Create.class));
        // Seed a valid pre-change receipt in this disposable database, including its original fingerprint.
        jdbc.update("update fuel_entries set paid_total=6.04, create_request_hash=? where id=?",legacyCommand.hash(),UUID.fromString(old.get("id").toString()));
        String route=path+"/"+old.get("id");
        var replay=request("POST",path,access,null,old);
        assertThat(replay.status()).isEqualTo(200);
        assertThat(replay.body().path("idempotentReplay").asBoolean()).isTrue();
        var dateOnly=new LinkedHashMap<>(old); dateOnly.remove("id"); dateOnly.put("occurredAt","2026-10-11T12:00:00Z");
        var edited=request("PUT",route,access,created.etag(),dateOnly);
        assertThat(edited.status()).as("%s",edited.body()).isEqualTo(200);
        assertThat(edited.body().path("paidTotal").asString()).isEqualTo("6.04");
        assertThat(edited.body().path("occurredAt").asString()).isEqualTo("2026-10-11T12:00:00Z");
        assertThat(jdbc.queryForObject("select create_request_hash from fuel_entries where id=?",String.class,legacyCommand.id())).isEqualTo(legacyCommand.hash());
        dateOnly.put("paidTotal","6.03");
        assertThat(request("PUT",route,access,edited.etag(),dateOnly).status()).isEqualTo(422);
    }

    private String account() throws Exception {
        String email=UUID.randomUUID()+"@example.test", password="Only-test-password-42!";
        assertThat(request("POST","/auth/register",null,null,Map.of("name","Teste valores","email",email,"password",password)).status()).isEqualTo(201);
        var login=request("POST","/auth/login",null,null,Map.of("email",email,"password",password));
        assertThat(login.status()).isEqualTo(200); return login.body().path("access_token").asString();
    }
    private String vehiclePath(String access) throws Exception {
        var vehicle=request("POST","/vehicles",access,null,Map.of("nickname","Teste valores","allowedFuels",List.of("GASOLINE_REGULAR")));
        assertThat(vehicle.status()).isEqualTo(201);
        return "/vehicles/"+vehicle.body().path("id").asString()+"/fuel-entries";
    }
    private Map<String,Object> entry(String liters,String price,String paid) {
        var input=new LinkedHashMap<String,Object>();
        input.put("id",UUID.randomUUID().toString()); input.put("occurredAt","2026-10-10T12:00:00Z");
        input.put("timezone","America/Sao_Paulo"); input.put("odometerKm",100); input.put("fuelType","GASOLINE_REGULAR");
        input.put("liters",liters); input.put("unitPrice",price); input.put("paidTotal",paid); input.put("tankState","PARTIAL");
        input.put("latitude",BigDecimal.ZERO); input.put("longitude",BigDecimal.ZERO); return input;
    }
    private Result request(String method,String path,String access,String tag,Object body) throws Exception {
        var builder=HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+port+"/api/v1"+path)).header("Accept","application/json");
        if (access!=null) builder.header("Authorization","Bearer "+access);
        if (tag!=null) builder.header("If-Match",tag);
        if (body!=null) builder.header("Content-Type","application/json");
        builder.method(method,body==null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body)));
        var response=client.send(builder.build(),HttpResponse.BodyHandlers.ofString());
        return new Result(response.statusCode(),response.body().isBlank() ? json.nullNode() : json.readTree(response.body()),response.headers().firstValue("ETag").orElse(null));
    }
    private record Result(int status,JsonNode body,String etag) {}
}
