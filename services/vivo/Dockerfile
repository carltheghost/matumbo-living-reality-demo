FROM python:3.13-slim
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt && useradd --uid 10001 --create-home viva
COPY server ./server
COPY web ./web
COPY models ./models
RUN mkdir -p /data && chown -R viva:viva /app /data
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 VIVA_DB=/data/viva.sqlite PORT=8765 OPENBLAS_NUM_THREADS=1
USER 10001
EXPOSE 8765
CMD ["python", "-m", "server", "--host", "0.0.0.0"]
