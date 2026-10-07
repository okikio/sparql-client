# Official multi-architecture binary image pinned to an upstream commit.
FROM adfreiburg/qlever:commit-45b05e1
USER root
WORKDIR /index
RUN printf '<urn:test:s> <urn:test:p> <urn:test:o> .\n' > input.nt \
  && IndexBuilderMain -i sample -f input.nt -F nt --no-patterns
EXPOSE 7001
ENTRYPOINT ["ServerMain", "-i", "/index/sample", "-p", "7001", "-P", "-m", "256 MB", "-c", "64 MB", "-e", "32 MB"]
