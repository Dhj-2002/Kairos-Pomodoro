param(
  [string]$SyncPath = 'C:\Users\qazse\iCloudDrive\Kairos-calendar-sync.json'
)

$ErrorActionPreference = 'Stop'
$termStart = [datetime]'2026-09-14'
$holidayDates = @{}
@(
  '2026-09-25','2026-09-26','2026-09-27',
  '2026-10-01','2026-10-02','2026-10-03','2026-10-04','2026-10-05','2026-10-06','2026-10-07'
) | ForEach-Object { $holidayDates[$_] = $true }

$courses = @(
  @{ Name='运筹学1班'; Weeks=13..18; Day=2; Start='08:25'; End='10:05' },
  @{ Name='自然辩证法概论003-专硕，019-专硕'; Weeks=1..5; Day=3; Start='08:25'; End='10:05' },
  @{ Name='自然辩证法概论003-专硕，019-专硕'; Weeks=1..4; Day=3; Start='10:20'; End='12:00' },
  @{ Name='运筹学1班'; Weeks=13..18; Day=4; Start='10:20'; End='12:00' },
  @{ Name='现代微处理器架构与并行处理1班'; Weeks=1..8; Day=2; Start='14:30'; End='18:05' },
  @{ Name='统计学习1班'; Weeks=1..12; Day=3; Start='14:30'; End='18:05' },
  @{ Name='运筹学1班'; Weeks=13..18; Day=3; Start='14:30'; End='18:05' },
  @{ Name='大语言模型技术与应用1班'; Weeks=1..8; Day=4; Start='14:30'; End='18:05' },
  @{ Name='科研伦理与学术规范1班'; Weeks=5..11; Day=7; Start='21:20'; End='22:05' }
)

$payload = Get-Content -LiteralPath $SyncPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($payload.app -ne 'kairos-calendar' -or $payload.formatVersion -ne 1) {
  throw 'Unsupported Kairos calendar sync file.'
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = Join-Path (Split-Path $SyncPath) "Kairos-calendar-sync.before-class-$stamp.json"
Copy-Item -LiteralPath $SyncPath -Destination $backup

# 1. Correct previously imported two-period afternoon blocks in place. This
# preserves sync IDs and prevents a four-period correction from duplicating a
# user's existing calendar entries.
$now = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
$afternoonCourseNames = @($courses | Where-Object Start -eq '14:30' | ForEach-Object Name)
$corrected = 0
foreach ($item in $payload.items) {
  if (
    -not $item.deletedAt -and
    $afternoonCourseNames -contains $item.title -and
    $item.startTime -match '^(\d{4}-\d{2}-\d{2}) 14:30:00$' -and
    $item.endTime -in @("$($Matches[1]) 16:10:00", "$($Matches[1]) 18:00:00")
  ) {
    $item.endTime = "$($Matches[1]) 18:05:00"
    $item.updatedAt = $now
    $corrected++
  }
}

$existing = @{}
foreach ($item in $payload.items) {
  if (-not $item.deletedAt) {
    $existing["$($item.title)|$($item.startTime)|$($item.endTime)|$($item.category.name)"] = $true
  }
}

$inserted = 0
$skippedHoliday = 0
$duplicates = 0
foreach ($course in $courses) {
  foreach ($week in $course.Weeks) {
    $date = $termStart.AddDays((7 * ($week - 1)) + ($course.Day - 1))
    $dateKey = $date.ToString('yyyy-MM-dd')
    if ($holidayDates.ContainsKey($dateKey)) {
      $skippedHoliday++
      continue
    }
    $startTime = "$dateKey $($course.Start):00"
    $endTime = "$dateKey $($course.End):00"
    $key = "$($course.Name)|$startTime|$endTime|class"
    if ($existing.ContainsKey($key)) {
      $duplicates++
      continue
    }
    $item = [ordered]@{
      syncId = [guid]::NewGuid().ToString()
      title = $course.Name
      startTime = $startTime
      endTime = $endTime
      completed = 0
      color = $null
      notificationEnabled = 0
      createdAt = $now
      updatedAt = $now
      deletedAt = $null
      deviceId = $payload.deviceId
      category = [ordered]@{ name='class'; color='#5B8C85' }
      taskName = $null
    }
    $payload.items += [pscustomobject]$item
    $existing[$key] = $true
    $inserted++
  }
}

$payload.exportedAt = $now
$json = $payload | ConvertTo-Json -Depth 12
[IO.File]::WriteAllText($SyncPath, $json, [Text.UTF8Encoding]::new($false))

[pscustomobject]@{
  SyncPath = $SyncPath
  Backup = $backup
  Corrected = $corrected
  Inserted = $inserted
  DuplicateSkipped = $duplicates
  HolidaySkipped = $skippedHoliday
  TotalItems = $payload.items.Count
}
