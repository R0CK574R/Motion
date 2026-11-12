# Stage 1: build the jar. Tests are not run here because they need a
# database; CI runs them against a real Postgres before anything is deployed.
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /src
# Copying the POM first lets Docker cache the dependency download until the
# POM itself changes.
COPY pom.xml .
RUN mvn -B -q dependency:go-offline
COPY src ./src
# The fat jar is unpacked into motion-api.jar plus lib/, the layout that
# class data sharing (below) needs.
RUN mvn -B -q -DskipTests package \
    && java -Djarmode=tools -jar target/motion-api.jar extract --destination /out

# Stage 2: a small runtime image with only a Java runtime and the app.
FROM eclipse-temurin:21-jre-alpine
RUN addgroup -S motion && adduser -S motion -G motion
COPY --from=build /out /app
WORKDIR /app

# Tuned for a small, slow instance (Render's free tier: 0.1 CPU, 512 MB).
#  TieredStopAtLevel=1  JIT with the quick compiler only; the optimising one
#                       would spend minutes of a tenth of a CPU after start.
#  UseSerialGC          the collector with the least overhead on one core.
#  Xss512k              smaller thread stacks.
#  MaxRAMPercentage=60  heap up to 60% of the container's memory, leaving the
#                       rest for class metadata, compiled code and threads.
ENV JAVA_FLAGS="-XX:TieredStopAtLevel=1 -XX:+UseSerialGC -Xss512k -XX:MaxRAMPercentage=60"

# Class data sharing: start the app once at build time, far enough to load
# its classes, and save them pre-parsed and pre-verified in app.jsa, so each
# cold start skips that work. The settings below exist only for this run;
# the database is never contacted.
RUN DATABASE_URL=postgres://training:training@127.0.0.1:1/training \
    JWT_ACCESS_SECRET=build-time-training-run-only-not-a-real-secret \
    java $JAVA_FLAGS -XX:ArchiveClassesAtExit=app.jsa -Dspring.context.exit=onRefresh \
      -jar motion-api.jar --spring.flyway.enabled=false > /tmp/training.log 2>&1 \
    || { cat /tmp/training.log; exit 1; }; \
    test -s app.jsa && rm /tmp/training.log

USER motion
ENV PORT=4000
EXPOSE 4000

# Lets the orchestrator restart the container if the app stops answering.
# The long start period allows for a cold start on a tenth of a CPU.
HEALTHCHECK --interval=10s --timeout=3s --start-period=120s --retries=6 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" || exit 1

CMD ["sh", "-c", "exec java $JAVA_FLAGS -XX:SharedArchiveFile=app.jsa -jar motion-api.jar"]
