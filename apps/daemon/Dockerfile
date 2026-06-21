# Agent daemon image. Build context = apps/daemon (self-contained Go module).
# Two stages: static Go binary, then a slim Node base carrying the Claude Code CLI
# so the `claude` runtime can spawn it. The `echo` runtime needs no CLI.

FROM golang:1.26-bookworm AS build
WORKDIR /src
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -o /daemon .

FROM node:22-bookworm-slim
# Claude Code CLI for the `claude` runtime. Drop this layer if you only use echo.
RUN npm install -g @anthropic-ai/claude-code \
  && useradd -m -u 10001 app \
  && mkdir -p /home/app/work && chown -R app /home/app
COPY --from=build /daemon /usr/local/bin/agentik-daemon

USER app
WORKDIR /home/app
ENV WORK_ROOT=/home/app/work \
    ENGINE_URL=http://engine:8787 \
    RUNTIME_KINDS=echo
ENTRYPOINT ["agentik-daemon"]
