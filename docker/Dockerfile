# syntax=docker/dockerfile:1

# ╔═══════════════════════════════════════════════════════════════════╗
# ║  SoulFlow Orchestrator — Multi-stage Dockerfile                  ║
# ║                                                                   ║
# ║  4-Layer 캐시 전략:                                              ║
# ║    L1 의존성   — package.json 변경 시에만 재빌드                 ║
# ║    L2 컴파일   — 변경된 쪽(backend/web)만 독립 재빌드            ║
# ║    L3 런타임   — 소스와 완전 독립, 항상 캐시                     ║
# ║    L4 조립     — 빠른 COPY만 (수 초)                             ║
# ║                                                                   ║
# ║  Targets: production | full | dev                                 ║
# ╚═══════════════════════════════════════════════════════════════════╝
#
# 빌드 의존성 그래프:
#
#                native-base (apt: python3 make g++)
#                 ┌────┴────┐
#               deps     deps-prod                    ← 병렬
#                │
#         ┌──────┴──────┐
#   build-backend   build-web                         ← 병렬, 독립 캐시
#
#   python-venv ──┬→ prod-base                        ← 병렬
#                 └→ full-base (+ browser + CLI)      ← 병렬
#                       └→ dev-base (+ make/g++)
#
#   production = prod-base + deps-prod + builds
#   full       = full-base + deps-prod + builds
#   dev        = dev-base  + deps      (소스는 볼륨 마운트)

# ═══════════════════════════════════════════════════════════════════
# L1: 의존성 (package.json 변경 시에만 재빌드)
# ═══════════════════════════════════════════════════════════════════

# ── native-base: 네이티브 모듈 빌드 도구 (deps, deps-prod 공유) ──
FROM node:22-slim AS native-base
WORKDIR /build

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++

# ── deps: 전체 의존성 (devDependencies 포함, 빌드용) ────────────
FROM native-base AS deps

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci

COPY web/package.json web/package-lock.json ./web/
RUN --mount=type=cache,target=/root/.npm \
    cd web && npm ci

# ── deps-prod: 프로덕션 의존성만 (네이티브 모듈 컴파일 포함) ────
FROM native-base AS deps-prod

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev

# ═══════════════════════════════════════════════════════════════════
# L2: 컴파일 (변경된 쪽만 독립 재빌드)
# ═══════════════════════════════════════════════════════════════════

# ── build-backend: TypeScript → JavaScript ──────────────────────
# src/ 변경 시에만 재빌드. web/ 변경과 무관.
FROM deps AS build-backend

COPY tsconfig.json ./
COPY src/ src/
RUN npm run build

# ── build-web: Vite → dist/web/ ────────────────────────────────
# web/ 변경 시에만 재빌드. src/ 변경과 무관.
FROM deps AS build-web

COPY web/ web/
RUN cd web && npx vite build

# ═══════════════════════════════════════════════════════════════════
# L3: 런타임 기반 (소스와 완전 독립 — 항상 캐시)
# ═══════════════════════════════════════════════════════════════════

# ── python-venv: pip 패키지 사전 빌드 ───────────────────────────
FROM python:3.12-slim AS python-venv

RUN python3 -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir markdown

# ── prod-base: 경량 프로덕션 시스템 (python3 + tini) ────────────
FROM node:22-slim AS prod-base

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-lxml tini

COPY --from=python-venv /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

WORKDIR /app

# ── full-base: prod-base 동등 + 브라우저 + CLI 에이전트 ─────────
# prod-base와 병렬 빌드 가능 (독립 FROM node:22-slim).
# CLI 에이전트 설치 + agent-browser install은 수 분 소요되므로
# 소스 변경과 무관하게 캐시를 유지하는 것이 핵심.
FROM node:22-slim AS full-base

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-lxml tini \
    # Chromium headless
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 \
    libcups2 libdrm2 libgbm1 libxkbcommon0 \
    # X11/Wayland rendering
    libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    # Text/graphics
    libpango-1.0-0 libcairo2 libasound2 libatspi2.0-0 \
    # Certificates
    ca-certificates \
    # Fonts (한국어 + 기본)
    fonts-noto-cjk fonts-liberation

COPY --from=python-venv /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# CLI agents + Agent Browser (가장 고비용 레이어 — 캐시 필수)
RUN --mount=type=cache,target=/root/.npm \
    (npm install -g @anthropic-ai/claude-code@latest || true) && \
    (npm install -g @openai/codex@latest || true) && \
    (npm install -g @google/gemini-cli@latest || true) && \
    npm install -g agent-browser && \
    agent-browser install

WORKDIR /app

# ── dev-base: full-base + 네이티브 빌드 도구 ────────────────────
FROM full-base AS dev-base

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++

RUN --mount=type=cache,target=/root/.npm \
    npm install -g nodemon

WORKDIR /build

# ═══════════════════════════════════════════════════════════════════
# L4: 최종 조립 (빠른 COPY만 — 소스 변경 시 여기만 재실행)
# ═══════════════════════════════════════════════════════════════════

# ── production: 경량 프로덕션 이미지 ────────────────────────────
FROM prod-base AS production

COPY --from=deps-prod /build/node_modules node_modules/
COPY package.json ./
COPY --from=build-backend /build/dist/ dist/
COPY --from=build-web /build/dist/web/ dist/web/
COPY src/skills/ src/skills/
COPY scripts/ scripts/

ENV WORKSPACE=/data
ENV NODE_ENV=production

EXPOSE 4200

ENTRYPOINT ["tini", "--"]
CMD ["node", "dist/main.js"]

# ── full: production + 브라우저 + CLI 에이전트 ──────────────────
FROM full-base AS full

COPY --from=deps-prod /build/node_modules node_modules/
COPY package.json ./
COPY --from=build-backend /build/dist/ dist/
COPY --from=build-web /build/dist/web/ dist/web/
COPY src/skills/ src/skills/
COPY scripts/ scripts/

ENV WORKSPACE=/data
ENV NODE_ENV=production

EXPOSE 4200

ENTRYPOINT ["tini", "--"]
CMD ["node", "dist/main.js"]

# ── dev: 개발 환경 (소스는 볼륨 마운트) ─────────────────────────
FROM dev-base AS dev

COPY --from=deps /build/node_modules node_modules/
COPY --from=deps /build/web/node_modules web/node_modules/
COPY package.json tsconfig.json ./

ENTRYPOINT ["tini", "--"]
CMD ["npx", "tsx", "watch", "--clear-screen=false", "src/main.ts"]
