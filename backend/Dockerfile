FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /app
COPY pom.xml .
COPY src ./src
# compose.dev.yaml sets true to rebuild on every save without the tests and the formatting check.
ARG SKIP_CHECKS=false
RUN --mount=type=cache,target=/root/.m2 mvn -B -ntp verify -Dmaven.test.skip=${SKIP_CHECKS} -Dspotless.check.skip=${SKIP_CHECKS}

FROM eclipse-temurin:21-jre-jammy
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/* && useradd --system --uid 10001 arc
WORKDIR /app
COPY --from=build /app/target/arc-api-*.jar app.jar
USER arc
EXPOSE 8080
# Pin the JVM default locale so value formatting never depends on the host's settings.
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75.0", "-Duser.language=en", "-Duser.country=US", "-jar", "app.jar"]
