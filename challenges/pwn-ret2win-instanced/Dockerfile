FROM gcc:14-bookworm@sha256:5e927c284bf55a7dc796262e311a0703344f62f41f5621eb56843111b1d37e15 AS build
ARG SOURCE_DATE_EPOCH=1767225600
ENV SOURCE_DATE_EPOCH=${SOURCE_DATE_EPOCH}
WORKDIR /src
COPY chall.c .
RUN gcc -std=gnu99 -O0 -fno-stack-protector -no-pie -fcf-protection=none -z noexecstack -z norelro \
      -Wno-deprecated-declarations -ffile-prefix-map=/src=. -Wl,--build-id=none \
      -o chall chall.c

FROM debian:bookworm-slim@sha256:7c7b2c966bc9ee8cedfeef67e0e279108992c77681fa595db4a9d65c06ccc587
RUN apt-get update && apt-get install -y --no-install-recommends socat \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --system --uid 10001 --no-create-home chall
COPY --from=build /src/chall /opt/chall
USER 10001
EXPOSE 1337
CMD ["socat", "TCP-LISTEN:1337,reuseaddr,fork", "EXEC:/opt/chall,stderr"]
