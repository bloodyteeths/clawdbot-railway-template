# Build clawdbot from source to avoid npm packaging gaps (some dist files are not shipped).
FROM node:24-bookworm AS clawdbot-build

# Dependencies needed for clawdbot build
RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    git \
    ca-certificates \
    curl \
    python3 \
    make \
    g++ \
  && rm -rf /var/lib/apt/lists/*

# Install Bun (clawdbot build uses it)
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

RUN corepack enable

WORKDIR /clawdbot

# Pin to a known ref (tag/branch). If it doesn't exist, fall back to main.
ARG CLAWDBOT_GIT_REF=v2026.2.9
RUN git clone --depth 1 --branch "${CLAWDBOT_GIT_REF}" https://github.com/clawdbot/clawdbot.git .

# Patch: relax version requirements for packages that may reference unpublished versions.
# Apply to all extension package.json files to handle workspace protocol (workspace:*).
RUN set -eux; \
  find ./extensions -name 'package.json' -type f | while read -r f; do \
    sed -i -E 's/"clawdbot"[[:space:]]*:[[:space:]]*">=[^"]+"/"clawdbot": "*"/g' "$f"; \
    sed -i -E 's/"clawdbot"[[:space:]]*:[[:space:]]*"workspace:[^"]+"/"clawdbot": "*"/g' "$f"; \
  done

RUN pnpm install --no-frozen-lockfile
RUN pnpm build
ENV CLAWDBOT_PREFER_PNPM=1
RUN pnpm ui:install && pnpm ui:build


# Runtime image
FROM node:24-bookworm
ENV NODE_ENV=production

RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    unzip \
    ffmpeg \
    python3 \
    python3-pip \
    jq \
    tini \
    # Chromium and dependencies for browser automation
    chromium \
    chromium-sandbox \
    fonts-liberation \
    fonts-noto-color-emoji \
  && rm -rf /var/lib/apt/lists/*

# Set Chromium path for Puppeteer/Playwright
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium
ENV CHROME_PATH=/usr/bin/chromium

# Install uv (Python package manager for nano-banana-pro image generation)
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
ENV PATH="/root/.local/bin:${PATH}"

# Install gog CLI (Google Workspace CLI)
RUN curl -fsSL https://github.com/steipete/gogcli/releases/download/v0.9.0/gogcli_0.9.0_linux_amd64.tar.gz \
    | tar -xz -C /usr/local/bin gog \
    && chmod +x /usr/local/bin/gog

WORKDIR /app

# Wrapper deps
COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force

# Copy built clawdbot
COPY --from=clawdbot-build /clawdbot /clawdbot

# Install Playwright globally for Moltbot browser automation
ENV PLAYWRIGHT_BROWSERS_PATH=/root/.cache/ms-playwright
RUN npm install -g playwright && playwright install --with-deps chromium

# Provide a clawdbot executable
RUN printf '%s\n' '#!/usr/bin/env bash' 'exec node /clawdbot/dist/entry.js "$@"' > /usr/local/bin/clawdbot \
  && chmod +x /usr/local/bin/clawdbot

COPY src ./src
COPY scripts ./scripts
COPY CLAWD_TOOLS_PROMPT.md ./CLAWD_TOOLS_PROMPT.md
COPY CLAUDE.md ./CLAUDE.md
RUN chmod +x ./scripts/entrypoint.sh

# The wrapper listens on this port.
ENV CLAWDBOT_PUBLIC_PORT=8080
ENV PORT=8080
EXPOSE 8080

# Use tini as init to properly reap zombie processes from browser automation
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["./scripts/entrypoint.sh"]
