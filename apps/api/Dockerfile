FROM node:22-slim

ARG PNPM_VERSION=10
ARG APP=api
ENV APP=${APP}
ENV NODE_ENV=production

RUN npm install -g pnpm@${PNPM_VERSION}
RUN mkdir /app && chown node:node /app

USER node
WORKDIR /app

COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --chown=node:node packages/shared/package.json packages/shared/
COPY --chown=node:node apps/api/package.json apps/api/
COPY --chown=node:node apps/worker/package.json apps/worker/
COPY --chown=node:node apps/web/package.json apps/web/

RUN NODE_ENV=development pnpm install --frozen-lockfile --filter "@tradekaro/${APP}..."

COPY --chown=node:node . .

RUN pnpm --filter "@tradekaro/${APP}" build

EXPOSE 4000
CMD ["sh", "-c", "exec pnpm --filter @tradekaro/$APP exec tsx src/index.ts"]