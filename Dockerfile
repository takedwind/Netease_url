FROM python:3.11-slim
WORKDIR /app
ARG PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple
ENV TZ=Asia/Shanghai \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_INDEX_URL=${PIP_INDEX_URL} \
    PIP_DEFAULT_TIMEOUT=120 \
    PIP_DISABLE_PIP_VERSION_CHECK=1
COPY requirements.txt requirements.txt
RUN pip install --no-cache-dir --prefer-binary --retries 10 --timeout 120 -r requirements.txt
COPY . .
RUN chmod +x /app/entrypoint.sh
EXPOSE 5000
CMD ["/app/entrypoint.sh"]
