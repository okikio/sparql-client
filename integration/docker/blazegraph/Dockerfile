# Official Maven executable artifact, independent of third-party engine images.
FROM eclipse-temurin:8-jre-noble
ARG BLAZEGRAPH_VERSION=2.1.5
RUN apt-get update && apt-get install --no-install-recommends -y curl ca-certificates && rm -rf /var/lib/apt/lists/* \
  && url="https://repo1.maven.org/maven2/com/blazegraph/blazegraph-jar/${BLAZEGRAPH_VERSION}/blazegraph-jar-${BLAZEGRAPH_VERSION}.jar" \
  && curl --fail --location --retry 3 "$url" --output /opt/blazegraph.jar \
  && curl --fail --location --retry 3 "${url}.sha1" --output /tmp/blazegraph.sha1 \
  && echo "$(cat /tmp/blazegraph.sha1)  /opt/blazegraph.jar" | sha1sum -c - \
  && rm /tmp/blazegraph.sha1
WORKDIR /data
EXPOSE 9999
ENTRYPOINT ["java", "-Dfile.encoding=UTF-8", "-Dsun.jnu.encoding=UTF-8", "-jar", "/opt/blazegraph.jar"]
