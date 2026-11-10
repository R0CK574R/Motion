# Stage 1: compile the C++ engine and run its unit tests. A failing test
# fails the image build, so a broken engine can never be deployed.
FROM python:3.12-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends g++ cmake make \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
RUN cmake -S . -B build -Dpybind11_DIR="$(python -m pybind11 --cmakedir)" \
    && cmake --build build -j \
    && ctest --test-dir build --output-on-failure

# Stage 2: the runtime image has no compiler, only the built module.
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY --from=build /src/service/ ./
RUN useradd --system --no-create-home risk
USER risk
ENV PORT=8000
EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 \
  CMD python -c "import os,urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:'+os.environ.get('PORT','8000')+'/health').status==200 else 1)"
CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port ${PORT}"]
