# syntax=docker/dockerfile:1
# Image reproductible : bases épinglées par digest, binaire statique, utilisateur non-root.
# golang:1.27.2-alpine3.24
FROM golang:1.27.2-alpine3.24@sha256:f92b6ef800e499660581efdabdf25d9d817a9d124eaf900924f0504e7e27e12d AS build
ARG SOURCE_DATE_EPOCH
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-buildid= -s -w" -o /out/netbird-sync .

# gcr.io/distroless/static:nonroot
FROM gcr.io/distroless/static:nonroot@sha256:e2e927ec666bae08560abb3c55d0659eceabb657f56b6782ab500a9fc7f555e3
COPY --from=build /out/netbird-sync /netbird-sync
USER 65532:65532
EXPOSE 8080 8081
ENTRYPOINT ["/netbird-sync"]
