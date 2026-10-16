FROM python:3.13-slim-bookworm@sha256:a1165e272e578941b84abc79e4ab38a0305cd12803a5c4247979ac7655f4d641
ARG SOURCE_DATE_EPOCH=1767225600
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app
COPY app/requirements.txt .
# pip et setuptools sont retirés après l'installation : leurs dépendances vendorisées (msgpack, urllib3, wheel,
# jaraco.context) portent des CVE sans correctif amont dans pip, et l'image n'en a plus besoin à l'exécution.
RUN pip install -r requirements.txt && pip uninstall -y pip setuptools wheel
COPY app/app.py .
RUN useradd --system --uid 10001 --no-create-home chall
USER 10001
EXPOSE 8080
CMD ["python", "app.py"]
