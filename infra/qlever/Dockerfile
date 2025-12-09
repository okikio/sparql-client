FROM ubuntu:24.04 AS builder
ENV DEBIAN_FRONTEND=noninteractive

# Basic tools + git
RUN apt-get update && apt-get install -y wget git

# Newer CMake from Kitware (as you had)
RUN wget https://apt.kitware.com/kitware-archive.sh \
 && chmod +x kitware-archive.sh \
 && ./kitware-archive.sh \
 && apt-get update

# Build dependencies (mostly copied from your file)
RUN apt-get install -y \
    build-essential cmake libicu-dev tzdata pkg-config uuid-runtime uuid-dev \
    libjemalloc-dev ninja-build libzstd-dev libssl-dev \
    libboost1.83-dev libboost-program-options1.83-dev \
    libboost-iostreams1.83-dev libboost-url1.83-dev \
    libboost-container1.83-dev

# Fetch QLever source (repo has src/, test/, CMakeLists.txt, CompilationInfo.cmake, docker-entrypoint.sh)
WORKDIR /qlever
RUN git clone --recursive https://github.com/ad-freiburg/qlever.git .

# Configure + build binaries
WORKDIR /qlever/build
RUN cmake -DCMAKE_BUILD_TYPE=Release \
          -DLOGLEVEL=INFO \
          -DUSE_PARALLEL=true \
          -DNATIVE_ARCH=OFF \
          -GNinja ..
RUN cmake --build . --target IndexBuilderMain ServerMain

FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
WORKDIR /qlever

RUN apt-get update && apt-get install -y \
    python3-yaml unzip curl bzip2 pkg-config libicu74 python3-icu \
    libgomp1 uuid-runtime make lbzip2 libjemalloc2 libzstd1 \
    libboost-program-options1.83.0 libboost-iostreams1.83.0 \
    libboost-url1.83.0 pipx bash-completion vim sudo && \
    rm -rf /var/lib/apt/lists/*

RUN groupadd -r qlever && useradd --no-log-init -d /qlever -r -g qlever qlever && \
    chown qlever:qlever /qlever && \
    echo "qlever ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

ENV QLEVER_PROFILE=/etc/profile.d/qlever.sh
RUN echo 'eval "$(register-python-argcomplete qlever)"' >> $QLEVER_PROFILE && \
    echo "export QLEVER_ARGCOMPLETE_ENABLED=1" >> $QLEVER_PROFILE && \
    echo "export QLEVER_IS_RUNNING_IN_CONTAINER=1" >> $QLEVER_PROFILE && \
    echo 'PATH=/qlever:/qlever/.local/bin:$PATH && PS1="\u@docker:\W\$ "' >> $QLEVER_PROFILE && \
    echo 'alias ll="ls -l"' >> $QLEVER_PROFILE && \
    echo "if [ -d /data ]; then cd /data; fi" >> $QLEVER_PROFILE && \
    cp $QLEVER_PROFILE /qlever/.bashrc

USER qlever
ENV PATH=/qlever:/qlever/.local/bin:$PATH
RUN pipx install qlever
ENV QLEVER_ARGCOMPLETE_ENABLED=1
ENV QLEVER_IS_RUNNING_IN_CONTAINER=1

# Copy the freshly built binaries from the builder stage
COPY --from=builder /qlever/build/*Main /qlever/

# Copy the entrypoint script from the source checkout (also in the builder stage)
COPY --from=builder /qlever/docker-entrypoint.sh /qlever/
RUN sudo chmod +x /qlever/docker-entrypoint.sh

ENTRYPOINT ["/qlever/docker-entrypoint.sh"]
