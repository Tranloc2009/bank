# PLAYBANK Simulator — Production Dockerfile (100% Free-Tier Ready)
# Hoạt động trên Hugging Face Spaces (Docker Free), Render, Koyeb hoặc máy chủ tự host.
FROM node:22-slim

WORKDIR /app

# Cài đặt công cụ biên dịch native tối thiểu cho better-sqlite3 khi dùng chế độ SQLite cục bộ
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "server.ts"]
