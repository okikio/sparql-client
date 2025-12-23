# syntax=docker/dockerfile:1.7

# Wrapper image: keep upstream QLever image, but bake in your scripts.
FROM adfreiburg/qlever:latest

# Keep your compose expectation: /data is the working dir.
WORKDIR /data

# Copy your scripts into the image and ensure they are executable.
# (Requires BuildKit, which GitHub Actions uses by default with buildx.)
COPY --chmod=0755 ./scripts/ /qlever/scripts/
COPY ./data/ /qlever/input/

# Optional: makes it easy to call scripts without full path.
ENV PATH="/qlever/scripts:${PATH}"

# Default entrypoint matches what you were doing in compose.
ENTRYPOINT ["/bin/bash", "/qlever/scripts/entrypoint.sh"]
