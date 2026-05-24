import { NestFactory } from '@nestjs/core';
import { assertApiRuntimeConfig, securityHeaders } from '@raibitserver/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const runtimeConfig = assertApiRuntimeConfig(process.env);
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.use((req: any, res: any, next: any) => {
    for (const [key, value] of Object.entries(securityHeaders())) res.setHeader(key, value as string);
    next();
  });
  app.setGlobalPrefix('api');
  await app.listen(runtimeConfig.port);
}

void bootstrap();
