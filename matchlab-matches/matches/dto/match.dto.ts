import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class TeamSideDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() slug!: string;
  @ApiPropertyOptional({ nullable: true }) crestUrl!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Угловой индекс 0–100. null означает недостаточно данных, а не ноль.',
  })
  cornerIndex!: number | null;

  @ApiPropertyOptional({ nullable: true, description: 'Грейд A+/A/B/C/D' })
  cornerGrade!: string | null;

  @ApiProperty({ description: 'Команда входит в топ своей лиги по угловому индексу' })
  highlighted!: boolean;
}

export class LeagueDto {
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
}

export class MatchDto {
  @ApiProperty() id!: string;

  @ApiProperty({ description: 'Время начала в UTC, ISO 8601. Пояс выбирает клиент.' })
  kickoffAt!: string;

  @ApiProperty({
    description: 'false, если источник ещё не назначил час начала: показывать только дату',
  })
  kickoffTimeKnown!: boolean;

  @ApiProperty({ type: LeagueDto }) league!: LeagueDto;
  @ApiProperty({ type: TeamSideDto }) home!: TeamSideDto;
  @ApiProperty({ type: TeamSideDto }) away!: TeamSideDto;
}

export class SelectionDto {
  @ApiProperty({ example: 'top-per-league' }) rule!: string;
  @ApiProperty() topTeamsPerLeague!: number;
  @ApiProperty() windowDays!: number;
}

export class UpcomingResponseDto {
  @ApiProperty() generatedAt!: string;
  @ApiProperty({ type: SelectionDto }) selection!: SelectionDto;
  @ApiProperty({ type: [MatchDto] }) items!: MatchDto[];
}

export class MatchdayLeagueDto extends LeagueDto {
  @ApiProperty() count!: number;
}

export class MatchdayResponseDto {
  @ApiProperty({ description: 'Дата, которую запросил клиент' })
  requestedDate!: string;

  @ApiProperty({ description: 'Дата, за которую фактически отданы матчи' })
  date!: string;

  @ApiProperty({
    description:
      'false означает, что в запрошенный день матчей не было и отдан ближайший игровой день',
  })
  isRequestedDate!: boolean;

  @ApiProperty() hasMatches!: boolean;
  @ApiProperty({ type: [MatchdayLeagueDto] }) leagues!: MatchdayLeagueDto[];
  @ApiProperty({ type: [MatchDto] }) items!: MatchDto[];
}
