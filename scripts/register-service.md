# ERP 서비스 자동 등록 가이드 (Windows)

사내 서버 PC를 켰을 때 자동으로 ERP 서버가 실행되도록 설정하는 방법입니다. 
가장 안정적인 **PM2(Process Manager 2)** 방식과 **Windows 기본 작업 스케줄러** 방식 두 가지를 제안합니다.

---

### 방법 1: PM2를 이용한 자동 실행 (추천)
서버 다운 시 자동 재시작 기능이 있어 가장 안정적입니다.

1. **PM2 설치** (터미널에서 실행):
   ```powershell
   npm install -g pm2 pm2-windows-startup
   ```

2. **자동 실행 등록 스크립트** (`scripts/setup-pm2.ps1`):
   ```powershell
   # 백엔드 등록
   pm2 start index.ts --name "erp-backend" --interpreter npx -- ts-node
   
   # 프론트엔드 등록
   pm2 start "npm run dev" --name "erp-frontend" --cwd "./frontend"
   
   # 부팅 시 자동 시작 설정
   pm2 save
   pm2-startup install
   ```

---

### 방법 2: Windows 작업 스케줄러 이용 (스크립트 방식)
별도의 도구 설치 없이 Windows 기능을 사용합니다.

```powershell
# scripts/register-service.ps1
$Action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-WindowStyle Hidden -Command 'cd D:\Website\ERP_Claude_1; npm run dev'"
$Trigger = New-ScheduledTaskTrigger -AtStartup
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$Principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest

Register-ScheduledTask -TaskName "ERP_AutoStart_Backend" -Action $Action -Trigger $Trigger -Settings $Settings -Principal $Principal

Write-Host "ERP 서버가 Windows 시작 시 자동 실행되도록 등록되었습니다." -ForegroundColor Green
```

> [!IMPORTANT]
> - 경로(`D:\Website\ERP_Claude_1`)는 반드시 실제 설치 경로로 수정해야 합니다.
> - 서비스 계정으로 실행 시 DB 연결 권한(PostgreSQL/MongoDB)이 확보되어 있어야 합니다.
