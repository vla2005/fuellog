package com.fuellog;

import static org.assertj.core.api.Assertions.assertThat;

import java.math.BigDecimal;
import java.net.URI;
import java.net.http.*;
import java.util.*;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.*;
import org.testcontainers.postgresql.PostgreSQLContainer;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
class FuelEntryFiltersIT {
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
    private final HttpClient client=HttpClient.newHttpClient();

    @Test void decimalBoundsCombineBeforePaginationAndCountUsingActualPaidTotal() throws Exception {
        String access=account(), vehicle=vehicle(access);
        String first=create(access,vehicle,"2024-02-01T12:00:00Z",100,"10.123","5.1234","40.01","GASOLINE_REGULAR");
        String second=create(access,vehicle,"2024-02-02T12:00:00Z",200,"20.123","6.1234","50.02","GASOLINE_REGULAR");
        create(access,vehicle,"2024-02-03T12:00:00Z",300,"30.123","7.1234","60.03","GASOLINE_REGULAR");
        create(access,vehicle,"2024-02-04T12:00:00Z",400,"15","5.5","45","ETHANOL");
        create(access,vehicle(access),"2024-02-01T12:00:00Z",100,"15","5.5","45","GASOLINE_REGULAR");
        String filters="?from=2024-02-01&to=2024-02-02&timezone=America/Sao_Paulo&fuelType=GASOLINE_REGULAR"
            +"&tankState=FULL&minTotalPaid=40.01&maxTotalPaid=50.02&minLiters=10.123&maxLiters=20.123"
            +"&minPricePerLiter=5.1234&maxPricePerLiter=6.1234&size=1";
        var page=list(access,vehicle,filters);
        assertThat(page.path("totalElements").asInt()).isEqualTo(2);
        assertThat(page.path("totalPages").asInt()).isEqualTo(2);
        assertThat(page.path("items").size()).isEqualTo(1);
        assertThat(page.path("items").get(0).path("id").asString()).isEqualTo(second);
        assertThat(page.path("items").get(0).path("paidTotal").asString()).isEqualTo("50.02");
        assertThat(list(access,vehicle,filters+"&page=1").path("items").get(0).path("id").asString()).isEqualTo(first);
        var empty=list(access,vehicle,filters+"&page=2");
        assertThat(empty.path("items").size()).isZero();
        assertThat(empty.path("totalElements").asInt()).isEqualTo(2);
        for (String bound:List.of("minTotalPaid=50.02","maxTotalPaid=40.01","minLiters=20.123",
                "maxLiters=10.123","minPricePerLiter=6.1234","maxPricePerLiter=5.1234")) {
            int expected=bound.startsWith("min") ? 2 : 1;
            assertThat(list(access,vehicle,"?fuelType=GASOLINE_REGULAR&"+bound).path("totalElements").asInt()).as(bound).isEqualTo(expected);
        }
        assertThat(list(access,vehicle,"?maxTotalPaid=0").path("totalElements").asInt()).isZero();
        assertThat(list(access,vehicle,"?tankState=PARTIAL").path("totalElements").asInt()).isZero();
        assertThat(list(access,vehicle,"").path("totalElements").asInt()).isEqualTo(4);
    }

    @Test void inclusiveLocalDaysHandleLeapDayMidnightAndDst() throws Exception {
        String access=account(), vehicle=vehicle(access);
        List<String> dates=List.of("2024-02-29T02:59:59Z","2024-02-29T03:00:00Z",
            "2024-03-01T02:59:59.999999Z","2024-03-01T03:00:00Z",
            "2024-03-10T04:59:59Z","2024-03-10T05:00:00Z",
            "2024-03-11T03:59:59.999999Z","2024-03-11T04:00:00Z");
        var ids=new ArrayList<String>();
        for (int i=0;i<dates.size();i++) ids.add(create(access,vehicle,dates.get(i),i*100,"10","6","60","GASOLINE_REGULAR"));
        var leap=list(access,vehicle,"?from=2024-02-29&to=2024-02-29&timezone=America/Sao_Paulo");
        assertThat(leap.path("totalElements").asInt()).isEqualTo(2);
        assertThat(leap.path("items").get(0).path("id").asString()).isEqualTo(ids.get(2));
        assertThat(leap.path("items").get(1).path("id").asString()).isEqualTo(ids.get(1));
        var dst=list(access,vehicle,"?from=2024-03-10&to=2024-03-10&timezone=America/New_York");
        assertThat(dst.path("totalElements").asInt()).isEqualTo(2);
        assertThat(dst.path("items").get(0).path("id").asString()).isEqualTo(ids.get(6));
        assertThat(dst.path("items").get(1).path("id").asString()).isEqualTo(ids.get(5));
        assertThat(list(access,vehicle,"?to=2024-02-28").path("totalElements").asInt()).isEqualTo(1);
        assertThat(list(access,vehicle,"?from=2024-03-11&timezone=America/New_York").path("totalElements").asInt()).isEqualTo(1);
    }

    @Test void malformedPrecisionLimitsAndReversedRangesAreRejectedWithoutRounding() throws Exception {
        String access=account(), vehicle=vehicle(access);
        for (String param:List.of("minTotalPaid","maxTotalPaid","minLiters","maxLiters","minPricePerLiter","maxPricePerLiter")) {
            for (String value:List.of("-1","1e2","1,2","NaN","","%201","%2B1","1.",".5","9".repeat(65))) {
                var response=request("GET",path(vehicle)+"?"+param+"="+value,access,null);
                assertThat(response.status()).as(param+"="+value).isEqualTo(422);
                assertThat(response.body().path("fieldErrors").has(param)).isTrue();
            }
        }
        for (String query:List.of("minTotalPaid=0.001","maxTotalPaid=10000000000","minLiters=0.0001",
                "maxLiters=10000000","minPricePerLiter=0.00001","maxPricePerLiter=1000000",
                "minTotalPaid=2&maxTotalPaid=1","minLiters=2&maxLiters=1","minPricePerLiter=2&maxPricePerLiter=1",
                "from=2024-03-01&to=2024-02-29","timezone=Invalid/Zone"))
            assertThat(request("GET",path(vehicle)+"?"+query,access,null).status()).as(query).isEqualTo(422);
        assertThat(list(access,vehicle,"?minTotalPaid=0&maxTotalPaid=9999999999.99&minLiters=0&maxLiters=9999999.999"
            +"&minPricePerLiter=0&maxPricePerLiter=999999.9999").path("totalElements").asInt()).isZero();
        for (String query:List.of("from=2023-02-29","fuelType=INVALID","tankState=INVALID","page=-1","size=101"))
            assertThat(request("GET",path(vehicle)+"?"+query,access,null).status()).as(query).isEqualTo(400);
    }

    @Test void authenticationAndOwnershipProtectFilteredQueries() throws Exception {
        String owner=account(), stranger=account(), vehicle=vehicle(owner);
        create(owner,vehicle,"2024-01-01T12:00:00Z",100,"10","6","60","GASOLINE_REGULAR");
        String route=path(vehicle)+"?minTotalPaid=60&maxTotalPaid=60&size=1";
        assertThat(request("GET",route,null,null).status()).isEqualTo(401);
        assertThat(request("GET",route,stranger,null).status()).isEqualTo(404);
        assertThat(list(stranger,vehicle(stranger),"?minTotalPaid=60&maxTotalPaid=60").path("totalElements").asInt()).isZero();
        assertThat(list(owner,vehicle,"?minTotalPaid=60&maxTotalPaid=60").path("totalElements").asInt()).isEqualTo(1);
    }

    private String account() throws Exception {
        String email=UUID.randomUUID()+"@example.test", password="Only-test-password-42!";
        assertThat(request("POST","/auth/register",null,Map.of("name","Filtros","email",email,"password",password)).status()).isEqualTo(201);
        var login=request("POST","/auth/login",null,Map.of("email",email,"password",password));
        assertThat(login.status()).isEqualTo(200); return login.body().path("access_token").asString();
    }
    private String vehicle(String access) throws Exception {
        var result=request("POST","/vehicles",access,Map.of("nickname","Filtros","allowedFuels",List.of("GASOLINE_REGULAR","ETHANOL")));
        assertThat(result.status()).isEqualTo(201); return result.body().path("id").asString();
    }
    private String create(String access,String vehicle,String when,long odometer,String liters,String price,String paid,String fuel) throws Exception {
        var input=new LinkedHashMap<String,Object>();
        String id=UUID.randomUUID().toString(); input.put("id",id); input.put("occurredAt",when);
        input.put("timezone","America/Sao_Paulo"); input.put("odometerKm",odometer); input.put("fuelType",fuel);
        input.put("liters",liters); input.put("unitPrice",price); input.put("paidTotal",paid);
        input.put("adjustmentReason","Valor efetivamente pago"); input.put("tankState","FULL");
        input.put("latitude",new BigDecimal("-23.55052")); input.put("longitude",new BigDecimal("-46.633308"));
        var result=request("POST",path(vehicle),access,input);
        assertThat(result.status()).as("%s",result.body()).isEqualTo(201); return id;
    }
    private JsonNode list(String access,String vehicle,String query) throws Exception {
        var result=request("GET",path(vehicle)+query,access,null);
        assertThat(result.status()).as("%s",result.body()).isEqualTo(200); return result.body();
    }
    private Result request(String method,String route,String access,Object body) throws Exception {
        var builder=HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+port+"/api/v1"+route)).header("Accept","application/json");
        if (access != null) builder.header("Authorization","Bearer "+access);
        if (body != null) builder.header("Content-Type","application/json");
        builder.method(method,body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body)));
        var response=client.send(builder.build(),HttpResponse.BodyHandlers.ofString());
        return new Result(response.statusCode(),json.readTree(response.body()));
    }
    private String path(String vehicle) { return "/vehicles/"+vehicle+"/fuel-entries"; }
    private record Result(int status,JsonNode body) {}
}
