# syntax=docker/dockerfile:1
FROM eclipse-temurin:26-jdk-alpine AS builder
WORKDIR /build
COPY .mvn/ .mvn/
COPY mvnw pom.xml ./
RUN chmod +x mvnw
RUN --mount=type=cache,target=/root/.m2 ./mvnw -B -ntp dependency:go-offline
COPY src/ src/
RUN --mount=type=cache,target=/root/.m2 ./mvnw -B -ntp -Dmaven.test.skip=true package \
    && cp target/fuellog-api-0.0.1-SNAPSHOT.jar application.jar \
    && java -Djarmode=tools -jar application.jar extract --layers --destination extracted

FROM eclipse-temurin:26-jre-alpine AS runtime
RUN addgroup -S fuellog && adduser -S -G fuellog fuellog
WORKDIR /application
COPY --from=builder /build/extracted/dependencies/ ./
COPY --from=builder /build/extracted/spring-boot-loader/ ./
COPY --from=builder /build/extracted/snapshot-dependencies/ ./
COPY --from=builder /build/extracted/application/ ./
COPY --chmod=755 docker-entrypoint.sh /usr/local/bin/fuellog-entrypoint
USER fuellog
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/actuator/health || exit 1
ENTRYPOINT ["/usr/local/bin/fuellog-entrypoint"]
