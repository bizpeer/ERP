# ERP Database 자동 복구 스크립트 (Windows용)
# 사용법: .\restore-db.ps1 [백업파일경로]

param (
    [Parameter(Mandatory = $true)]
    [string]$BackupFile
)

$BACKUP_DIR = "D:\ERP_Backups"
$TEMP_BACKUP = "$BACKUP_DIR\pre_restore_temp_$(Get-Date -Format 'yyyyMMdd_HHmm').sql"

Write-Host "[$(Get-Date)] 복구 프로세스 시작..." -ForegroundColor Cyan

# 1. 안전 장치: 복구 전 현재 상태 임시 백업
Write-Host "1. 현재 데이터 안전 백업 중..." -ForegroundColor Yellow
try {
    & pg_dump -U postgres -d erp_db -f $TEMP_BACKUP
    Write-Host "안전 백업 완료: $TEMP_BACKUP" -ForegroundColor Green
}
catch {
    Write-Host "안전 백업 실패! 작업을 중단합니다." -ForegroundColor Red
    exit
}

# 2. PostgreSQL 복구
Write-Host "2. PostgreSQL 데이터 복구 중 ($BackupFile)..." -ForegroundColor Yellow
try {
    # 기존 DB 연결 종료 및 재생성 (필요시)
    # & psql -U postgres -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'erp_db';"
    # & dropdb -U postgres erp_db
    # & createdb -U postgres erp_db
    & psql -U postgres -d erp_db -f $BackupFile
    Write-Host "DB 복구 성공!" -ForegroundColor Green
}
catch {
    Write-Host "DB 복구 중 오류 발생!" -ForegroundColor Red
}

# 3. MongoDB 복구 (백업 파일이 디렉토리일 경우)
# & mongorestore --db erp_logs [백업경로]

Write-Host "[$(Get-Date)] 모든 복구 작업이 종료되었습니다." -ForegroundColor Cyan
