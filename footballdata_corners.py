#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Выгрузка угловых и ударов с football-data.co.uk и расчёт «Углового индекса»
по формуле ТЗ MatchLab.

Запуск
------
    python3 footballdata_corners.py --seasons 2425 2526 --out ./out

Пересчёт по уже скачанным файлам, без сети:
    python3 footballdata_corners.py --seasons 2425 2526 --out ./out --offline

Перекачать файлы заново (текущий сезон обновляется на сайте):
    python3 footballdata_corners.py --seasons 2526 --refresh --out ./out
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import os
import sys
import time
import urllib.error
import urllib.request
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Iterable

BASE = "https://www.football-data.co.uk/mmz4281"

LEAGUES = {
    "E0": "Premier League (Англия)",
    "SP1": "La Liga (Испания)",
    "I1": "Serie A (Италия)",
    "D1": "Bundesliga (Германия)",
    "F1": "Ligue 1 (Франция)",
}

# Имена колонок в файлах источника.
COL_DIV = "Div"
COL_DATE = "Date"
COL_HOME = "HomeTeam"
COL_AWAY = "AwayTeam"
COL_HOME_SHOTS = "HS"
COL_AWAY_SHOTS = "AS"
COL_HOME_SHOTS_ON = "HST"
COL_AWAY_SHOTS_ON = "AST"
COL_HOME_CORNERS = "HC"
COL_AWAY_CORNERS = "AC"

REQUIRED_COLUMNS = [COL_HOME, COL_AWAY, COL_HOME_SHOTS, COL_AWAY_SHOTS, COL_HOME_CORNERS, COL_AWAY_CORNERS]

GRADE_THRESHOLDS = [(85, "A+"), (70, "A"), (50, "B"), (30, "C"), (0, "D")]

USER_AGENT = "MatchLab-corner-index/1.0"


# --------------------------------------------------------------------------
# Загрузка файлов
# --------------------------------------------------------------------------


class DownloadError(Exception):
    pass


def season_label(code: str) -> str:
    """'2425' -> '2024/25'."""
    if len(code) != 4 or not code.isdigit():
        return code
    return f"20{code[:2]}/{code[2:]}"


def fetch_csv(
    league: str,
    season: str,
    cache_dir: str,
    offline: bool = False,
    refresh: bool = False,
    timeout: int = 60,
    attempts: int = 3,
) -> str | None:
    """Возвращает путь к локальному файлу или None, если получить его не вышло."""
    os.makedirs(cache_dir, exist_ok=True)
    path = os.path.join(cache_dir, f"{season}_{league}.csv")

    if os.path.exists(path) and not refresh:
        return path
    if offline:
        return path if os.path.exists(path) else None

    url = f"{BASE}/{season}/{league}.csv"
    delay = 2.0
    last: Exception | None = None
    for i in range(attempts):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                raw = resp.read()
            if len(raw) < 200:
                raise DownloadError(f"подозрительно маленький файл ({len(raw)} байт)")
            # Файлы приходят в cp1252, но встречается и utf-8; пишем как есть,
            # декодированием займётся разбор.
            with open(path, "wb") as f:
                f.write(raw)
            return path
        except urllib.error.HTTPError as e:
            if e.code == 404:
                # Нормальная ситуация: сезон ещё не начался или лиги в нём нет.
                return None
            last = e
            time.sleep(delay * (i + 1))
        except (urllib.error.URLError, TimeoutError, DownloadError) as e:
            last = e
            time.sleep(delay * (i + 1))
    print(f"  не удалось скачать {url}: {last}", file=sys.stderr)
    return None


def read_rows(path: str) -> tuple[list[dict], list[str]]:
    """Читает CSV, подбирая кодировку. Возвращает строки и список колонок."""
    with open(path, "rb") as f:
        raw = f.read()
    text: str | None = None
    for enc in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            text = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    if text is None:
        text = raw.decode("latin-1", errors="replace")

    reader = csv.DictReader(io.StringIO(text))
    fieldnames = [c.strip() for c in (reader.fieldnames or [])]
    rows = []
    for r in reader:
        # В хвосте файлов бывают пустые строки-разделители.
        if not r.get(COL_HOME) and not r.get(COL_AWAY):
            continue
        rows.append({(k.strip() if k else k): v for k, v in r.items()})
    return rows, fieldnames


# --------------------------------------------------------------------------
# Разбор значений
# --------------------------------------------------------------------------


def to_int(value: str | None) -> int | None:
    """
    Пустая ячейка и ноль — разные вещи.

    В старых сезонах часть показателей не собрана; такой матч должен быть
    отброшен, а не учтён как матч с нулём ударов.
    """
    if value is None:
        return None
    v = value.strip()
    if not v:
        return None
    try:
        return int(float(v))
    except ValueError:
        return None


def to_date(value: str | None) -> date | None:
    if not value:
        return None
    v = value.strip()
    for fmt in ("%d/%m/%Y", "%d/%m/%y"):
        try:
            return datetime.strptime(v, fmt).date()
        except ValueError:
            continue
    return None


# --------------------------------------------------------------------------
# Агрегация
# --------------------------------------------------------------------------


@dataclass
class TeamAgg:
    team: str
    league_code: str
    league: str
    matches: int = 0
    corners_for: int = 0
    corners_against: int = 0
    shots_for: int = 0
    shots_against: int = 0
    shots_on_for: int = 0
    first_match: date | None = None
    last_match: date | None = None
    seasons: set = field(default_factory=set)


def canonical(name: str, mapping: dict[str, str]) -> str:
    n = (name or "").strip()
    return mapping.get(n, n)


def collect(
    leagues: dict[str, str],
    seasons: Iterable[str],
    cache_dir: str,
    offline: bool,
    refresh: bool,
    mapping: dict[str, str],
    verbose: bool = True,
) -> tuple[dict[tuple[str, str], TeamAgg], dict]:
    agg: dict[tuple[str, str], TeamAgg] = {}
    report = {
        "files_ok": 0,
        "files_missing": [],
        "rows_total": 0,
        "rows_used": 0,
        "rows_skipped_no_stats": 0,
        "rows_skipped_bad": 0,
        "per_file": [],
        "columns_missing": [],
    }

    for league_code, league_name in leagues.items():
        for season in seasons:
            path = fetch_csv(league_code, season, cache_dir, offline=offline, refresh=refresh)
            if not path:
                report["files_missing"].append(f"{league_code} {season_label(season)}")
                if verbose:
                    print(f"  {league_name}, {season_label(season)}: файла нет", flush=True)
                continue

            rows, fieldnames = read_rows(path)
            missing = [c for c in REQUIRED_COLUMNS if c not in fieldnames]
            if missing:
                # Порядок колонок между лигами различается (в E0 есть Referee),
                # поэтому разбор идёт по именам. Если имени нет вовсе — файл
                # другого формата, и молча считать по нему нельзя.
                report["columns_missing"].append(
                    {"file": os.path.basename(path), "missing": missing}
                )
                if verbose:
                    print(
                        f"  {league_name}, {season_label(season)}: "
                        f"нет колонок {', '.join(missing)} — файл пропущен",
                        flush=True,
                    )
                continue

            report["files_ok"] += 1
            used = skipped = bad = 0

            for r in rows:
                report["rows_total"] += 1
                home = canonical(r.get(COL_HOME, ""), mapping)
                away = canonical(r.get(COL_AWAY, ""), mapping)
                if not home or not away:
                    bad += 1
                    continue

                hs = to_int(r.get(COL_HOME_SHOTS))
                a_s = to_int(r.get(COL_AWAY_SHOTS))
                hc = to_int(r.get(COL_HOME_CORNERS))
                ac = to_int(r.get(COL_AWAY_CORNERS))
                if None in (hs, a_s, hc, ac):
                    skipped += 1
                    continue

                hst = to_int(r.get(COL_HOME_SHOTS_ON)) or 0
                ast = to_int(r.get(COL_AWAY_SHOTS_ON)) or 0
                d = to_date(r.get(COL_DATE))

                for team, opp_team, sf, sa, cf, ca, son in (
                    (home, away, hs, a_s, hc, ac, hst),
                    (away, home, a_s, hs, ac, hc, ast),
                ):
                    k = (league_code, team)
                    if k not in agg:
                        agg[k] = TeamAgg(team=team, league_code=league_code, league=league_name)
                    a = agg[k]
                    a.matches += 1
                    a.shots_for += sf
                    a.shots_against += sa
                    a.corners_for += cf
                    a.corners_against += ca
                    a.shots_on_for += son
                    a.seasons.add(season)
                    if d:
                        a.first_match = d if a.first_match is None else min(a.first_match, d)
                        a.last_match = d if a.last_match is None else max(a.last_match, d)
                used += 1

            report["rows_used"] += used
            report["rows_skipped_no_stats"] += skipped
            report["rows_skipped_bad"] += bad
            report["per_file"].append(
                {
                    "league": league_code,
                    "season": season_label(season),
                    "rows": len(rows),
                    "used": used,
                    "skipped_no_stats": skipped,
                    "skipped_bad": bad,
                }
            )
            if verbose:
                print(
                    f"  {league_name}, {season_label(season)}: строк {len(rows)}, "
                    f"в расчёт {used}, без статистики {skipped}",
                    flush=True,
                )

    return agg, report


# --------------------------------------------------------------------------
# Расчёт индекса
# --------------------------------------------------------------------------


def grade(ci: float) -> str:
    for threshold, letter in GRADE_THRESHOLDS:
        if ci >= threshold:
            return letter
    return "D"


def compute_index(agg: dict[tuple[str, str], TeamAgg], min_matches: int = 10) -> list[dict]:
    """
    Формула ТЗ: «делим количество ударов на количество угловых». Деление
    реализовано буквально, raw_index = удары за / угловые за. Название в ТЗ
    («среднее количество угловых») этой величине не соответствует: отношение
    ударов к угловым средним числом угловых не является. На расчёт не влияет,
    на подпись столбца в интерфейсе влияет — формулировку надо уточнить.

    CI — то же значение, нормированное внутри лиги в шкалу 0–100.
    """
    rows: list[dict] = []
    for a in agg.values():
        if a.matches == 0:
            continue
        raw = (a.shots_for / a.corners_for) if a.corners_for else None
        rows.append(
            {
                "league_id": a.league_code,
                "league": a.league,
                "team_id": "",
                "team": a.team,
                "matches": a.matches,
                "skipped_matches": 0,
                "seasons": "+".join(season_label(s) for s in sorted(a.seasons)),
                "first_match": a.first_match.isoformat() if a.first_match else "",
                "last_match": a.last_match.isoformat() if a.last_match else "",
                "corners_for": a.corners_for,
                "corners_against": a.corners_against,
                "corners_for_avg": round(a.corners_for / a.matches, 2),
                "corners_against_avg": round(a.corners_against / a.matches, 2),
                "corners_total_avg": round((a.corners_for + a.corners_against) / a.matches, 2),
                "shots_for": a.shots_for,
                "shots_against": a.shots_against,
                "shots_for_avg": round(a.shots_for / a.matches, 2),
                "shots_on_for_avg": round(a.shots_on_for / a.matches, 2),
                "raw_index": round(raw, 3) if raw is not None else None,
                "enough_data": a.matches >= min_matches,
            }
        )

    by_league: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        by_league[r["league_id"]].append(r)

    for league_rows in by_league.values():
        vals = [r["raw_index"] for r in league_rows if r["raw_index"] is not None and r["enough_data"]]
        lo, hi = (min(vals), max(vals)) if vals else (None, None)
        for r in league_rows:
            # Команде без нужного объёма истории CI и грейд не присваиваются:
            # иначе после обрезки в шкалу она встаёт рядом с лидером лиги.
            if r["raw_index"] is None or lo is None or hi == lo or not r["enough_data"]:
                r["ci"] = None
                r["grade"] = None
            else:
                ci = max(0.0, min(100.0, (r["raw_index"] - lo) / (hi - lo) * 100))
                r["ci"] = round(ci, 1)
                r["grade"] = grade(ci)

    rows.sort(key=lambda r: (r["league"], not r["enough_data"], -(r["raw_index"] or 0)))
    pos: dict[str, int] = defaultdict(int)
    for r in rows:
        pos[r["league"]] += 1
        r["position"] = pos[r["league"]]
    return rows


# --------------------------------------------------------------------------
# Вывод
# --------------------------------------------------------------------------

CSV_FIELDS = [
    "league", "position", "team", "matches", "seasons", "first_match", "last_match",
    "corners_for_avg", "corners_against_avg", "corners_total_avg",
    "shots_for_avg", "shots_on_for_avg",
    "raw_index", "ci", "grade", "enough_data",
    "corners_for", "corners_against", "shots_for", "shots_against",
    "league_id", "team_id",
]


def write_outputs(rows: list[dict], report: dict, out_dir: str) -> tuple[str, str]:
    os.makedirs(out_dir, exist_ok=True)
    csv_path = os.path.join(out_dir, "corner_index.csv")
    json_path = os.path.join(out_dir, "corner_index.json")

    with open(csv_path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=CSV_FIELDS, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow(r)

    with open(json_path, "w", encoding="utf-8") as f:
        json.dump({"report": report, "rows": rows}, f, ensure_ascii=False, indent=2)

    return csv_path, json_path


def print_table(rows: list[dict], limit: int) -> None:
    by_league: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        by_league[r["league"]].append(r)
    for league, lr in by_league.items():
        print(f"\n{league}")
        print(f"{'#':>3} {'команда':<22}{'И':>4}{'угл.за':>8}{'угл.пр':>8}{'тотал':>8}{'удары':>7}{'индекс':>8}{'CI':>7}  грейд")
        for r in lr[:limit]:
            ci = "—" if r["ci"] is None else f"{r['ci']:.1f}"
            g = r["grade"] or "—"
            flag = "" if r["enough_data"] else "  (мало данных)"
            print(
                f"{r['position']:>3} {r['team'][:22]:<22}{r['matches']:>4}"
                f"{r['corners_for_avg']:>8.2f}{r['corners_against_avg']:>8.2f}"
                f"{r['corners_total_avg']:>8.2f}{r['shots_for_avg']:>7.2f}"
                f"{(r['raw_index'] or 0):>8.3f}{ci:>7}  {g}{flag}"
            )


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------


def main() -> int:
    p = argparse.ArgumentParser(
        description="Выгрузка угловых и ударов с football-data.co.uk + расчёт индекса"
    )
    p.add_argument("--leagues", nargs="+", default=list(LEAGUES),
                   help=f"коды лиг: {', '.join(LEAGUES)}")
    p.add_argument("--seasons", nargs="+", default=["2425", "2526"],
                   help="сезоны в формате источника: 2425, 2526")
    p.add_argument("--out", default="./out", help="куда положить CSV и JSON")
    p.add_argument("--cache-dir", default="./fd_cache", help="каталог для скачанных CSV")
    p.add_argument("--min-matches", type=int, default=10,
                   help="минимум матчей для признака достаточности данных")
    p.add_argument("--team-map", default=None,
                   help="JSON-файл соответствия названий команд нашему справочнику")
    p.add_argument("--offline", action="store_true", help="считать по уже скачанным файлам")
    p.add_argument("--refresh", action="store_true", help="перекачать файлы, даже если они есть")
    p.add_argument("--top", type=int, default=10, help="сколько строк печатать по каждой лиге")
    args = p.parse_args()

    unknown = [l for l in args.leagues if l not in LEAGUES]
    if unknown:
        print(f"неизвестные коды лиг: {', '.join(unknown)}", file=sys.stderr)
        return 2
    leagues = {code: LEAGUES[code] for code in args.leagues}

    mapping: dict[str, str] = {}
    if args.team_map:
        with open(args.team_map, encoding="utf-8") as f:
            mapping = json.load(f)
        print(f"Загружено соответствий названий команд: {len(mapping)}")

    print("Выгрузка:")
    agg, report = collect(
        leagues, args.seasons, args.cache_dir,
        offline=args.offline, refresh=args.refresh, mapping=mapping,
    )

    rows = compute_index(agg, min_matches=args.min_matches)
    csv_path, json_path = write_outputs(rows, report, args.out)

    print_table(rows, args.top)

    print("\nИтоги")
    print(f"  файлов разобрано:            {report['files_ok']}")
    print(f"  строк всего:                 {report['rows_total']}")
    print(f"  матчей в расчёте:            {report['rows_used']}")
    print(f"  без статистики (пропущено):  {report['rows_skipped_no_stats']}")
    print(f"  битых строк:                 {report['rows_skipped_bad']}")
    print(f"  команд в таблице:            {len(rows)}")
    if report["files_missing"]:
        print(f"  файлы не получены:           {', '.join(report['files_missing'])}")
    if report["columns_missing"]:
        for cm in report["columns_missing"]:
            print(f"  в файле {cm['file']} нет колонок: {', '.join(cm['missing'])}")
    print(f"  CSV:  {csv_path}")
    print(f"  JSON: {json_path}")

    if report["files_ok"] == 0:
        print("\nНи одного файла разобрать не удалось.", file=sys.stderr)
        return 3
    return 0


if __name__ == "__main__":
    sys.exit(main())
