export const RESOURCE_CATALOG = Object.freeze({
  postgresql: {
    type: 'database',
    engine: 'postgresql',
    displayName: 'PostgreSQL',
    defaultVersion: '16',
    priority: 1,
    operator: 'CloudNativePG',
    env: ['DATABASE_URL', 'POSTGRES_URL', 'PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD'],
    features: ['sql-editor', 'table-browser', 'extensions', 'backup-restore', 'pitr', 'read-replica', 'pooling'],
  },
  mysql: {
    type: 'database',
    engine: 'mysql',
    displayName: 'MySQL',
    defaultVersion: '8',
    priority: 1,
    operator: 'Percona Operator for MySQL',
    env: ['MYSQL_URL', 'MYSQL_HOST', 'MYSQL_PORT', 'MYSQL_DATABASE', 'MYSQL_USER', 'MYSQL_PASSWORD'],
    features: ['sql-editor', 'table-browser', 'indexes', 'slow-query-logs', 'backup-restore'],
  },
  mariadb: {
    type: 'database',
    engine: 'mariadb',
    displayName: 'MariaDB',
    defaultVersion: '11',
    priority: 2,
    operator: 'MariaDB Operator or Percona-compatible profile',
    env: ['MARIADB_URL', 'MYSQL_URL', 'MYSQL_HOST', 'MYSQL_PORT', 'MYSQL_DATABASE', 'MYSQL_USER', 'MYSQL_PASSWORD'],
    features: ['sql-editor', 'table-browser', 'backup-restore'],
  },
  mongodb: {
    type: 'database',
    engine: 'mongodb',
    displayName: 'MongoDB',
    defaultVersion: '7',
    priority: 2,
    operator: 'MongoDB Kubernetes Operator / Atlas Operator',
    env: ['MONGODB_URI', 'MONGO_URL', 'MONGO_HOST', 'MONGO_DATABASE', 'MONGO_USER', 'MONGO_PASSWORD'],
    features: ['collection-browser', 'document-editor', 'index-management', 'backup-restore'],
  },
  redis: {
    type: 'cache',
    engine: 'redis',
    displayName: 'Redis',
    defaultVersion: '7',
    priority: 1,
    operator: 'Redis Operator / Redis Enterprise Operator / Upstash adapter',
    env: ['REDIS_URL', 'REDIS_HOST', 'REDIS_PORT', 'REDIS_PASSWORD'],
    features: ['key-browser', 'ttl', 'memory-usage', 'eviction-policy', 'pubsub-monitoring'],
  },
  'object-storage': {
    type: 'storage',
    engine: 's3-compatible',
    displayName: 'Object Storage',
    defaultVersion: 's3',
    priority: 1,
    operator: 'MinIO / S3-compatible provider adapter',
    env: ['S3_ENDPOINT', 'S3_BUCKET', 'S3_REGION', 'S3_ACCESS_KEY', 'S3_SECRET_KEY'],
    features: ['bucket-management', 'presigned-url', 'cors', 'public-private-policy', 'cdn-ready'],
  },
  'vector-db': {
    type: 'vector',
    engine: 'qdrant-compatible',
    displayName: 'Vector Database',
    defaultVersion: 'latest',
    priority: 3,
    operator: 'Qdrant/Weaviate/Milvus provider adapter',
    env: ['VECTOR_DB_URL', 'VECTOR_DB_API_KEY', 'VECTOR_DB_COLLECTION'],
    features: ['collection-management', 'embedding-dimensions', 'similarity-search-test', 'usage-monitoring'],
  },
  'message-queue': {
    type: 'queue',
    engine: 'nats-compatible',
    displayName: 'Message Queue',
    defaultVersion: 'latest',
    priority: 4,
    operator: 'NATS/Kafka/Redpanda/RabbitMQ provider adapter',
    env: ['QUEUE_URL', 'QUEUE_USERNAME', 'QUEUE_PASSWORD', 'QUEUE_TOPIC'],
    features: ['topic-management', 'consumer-lag', 'dead-letter-queue', 'usage-monitoring'],
  },
});

export function listCatalog() {
  return Object.entries(RESOURCE_CATALOG).map(([key, value]) => ({ key, ...value }));
}

export function getCatalogEntry(engine) {
  const key = normalizeResourceEngine(engine);
  const entry = RESOURCE_CATALOG[key];
  if (!entry) throw new Error(`unsupported resource engine: ${engine}`);
  return { key, ...entry };
}

export function normalizeResourceEngine(engine) {
  const value = String(engine || '').toLowerCase().replace(/_/g, '-');
  if (['postgres', 'postgresql', 'pg'].includes(value)) return 'postgresql';
  if (['mysql'].includes(value)) return 'mysql';
  if (['mariadb'].includes(value)) return 'mariadb';
  if (['mongo', 'mongodb'].includes(value)) return 'mongodb';
  if (['redis', 'valkey'].includes(value)) return 'redis';
  if (['s3', 'minio', 'object', 'object-storage', 'storage'].includes(value)) return 'object-storage';
  if (['vector', 'vector-db', 'qdrant', 'weaviate', 'milvus'].includes(value)) return 'vector-db';
  if (['queue', 'message-queue', 'nats', 'kafka', 'redpanda', 'rabbitmq'].includes(value)) return 'message-queue';
  return value;
}
