# ─── Stage 1: Builder ────────────────────────────────────────────────────────
FROM node:20-slim AS builder

# Instala Leo CLI e dependências de sistema
RUN apt-get update && apt-get install -y \
    curl git build-essential libssl-dev pkg-config \
    && rm -rf /var/lib/apt/lists/*

# Instala Rust (necessário para @aleohq/sdk)
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"

# Instala Leo CLI
RUN curl -L https://raw.githubusercontent.com/ProvableHQ/leo/mainline/install.sh | bash || \
    cargo install leo-lang --locked
ENV PATH="/root/.aleo/bin:${PATH}"

WORKDIR /app

# Copia e instala dependências Node primeiro (cache layer)
COPY package.json package-lock.json* tsconfig.json ./
RUN npm ci

# Copia o código fonte
COPY src/ ./src/
COPY templates/ ./templates/

# Compila TypeScript
RUN npm run build

# ─── Stage 2: Runtime ─────────────────────────────────────────────────────────
FROM node:20-slim AS runtime

RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

# Copia binários do Rust/Leo do builder
COPY --from=builder /root/.cargo/bin/leo /usr/local/bin/leo
COPY --from=builder /root/.aleo /root/.aleo
ENV PATH="/root/.aleo/bin:${PATH}"

WORKDIR /app

# Copia node_modules e build
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/templates ./templates

# Script de entrypoint que aguarda peers e inicia o nó
COPY docker-entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 8545 6000

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
