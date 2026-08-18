# Apache Jena Fuseki test image assembled from the official Maven artifact.
FROM eclipse-temurin:21-jre-alpine
ARG JENA_VERSION=6.1.0
RUN apk add --no-cache curl \
  && set -eux; \
  url="https://repo1.maven.org/maven2/org/apache/jena/jena-fuseki-server/${JENA_VERSION}/jena-fuseki-server-${JENA_VERSION}.jar"; \
  curl --fail --location --retry 3 "$url" --output /opt/fuseki.jar; \
  curl --fail --location --retry 3 "${url}.sha1" --output /tmp/fuseki.jar.sha1; \
  echo "$(cat /tmp/fuseki.jar.sha1)  /opt/fuseki.jar" | sha1sum -c -; \
  rm /tmp/fuseki.jar.sha1
EXPOSE 3030
ENTRYPOINT ["java", "-jar", "/opt/fuseki.jar"]
CMD ["--mem", "/ds", "--port", "3030"]
