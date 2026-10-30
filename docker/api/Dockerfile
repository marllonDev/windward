# The platform API image. It carries the Sail CLI because the API is the
# parent of the engine process (ADR-0002): starting this container starts the
# engine, and there is no JVM and no Spark installation anywhere in it.
#
# Base image and every dependency are pinned to exact versions. The Sail pin
# must match engine/sail.version; scripts/check-toolchain-pins.sh enforces it.
FROM python:3.12.7-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# --- dbt 2 (Rust CLI), pinned by version and checksum ---------------------------
# dbt 2 ships as a prebuilt binary. It has no Sail adapter (ADR-0002 "Dissent"),
# so it is installed beside the Python runner that does talk to Sail.
FROM python:3.12.7-slim AS dbt2
ARG TARGETARCH
ARG DBT2_VERSION=2.0.8
ARG DBT2_SHA256_ARM64=08adc0abdcf8c077237ea3dfc78815a949557879144ee1def5c447bc2d2912cd
ARG DBT2_SHA256_AMD64=5ae21d84f6d3b96f1e4f3ba7e0265c78bee804f6c812c4c00494487fd402abbe
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN set -eu; \
    if [ "$TARGETARCH" = "arm64" ]; then ARCH=aarch64; SHA="$DBT2_SHA256_ARM64"; \
    else ARCH=x86_64; SHA="$DBT2_SHA256_AMD64"; fi; \
    NAME="dbt-core-${DBT2_VERSION}-${ARCH}-unknown-linux-gnu"; \
    curl -fsSL -o /tmp/dbt2.tgz \
      "https://github.com/dbt-labs/dbt/releases/download/v${DBT2_VERSION}/${NAME}.tar.gz"; \
    echo "${SHA}  /tmp/dbt2.tgz" | sha256sum -c -; \
    tar -xzf /tmp/dbt2.tgz -C /tmp; \
    install -m 0755 "/tmp/${NAME}/dbt" /usr/local/bin/dbt2

FROM python:3.12.7-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

COPY --from=dbt2 /usr/local/bin/dbt2 /usr/local/bin/dbt2

# The Python dbt runner that executes against Sail (ADR-0002 fallback). It lives
# in its own venv so its dependency tree cannot disturb the API's pins.
RUN python -m venv /opt/dbt-py \
    && /opt/dbt-py/bin/pip install \
        dbt-core==1.12.6 \
        dbt-spark[session]==1.11.0 \
        dbt-sail==0.1.0 \
        pyspark==4.2.0 \
        pysail==0.7.3 \
        pandas==2.2.3 \
        pyarrow==21.0.0 \
        numpy==2.5.4 \
        grpcio==1.85.0 \
        grpcio-status==1.85.0 \
        googleapis-common-protos==1.76.0 \
        protobuf==6.33.5 \
        zstandard==0.25.0

WORKDIR /srv

COPY services/api/pyproject.toml ./services/api/pyproject.toml
COPY services/api/windward_api ./services/api/windward_api
RUN pip install ./services/api

# The engine writes nothing here, but it is the directory Sail runs in, so
# relative paths in user SQL resolve against it.
COPY dbt /srv/dbt

ENV WINDWARD_DATA_DIR=/var/lib/windward/data \
    WINDWARD_DBT_BINARY=/opt/dbt-py/bin/dbt \
    WINDWARD_DBT2_BINARY=/usr/local/bin/dbt2 \
    WINDWARD_DBT_PROJECT_DIR=/srv/dbt \
    WINDWARD_DBT_PROFILES_DIR=/srv/dbt \
    WINDWARD_DBT_WORK_DIR=/var/lib/windward/data/dbt
RUN mkdir -p "$WINDWARD_DATA_DIR" \
    && useradd --system --uid 10001 --home-dir /srv windward \
    && chown -R windward:windward /srv "$WINDWARD_DATA_DIR"
USER windward

# Listen on all interfaces inside the container. Only this port is published to
# the host; the engine's 50051 and 32010 stay on the compose network.
ENV WINDWARD_API_HOST=0.0.0.0 \
    WINDWARD_API_PORT=8000 \
    WINDWARD_SAIL_BIND_HOST=0.0.0.0

EXPOSE 8000

# Liveness of the service itself. It answers while the engine is down, which is
# deliberate: engine state belongs to GET /api/v1/engine/status.
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
    CMD ["python", "-c", "import urllib.request,os,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:'+os.environ['WINDWARD_API_PORT']+'/api/v1/health', timeout=2).status==200 else 1)"]

# SIGTERM reaches this process, which stops the engine children in its
# lifespan shutdown. docker-compose allows time for that via stop_grace_period.
STOPSIGNAL SIGTERM

CMD ["python", "-m", "windward_api"]
