# Neo4j Setup for Coolify

## Deploy Options

### Option 1: Docker Compose (Recommended)

1. Di Coolify → New Resource → **Docker Compose**
2. Paste isi `docker-compose.yml` atau point ke repo ini
3. Set environment variables di Coolify UI:
   - `NEO4J_PASSWORD` — password untuk user neo4j (min 8 chars)
   - `NEO4J_HEAP_MAX` — max heap memory (default: 512m)
   - `NEO4J_PAGECACHE` — page cache size (default: 256m)
4. Deploy

### Option 2: Dockerfile

1. Di Coolify → New Resource → **Dockerfile**
2. Set build context ke folder `neo4j/`
3. Override env vars di Coolify UI
4. Deploy

## Ports

- `7474` — Neo4j Browser (HTTP)
- `7687` — Bolt protocol (driver connection)

## Connect dari App

Setelah deploy, set env vars di app:

```
NEO4J_URI=bolt://<neo4j-host>:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=<password-yang-kamu-set>
```

Kalau app dan Neo4j di server Coolify yang sama, aktifkan
"Connect to Predefined Network" di kedua resource.

## Backup

Neo4j Community Edition perlu stop database sebelum dump:

```bash
# Masuk terminal container di Coolify
neo4j stop
neo4j-admin database dump neo4j --to-path=/data/backups/
neo4j start
```

Atau backup volume dari host:

```bash
docker run --rm \
  -v <volume_name>:/source:ro \
  -v /opt/backups:/backup \
  alpine tar czf /backup/neo4j_$(date +%Y%m%d).tar.gz -C /source .
```

## Memory Guide

| Server RAM | NEO4J_HEAP_MAX | NEO4J_PAGECACHE |
| ---------- | -------------- | --------------- |
| 2 GB       | 512m           | 256m            |
| 4 GB       | 1G             | 512m            |
| 8 GB+      | 2G             | 1G              |

Total Neo4j memory jangan lebih dari 50-60% RAM server.
