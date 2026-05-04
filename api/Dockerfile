# 엠코소아청소년과 챗봇 API — Cloud Run
# NOTE: dist 는 로컬에서 빌드해서 COPY 한다 (Cloud Build container 의 한국어 문자
# 인코딩 처리 이슈를 우회). 로컬 `npm run build` 후 dist 를 업로드.
FROM node:20-slim
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080
ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

COPY dist ./dist

USER node

EXPOSE 8080
CMD ["node", "dist/server.js"]
