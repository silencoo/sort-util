# Stage 1: Build Frontend
FROM node:18-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install
COPY frontend .
RUN npm run build

# Stage 2: Production Backend
FROM python:3.10-slim
WORKDIR /app

# Install system tools for fast directory scanning
RUN apt-get update && apt-get install -y tree curl && rm -rf /var/lib/apt/lists/*

# Python dependencies
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Application code
COPY backend .
COPY --from=frontend-builder /app/backend/dist /app/dist

# Configuration
EXPOSE 5000
VOLUME ["/data"]
ENV TREE_DIR=/data/.fileanalyzer
ENV DATA_DIR=/data
ENV FLASK_ENV=production

# Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:5000/api/config || exit 1

# Production server via gunicorn
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "2", "--timeout", "600", "app:app"]
