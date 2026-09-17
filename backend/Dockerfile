FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /app/backend
COPY backend/pom.xml .
COPY backend/src ./src
COPY database/migrations /app/database/migrations
RUN --mount=type=cache,target=/root/.m2 mvn -B -ntp verify

FROM eclipse-temurin:21-jre-jammy
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/* && useradd --system --uid 10001 arc
WORKDIR /app
COPY --from=build /app/backend/target/arc-api-*.jar app.jar
USER arc
EXPOSE 8080
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75.0", "-jar", "app.jar"]
