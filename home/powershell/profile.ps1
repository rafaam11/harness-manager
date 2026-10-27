# =============================================================================
# PSReadLine
# =============================================================================
if (Get-Module -ListAvailable -Name PSReadLine | Where-Object { $_.Version -ge [version]'2.2.0' }) {
    Import-Module PSReadLine -MinimumVersion 2.2.0 -ErrorAction SilentlyContinue

    Set-PSReadLineOption -EditMode Windows
    Set-PSReadLineOption -HistorySearchCursorMovesToEnd
    Set-PSReadLineOption -BellStyle None

    # 예측 제안(Prediction)은 VT 처리를 지원하는 실제 콘솔에서만 활성화
    # (출력 리다이렉트/비대화형 실행 시 Set-PSReadLineOption이 예외를 던짐)
    if (-not [Console]::IsOutputRedirected) {
        try {
            Set-PSReadLineOption -PredictionSource History
            Set-PSReadLineOption -PredictionViewStyle InlineView   # PowerShell 5.1에서는 ListView 미지원
        } catch {}
    }

    # 입력한 접두사로 히스토리 검색 (위/아래 화살표)
    Set-PSReadLineKeyHandler -Key UpArrow -Function HistorySearchBackward
    Set-PSReadLineKeyHandler -Key DownArrow -Function HistorySearchForward
    # Tab: 후보 목록 메뉴로 표시
    Set-PSReadLineKeyHandler -Key Tab -Function MenuComplete
}

# =============================================================================
# zoxide
# =============================================================================
if (Get-Command zoxide -ErrorAction SilentlyContinue) {
    Invoke-Expression (& { (zoxide init powershell | Out-String) })
}
