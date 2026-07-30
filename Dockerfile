FROM node:20-alpine AS build

WORKDIR /app

# Copy package.json and package-lock.json first to leverage Docker cache
COPY package*.json ./
RUN npm ci

# Copy the rest of the application
COPY . .

# Multi-stage build to keep the final image clean
FROM node:20-alpine

WORKDIR /app

# Copy node_modules and all code from the build stage
COPY --from=build /app /app

ENV PORT=3003
EXPOSE 3003

# Run the server
CMD ["node", "server/index.js"]
