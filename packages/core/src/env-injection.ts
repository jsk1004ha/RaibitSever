import { getCatalogEntry, normalizeResourceEngine } from './catalog.ts';
import { slugify } from './ids.ts';

function hostFor(resource, projectSlug) {
  const name = slugify(resource.name || resource.engine || 'resource');
  return resource.internalHost || `${name}.${slugify(projectSlug || resource.projectSlug || 'project')}.svc.cluster.local`;
}

function userFor(resource) {
  return resource.username || slugify(resource.name || resource.engine || 'app');
}

function passwordFor(resource) {
  return resource.password || `generated-${slugify(resource.name || resource.engine || 'secret')}-password`;
}

function databaseFor(resource) {
  return resource.databaseName || slugify(resource.database || resource.name || 'app');
}

export function connectionEnvForResource(resource, projectSlug = 'project') {
  const engine = normalizeResourceEngine(resource.engine || resource.type);
  const entry = getCatalogEntry(engine);
  const host = hostFor(resource, projectSlug);
  const port = resource.port || defaultPort(engine);
  const username = userFor(resource);
  const password = passwordFor(resource);
  const database = databaseFor(resource);
  const bucket = resource.bucket || slugify(resource.name || 'bucket');
  const protocol = resource.tls ? 'rediss' : 'redis';

  const env = {};
  switch (entry.key) {
    case 'postgresql':
      env.DATABASE_URL = `postgresql://${username}:${password}@${host}:${port}/${database}`;
      env.POSTGRES_URL = env.DATABASE_URL;
      env.PGHOST = host;
      env.PGPORT = String(port);
      env.PGDATABASE = database;
      env.PGUSER = username;
      env.PGPASSWORD = password;
      break;
    case 'mysql':
    case 'mariadb':
      env.MYSQL_URL = `mysql://${username}:${password}@${host}:${port}/${database}`;
      env.MYSQL_HOST = host;
      env.MYSQL_PORT = String(port);
      env.MYSQL_DATABASE = database;
      env.MYSQL_USER = username;
      env.MYSQL_PASSWORD = password;
      if (entry.key === 'mariadb') env.MARIADB_URL = env.MYSQL_URL;
      break;
    case 'mongodb':
      env.MONGODB_URI = `mongodb://${username}:${password}@${host}:${port}/${database}`;
      env.MONGO_URL = env.MONGODB_URI;
      env.MONGO_HOST = host;
      env.MONGO_DATABASE = database;
      env.MONGO_USER = username;
      env.MONGO_PASSWORD = password;
      break;
    case 'redis':
      env.REDIS_URL = `${protocol}://:${password}@${host}:${port}`;
      env.REDIS_HOST = host;
      env.REDIS_PORT = String(port);
      env.REDIS_PASSWORD = password;
      break;
    case 'object-storage':
      env.S3_ENDPOINT = resource.endpoint || `https://${host}`;
      env.S3_BUCKET = bucket;
      env.S3_REGION = resource.region || 'local';
      env.S3_ACCESS_KEY = resource.accessKey || `ak-${bucket}`;
      env.S3_SECRET_KEY = resource.secretKey || `sk-${bucket}`;
      break;
    case 'vector-db':
      env.VECTOR_DB_URL = resource.url || `http://${host}:${port}`;
      env.VECTOR_DB_API_KEY = resource.apiKey || `vdb-${slugify(resource.name || 'key')}`;
      env.VECTOR_DB_COLLECTION = resource.collection || slugify(resource.name || 'collection');
      break;
    case 'message-queue':
      env.QUEUE_URL = resource.url || `nats://${host}:${port}`;
      env.QUEUE_USERNAME = username;
      env.QUEUE_PASSWORD = password;
      env.QUEUE_TOPIC = resource.topic || slugify(resource.name || 'events');
      break;
    default:
      throw new Error(`unsupported resource: ${engine}`);
  }
  return env;
}

export function injectResourceEnv(service, resources = [], projectSlug = 'project') {
  const base = { ...(service.environment || {}) };
  const attachedNames = new Set(service.attachedResources || resources.map((resource) => resource.name));
  for (const resource of resources) {
    if (!attachedNames.has(resource.name)) continue;
    Object.assign(base, connectionEnvForResource(resource, projectSlug));
  }
  return base;
}

function defaultPort(engine) {
  switch (engine) {
    case 'postgresql': return 5432;
    case 'mysql':
    case 'mariadb': return 3306;
    case 'mongodb': return 27017;
    case 'redis': return 6379;
    case 'object-storage': return 9000;
    case 'vector-db': return 6333;
    case 'message-queue': return 4222;
    default: return 0;
  }
}
