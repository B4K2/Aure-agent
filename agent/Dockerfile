# Aura agent for a cluster (deploy/k8s). CPU torch: the embedding model is small and the cu128
# wheels pinned for local GPU dev would add several GB. kubectl uses the pod's ServiceAccount.
FROM python:3.12-slim
ARG KUBECTL_VERSION=v1.35.1
RUN apt-get update && apt-get install -y --no-install-recommends git curl ca-certificates \
 && curl -fsSLo /usr/local/bin/kubectl "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/$(dpkg --print-architecture)/kubectl" \
 && chmod +x /usr/local/bin/kubectl && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv export --frozen --no-dev --no-hashes --no-emit-project | grep -vE '^(torch|torchvision)==' > req.txt \
 && uv pip install --system --no-cache torch torchvision --index-url https://download.pytorch.org/whl/cpu \
 && uv pip install --system --no-cache -r req.txt
COPY aura aura
COPY seed seed
ENV AURA_API_HOST=0.0.0.0 AURA_RUNTIME=kubernetes HF_HOME=/app/.aura_state/hf
EXPOSE 8700
CMD ["python", "-m", "aura.main"]
