import { Module, OnModuleInit } from '@nestjs/common';
import { BullModule, InjectQueue } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { Queue } from 'bullmq';

import matchesConfig from './matches.config';
import { MatchesController } from './matches.controller';
import { MatchesService } from './matches.service';
import { FixturesIngestService } from './fixtures-ingest.service';
import {
  FIXTURES_INGEST_JOB,
  FIXTURES_QUEUE,
  FixturesIngestProcessor,
} from './fixtures-ingest.processor';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [
    ConfigModule.forFeature(matchesConfig),
    BullModule.registerQueue({ name: FIXTURES_QUEUE }),
    PrismaModule,
    RedisModule,
  ],
  controllers: [MatchesController],
  providers: [MatchesService, FixturesIngestService, FixturesIngestProcessor],
  exports: [MatchesService, FixturesIngestService],
})
export class MatchesModule implements OnModuleInit {
  constructor(@InjectQueue(FIXTURES_QUEUE) private readonly queue: Queue) {}

  async onModuleInit(): Promise<void> {
    // Планировщик регистрируется по фиксированному идентификатору, поэтому
    // перезапуск приложения обновляет расписание задачи, а не плодит дубли.
    // В BullMQ 6 повторяющиеся задачи заводятся именно так: передача repeat
    // в queue.add больше не поддерживается.
    await this.queue.upsertJobScheduler(
      'fixtures-ingest-hourly',
      { pattern: process.env.MATCHES_INGEST_CRON ?? '17 * * * *' },
      {
        name: FIXTURES_INGEST_JOB,
        data: {},
        opts: { removeOnComplete: 50, removeOnFail: 100 },
      },
    );
  }
}
