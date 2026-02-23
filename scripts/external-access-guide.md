# ERP 외부 인터넷 접속 구축 가이드 (Cloudflare Tunnel)

가장 안전하고 쉬운 방식인 **Cloudflare Tunnel**을 사용하여 사내 서버를 외부 URL(`https://*.trycloudflare.com` 또는 전용 도메인)로 연결하는 방법입니다.

---

### 1단계: Cloudflare Tunnel 도구 설치
사내 서버 PC의 PowerShell(관리자 권한)에서 다음 명령어를 실행하여 설치합니다.

```powershell
# 1. 설치 도구 다운로드 및 실행
Set-ExecutionPolicy Bypass -Scope Process -Force; [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072; iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))

# 2. cloudflared 설치
choco install cloudflared -y
```

---

### 2단계: 터널 개설 및 외부 주소 할당
서버를 외부로 연결하는 세션을 시작합니다. (무료 도메인 방식)

```powershell
# 프론트엔드 연결 (사용자가 접속할 실제 주소가 생성됩니다)
cloudflared tunnel --url http://localhost:5173
```
> [!IMPORTANT]
> - 위 명령어를 실행하면 `https://random-words.trycloudflare.com` 형태의 주소가 생성됩니다.
> - 이 주소를 휴대폰이나 외부 노트북 브라우저에 입력하면 즉시 접속됩니다.

---

### 3단계: 백엔드 API 연결 (CORS 설정)
외부 망에서 접속할 때 API 호출이 차단되지 않도록 `gateway.ts`의 환경 변수를 설정해야 합니다.

1. **`.env` 파일 수정**:
   ```env
   ALLOWED_ORIGINS=https://생성된-랜덤-주소.trycloudflare.com
   ```
2. **서버 재시작**: `npm run dev`

---

### 4단계: 고정 도메인 사용 (선택 사항)
매번 주소가 바뀌는 것이 번거롭다면, Cloudflare 계정을 생성하고 본인의 도메인(예: `erp.mysite.com`)을 연결할 수 있습니다.

1. [Cloudflare Dashboard](https://dash.cloudflare.com/) 로그인
2. **Zero Trust > Networks > Tunnels** 메뉴에서 신규 터널 생성
3. 서버 PC에 전용 커넥터 설치(명령어 복사/붙여넣기)
4. **Public Hostname**에 `erp.mysite.com` -> `http://localhost:5173` 매핑

---

### 💡 보안 팁
- **Cloudflare Access**: 특정 이메일로 인증 코드를 받은 사람만 ERP에 들어오게 추가 차단막을 칠 수 있습니다. (강력 추천)
- **HTTPS 자동 적용**: Cloudflare를 통하면 별도의 인증서 설치 없이 안전한 HTTPS 통신이 보장됩니다.
