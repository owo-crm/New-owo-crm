#!/usr/bin/env bash
# Восстановление базы из ночного бэкапа (файл owo-YYYY-MM-DD.dump.gpg из GitHub Actions).
#
#   BACKUP_PASSPHRASE='…' scripts/backup/restore.sh owo-2026-11-13.dump.gpg postgresql://…/owo_restore
#
# По умолчанию восстанавливает только в ПУСТУЮ базу — так нельзя случайно затереть рабочую.
# Чтобы восстановить поверх существующих данных (настоящая авария), добавь --overwrite.
set -euo pipefail

usage() { echo "Użycie: BACKUP_PASSPHRASE=… $0 <plik.dump.gpg|plik.dump> <DATABASE_URL> [--overwrite]" >&2; exit 2; }
[ $# -ge 2 ] || usage
FILE="$1"; TARGET="$2"; MODE="${3:-}"
[ -f "$FILE" ] || { echo "Nie ma pliku: $FILE" >&2; exit 2; }
HERE="$(cd "$(dirname "$0")" && pwd)"

WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
DUMP="$FILE"
if [[ "$FILE" == *.gpg ]]; then
  : "${BACKUP_PASSPHRASE:?Ustaw BACKUP_PASSPHRASE (to samo hasło, co w sekretach GitHub)}"
  DUMP="$WORK/owo.dump"
  gpg --batch --quiet --pinentry-mode loopback --passphrase-fd 3 --output "$DUMP" --decrypt "$FILE" 3<<<"$BACKUP_PASSPHRASE"
fi

TABLES="$(psql "$TARGET" -Atqc "select count(*) from information_schema.tables where table_schema in ('public','auth')")"
if [ "$TABLES" != "0" ] && [ "$MODE" != "--overwrite" ]; then
  echo "Baza docelowa nie jest pusta ($TABLES tabel). Przerwano, żeby niczego nie nadpisać." >&2
  echo "Jeśli to świadome odtworzenie po awarii, uruchom ponownie z --overwrite." >&2
  exit 3
fi

PGOPTIONS="-c client_min_messages=warning" psql "$TARGET" -v ON_ERROR_STOP=1 -q -f "$HERE/roles.sql"
CLEAN=(); [ "$MODE" = "--overwrite" ] && CLEAN=(--clean --if-exists)
pg_restore --no-owner --exit-on-error "${CLEAN[@]}" --dbname "$TARGET" "$DUMP"

echo "Odtworzono. Podsumowanie:"
psql "$TARGET" -At -F ' = ' -f "$HERE/summary.sql"
