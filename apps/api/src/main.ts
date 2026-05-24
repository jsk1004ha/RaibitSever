import { NestFactory } from '@nestjs/core';
import { securityHeaders } from '@raibitserver/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.use((req: any, res: any, next: any) => {
    for (const [key, value] of Object.entries(securityHeaders())) res.setHeader(key, value as string);
    next();
  });
  app.setGlobalPrefix('api');
  await app.listen(process.env.PORT ? Number(process.env.PORT) : 3000);
}

void bootstrap();
