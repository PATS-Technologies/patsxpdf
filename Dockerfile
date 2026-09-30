FROM ubuntu:24.04 AS node-base

ARG NODE_VERSION=24.18.0
ENV DEBIAN_FRONTEND=noninteractive

RUN printf 'Acquire::Retries "8";\nAcquire::http::Timeout "45";\nAcquire::https::Timeout "45";\n' > /etc/apt/apt.conf.d/99network-retries \
	&& apt-get update \
	&& apt-get upgrade -y \
	&& apt-get install -y --no-install-recommends ca-certificates curl xz-utils \
	&& arch="$(dpkg --print-architecture)" \
	&& case "${arch}" in amd64) node_arch='x64' ;; arm64) node_arch='arm64' ;; *) echo "Unsupported architecture: ${arch}"; exit 1 ;; esac \
	&& cd /tmp \
	&& curl -fsSLO "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${node_arch}.tar.xz" \
	&& curl -fsSLO "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt" \
	&& grep " node-v${NODE_VERSION}-linux-${node_arch}.tar.xz$" SHASUMS256.txt | sha256sum -c - \
	&& tar -xJf "node-v${NODE_VERSION}-linux-${node_arch}.tar.xz" -C /usr/local --strip-components=1 --no-same-owner \
	&& node --version \
	&& npm --version \
	&& rm -rf /tmp/* /var/lib/apt/lists/*

FROM node-base AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node-base AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM ubuntu:24.04 AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
RUN apt-get update \
	&& apt-get upgrade -y \
	&& apt-get install -y --no-install-recommends ca-certificates tini \
	&& rm -rf /var/lib/apt/lists/* \
	&& groupadd --system --gid 1001 nodejs \
	&& useradd --system --uid 1001 --gid nodejs --shell /usr/sbin/nologin nextjs \
	&& mkdir -p /data/pdfs \
	&& chown -R nextjs:nodejs /data
COPY --from=node-base /usr/local/bin/node /usr/local/bin/node
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.js"]
