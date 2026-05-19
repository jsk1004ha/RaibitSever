function parseJson(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function hasAnyDependency(pkg, names) {
  const deps = {
    ...(pkg.dependencies || {}),
    ...(pkg.devDependencies || {}),
    ...(pkg.optionalDependencies || {}),
  };
  return names.find((name) => Object.prototype.hasOwnProperty.call(deps, name));
}

function fileExists(files, name) {
  return Object.prototype.hasOwnProperty.call(files || {}, name);
}

function getFile(files, name) {
  return files?.[name];
}

export function detectFramework(files = {}) {
  const packageJson = parseJson(getFile(files, 'package.json'));
  const scripts = packageJson.scripts || {};

  if (fileExists(files, 'package.json')) {
    if (hasAnyDependency(packageJson, ['next'])) {
      return {
        framework: 'nextjs',
        runtime: 'node',
        serviceType: 'web',
        installCommand: packageJson.packageManager?.startsWith('pnpm') ? 'pnpm install --frozen-lockfile' : 'npm install',
        buildCommand: scripts.build || 'npm run build',
        startCommand: scripts.start || 'npm start',
        port: 3000,
        outputDirectory: '.next',
      };
    }
    if (hasAnyDependency(packageJson, ['@nestjs/core'])) {
      return {
        framework: 'nestjs',
        runtime: 'node',
        serviceType: 'web',
        installCommand: 'npm install',
        buildCommand: scripts.build || 'npm run build',
        startCommand: scripts.start || 'npm run start:prod',
        port: 3000,
        outputDirectory: 'dist',
      };
    }
    if (hasAnyDependency(packageJson, ['express', 'fastify', 'koa', 'hono'])) {
      return {
        framework: 'node-http',
        runtime: 'node',
        serviceType: 'web',
        installCommand: 'npm install',
        buildCommand: scripts.build || null,
        startCommand: scripts.start || 'npm start',
        port: 3000,
        outputDirectory: null,
      };
    }
    if (hasAnyDependency(packageJson, ['vite', '@vitejs/plugin-react', 'vue', 'svelte'])) {
      return {
        framework: 'static-spa',
        runtime: 'static',
        serviceType: 'web',
        installCommand: packageJson.packageManager?.startsWith('pnpm') ? 'pnpm install --frozen-lockfile' : 'npm install',
        buildCommand: scripts.build || 'npm run build',
        startCommand: null,
        port: 80,
        outputDirectory: 'dist',
        staticContainer: 'caddy',
      };
    }
    return {
      framework: 'node-generic',
      runtime: 'node',
      serviceType: 'web',
      installCommand: 'npm install',
      buildCommand: scripts.build || null,
      startCommand: scripts.start || 'npm start',
      port: 3000,
      outputDirectory: scripts.build ? 'dist' : null,
    };
  }

  if (fileExists(files, 'requirements.txt') || fileExists(files, 'pyproject.toml')) {
    const requirements = String(getFile(files, 'requirements.txt') || '').toLowerCase();
    const isFastApi = requirements.includes('fastapi') || String(getFile(files, 'pyproject.toml') || '').toLowerCase().includes('fastapi');
    return {
      framework: isFastApi ? 'fastapi' : 'python',
      runtime: 'python',
      serviceType: 'web',
      installCommand: fileExists(files, 'requirements.txt') ? 'pip install -r requirements.txt' : 'pip install .',
      buildCommand: null,
      startCommand: isFastApi ? 'uvicorn main:app --host 0.0.0.0 --port $PORT' : 'python app.py',
      port: 8000,
      outputDirectory: null,
    };
  }

  if (fileExists(files, 'pom.xml') || fileExists(files, 'build.gradle') || fileExists(files, 'build.gradle.kts')) {
    return {
      framework: 'java',
      runtime: 'jvm',
      serviceType: 'web',
      installCommand: null,
      buildCommand: fileExists(files, 'pom.xml') ? 'mvn package -DskipTests' : './gradlew build -x test',
      startCommand: 'java -jar app.jar',
      port: 8080,
      outputDirectory: 'target',
    };
  }

  if (fileExists(files, 'go.mod')) {
    return {
      framework: 'go',
      runtime: 'go',
      serviceType: 'web',
      installCommand: null,
      buildCommand: 'go build -o app ./...',
      startCommand: './app',
      port: 8080,
      outputDirectory: '.',
    };
  }

  if (fileExists(files, 'index.html')) {
    return {
      framework: 'static-html',
      runtime: 'static',
      serviceType: 'web',
      installCommand: null,
      buildCommand: null,
      startCommand: null,
      port: 80,
      outputDirectory: '.',
      staticContainer: 'caddy',
    };
  }

  return {
    framework: 'unknown',
    runtime: 'container',
    serviceType: 'web',
    installCommand: null,
    buildCommand: null,
    startCommand: null,
    port: 8080,
    outputDirectory: null,
  };
}
