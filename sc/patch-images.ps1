# Правка: картинки в разделах глав и в полном учебнике.
$ErrorActionPreference = 'Stop'
$root = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
Set-Location $root
if (-not (Test-Path (Join-Path $root 'js/app.js'))) { throw 'Нет js/app.js. Положи файл в папку sc.' }
$utf8 = New-Object Text.UTF8Encoding($false)
$num = 0
function Patch($file, $anchorB64, $replB64) {
  $num++
  $path = Join-Path $root $file
  $text = [IO.File]::ReadAllText($path, [Text.Encoding]::UTF8)
  $anchor = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($anchorB64))
  $repl   = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($replB64))
  if (-not $text.Contains($anchor)) {
    if ($text.Contains($repl.Substring(0, [Math]::Min(40, $repl.Length)))) { Write-Host "  $num. $file - уже сделано" }
    else { Write-Host "  $num. $file - ЯКОРЬ НЕ НАЙДЕН" }
    return
  }
  [IO.File]::WriteAllText($path, $text.Replace($anchor, $repl), $utf8)
  Write-Host "  $num. $file - обновлён"
}

Write-Host 'Применяю правки...'
Patch 'js/app.js' 'ZnVuY3Rpb24gbGVzc29uVmlzdWFsKGkpe2NvbnN0IG09bW9kdWxlc1tpXTs=' 'ZnVuY3Rpb24gZmlndXJlTGlzdChsaXN0KXtyZXR1cm4gKGxpc3R8fFtdKS5maWx0ZXIoeD0+eCYmdHlwZW9mIHguZGF0YT09PSdzdHJpbmcnJiYvXihpbWFnZXNcL3xncmFwaGljc1wvfGRhdGE6aW1hZ2VcLyhwbmd8anBlZ3x3ZWJwfHN2Z1wreG1sKTtiYXNlNjQsfGh0dHBzOlwvXC8pLy50ZXN0KHguZGF0YSkpLm1hcCh4PT5gPGZpZ3VyZSBjbGFzcz0iY2FyZCI+PGltZyBzdHlsZT0ibWF4LXdpZHRoOjEwMCU7aGVpZ2h0OmF1dG8iIHNyYz0iJHtlc2NhcGVIVE1MKHguZGF0YSl9IiBhbHQ9IiR7ZXNjYXBlSFRNTCh4LmNhcHRpb258fCcnKX0iIGxvYWRpbmc9ImxhenkiPjxmaWdjYXB0aW9uPiR7ZXNjYXBlSFRNTCh4LmNhcHRpb258fCcnKX08L2ZpZ2NhcHRpb24+PC9maWd1cmU+YCkuam9pbignJyl9CmZ1bmN0aW9uIGxlc3NvblZpc3VhbChpKXtjb25zdCBtPW1vZHVsZXNbaV07'
Patch 'js/app.js' 'PHA+JHtzWzFdfTwvcD48L3NlY3Rpb24+YCkuam9pbignJyl9' 'PHA+JHtzWzFdfTwvcD4ke2ZpZ3VyZUxpc3QoKHNbMl18fFtdKS5tYXAoeD0+KHtkYXRhOnhbMF0sY2FwdGlvbjp4WzFdfSkpKX08L3NlY3Rpb24+YCkuam9pbignJyl9JHtmaWd1cmVMaXN0KChtLmltYWdlc3x8W10pLm1hcCh4PT4oe2RhdGE6eFswXSxjYXB0aW9uOnhbMV19KSkpfQ=='
Patch 'js/app.js' 'PGgzPiR7c1swXX08L2gzPjxwPiR7c1sxXX08L3A+YCkuam9pbignJyl9JHt0YWJsZShtLnRhYmxlKX0=' 'PGgzPiR7c1swXX08L2gzPjxwPiR7c1sxXX08L3A+JHtmaWd1cmVMaXN0KChzWzJdfHxbXSkubWFwKHg9Pih7ZGF0YTp4WzBdLGNhcHRpb246eFsxXX0pKSl9YCkuam9pbignJyl9JHtmaWd1cmVMaXN0KChtLmltYWdlc3x8W10pLm1hcCh4PT4oe2RhdGE6eFswXSxjYXB0aW9uOnhbMV19KSkpfSR7dGFibGUobS50YWJsZSl9'
Patch 'js/editor.js' 'c2VjdGlvbnM6bS5zZWN0aW9ucy5tYXAocz0+cy5tYXAoZXNjYXBlSFRNTCkpLHRhYmxlOm0udGFibGUubWFwKHI9PnIubWFwKGVzY2FwZUhUTUwpKSw=' 'c2VjdGlvbnM6bS5zZWN0aW9ucy5tYXAocz0+W2VzY2FwZUhUTUwoc1swXSksZXNjYXBlSFRNTChzWzFdKSwoc1syXXx8W10pLm1hcCh4PT5bZXNjYXBlSFRNTCh4WzBdKSxlc2NhcGVIVE1MKHhbMV0pXSldKSxpbWFnZXM6KG0uaW1hZ2VzfHxbXSkubWFwKHg9Pltlc2NhcGVIVE1MKHhbMF0pLGVzY2FwZUhUTUwoeFsxXSldKSx0YWJsZTptLnRhYmxlLm1hcChyPT5yLm1hcChlc2NhcGVIVE1MKSks'
Patch 'js/editor.js' 'cy5sZW5ndGghPT0yfHxzLnNvbWUoeD0+dHlwZW9mIHghPT0nc3RyaW5nJyk=' 'cy5sZW5ndGg8Mnx8cy5sZW5ndGg+M3x8dHlwZW9mIHNbMF0hPT0nc3RyaW5nJ3x8dHlwZW9mIHNbMV0hPT0nc3RyaW5nJw=='

Write-Host ''
Write-Host 'Проверка:'
$app = [IO.File]::ReadAllText((Join-Path $root 'js/app.js'), [Text.Encoding]::UTF8)
$ed  = [IO.File]::ReadAllText((Join-Path $root 'js/editor.js'), [Text.Encoding]::UTF8)
Write-Host ('  function figureList: ' + $app.Contains('function figureList'))
Write-Host ('  kartinki razdelov:   ' + $app.Contains('(s[2]||[]).map'))
Write-Host ('  kartinki glavy:      ' + $app.Contains('(m.images||[]).map'))
Write-Host ('  cleanModule:         ' + $ed.Contains('images:(m.images||[])'))
Write-Host ('  proverka razdelov:   ' + $ed.Contains('s.length<2||s.length>3'))

if (Get-Command node -ErrorAction SilentlyContinue) {
  node --check (Join-Path $root 'js/app.js')
  node --check (Join-Path $root 'js/editor.js')
  Write-Host '  sintaksis: OK'
}