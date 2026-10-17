FROM node:24-alpine AS source
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .

# The Vite dev server of compose.dev.yaml, which syncs source edits into /app.
FROM source AS dev
CMD ["node", "node_modules/vite/bin/vite.js", "--host", "0.0.0.0", "--port", "3080", "--strictPort"]

FROM source AS build
RUN npm run build

FROM nginx:1.28-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
