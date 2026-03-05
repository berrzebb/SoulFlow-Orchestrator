# ── Stage 1: Dependencies ─────────────────────────────────────────────────────
FROM node:22-slim AS deps
WORKDIR /build

# better-sqlite3 네이티브 빌드에 필요한 도구
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY web/package.json web/package-lock.json ./web/
RUN cd web && npm ci

# ── Stage 2: Build ────────────────────────────────────────────────────────────
FROM deps AS build
WORKDIR /build

COPY tsconfig.json ./
COPY src/ src/
RUN npm run build

COPY web/ web/
RUN cd web && npx vite build

# ── Stage 3: Production ──────────────────────────────────────────────────────
FROM node:22-slim AS production

# 런타임: python3 + lxml (HWPX 스킬), tini (PID 1)
# 빌드 전용: make, g++ (better-sqlite3 네이티브 컴파일 후 제거)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-lxml tini make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
    && apt-get purge -y make g++ \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

# 빌드 산출물
COPY --from=build /build/dist/ dist/

# 빌트인 스킬 (.md, .sh, .py)
COPY src/skills/ src/skills/

# 기본 워크플로우 템플릿 (WORKSPACE에 없으면 자동 시드)
COPY workspace/workflows/ default-workflows/

ENV WORKSPACE=/data
ENV NODE_ENV=production

EXPOSE 4200

ENTRYPOINT ["tini", "--"]
CMD ["node", "dist/main.js"]

# ── Stage 4: Full (+ CLI agents) ─────────────────────────────────────────────
FROM production AS full

# CLI 에이전트의 Rust HTTP 클라이언트가 시스템 CA 번들 필요
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g @anthropic-ai/claude-code@latest || true
RUN npm install -g @openai/codex@latest || true
RUN npm install -g @google/gemini-cli@latest || true

# ── Stage 5: Dev (deps + CLI agents + devDependencies) ──────────────────────
FROM deps AS dev

# CLI 에이전트의 Rust HTTP 클라이언트가 시스템 CA 번들 필요
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g @anthropic-ai/claude-code@latest || true
RUN npm install -g @openai/codex@latest || true
RUN npm install -g @google/gemini-cli@latest || true
