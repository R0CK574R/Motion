# Stage 1: build the jar. Tests are not run here because they need a
# database; CI runs them against a real Postgres before anything is deployed.
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /src
# Copying the POM first lets Docker cache the dependency download until the
# POM itself changes.
COPY pom.xml .
RUN mvn -B -q dependency:go-offline
COPY src ./src
RUN mvn -B -q -DskipTests package

# Stage 2: a small runtime image with only a Java runtime and the jar.
FROM eclipse-temurin:21-jre-alpine
WORKDIR /app
RUN addgroup -S motion && adduser -S motion -G motion
COPY --from=build /src/target/motion-api.jar app.jar
USER motion
ENV PORT=4000
EXPOSE 4000

# Lets the orchestrator restart the container if the app stops answering.
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" || exit 1

# MaxRAMPercentage sizes the heap from the container's memory limit, which
# matters on small free-tier instances.
CMD ["java", "-XX:MaxRAMPercentage=75", "-jar", "app.jar"]
