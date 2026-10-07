FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 UV_COMPILE_BYTECODE=1
RUN pip install --no-cache-dir uv==0.12.3 && useradd --create-home --uid 10001 recall
WORKDIR /app/services/backend
COPY services/backend/pyproject.toml services/backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY services/backend/src ./src
COPY services/backend/migrations ./migrations
COPY packages/contracts /app/packages/contracts
RUN uv sync --frozen --no-dev && mkdir -p /app/storage && chown -R recall:recall /app
ENV PATH="/app/services/backend/.venv/bin:$PATH" RECALL_LOCAL_STORAGE_DIR=/app/storage
USER recall
EXPOSE 8000
CMD ["uvicorn", "recall.api.app:app_factory", "--factory", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]
