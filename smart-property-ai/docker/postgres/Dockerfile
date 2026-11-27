# PostGIS (spatial) + pgvector (RAG embeddings) in one Postgres instance.
# Based on pgvector (current Debian) + PostGIS from the PGDG repo; the postgis/postgis:16-3.x
# images are on Debian bullseye, whose PGDG apt repo has been retired (apt-get 404).
FROM pgvector/pgvector:pg16
RUN apt-get update \
 && apt-get install -y --no-install-recommends postgresql-16-postgis-3 \
 && rm -rf /var/lib/apt/lists/*
