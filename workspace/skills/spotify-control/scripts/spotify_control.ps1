[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("launch", "play", "pause", "toggle", "next", "previous", "stop", "status", "open-uri", "play-track", "recommend")]
    [string]$Action,

    [string]$Uri,

    [string]$Query,

    [switch]$AutoLaunch,

    [ValidateRange(2, 30)]
    [int]$LaunchTimeoutSec = 8,

    [ValidateRange(1, 20)]
    [int]$RecommendationLimit = 5
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$provider = "spotify-control"

function Write-Success {
    param(
        [hashtable]$Data = @{}
    )

    $payload = @{
        ok       = $true
        provider = $provider
        action   = $Action
    }
    foreach ($key in $Data.Keys) {
        $payload[$key] = $Data[$key]
    }
    $payload | ConvertTo-Json -Depth 8 -Compress
}

function Write-Failure {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Reason,
        [hashtable]$Data = @{}
    )

    $errorCode = "${provider}:$Reason"
    $payload = @{
        ok       = $false
        provider = $provider
        action   = $Action
        error    = $errorCode
    }
    foreach ($key in $Data.Keys) {
        $payload[$key] = $Data[$key]
    }
    $payload | ConvertTo-Json -Depth 8 -Compress
    exit 1
}

function Get-SpotifyProcesses {
    @(Get-Process -Name "Spotify" -ErrorAction SilentlyContinue)
}

function Get-SpotifyProcess {
    $processes = Get-SpotifyProcesses
    if ($processes.Count -eq 0) {
        return $null
    }

    $windowed = $processes | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
    if ($null -ne $windowed) {
        return $windowed
    }

    $earliest = $processes | Sort-Object StartTime | Select-Object -First 1
    return $earliest
}

function Start-SpotifyDesktop {
    try {
        Start-Process "spotify" | Out-Null
        return $true
    }
    catch {
        $spotifyExe = Join-Path $env:APPDATA "Spotify\Spotify.exe"
        if (Test-Path $spotifyExe) {
            Start-Process $spotifyExe | Out-Null
            return $true
        }
        return $false
    }
}

function Ensure-SpotifyRunning {
    param(
        [bool]$AllowLaunch
    )

    $process = Get-SpotifyProcess
    if ($null -ne $process) {
        return $process
    }

    if (-not $AllowLaunch) {
        return $null
    }

    if (-not (Start-SpotifyDesktop)) {
        return $null
    }

    $deadline = (Get-Date).AddSeconds($LaunchTimeoutSec)
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 250
        $process = Get-SpotifyProcess
        if ($null -ne $process) {
            return $process
        }
    }

    return $null
}

function Get-SpotifyStatus {
    $process = Get-SpotifyProcess
    if ($null -eq $process) {
        return @{
            running = $false
        }
    }

    $windowHandle = [IntPtr]::Zero
    try {
        $windowHandle = [IntPtr]$process.MainWindowHandle
    }
    catch {
        $windowHandle = [IntPtr]::Zero
    }

    $windowTitle = $null
    try {
        $windowTitle = $process.MainWindowTitle
    }
    catch {
        $windowTitle = $null
    }

    return @{
        running           = $true
        pid               = $process.Id
        start_time        = ([DateTimeOffset]$process.StartTime).ToString("o")
        has_window        = ([int64]$windowHandle -ne 0)
        hwnd              = $(if ([int64]$windowHandle -ne 0) { '0x{0:X}' -f ([int64]$windowHandle) } else { $null })
        main_window_title = $windowTitle
    }
}

function Get-SpotifyWindowTarget {
    param(
        [ValidateRange(200, 10000)]
        [int]$WaitMs = 3000
    )

    $deadline = (Get-Date).AddMilliseconds($WaitMs)
    $lastProcess = $null

    while ((Get-Date) -lt $deadline) {
        $process = Get-SpotifyProcess
        if ($null -ne $process) {
            $lastProcess = $process
            $windowHandle = [IntPtr]::Zero
            try {
                $windowHandle = [IntPtr]$process.MainWindowHandle
            }
            catch {
                $windowHandle = [IntPtr]::Zero
            }

            if ([int64]$windowHandle -ne 0) {
                return @{
                    process = $process
                    handle  = $windowHandle
                }
            }
        }
        Start-Sleep -Milliseconds 150
    }

    return @{
        process = $lastProcess
        handle  = [IntPtr]::Zero
    }
}

if (-not ([System.Management.Automation.PSTypeName]"SpotifyAppCommand").Type) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class SpotifyAppCommand {
    [DllImport("user32.dll", SetLastError=true)]
    private static extern IntPtr SendMessageTimeout(
        IntPtr hWnd,
        uint Msg,
        IntPtr wParam,
        IntPtr lParam,
        uint fuFlags,
        uint uTimeout,
        out IntPtr lpdwResult);

    private const uint WM_APPCOMMAND = 0x0319;
    private const uint SMTO_ABORTIFHUNG = 0x0002;

    public static bool Send(IntPtr hwnd, int appCommand, uint timeoutMs) {
        if (hwnd == IntPtr.Zero) {
            return false;
        }

        IntPtr result;
        IntPtr lParam = new IntPtr(appCommand << 16);
        IntPtr sendResult = SendMessageTimeout(
            hwnd,
            WM_APPCOMMAND,
            hwnd,
            lParam,
            SMTO_ABORTIFHUNG,
            timeoutMs,
            out result);

        return sendResult != IntPtr.Zero;
    }
}
'@
}

function Send-SpotifyAppCommand {
    param(
        [Parameter(Mandatory = $true)]
        [ValidateRange(1, 100)]
        [int]$AppCommand,

        [Parameter(Mandatory = $true)]
        [bool]$AllowLaunch
    )

    $process = Ensure-SpotifyRunning -AllowLaunch $AllowLaunch
    if ($null -eq $process) {
        Write-Failure -Reason "spotify_not_running"
    }

    $target = Get-SpotifyWindowTarget
    if ([int64]$target.handle -eq 0) {
        Write-Failure -Reason "spotify_window_not_found" -Data @{
            pid = $process.Id
        }
    }

    $isSent = [SpotifyAppCommand]::Send($target.handle, $AppCommand, 1200)
    if (-not $isSent) {
        Write-Failure -Reason "spotify_command_send_failed" -Data @{
            pid         = $target.process.Id
            hwnd        = ('0x{0:X}' -f ([int64]$target.handle))
            app_command = $AppCommand
        }
    }

    return @{
        pid         = $target.process.Id
        hwnd        = ('0x{0:X}' -f ([int64]$target.handle))
        app_command = $AppCommand
    }
}

function Open-SpotifyUri {
    param(
        [Parameter(Mandatory = $true)]
        [string]$TargetUri
    )

    if ([string]::IsNullOrWhiteSpace($TargetUri)) {
        Write-Failure -Reason "missing_uri"
    }
    if ($TargetUri -notmatch "^spotify:.+") {
        Write-Failure -Reason "invalid_uri_format" -Data @{ uri = $TargetUri }
    }

    $launchMethod = "start-process"
    try {
        Start-Process $TargetUri | Out-Null
    }
    catch {
        # Some constrained hosts block Start-Process for URI protocols.
        # Fallback to explorer.exe which can still dispatch registered URI handlers.
        try {
            Start-Process "explorer.exe" -ArgumentList $TargetUri | Out-Null
            $launchMethod = "explorer"
        }
        catch {
            Write-Failure -Reason "uri_open_access_denied" -Data @{
                uri     = $TargetUri
                message = $_.Exception.Message
            }
        }
    }
    Start-Sleep -Milliseconds 350
    $process = Ensure-SpotifyRunning -AllowLaunch $true

    return @{
        uri           = $TargetUri
        running       = ($null -ne $process)
        pid           = $(if ($null -ne $process) { $process.Id } else { $null })
        launch_method = $launchMethod
    }
}

function Open-SpotifyUriAndPlay {
    param(
        [Parameter(Mandatory = $true)]
        [string]$TargetUri
    )

    $openResult = Open-SpotifyUri -TargetUri $TargetUri
    Start-Sleep -Milliseconds 350
    $playResult = Send-SpotifyAppCommand -AppCommand 46 -AllowLaunch $true

    return @{
        uri           = $TargetUri
        running       = $openResult.running
        pid           = $playResult.pid
        hwnd          = $playResult.hwnd
        app_command   = $playResult.app_command
        launch_method = $openResult.launch_method
    }
}

function Get-SpotifyApiAccessToken {
    $clientId = $env:SPOTIFY_CLIENT_ID
    $clientSecret = $env:SPOTIFY_CLIENT_SECRET

    if ([string]::IsNullOrWhiteSpace($clientId) -or [string]::IsNullOrWhiteSpace($clientSecret)) {
        return $null
    }

    $basicRaw = "{0}:{1}" -f $clientId, $clientSecret
    $basic = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes($basicRaw))

    try {
        $tokenResponse = Invoke-RestMethod -Method Post -Uri "https://accounts.spotify.com/api/token" -Headers @{
            Authorization = "Basic $basic"
            "Content-Type" = "application/x-www-form-urlencoded"
        } -Body "grant_type=client_credentials" -TimeoutSec 12

        if ($null -eq $tokenResponse -or [string]::IsNullOrWhiteSpace($tokenResponse.access_token)) {
            return $null
        }

        return $tokenResponse.access_token
    }
    catch {
        return $null
    }
}

function Convert-SpotifyTrack {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Track
    )

    $artistNames = @()
    if ($null -ne $Track.artists) {
        $artistNames = @($Track.artists | ForEach-Object { $_.name })
    }

    return @{
        id         = $Track.id
        uri        = $Track.uri
        name       = $Track.name
        artists    = $artistNames
        album      = $(if ($null -ne $Track.album) { $Track.album.name } else { $null })
        popularity = $Track.popularity
    }
}

function Search-SpotifyTracks {
    param(
        [Parameter(Mandatory = $true)]
        [string]$SearchQuery,

        [ValidateRange(1, 20)]
        [int]$Limit = 5
    )

    $token = Get-SpotifyApiAccessToken
    if ([string]::IsNullOrWhiteSpace($token)) {
        return @{
            ok     = $false
            source = "search_uri_fallback"
            error  = "spotify_api_credentials_missing"
        }
    }

    try {
        $encoded = [System.Uri]::EscapeDataString($SearchQuery)
        $url = "https://api.spotify.com/v1/search?q=$encoded&type=track&limit=$Limit&market=US"

        $response = Invoke-RestMethod -Method Get -Uri $url -Headers @{
            Authorization = "Bearer $token"
        } -TimeoutSec 12

        $items = @()
        if ($null -ne $response -and $null -ne $response.tracks -and $null -ne $response.tracks.items) {
            $items = @($response.tracks.items)
        }

        $tracks = @($items | ForEach-Object { Convert-SpotifyTrack -Track $_ })
        return @{
            ok     = $true
            source = "spotify_api"
            tracks = $tracks
        }
    }
    catch {
        return @{
            ok      = $false
            source  = "search_uri_fallback"
            error   = "spotify_api_search_failed"
            message = $_.Exception.Message
        }
    }
}

function Get-SpotifyRecommendations {
    param(
        [Parameter(Mandatory = $true)]
        [string]$SeedTrackId,

        [ValidateRange(1, 20)]
        [int]$Limit = 5
    )

    $token = Get-SpotifyApiAccessToken
    if ([string]::IsNullOrWhiteSpace($token)) {
        return @{
            ok     = $false
            source = "search_uri_fallback"
            error  = "spotify_api_credentials_missing"
        }
    }

    try {
        $escapedSeed = [System.Uri]::EscapeDataString($SeedTrackId)
        $url = "https://api.spotify.com/v1/recommendations?seed_tracks=$escapedSeed&limit=$Limit&market=US"

        $response = Invoke-RestMethod -Method Get -Uri $url -Headers @{
            Authorization = "Bearer $token"
        } -TimeoutSec 12

        $items = @()
        if ($null -ne $response -and $null -ne $response.tracks) {
            $items = @($response.tracks)
        }

        $tracks = @($items | ForEach-Object { Convert-SpotifyTrack -Track $_ })
        return @{
            ok     = $true
            source = "spotify_api"
            tracks = $tracks
        }
    }
    catch {
        return @{
            ok      = $false
            source  = "search_uri_fallback"
            error   = "spotify_api_recommend_failed"
            message = $_.Exception.Message
        }
    }
}

function New-SpotifySearchUri {
    param(
        [Parameter(Mandatory = $true)]
        [string]$SearchQuery
    )

    $encoded = [System.Uri]::EscapeDataString($SearchQuery.Trim())
    return "spotify:search:$encoded"
}

try {
    switch ($Action) {
        "status" {
            Write-Success -Data (Get-SpotifyStatus)
            exit 0
        }

        "launch" {
            $process = Ensure-SpotifyRunning -AllowLaunch $true
            if ($null -eq $process) {
                Write-Failure -Reason "spotify_not_installed_or_launch_failed"
            }

            Write-Success -Data @{
                result  = "launched_or_running"
                pid     = $process.Id
                running = $true
            }
            exit 0
        }

        "open-uri" {
            $openResult = Open-SpotifyUri -TargetUri $Uri

            Write-Success -Data @{
                result        = "uri_opened"
                uri           = $openResult.uri
                running       = $openResult.running
                pid           = $openResult.pid
                launch_method = $openResult.launch_method
            }
            exit 0
        }

        "play-track" {
            if ([string]::IsNullOrWhiteSpace($Query)) {
                Write-Failure -Reason "missing_query"
            }

            $searchResult = Search-SpotifyTracks -SearchQuery $Query -Limit 5
            if ($searchResult.ok -and $searchResult.tracks.Count -gt 0) {
                $selectedTrack = $searchResult.tracks[0]
                $playResult = Open-SpotifyUriAndPlay -TargetUri $selectedTrack.uri

                Write-Success -Data @{
                    result         = "track_started"
                    mode           = "spotify_api"
                    query          = $Query
                    selected_track = $selectedTrack
                    candidates     = $searchResult.tracks
                    uri            = $playResult.uri
                    pid            = $playResult.pid
                    hwnd           = $playResult.hwnd
                    launch_method  = $playResult.launch_method
                }
                exit 0
            }

            $searchUri = New-SpotifySearchUri -SearchQuery $Query
            $playResult = Open-SpotifyUriAndPlay -TargetUri $searchUri
            Write-Success -Data @{
                result    = "search_started"
                mode      = "search_uri_fallback"
                query     = $Query
                uri       = $playResult.uri
                pid       = $playResult.pid
                hwnd      = $playResult.hwnd
                launch_method = $playResult.launch_method
                api_error = $searchResult.error
            }
            exit 0
        }

        "recommend" {
            if ([string]::IsNullOrWhiteSpace($Query)) {
                Write-Failure -Reason "missing_query"
            }

            $seedResult = Search-SpotifyTracks -SearchQuery $Query -Limit 1
            if ($seedResult.ok -and $seedResult.tracks.Count -gt 0) {
                $seedTrack = $seedResult.tracks[0]
                $recommendResult = Get-SpotifyRecommendations -SeedTrackId $seedTrack.id -Limit $RecommendationLimit

                if ($recommendResult.ok -and $recommendResult.tracks.Count -gt 0) {
                    $selectedTrack = $recommendResult.tracks[0]
                    $playResult = Open-SpotifyUriAndPlay -TargetUri $selectedTrack.uri

                    Write-Success -Data @{
                        result          = "recommendation_started"
                        mode            = "spotify_api"
                        query           = $Query
                        seed_track      = $seedTrack
                        selected_track  = $selectedTrack
                        recommendations = $recommendResult.tracks
                        uri             = $playResult.uri
                        pid             = $playResult.pid
                        hwnd            = $playResult.hwnd
                        launch_method   = $playResult.launch_method
                    }
                    exit 0
                }

                $fallbackQuery = "{0} recommendations" -f $Query
                $fallbackUri = New-SpotifySearchUri -SearchQuery $fallbackQuery
                $playResult = Open-SpotifyUriAndPlay -TargetUri $fallbackUri
                Write-Success -Data @{
                    result    = "recommendation_search_started"
                    mode      = "search_uri_fallback"
                    query     = $Query
                    uri       = $playResult.uri
                    pid       = $playResult.pid
                    hwnd      = $playResult.hwnd
                    launch_method = $playResult.launch_method
                    api_error = $recommendResult.error
                }
                exit 0
            }

            $fallbackQuery = "{0} radio" -f $Query
            $fallbackUri = New-SpotifySearchUri -SearchQuery $fallbackQuery
            $playResult = Open-SpotifyUriAndPlay -TargetUri $fallbackUri
            Write-Success -Data @{
                result    = "recommendation_search_started"
                mode      = "search_uri_fallback"
                query     = $Query
                uri       = $playResult.uri
                pid       = $playResult.pid
                hwnd      = $playResult.hwnd
                launch_method = $playResult.launch_method
                api_error = $seedResult.error
            }
            exit 0
        }

        default {
            $allowLaunch = $AutoLaunch.IsPresent
            $appCommandMap = @{
                play     = 46
                pause    = 47
                toggle   = 14
                next     = 11
                previous = 12
                stop     = 13
            }

            $appCommand = $appCommandMap[$Action]
            if ($null -eq $appCommand) {
                Write-Failure -Reason "unsupported_action"
            }

            $sendResult = Send-SpotifyAppCommand -AppCommand $appCommand -AllowLaunch $allowLaunch
            Write-Success -Data @{
                result      = "spotify_app_command_sent"
                app_command = $sendResult.app_command
                pid         = $sendResult.pid
                hwnd        = $sendResult.hwnd
                auto_launch = $allowLaunch
            }
            exit 0
        }
    }
}
catch {
    Write-Failure -Reason "unexpected_exception" -Data @{
        message = $_.Exception.Message
    }
}
