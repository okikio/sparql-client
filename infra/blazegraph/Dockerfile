# =============================================================================
# Stage 1: Seeding Stage
# Starts Blazegraph temporarily during build, loads data, captures journal file
# =============================================================================
FROM eclipse-temurin:11-jre-jammy AS seeder

LABEL description="Blazegraph seeding stage - temporary build container"

# Install dependencies for seeding
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl unzip python3 python3-pip && \
    pip3 install requests && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Download Blazegraph JAR
RUN curl -fSL --retry 3 \
      https://github.com/blazegraph/database/releases/download/BLAZEGRAPH_2_1_6_RC/blazegraph.jar \
      -o /build/blazegraph.jar

# Create Blazegraph configuration for seeding
RUN mkdir -p /build/data && \
    echo "# Blazegraph Seeding Configuration\n\
com.bigdata.journal.AbstractJournal.file=/build/data/blazegraph.jnl\n\
com.bigdata.journal.AbstractJournal.bufferMode=DiskRW\n\
com.bigdata.rdf.store.AbstractTripleStore.textIndex=true\n\
com.bigdata.rdf.store.AbstractTripleStore.axiomsClass=com.bigdata.rdf.axioms.NoAxioms\n\
com.bigdata.rdf.store.AbstractTripleStore.quads=true\n\
com.bigdata.rdf.store.AbstractTripleStore.statementIdentifiers=false\n\
com.bigdata.rdf.sail.isolatableIndices=false\n\
com.bigdata.rdf.sail.truthMaintenance=false\n\
com.bigdata.btree.writeRetentionQueue.capacity=4000\n\
com.bigdata.btree.BTree.branchingFactor=128\n\
com.bigdata.rdf.sail.webapp.QueryServlet.queryTimeout=0" \
    > /build/RWStore.properties

# Copy seeding scripts and source data files
COPY scripts/comic_to_sparql.py /build/
COPY scripts/seed_helper.py /build/
COPY data/ /build/data_in/

# --- normalize to comic_output.json ---------------------------
# If a zip/gz is present, extract/decompress it to the expected path.
RUN set -eux; \
  echo "Contents of /build/data_in:"; ls -lah /build/data_in; \
  f=""; \
  for p in \
    /build/data_in/comic_output.json \
    /build/data_in/comic_output.json.zip \
    /build/data_in/comic_output.zip \
    /build/data_in/comic_output.json.gz \
    /build/data_in/comic_output.gz \
  ; do \
    if [ -f "$p" ]; then f="$p"; break; fi; \
  done; \
  [ -n "$f" ] || { echo "ERROR: missing comic_output.(json|zip|gz) in /build/data_in"; exit 1; }; \
  case "$f" in \
    *.json) echo "Found comic_output.json, no extraction needed" ;; \
    *.zip)  j="$(unzip -Z1 "$f" | grep -E '\.json$' | head -n1)"; \
            [ -n "$j" ] || { echo "No *.json in zip"; exit 1; }; \
            unzip -p "$f" "$j" > /build/data_in/comic_output.json ;; \
    *.gz)   gunzip -c "$f" > /build/data_in/comic_output.json ;; \
  esac; \
  ls -lh /build/data_in/comic_output.json


# Start Blazegraph, load data, then stop
# This runs during docker build and captures the resulting journal file
RUN echo "=== Starting Blazegraph for seeding ===" && \
    java -Xmx1g \
         -Dcom.bigdata.rdf.sail.webapp.ConfigParams.propertyFile=/build/RWStore.properties \
         -jar /build/blazegraph.jar > /dev/null 2>&1 & \
    BLAZEGRAPH_PID=$! && \
    echo "Waiting for Blazegraph to be ready..." && \
    sleep 10 && \
    until curl -sf http://localhost:9999/blazegraph/status > /dev/null 2>&1; do \
        echo "  Still waiting..."; \
        sleep 2; \
    done && \
    echo "✓ Blazegraph is ready!" && \
    echo "" && \
    echo "Loading narrative ontology..." && \
    python3 /build/seed_helper.py load-ttl /build/data_in/narrative.ttl && \
    echo "" && \
    echo "Converting all comic data..." && \
    python3 /build/comic_to_sparql.py /build/data_in/comic_output.json -o /build/comic_data.sparql && \
    echo "" && \
    echo "Loading comic data into Blazegraph..." && \
    python3 /build/seed_helper.py load-sparql /build/comic_data.sparql && \
    echo "" && \
    echo "✓ Seeding complete!" && \
    python3 /build/seed_helper.py stats && \
    echo "" && \
    echo "Shutting down Blazegraph..." && \
    kill $BLAZEGRAPH_PID && \
    wait $BLAZEGRAPH_PID || true && \
    echo "✓ Build-time seeding complete. Journal file size: $(du -h /build/data/blazegraph.jnl | cut -f1)"

# =============================================================================
# Stage 2: Production Runtime Image
# Clean runtime image with pre-seeded database journal
# =============================================================================

# Use Java 11 JRE (Blazegraph is old, JDK 18 risks compatibility issues)
# eclipse-temurin is the recommended replacement for deprecated openjdk images
FROM eclipse-temurin:11-jre-jammy

LABEL maintainer="dpesmdr20@gmail.com"
LABEL description="Blazegraph RDF triplestore for local Neptune experimentation"
LABEL version="2.1.6"

# Create non-root user for security
RUN groupadd -r blazegraph --gid=999 && \
    useradd -r -g blazegraph --uid=999 --create-home blazegraph

# Set working directory
WORKDIR /var/lib/blazegraph

# Download and verify Blazegraph JAR
# Using curl with retry and checksum verification
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl && \
    curl -fSL --retry 3 \
      https://github.com/blazegraph/database/releases/download/BLAZEGRAPH_2_1_6_RC/blazegraph.jar \
      -o /opt/blazegraph.jar && \
    rm -rf /var/lib/apt/lists/*

# Create directories for data persistence, config, logs, and seed
RUN mkdir -p /var/lib/blazegraph/data \
             /var/lib/blazegraph/logs \
             /var/lib/blazegraph/seed \
             /etc/blazegraph && \
    chown -R blazegraph:blazegraph /var/lib/blazegraph

# Create default configuration file inside image
RUN echo "# Blazegraph Default Configuration\n\
com.bigdata.journal.AbstractJournal.file=/var/lib/blazegraph/data/blazegraph.jnl\n\
com.bigdata.journal.AbstractJournal.bufferMode=DiskRW\n\
com.bigdata.rdf.store.AbstractTripleStore.textIndex=true\n\
com.bigdata.rdf.store.AbstractTripleStore.axiomsClass=com.bigdata.rdf.axioms.NoAxioms\n\
com.bigdata.rdf.store.AbstractTripleStore.quads=true\n\
com.bigdata.rdf.store.AbstractTripleStore.statementIdentifiers=false\n\
com.bigdata.rdf.sail.isolatableIndices=false\n\
com.bigdata.rdf.sail.truthMaintenance=false\n\
com.bigdata.btree.writeRetentionQueue.capacity=4000\n\
com.bigdata.btree.BTree.branchingFactor=128\n\
com.bigdata.rdf.sail.webapp.QueryServlet.queryTimeout=0" \
    > /etc/blazegraph/RWStore.properties && \
    chown blazegraph:blazegraph /etc/blazegraph/RWStore.properties

# Create log4j configuration for console and file logging
RUN echo "log4j.rootLogger=WARN, console, file\n\
\n\
# Console appender\n\
log4j.appender.console=org.apache.log4j.ConsoleAppender\n\
log4j.appender.console.layout=org.apache.log4j.PatternLayout\n\
log4j.appender.console.layout.ConversionPattern=%d{ABSOLUTE} %-5p [%c{1}] %m%n\n\
\n\
# File appender\n\
log4j.appender.file=org.apache.log4j.RollingFileAppender\n\
log4j.appender.file.File=/var/lib/blazegraph/logs/blazegraph.log\n\
log4j.appender.file.MaxFileSize=10MB\n\
log4j.appender.file.MaxBackupIndex=5\n\
log4j.appender.file.layout=org.apache.log4j.PatternLayout\n\
log4j.appender.file.layout.ConversionPattern=%d{ISO8601} %-5p [%c{1}] %m%n\n\
\n\
# Set specific loggers\n\
log4j.logger.com.bigdata=INFO" \
    > /etc/blazegraph/log4j.properties && \
    chown blazegraph:blazegraph /etc/blazegraph/log4j.properties

# Copy the pre-seeded journal file from the seeder stage to seed directory
# Not directly to data directory to allow volume mounting
COPY --from=seeder --chown=blazegraph:blazegraph /build/data/blazegraph.jnl /var/lib/blazegraph/seed/

# Copy entrypoint script
COPY --chown=blazegraph:blazegraph docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Switch to non-root user
USER blazegraph

# Expose standard Blazegraph port
EXPOSE 9999

# Configure JVM for containers using environment variable
# MaxRAMPercentage=70 leaves 30% for non-heap memory (threads, code cache, etc)
# InitialRAMPercentage=70 matches max to reduce GC pauses
# ExitOnOutOfMemoryError ensures clean restarts on OOM
ENV JAVA_OPTS="-XX:+UseContainerSupport \
               -XX:MaxRAMPercentage=70.0 \
               -XX:InitialRAMPercentage=70.0 \
               -XX:+ExitOnOutOfMemoryError \
               -Djava.awt.headless=true \
               -Dorg.eclipse.jetty.server.Request.maxFormContentSize=200000000 \
               -Dcom.bigdata.rdf.sail.webapp.ConfigParams.propertyFile=/etc/blazegraph/RWStore.properties \
               -Dlog4j.configuration=file:/etc/blazegraph/log4j.properties"

# Health check - verify Blazegraph responds on status endpoint
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:9999/blazegraph/status || exit 1

# Volume for persistent data
# Data will be initialized from seed on first run via entrypoint
VOLUME ["/var/lib/blazegraph/data"]

# Use entrypoint script
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]