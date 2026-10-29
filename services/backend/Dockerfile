FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 UV_COMPILE_BYTECODE=1
RUN pip install --no-cache-dir uv==0.12.3 && useradd --create-home --uid 10001 monolith
WORKDIR /app/services/backend
COPY services/backend/pyproject.toml services/backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY services/backend/src ./src
COPY services/backend/migrations ./migrations
COPY packages/contracts /app/packages/contracts
RUN uv sync --frozen --no-dev && mkdir -p /app/storage && chown -R monolith:monolith /app
# Keep the image's storage location as a legacy fallback so deployments that already
# set RECALL_LOCAL_STORAGE_DIR can override it. An explicit MONOLITH_LOCAL_STORAGE_DIR
# still takes precedence through the application's environment compatibility layer.
ENV PATH="/app/services/backend/.venv/bin:$PATH" RECALL_LOCAL_STORAGE_DIR=/app/storage
USER monolith
EXPOSE 8000
CMD ["uvicorn", "monolith.api.app:app_factory", "--factory", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]
