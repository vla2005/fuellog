package com.fuellog;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.Executors;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
class FuellogApiIT {
    private static final String PASSWORD = "Only-test-password-42!";
    private final HttpClient client = HttpClient.newHttpClient();
    @LocalServerPort int port;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    @Autowired org.springframework.security.crypto.password.PasswordEncoder passwordEncoder;
    @Autowired
    @org.springframework.beans.factory.annotation.Qualifier("requestMappingHandlerMapping")
    org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping mappings;

    @Test
    void corsPreflightRunsBeforeAuthenticationAndRejectsUnapprovedOriginsAndHeaders() throws Exception {
        for (String origin : List.of("http://localhost:8081", "http://127.0.0.1:8081")) {
            var response = client.send(HttpRequest.newBuilder(URI.create(base() + "/api/v1/vehicles"))
                    .header("Origin", origin).header("Access-Control-Request-Method", "POST")
                    .header("Access-Control-Request-Headers", "authorization,content-type")
                    .header("Authorization", "Bearer invalid")
                    .method("OPTIONS", HttpRequest.BodyPublishers.noBody()).build(), HttpResponse.BodyHandlers.ofString());
            assertThat(response.statusCode()).isEqualTo(200);
            assertThat(response.headers().firstValue("Access-Control-Allow-Origin")).contains(origin);
            assertThat(response.headers().firstValue("Access-Control-Allow-Headers").orElseThrow().toLowerCase())
                    .contains("authorization", "content-type");
            assertThat(response.headers().firstValue("Access-Control-Allow-Credentials")).isEmpty();
        }
        for (String[] rejected : List.of(
                new String[]{"http://localhost:8081.evil.example", "POST", "authorization"},
                new String[]{"http://localhost:8082", "POST", "authorization"},
                new String[]{"null", "POST", "authorization"},
                new String[]{"http://localhost:8081", "DELETE", "authorization"},
                new String[]{"http://localhost:8081", "POST", "x-unapproved"})) {
            var response = client.send(HttpRequest.newBuilder(URI.create(base() + "/api/v1/vehicles"))
                    .header("Origin", rejected[0]).header("Access-Control-Request-Method", rejected[1])
                    .header("Access-Control-Request-Headers", rejected[2])
                    .method("OPTIONS", HttpRequest.BodyPublishers.noBody()).build(), HttpResponse.BodyHandlers.ofString());
            assertThat(response.statusCode()).isEqualTo(403);
            assertThat(response.headers().firstValue("Access-Control-Allow-Origin")).isEmpty();
        }
    }

    @Test
    void corsExposesEtagButStillRequiresBearerAndOwnership() throws Exception {
        var owner = account();
        var stranger = account();
        String vehicle = vehicle(owner.access());
        for (String token : List.of("", "invalid", stranger.access(), owner.access())) {
            var builder = HttpRequest.newBuilder(URI.create(base() + "/api/v1/vehicles/" + vehicle))
                    .header("Origin", "http://localhost:8081");
            if (!token.isEmpty()) builder.header("Authorization", "Bearer " + token);
            var response = client.send(builder.GET().build(), HttpResponse.BodyHandlers.ofString());
            int expected = token.equals(owner.access()) ? 200 : token.equals(stranger.access()) ? 404 : 401;
            assertThat(response.statusCode()).isEqualTo(expected);
            assertThat(response.headers().firstValue("Access-Control-Allow-Origin")).contains("http://localhost:8081");
            assertThat(response.headers().firstValue("Access-Control-Expose-Headers")).contains("ETag");
            assertThat(response.headers().firstValue("Access-Control-Allow-Credentials")).isEmpty();
            if (expected == 200) assertThat(response.headers().firstValue("ETag")).contains("\"0\"");
        }
    }

    @Test
    void documentedRoutesMatchImplementedBusinessRoutes() throws Exception {
        var spec = json.readTree(java.nio.file.Files.readString(java.nio.file.Path.of("..", "contracts", "openapi.json")));
        var documented = new java.util.HashSet<String>();
        spec.path("paths").properties().forEach(path -> path.getValue().properties().forEach(operation -> {
            if (List.of("get", "post", "patch", "delete").contains(operation.getKey())) {
                documented.add(operation.getKey().toUpperCase(java.util.Locale.ROOT) + " /api/v1" + path.getKey());
            }
        }));
        var implemented = new java.util.HashSet<String>();
        mappings.getHandlerMethods().keySet().forEach(mapping -> mapping.getPatternValues().forEach(path -> {
            if (path.startsWith("/api/v1/")) {
                mapping.getMethodsCondition().getMethods().forEach(method -> implemented.add(method + " " + path));
            }
        }));
        assertThat(documented).containsExactlyInAnyOrderElementsOf(implemented);
    }

    @Test
    void accountVehicleAndFuelEntryPersistThroughRealHttpAndPostgres() throws Exception {
        var account = account();
        String vehicle = vehicle(account.access());
        var input = entry("2026-10-12T12:00:00-03:00", 57980, "45.000", "6.0833", "273.75");
        var saved = request("POST", path(vehicle), account.access(), input);
        assertThat(saved.status()).isEqualTo(201);
        assertThat(saved.body().path("paidTotal").asString()).isEqualTo("273.75");
        assertThat(saved.body().path("liters").isString()).isTrue();
        assertThat(saved.body().path("idempotentReplay").asBoolean()).isFalse();
        var detail = request("GET", path(vehicle) + "/" + input.get("id"), account.access(), null);
        assertThat(detail.status()).isEqualTo(200);
        assertThat(detail.response().headers().firstValue("ETag")).contains("\"0\"");
        var history = request("GET", path(vehicle), account.access(), null);
        assertThat(history.status()).isEqualTo(200);
        assertThat(history.body().path("totalElements").asInt()).isEqualTo(1);
        assertThat(history.body().path("items").get(0).path("id").asString()).isEqualTo(input.get("id"));
        assertThat(jdbc.queryForObject("select count(*) from flyway_schema_history where success", Integer.class)).isPositive();
        assertThat(jdbc.queryForObject("select paid_total from fuel_entries where id=?", java.math.BigDecimal.class,
                UUID.fromString(input.get("id").toString()))).isEqualByComparingTo("273.75");
    }

    @Test
    void allBusinessRoutesRequireBearerAndHealthDoesNotExposeDetails() throws Exception {
        assertThat(request("GET", "/vehicles", null, null).status()).isEqualTo(401);
        assertThat(request("GET", "/future-business-route", null, null).status()).isEqualTo(401);
        assertThat(request("GET", "/me", "not-a-jwt", null).status()).isEqualTo(401);
        var health = client.send(HttpRequest.newBuilder(URI.create(base() + "/actuator/health")).GET().build(),
                HttpResponse.BodyHandlers.ofString());
        assertThat(health.statusCode()).isEqualTo(200);
        assertThat(json.readTree(health.body()).has("components")).isFalse();
        assertThat(request("GET", "/actuator/env", null, null).status()).isEqualTo(401);
        var account = account();
        assertThat(request("GET", "/unknown", account.access(), null).status()).isEqualTo(404);
        assertThat(request("DELETE", "/vehicles", account.access(), null).status()).isEqualTo(405);
    }

    @Test
    void accountIsolationCoversVehiclesDetailsHistoryAndWrites() throws Exception {
        var owner = account();
        var stranger = account();
        String vehicle = vehicle(owner.access());
        var input = entry("2026-10-12T12:00:00Z", 100, "10", "6", "60");
        assertThat(request("POST", path(vehicle), owner.access(), input).status()).isEqualTo(201);
        for (String route : List.of("/vehicles/" + vehicle, path(vehicle), path(vehicle) + "/" + input.get("id"))) {
            var denied = request("GET", route, stranger.access(), null);
            assertThat(denied.status()).isEqualTo(404);
            assertThat(denied.body().path("code").asString()).isEqualTo("RESOURCE_NOT_FOUND");
        }
        assertThat(request("POST", path(vehicle), stranger.access(), input).status()).isEqualTo(404);
        assertThat(request("GET", "/vehicles", stranger.access(), null).body().size()).isZero();
        assertThat(request("GET", path(vehicle), owner.access(), null).body().path("totalElements").asInt()).isEqualTo(1);
    }

    @Test
    void moneyRequiresExactStringScaleAndAdjustmentReason() throws Exception {
        var account = account();
        String vehicle = vehicle(account.access());
        var input = entry("2026-10-12T12:00:00Z", 100, "40", "6", "230");
        assertThat(request("POST", path(vehicle), account.access(), input).status()).isEqualTo(422);
        input.put("adjustmentReason", "Desconto no comprovante");
        var saved = request("POST", path(vehicle), account.access(), input);
        assertThat(saved.status()).isEqualTo(201);
        assertThat(saved.body().path("referenceTotal").asString()).isEqualTo("240.00");
        assertThat(saved.body().path("adjustmentAmount").asString()).isEqualTo("-10.00");
        var invalid = entry("2026-10-13T12:00:00Z", 200, "1.0001", "6", "6");
        assertThat(request("POST", path(vehicle), account.access(), invalid).status()).isEqualTo(422);
        invalid.put("liters", 1);
        assertThat(request("POST", path(vehicle), account.access(), invalid).status()).isEqualTo(400);
        invalid.put("liters", "0");
        assertThat(request("POST", path(vehicle), account.access(), invalid).status()).isEqualTo(422);
        assertThat(jdbc.queryForObject("select count(*) from fuel_entries where vehicle_id=?", Integer.class,
                UUID.fromString(vehicle))).isEqualTo(1);
    }

    @Test
    void malformedScalarTypesAreRejectedBeforeAnyDataIsWritten() throws Exception {
        var account = account();
        for (Object year : List.of(2020.9, "2020")) {
            assertThat(request("POST", "/vehicles", account.access(),
                    Map.of("nickname", "Carro", "modelYear", year, "allowedFuels", List.of("GASOLINE_REGULAR")))
                    .status()).isEqualTo(400);
        }
        assertThat(request("POST", "/vehicles", account.access(),
                Map.of("nickname", "Carro", "allowedFuels", List.of(0))).status()).isEqualTo(400);
        assertThat(request("GET", "/vehicles", account.access(), null).body().size()).isZero();
        String vehicle = vehicle(account.access());
        for (String field : List.of("fuelType", "tankState", "historyGapBefore")) {
            for (Object invalid : List.of(0, "0")) {
                var input = entry("2026-10-12T12:00:00Z", 100, "10", "6", "60");
                input.put(field, invalid);
                assertThat(request("POST", path(vehicle), account.access(), input).status()).isEqualTo(400);
            }
        }
        var input = entry("2026-10-12T12:00:00Z", 100, "10", "6", "60");
        input.put("historyGapBefore", "false");
        assertThat(request("POST", path(vehicle), account.access(), input).status()).isEqualTo(400);
        assertThat(request("GET", path(vehicle), account.access(), null).body().path("totalElements").asInt()).isZero();
    }

    @Test
    void retroactiveEntriesValidateBothNeighborsAndChronologicalAmbiguity() throws Exception {
        var account = account();
        String vehicle = vehicle(account.access());
        assertThat(request("POST", path(vehicle), account.access(),
                entry("2026-10-10T12:00:00Z", 100, "10", "6", "60")).status()).isEqualTo(201);
        assertThat(request("POST", path(vehicle), account.access(),
                entry("2026-10-12T12:00:00Z", 300, "10", "6", "60")).status()).isEqualTo(201);
        var middle = entry("2026-10-11T12:00:00Z", 99, "10", "6", "60");
        assertThat(request("POST", path(vehicle), account.access(), middle).status()).isEqualTo(422);
        middle.put("odometerKm", 301);
        assertThat(request("POST", path(vehicle), account.access(), middle).status()).isEqualTo(422);
        middle.put("odometerKm", 200);
        assertThat(request("POST", path(vehicle), account.access(), middle).status()).isEqualTo(201);
        assertThat(request("POST", path(vehicle), account.access(),
                entry("2026-10-11T12:00:00Z", 200, "10", "6", "60")).status()).isEqualTo(422);
        var invalid = entry(Instant.now().plusSeconds(600).toString(), 400, "10", "6", "60");
        assertThat(request("POST", path(vehicle), account.access(), invalid).status()).isEqualTo(422);
        invalid.put("occurredAt", "2026-10-13T12:00:00Z");
        invalid.put("timezone", "Mars/Olympus");
        assertThat(request("POST", path(vehicle), account.access(), invalid).status()).isEqualTo(422);
        invalid.put("timezone", "America/Sao_Paulo");
        invalid.put("fuelType", "DIESEL_S10");
        assertThat(request("POST", path(vehicle), account.access(), invalid).status()).isEqualTo(422);
    }

    @Test
    void idempotencySurvivesRetriesAndRejectsChangedCommand() throws Exception {
        var account = account();
        String vehicle = vehicle(account.access());
        var input = entry("2026-10-12T12:00:00Z", 100, "10.000", "6.0000", "60.00");
        assertThat(request("POST", path(vehicle), account.access(), input).status()).isEqualTo(201);
        var replay = request("POST", path(vehicle), account.access(), input);
        assertThat(replay.status()).isEqualTo(200);
        assertThat(replay.body().path("idempotentReplay").asBoolean()).isTrue();
        input.put("liters", "10");
        assertThat(request("POST", path(vehicle), account.access(), input).status()).isEqualTo(200);
        input.put("notes", "Comando diferente");
        var conflict = request("POST", path(vehicle), account.access(), input);
        assertThat(conflict.status()).isEqualTo(409);
        assertThat(conflict.body().path("code").asString()).isEqualTo("IDEMPOTENCY_CONFLICT");
        assertThat(request("GET", path(vehicle), account.access(), null).body().path("totalElements").asInt()).isEqualTo(1);
    }

    @Test
    void concurrentRetriesAndHistoryWritesAreSerializedPerVehicle() throws Exception {
        var account = account();
        String vehicle = vehicle(account.access());
        var duplicate = entry("2026-10-10T12:00:00Z", 100, "10", "6", "60");
        var statuses = parallel(
                () -> request("POST", path(vehicle), account.access(), duplicate).status(),
                () -> request("POST", path(vehicle), account.access(), duplicate).status());
        assertThat(statuses).containsExactlyInAnyOrder(201, 200);
        var first = entry("2026-10-11T12:00:00Z", 300, "10", "6", "60");
        var second = entry("2026-10-12T12:00:00Z", 200, "10", "6", "60");
        statuses = parallel(() -> request("POST", path(vehicle), account.access(), first).status(),
                () -> request("POST", path(vehicle), account.access(), second).status());
        assertThat(statuses).containsExactlyInAnyOrder(201, 422);
        assertThat(request("GET", path(vehicle), account.access(), null).body().path("totalElements").asInt()).isEqualTo(2);
    }

    @Test
    void historyFiltersUseCivilDatesInRequestedTimezoneAndBoundPagination() throws Exception {
        var account = account();
        String vehicle = vehicle(account.access());
        assertThat(request("POST", path(vehicle), account.access(),
                entry("2026-10-01T01:00:00Z", 100, "10", "6", "60")).status()).isEqualTo(201);
        assertThat(request("POST", path(vehicle), account.access(),
                entry("2026-10-01T04:00:00Z", 200, "10", "6", "60")).status()).isEqualTo(201);
        var filtered = request("GET", path(vehicle) + "?from=2026-09-30&to=2026-09-30&timezone=America/Sao_Paulo",
                account.access(), null);
        assertThat(filtered.status()).isEqualTo(200);
        assertThat(filtered.body().path("totalElements").asInt()).isEqualTo(1);
        assertThat(filtered.body().path("items").get(0).path("odometerKm").asInt()).isEqualTo(100);
        assertThat(request("GET", path(vehicle) + "?fuelType=ETHANOL", account.access(), null)
                .body().path("totalElements").asInt()).isZero();
        assertThat(request("GET", path(vehicle) + "?size=101", account.access(), null).status()).isEqualTo(400);
        assertThat(request("GET", path(vehicle) + "?page=-1", account.access(), null).status()).isEqualTo(400);
    }

    @Test
    void sameUuidOnDifferentVehiclesCannotBecomeAnInfrastructureFailure() throws Exception {
        var account = account();
        String first = vehicle(account.access());
        String second = vehicle(account.access());
        var input = entry("2026-10-12T12:00:00Z", 100, "10", "6", "60");
        assertThat(parallel(() -> request("POST", path(first), account.access(), input).status(),
                () -> request("POST", path(second), account.access(), input).status()))
                .containsExactlyInAnyOrder(201, 409);
    }

    @Test
    void archivedVehicleAcceptsKnownRetryButRejectsNewPurchases() throws Exception {
        var account = account();
        String vehicle = vehicle(account.access());
        var input = entry("2026-10-12T12:00:00Z", 100, "10", "6", "60");
        assertThat(request("POST", path(vehicle), account.access(), input).status()).isEqualTo(201);
        jdbc.update("update vehicles set archived_at=now() where id=?", UUID.fromString(vehicle));
        assertThat(request("POST", path(vehicle), account.access(), input).status()).isEqualTo(200);
        input.put("id", UUID.randomUUID().toString());
        var archived = request("POST", path(vehicle), account.access(), input);
        assertThat(archived.status()).isEqualTo(409);
        assertThat(archived.body().path("code").asString()).isEqualTo("VEHICLE_ARCHIVED");
    }

    @Test
    void refreshRotatesWithoutExtendingFamilyAndReplayPersistsRevocation() throws Exception {
        var account = account();
        var rotated = request("POST", "/auth/refresh", "expired-invalid-access",
                Map.of("refresh_token", account.refresh()));
        assertThat(rotated.status()).isEqualTo(200);
        assertThat(rotated.body().path("refresh_expires_at").asString()).isEqualTo(account.refreshExpiresAt());
        assertThat(rotated.body().path("refresh_token").asString()).isNotEqualTo(account.refresh());
        assertThat(rotated.response().headers().firstValue("Cache-Control")).contains("no-store");
        var replay = request("POST", "/auth/refresh", null, Map.of("refresh_token", account.refresh()));
        assertThat(replay.status()).isEqualTo(401);
        assertThat(replay.body().path("code").asString()).isEqualTo("REFRESH_TOKEN_REUSED");
        assertThat(request("GET", "/me", rotated.body().path("access_token").asString(), null).status()).isEqualTo(401);
        assertThat(jdbc.queryForObject("select revoked_at is not null from user_sessions where id=?", Boolean.class,
                UUID.fromString(account.sessionId()))).isTrue();
        assertThat(jdbc.queryForObject("select count(*) from refresh_tokens where session_id=?", Integer.class,
                UUID.fromString(account.sessionId()))).isEqualTo(2);
    }

    @Test
    void logoutAndDisabledAccountsInvalidateAccessImmediatelyAndSecretsAreHashed() throws Exception {
        var account = account();
        assertThat(request("GET", "/me", account.access(), null).status()).isEqualTo(200);
        assertThat(request("POST", "/auth/logout", account.access(), null).status()).isEqualTo(204);
        assertThat(request("GET", "/me", account.access(), null).status()).isEqualTo(401);
        assertThat(request("POST", "/auth/refresh", null, Map.of("refresh_token", account.refresh())).status()).isEqualTo(401);
        var disabled = account();
        jdbc.update("update users set disabled_at=now() where email=?", disabled.email());
        assertThat(request("GET", "/me", disabled.access(), null).status()).isEqualTo(401);
        String passwordHash = jdbc.queryForObject("select password_hash from users where email=?", String.class, account.email());
        assertThat(passwordHash).isNotEqualTo(PASSWORD);
        assertThat(passwordEncoder.matches(PASSWORD, passwordHash)).isTrue();
        assertThat(jdbc.queryForObject("select token_hash from refresh_tokens where session_id=?", String.class,
                UUID.fromString(account.sessionId()))).hasSize(64).isNotEqualTo(account.refresh());
    }

    @Test
    void concurrentRefreshUsesStrictReplayPolicyAndCommitsFamilyRevocation() throws Exception {
        var account = account();
        assertThat(parallel(
                () -> request("POST", "/auth/refresh", null, Map.of("refresh_token", account.refresh())).status(),
                () -> request("POST", "/auth/refresh", null, Map.of("refresh_token", account.refresh())).status()))
                .containsExactlyInAnyOrder(200, 401);
        assertThat(request("GET", "/me", account.access(), null).status()).isEqualTo(401);
        assertThat(jdbc.queryForObject("select revoked_at is not null from user_sessions where id=?", Boolean.class,
                UUID.fromString(account.sessionId()))).isTrue();
    }

    @Test
    void consumptionIncludesIntermediatesExcludesBaselineAndKeepsGlobalLatestCycle() throws Exception {
        var account = account();
        String vehicle = vehicle(account.access());
        assertThat(request("POST", path(vehicle), account.access(),
                entry("2026-10-10T12:00:00Z", 10000, "40", "6", "240")).status()).isEqualTo(201);
        var partial = entry("2026-10-12T12:00:00Z", 10200, "15", "6", "90");
        partial.put("tankState", "PARTIAL");
        assertThat(request("POST", path(vehicle), account.access(), partial).status()).isEqualTo(201);
        var closing = entry("2026-10-24T12:00:00Z", 10500, "30", "6", "180");
        closing.put("fuelType", "ETHANOL");
        assertThat(request("POST", path(vehicle), account.access(), closing).status()).isEqualTo(201);
        String route = "/vehicles/" + vehicle;
        var summary = request("GET", route + "/summary?from=2026-10-20&to=2026-10-24", account.access(), null);
        assertThat(summary.status()).isEqualTo(200);
        assertThat(summary.body().path("purchaseCount").asInt()).isEqualTo(1);
        assertThat(summary.body().path("paidTotal").asString()).isEqualTo("180.00");
        assertThat(summary.body().path("purchasedLiters").asString()).isEqualTo("30.000");
        assertThat(summary.body().path("cycleLiters").asString()).isEqualTo("45.000");
        assertThat(summary.body().path("periodConsumptionKmPerLiter").asString()).isEqualTo("11.11");
        assertThat(summary.body().path("periodReplacementCostPerKm").asString()).isEqualTo("0.5400");
        assertThat(summary.body().path("lastValidCycle").path("mixed").asBoolean()).isTrue();
        var cycles = request("GET", route + "/consumption-cycles", account.access(), null);
        assertThat(cycles.status()).isEqualTo(200);
        assertThat(cycles.body().path("items").size()).isEqualTo(1);
        assertThat(cycles.body().path("items").get(0).path("fuelTypes").size()).isEqualTo(2);
        var emptyPeriod = request("GET", route + "/summary?from=2026-09-01&to=2026-09-30", account.access(), null);
        assertThat(emptyPeriod.body().path("periodConsumptionKmPerLiter").isNull()).isTrue();
        assertThat(emptyPeriod.body().path("periodUnavailableReason").asString()).isEqualTo("NO_VALID_CYCLE_IN_PERIOD");
        assertThat(emptyPeriod.body().path("lastValidCycle").path("consumptionKmPerLiter").asString()).isEqualTo("11.11");
        assertThat(emptyPeriod.body().path("lastConsumptionUnavailableReason").isNull()).isTrue();
    }

    @Test
    void incompleteAndBrokenCyclesExplainNullAndFullTankReopensBaseline() throws Exception {
        var account = account();
        String vehicle = vehicle(account.access());
        String route = "/vehicles/" + vehicle;
        var empty = request("GET", route + "/summary", account.access(), null);
        assertThat(empty.status()).isEqualTo(200);
        assertThat(empty.body().path("weightedPaidPrice").isNull()).isTrue();
        assertThat(empty.body().path("lastConsumptionUnavailableReason").asString()).isEqualTo("NEEDS_FULL_TANK_BASELINE");
        assertThat(request("POST", path(vehicle), account.access(),
                entry("2026-10-10T12:00:00Z", 10000, "40", "6", "240")).status()).isEqualTo(201);
        var baseline = request("GET", route + "/summary", account.access(), null);
        assertThat(baseline.body().path("lastConsumptionUnavailableReason").asString()).isEqualTo("OPEN_CYCLE");
        var gap = entry("2026-10-12T12:00:00Z", 10200, "15", "6", "90");
        gap.put("tankState", "UNKNOWN");
        gap.put("historyGapBefore", true);
        assertThat(request("POST", path(vehicle), account.access(), gap).status()).isEqualTo(201);
        assertThat(request("POST", path(vehicle), account.access(),
                entry("2026-10-20T12:00:00Z", 10500, "30", "6", "180")).status()).isEqualTo(201);
        var broken = request("GET", route + "/consumption-cycles", account.access(), null);
        assertThat(broken.body().path("items").get(0).path("consumptionKmPerLiter").isNull()).isTrue();
        assertThat(broken.body().path("items").get(0).path("unavailableReason").asString()).isEqualTo("HISTORY_GAP");
        assertThat(request("POST", path(vehicle), account.access(),
                entry("2026-10-24T12:00:00Z", 10800, "30", "6", "180")).status()).isEqualTo(201);
        var recovered = request("GET", route + "/summary", account.access(), null);
        assertThat(recovered.body().path("validCycleCount").asInt()).isEqualTo(1);
        assertThat(recovered.body().path("lastValidCycle").path("consumptionKmPerLiter").asString()).isEqualTo("10.00");
    }

    @Test
    void periodConsumptionIsWeightedAcrossCyclesAndZeroDistanceDoesNotDivide() throws Exception {
        var account = account();
        String vehicle = vehicle(account.access());
        String route = "/vehicles/" + vehicle;
        assertThat(request("POST", path(vehicle), account.access(),
                entry("2026-10-01T12:00:00Z", 10000, "40", "6", "240")).status()).isEqualTo(201);
        assertThat(request("POST", path(vehicle), account.access(),
                entry("2026-10-02T12:00:00Z", 10100, "10", "6", "60")).status()).isEqualTo(201);
        assertThat(request("POST", path(vehicle), account.access(),
                entry("2026-10-03T12:00:00Z", 11000, "60", "6", "360")).status()).isEqualTo(201);
        var weighted = request("GET", route + "/summary", account.access(), null);
        assertThat(weighted.body().path("periodConsumptionKmPerLiter").asString()).isEqualTo("14.29");
        assertThat(weighted.body().path("cycleDistanceKm").asInt()).isEqualTo(1000);
        assertThat(request("POST", path(vehicle), account.access(),
                entry("2026-10-04T12:00:00Z", 11000, "5", "6", "30")).status()).isEqualTo(201);
        var cycles = request("GET", route + "/consumption-cycles", account.access(), null);
        assertThat(cycles.body().path("items").get(2).path("consumptionKmPerLiter").isNull()).isTrue();
        assertThat(cycles.body().path("items").get(2).path("unavailableReason").asString()).isEqualTo("ZERO_DISTANCE");
        assertThat(request("GET", route + "/summary", account.access(), null)
                .body().path("periodConsumptionKmPerLiter").asString()).isEqualTo("14.29");
    }

    @Test
    void metricsAlsoEnforceOwnershipAndValidateFilters() throws Exception {
        var owner = account();
        var stranger = account();
        String vehicle = vehicle(owner.access());
        for (String endpoint : List.of("summary", "consumption-cycles")) {
            String route = "/vehicles/" + vehicle + "/" + endpoint;
            assertThat(request("GET", route, stranger.access(), null).status()).isEqualTo(404);
            assertThat(request("GET", route + "?timezone=Mars/Olympus", owner.access(), null).status()).isEqualTo(422);
            assertThat(request("GET", route + "?from=2026-10-12&to=2026-10-01", owner.access(), null).status()).isEqualTo(422);
        }
    }

    private Account account() throws Exception {
        String email = UUID.randomUUID() + "@example.test";
        assertThat(request("POST", "/auth/register", null,
                Map.of("name", "Pessoa de teste", "email", email, "password", PASSWORD)).status()).isEqualTo(201);
        var login = request("POST", "/auth/login", null, Map.of("email", email, "password", PASSWORD));
        assertThat(login.status()).isEqualTo(200);
        return new Account(email, login.body().path("access_token").asString(), login.body().path("refresh_token").asString(),
                login.body().path("refresh_expires_at").asString(), login.body().path("session_id").asString());
    }

    private String vehicle(String access) throws Exception {
        var response = request("POST", "/vehicles", access,
                Map.of("nickname", "Civic", "modelYear", 2020, "allowedFuels", List.of("GASOLINE_REGULAR", "ETHANOL")));
        assertThat(response.status()).isEqualTo(201);
        return response.body().path("id").asString();
    }

    private Map<String, Object> entry(String when, long odometer, String liters, String price, String paid) {
        var value = new LinkedHashMap<String, Object>();
        value.put("id", UUID.randomUUID().toString());
        value.put("occurredAt", when);
        value.put("timezone", "America/Sao_Paulo");
        value.put("odometerKm", odometer);
        value.put("fuelType", "GASOLINE_REGULAR");
        value.put("liters", liters);
        value.put("unitPrice", price);
        value.put("paidTotal", paid);
        value.put("tankState", "FULL");
        value.put("historyGapBefore", false);
        return value;
    }

    @SafeVarargs
    private final List<Integer> parallel(Callable<Integer>... calls) throws Exception {
        try (var pool = Executors.newFixedThreadPool(calls.length)) {
            var results = new ArrayList<Integer>();
            for (var future : pool.invokeAll(List.of(calls))) results.add(future.get());
            return results;
        }
    }

    private Result request(String method, String path, String access, Object body) throws Exception {
        var builder = HttpRequest.newBuilder(URI.create(base() + "/api/v1" + path)).header("Accept", "application/json");
        if (access != null) builder.header("Authorization", "Bearer " + access);
        if (body != null) builder.header("Content-Type", "application/json");
        builder.method(method, body == null ? HttpRequest.BodyPublishers.noBody()
                : HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body)));
        var response = client.send(builder.build(), HttpResponse.BodyHandlers.ofString());
        return new Result(response.statusCode(), response.body().isBlank() ? json.nullNode() : json.readTree(response.body()), response);
    }

    private String base() { return "http://127.0.0.1:" + port; }
    private String path(String vehicle) { return "/vehicles/" + vehicle + "/fuel-entries"; }
    private record Account(String email, String access, String refresh, String refreshExpiresAt, String sessionId) {}
    private record Result(int status, JsonNode body, HttpResponse<String> response) {}
}
