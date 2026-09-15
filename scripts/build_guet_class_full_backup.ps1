param(
  [string]$SourceBackup = 'C:\Users\qazse\iCloudDrive\kairos-backup-2026-09-13-05-22-25.json',
  [string]$OutputBackup = 'C:\Users\qazse\iCloudDrive\kairos-backup-2026-09-13-with-classes.json'
)

$ErrorActionPreference = 'Stop'
$payload = Get-Content -LiteralPath $SourceBackup -Raw -Encoding UTF8 | ConvertFrom-Json
if ($payload.app -ne 'kairos' -or -not $payload.data -or -not $payload.data.time_blocks) {
  throw 'Source is not a complete Kairos backup.'
}

$termStart = [datetime]'2026-09-14'
$holidays = @{}
@('2026-09-25','2026-09-26','2026-09-27','2026-10-01','2026-10-02','2026-10-03','2026-10-04','2026-10-05','2026-10-06','2026-10-07') |
  ForEach-Object { $holidays[$_] = $true }

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

# 1. Correct already-imported afternoon classes in place so rebuilding from a
# newer personal backup never creates a second copy of the same class.
$nowLocal = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
$afternoonCourseNames = @($courses | Where-Object Start -eq '14:30' | ForEach-Object Name)
$corrected = 0
foreach ($block in $payload.data.time_blocks) {
  if (
    -not $block.deleted_at -and
    $afternoonCourseNames -contains $block.title -and
    $block.start_time -match '^(\d{4}-\d{2}-\d{2}) 14:30:00$' -and
    $block.end_time -in @("$($Matches[1]) 16:10:00", "$($Matches[1]) 18:00:00")
  ) {
    $block.end_time = "$($Matches[1]) 18:05:00"
    $block.updated_at = $nowLocal
    $corrected++
  }
}

$classCategory = @($payload.data.categories | Where-Object name -eq 'class')[0]
if (-not $classCategory) {
  $categoryId = 1 + [int](($payload.data.categories | Measure-Object id -Maximum).Maximum)
  $classCategory = [pscustomobject][ordered]@{
    id = $categoryId
    name = 'class'
    color = '#5B8C85'
    created_at = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
  }
  $payload.data.categories += $classCategory
} else {
  $categoryId = [int]$classCategory.id
}

$existing = @{}
foreach ($b in $payload.data.time_blocks) {
  if (-not $b.deleted_at) { $existing["$($b.title)|$($b.start_time)|$($b.end_time)"] = $true }
}
$nextId = 1 + [int](($payload.data.time_blocks | Measure-Object id -Maximum).Maximum)
$inserted = 0
$holidaySkipped = 0
foreach ($course in $courses) {
  foreach ($week in $course.Weeks) {
    $date = $termStart.AddDays((7 * ($week - 1)) + ($course.Day - 1))
    $dateKey = $date.ToString('yyyy-MM-dd')
    if ($holidays.ContainsKey($dateKey)) { $holidaySkipped++; continue }
    $start = "$dateKey $($course.Start):00"
    $end = "$dateKey $($course.End):00"
    $key = "$($course.Name)|$start|$end"
    if ($existing.ContainsKey($key)) { continue }
    $payload.data.time_blocks += [pscustomobject][ordered]@{
      id = $nextId
      title = $course.Name
      start_time = $start
      end_time = $end
      task_id = $null
      category_id = $categoryId
      color = $null
      completed = 0
      created_at = $nowLocal
      session_id = $null
      source_template_id = $null
      source_template_block_id = $null
      notification_enabled = 0
      reminded_at = $null
      sync_id = [guid]::NewGuid().ToString()
      updated_at = $nowLocal
      deleted_at = $null
      device_id = 'class-import-2026'
    }
    $existing[$key] = $true
    $nextId++
    $inserted++
  }
}

$payload.exportedAt = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
[IO.File]::WriteAllText($OutputBackup, ($payload | ConvertTo-Json -Depth 20), [Text.UTF8Encoding]::new($false))
[pscustomobject]@{ Output=$OutputBackup; Corrected=$corrected; Inserted=$inserted; HolidaySkipped=$holidaySkipped; Categories=$payload.data.categories.Count; TimeBlocks=$payload.data.time_blocks.Count }
