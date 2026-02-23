# ERP Database 자동 백업 스크립트 (Windows용)
# 실행 방법: Windows 작업 스케줄러에 등록하여 매일 오후 8시에 실행

$BACKUP_DIR = "D:\ERP_Backups"
$TIMESTAMP = Get-Date -Format "yyyyMMdd_HHmm"
$PG_BACKUP_FILE = "$BACKUP_DIR\pg_erp_$TIMESTAMP.sql"
$MONGO_BACKUP_DIR = "$BACKUP_DIR\mongo_erp_$TIMESTAMP"

# 1. 백업 디렉토리 생성
if (!(Test-Path $BACKUP_DIR)) {
    New-Item -ItemType Directory -Path $BACKUP_DIR
}

Write-Host "[$(Get-Date)] 백업 시작..." -ForegroundColor Cyan

# 2. PostgreSQL 백업 (사내 서버 환경 환경변수 설정 필요)
# pg_dump -h localhost -U postgres erp_db > $PG_BACKUP_FILE
try {
    & pg_dump -U postgres -d erp_db -f $PG_BACKUP_FILE
    Write-Host "[$(Get-Date)] PostgreSQL 백업 완료: $PG_BACKUP_FILE" -ForegroundColor Green
} catch {
    Write-Host "[$(Get-Date)] PostgreSQL 백업 실패!" -ForegroundColor Red
}

# 3. MongoDB 백업
try {
    & mongodump --db erp_logs --out $MONGO_BACKUP_DIR
    Write-Host "[$(Get-Date)] MongoDB 백업 완료: $MONGO_BACKUP_DIR" -ForegroundColor Green
} catch {
    Write-Host "[$(Get-Date)] MongoDB 백업 실패!" -ForegroundColor Red
}

# 4. 관리자 외 접근 제한 (권한 설정)
# 백업 파일의 소유권 및 권한을 관리자로 제한할 수 있습니다.
# icacls $PG_BACKUP_FILE /inheritance:r /grant:r "Administrators:F"

Write-Host "[$(Get-Date)] 모든 백업 작업이 완료되었습니다." -ForegroundColor Cyan
