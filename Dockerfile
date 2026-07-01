FROM nginx:1.28-alpine

ARG APP_VERSION=2.0.0
ARG VCS_REF=unknown
ARG SOURCE_URL=local

LABEL org.opencontainers.image.title="Finance OS" \
      org.opencontainers.image.description="Facturation, trésorerie, achats et paie" \
      org.opencontainers.image.version="$APP_VERSION" \
      org.opencontainers.image.revision="$VCS_REF" \
      org.opencontainers.image.source="$SOURCE_URL"

COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY outputs/prototype/ /usr/share/nginx/html/

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz >/dev/null || exit 1
