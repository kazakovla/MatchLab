import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Matches, Max, Min } from 'class-validator';

export class UpcomingQueryDto {
  @ApiPropertyOptional({
    minimum: 1,
    maximum: 50,
    description: 'Сколько матчей вернуть. Виджет главной берёт 3–4, раздел меню — больше.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit должен быть целым числом' })
  @Min(1)
  @Max(50)
  limit?: number;
}

export class MatchdayQueryDto {
  @ApiPropertyOptional({
    example: '2026-09-19',
    description:
      'Игровой день в формате YYYY-MM-DD по часовому поясу сервиса. ' +
      'Без параметра — сегодняшний день, а если матчей в нём нет — ближайший.',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date должен быть в формате YYYY-MM-DD' })
  date?: string;
}
