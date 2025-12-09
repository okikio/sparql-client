# docker/server.Dockerfile

# -----------------------------
# Stage 1: Build QLever from source
# -----------------------------
FROM ubuntu:24.04 AS qlever-build

ARG QLEVER_GIT_REF="master"  # You can pin to a tag/commit if you want
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
  && apt-get install -y \
    git \
    cmake \
    ninja-build \
    build-essential \
    libzstd-dev \
    libjemalloc-dev \
    libboost-all-dev \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /src

# Clone QLever and checkout the requested ref
RUN git clone https://github.com/ad-freiburg/qlever.git . \
  && git checkout "${QLEVER_GIT_REF}"

# Configure with conservative CPU flags so we don't hit Illegal Instruction
RUN cmake -S . -B build -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_CXX_FLAGS="-march=x86-64 -mtune=generic" \
  -DUSE_PARALLEL=true

# Build only the two main binaries we need
RUN cmake --build build --target IndexBuilderMain ServerMain -j4

# -----------------------------
# Stage 2: Stop-on-call helper
# -----------------------------
FROM ghcr.io/ludovicm67/stop-on-call:v0.1.0 AS soc

# -----------------------------
# Stage 3: Final QLever runtime image
# -----------------------------
FROM ubuntu:24.04

# Match the CLI version to something recent / stable
# Check PyPI for latest: https://pypi.org/project/qlever/
ARG QLEVER_VERSION="0.5.35"
ARG PIPX_VERSION="1.8.0"

ENV DEBIAN_FRONTEND=noninteractive

# Core runtime deps for QLever binaries + Python CLI
RUN apt-get update \
  && apt-get upgrade -y \
  && apt-get install -y \
    bash-completion \
    bzip2 \
    curl \
    libboost-iostreams1.83.0 \
    libboost-program-options1.83.0 \
    libboost-url1.83.0 \
    libgomp1 \
    libicu74 \
    libjemalloc2 \
    libzstd1 \
    pipx \
    python3 \
    unzip \
    uuid-runtime \
    vim \
    wget \
  && apt-get autoremove -y \
  && rm -rf /var/lib/apt/lists/* \
  && apt-get clean

# Create dirs and relax permissions so the `nobody`-like user can write
RUN mkdir -p /qlever /data \
  && chmod -R a+rw /data \
  && chmod -R a+rw /qlever

# Shell convenience for interactive use (optional, but nice)
RUN echo 'eval "$(register-python-argcomplete qlever)"' >> /etc/bash.bashrc \
  && echo 'PATH="/qlever:${PATH}"' >> /etc/bash.bashrc

ENV QLEVER_ARGCOMPLETE_ENABLED="1"
ENV QLEVER_IS_RUNNING_IN_CONTAINER="1"

# Upgrade pipx to the pyz version with --global support
RUN curl -L -o /usr/local/bin/pipx "https://github.com/pypa/pipx/releases/download/${PIPX_VERSION}/pipx.pyz" \
  && chmod +x /usr/local/bin/pipx

# Install the QLever CLI (Python wrapper); this will invoke our compiled binaries
RUN pipx install --global "qlever==${QLEVER_VERSION}"

# Copy compiled binaries from the build stage
# NOTE: CMake by default puts executables directly in build/, not under apps/
COPY --from=qlever-build /src/build/IndexBuilderMain /qlever/
COPY --from=qlever-build /src/build/ServerMain    /qlever/

ENV PATH="/qlever:${PATH}"

# Copy your helper scripts
RUN mkdir -p /qlever/scripts
COPY ./scripts/generate-qleverfile.sh /qlever/scripts/
COPY ./scripts/entrypoint.sh          /qlever/scripts/
RUN chmod +x /qlever/scripts/*.sh

# Configure Stop On Call
ENV STOP_ON_CALL_ENABLED="false"
COPY --from=soc /app/stop_on_call /usr/bin/stop_on_call

# Use the nobody user by default (65534)
USER 65534

WORKDIR /qlever

EXPOSE 7001

# Default envs (these are also used by generate-qleverfile.sh)
ENV QLEVER_SERVER_HOST_NAME="127.0.0.1"
ENV QLEVER_SERVER_PORT="7001"
ENV QLEVER_RUNTIME_SYSTEM="native"

# We let the script be the main process; keep ENTRYPOINT empty for compatibility
ENTRYPOINT [ "" ]
CMD [ "/qlever/scripts/entrypoint.sh" ]
