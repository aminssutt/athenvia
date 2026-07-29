param(
  [string]$Repository = "aminssutt/athenvia",
  [string]$Owner = "aminssutt",
  [int]$ProjectNumber = 5,
  [string]$Assignee = "aminssutt"
)

$ErrorActionPreference = "Stop"

function ConvertFrom-GhJson {
  param([string[]]$Lines)
  return (($Lines -join "") | ConvertFrom-Json)
}

function Invoke-GraphQL {
  param([string]$Query)

  $payload = @{ query = $Query } | ConvertTo-Json -Compress
  $raw = $payload | gh api graphql --input -
  if ($LASTEXITCODE -ne 0) {
    throw "GitHub GraphQL request failed."
  }

  $result = ConvertFrom-GhJson @($raw)
  if ($result.errors) {
    throw ($result.errors | ConvertTo-Json -Depth 10)
  }
  return $result
}

function Invoke-MutationBatch {
  param([System.Collections.Generic.List[string]]$Operations)

  if ($Operations.Count -eq 0) {
    return
  }

  $query = "mutation {`n$($Operations -join "`n")`n}"
  Invoke-GraphQL $query | Out-Null
  $Operations.Clear()
}

function Get-ProjectField {
  param([object[]]$Fields, [string]$Name)
  $field = $Fields | Where-Object { $_.name -eq $Name } | Select-Object -First 1
  if (-not $field) {
    throw "Project field not found: $Name"
  }
  return $field
}

function Get-ProjectOptionId {
  param([object]$Field, [string]$Name)
  $option = $Field.options | Where-Object { $_.name -eq $Name } | Select-Object -First 1
  if (-not $option) {
    throw "Option '$Name' not found in field '$($Field.name)'."
  }
  return $option.id
}

$project = ConvertFrom-GhJson @(gh project view $ProjectNumber --owner $Owner --format json)
$projectId = $project.id

$issues = @(ConvertFrom-GhJson @(gh issue list --repo $Repository --state all --limit 200 --json id,number,title,url,state,labels,body))
$existingItems = ConvertFrom-GhJson @(gh project item-list $ProjectNumber --owner $Owner --limit 200 --format json)
$existingIssueNumbers = @{}
foreach ($item in $existingItems.items) {
  if ($item.content.number) {
    $existingIssueNumbers[[int]$item.content.number] = $true
  }
}

$addOperations = [System.Collections.Generic.List[string]]::new()
$added = 0
$alias = 0

foreach ($issue in $issues) {
  if ($existingIssueNumbers.ContainsKey([int]$issue.number)) {
    continue
  }

  $addOperations.Add("add$alias`: addProjectV2ItemById(input: {projectId: `"$projectId`", contentId: `"$($issue.id)`"}) { item { id } }")
  $alias += 1
  $added += 1

  if ($addOperations.Count -ge 20) {
    Invoke-MutationBatch $addOperations
  }
}
Invoke-MutationBatch $addOperations

$itemByIssueNumber = @{}
for ($attempt = 1; $attempt -le 5; $attempt += 1) {
  $projectItems = ConvertFrom-GhJson @(gh project item-list $ProjectNumber --owner $Owner --limit 200 --format json)
  $itemByIssueNumber = @{}
  foreach ($item in $projectItems.items) {
    if ($item.content.number) {
      $itemByIssueNumber[[int]$item.content.number] = $item
    }
  }

  if ($itemByIssueNumber.Keys.Count -ge $issues.Count) {
    break
  }
  Start-Sleep -Seconds 2
}

$fieldResult = ConvertFrom-GhJson @(gh project field-list $ProjectNumber --owner $Owner --format json)
$fields = $fieldResult.fields
$statusField = Get-ProjectField $fields "Status"
$priorityField = Get-ProjectField $fields "Priority"
$phaseField = Get-ProjectField $fields "Phase"
$workstreamField = Get-ProjectField $fields "Workstream"
$ownerField = Get-ProjectField $fields "Owner"
$milestoneField = Get-ProjectField $fields "Target milestone"
$dependencyField = Get-ProjectField $fields "Dependency note"

$workstreamNames = @{
  product = "Product"
  design = "Design"
  frontend = "Frontend"
  database = "Database"
  api = "API"
  worker = "Worker"
  notifications = "Notifications"
  data = "Data"
  devops = "DevOps"
  quality = "Quality"
}

$targetMilestones = @{
  "0" = "Phase 0 contracts"
  "1" = "Phase 1 shell"
  "2" = "Phase 2 enrichment"
  "3" = "Phase 3 notifications"
  "4" = "Phase 4 data"
  "5" = "Phase 5 launch"
}

$readyIssueCodes = @(
  "P1-01",
  "P1-04",
  "P1-06",
  "P1-08",
  "P1-10",
  "P1-11",
  "P1-14",
  "P1-15"
)

$updateOperations = [System.Collections.Generic.List[string]]::new()
$updateAlias = 0
$updatedItems = 0

foreach ($issue in $issues) {
  $item = $itemByIssueNumber[[int]$issue.number]
  if (-not $item) {
    throw "Project item missing for issue #$($issue.number)."
  }

  $labelNames = @($issue.labels | ForEach-Object { $_.name })
  $priorityLabel = $labelNames | Where-Object { $_ -like "priority:*" } | Select-Object -First 1
  $phaseLabel = $labelNames | Where-Object { $_ -like "phase:*" } | Select-Object -First 1
  $workstreamLabel = $labelNames | Where-Object { $_ -like "workstream:*" } | Select-Object -First 1

  if (-not $priorityLabel -or -not $phaseLabel -or -not $workstreamLabel) {
    throw "Planning labels are incomplete on issue #$($issue.number)."
  }

  $priorityName = $priorityLabel.Substring("priority:".Length)
  $phaseNumber = [regex]::Match($phaseLabel, "phase:(\d)").Groups[1].Value
  $workstreamKey = $workstreamLabel.Substring("workstream:".Length)
  $issueCode = [regex]::Match($issue.title, "^\[([A-Z0-9-]+)\]").Groups[1].Value
  $statusName = if ($issue.state -eq "CLOSED") {
    "Done"
  }
  elseif ($readyIssueCodes -contains $issueCode) {
    "Ready"
  }
  else {
    "Backlog"
  }
  $dependencyMatch = [regex]::Match($issue.body, "(?m)^- Dependencies: (.+)$")
  $dependencyNote = if ($dependencyMatch.Success) { $dependencyMatch.Groups[1].Value.Trim() } else { "Not specified" }

  $values = @(
    @{ field = $statusField; option = $statusName },
    @{ field = $priorityField; option = $priorityName },
    @{ field = $phaseField; option = "Phase $phaseNumber" },
    @{ field = $workstreamField; option = $workstreamNames[$workstreamKey] },
    @{ field = $milestoneField; option = $targetMilestones[$phaseNumber] }
  )

  foreach ($value in $values) {
    $optionId = Get-ProjectOptionId $value.field $value.option
    $updateOperations.Add("u$updateAlias`: updateProjectV2ItemFieldValue(input: {projectId: `"$projectId`", itemId: `"$($item.id)`", fieldId: `"$($value.field.id)`", value: {singleSelectOptionId: `"$optionId`"}}) { projectV2Item { id } }")
    $updateAlias += 1
  }

  $ownerJson = ("@$Assignee" | ConvertTo-Json -Compress)
  $dependencyJson = ($dependencyNote | ConvertTo-Json -Compress)
  $updateOperations.Add("u$updateAlias`: updateProjectV2ItemFieldValue(input: {projectId: `"$projectId`", itemId: `"$($item.id)`", fieldId: `"$($ownerField.id)`", value: {text: $ownerJson}}) { projectV2Item { id } }")
  $updateAlias += 1
  $updateOperations.Add("u$updateAlias`: updateProjectV2ItemFieldValue(input: {projectId: `"$projectId`", itemId: `"$($item.id)`", fieldId: `"$($dependencyField.id)`", value: {text: $dependencyJson}}) { projectV2Item { id } }")
  $updateAlias += 1
  $updatedItems += 1

  if ($updateOperations.Count -ge 28) {
    Invoke-MutationBatch $updateOperations
  }
}
Invoke-MutationBatch $updateOperations

[pscustomobject]@{
  repository = $Repository
  project = $project.url
  totalIssues = $issues.Count
  itemsAdded = $added
  itemsConfigured = $updatedItems
} | ConvertTo-Json
