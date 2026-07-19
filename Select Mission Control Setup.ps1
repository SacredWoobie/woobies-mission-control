param(
    [ValidateSet(1, 2, 3, 4)]
    [int]$Choice
)

$ErrorActionPreference = 'Stop'

$options = @(
    'Set up Dashboard and ESP32 Controlpad',
    'Set up just Mission Control Dashboard',
    'Set up just ESP32 Controlpad',
    'Exit'
)

function Exit-WithChoice([int]$selected) {
    exit @(10, 20, 30, 40)[$selected]
}

if ($Choice) {
    Exit-WithChoice ($Choice - 1)
}

Write-Host ''
Write-Host 'Set up Mission Control now?'
Write-Host 'Use Up/Down and Enter, or type a number and press Enter.'
Write-Host ''

if ([Console]::IsInputRedirected -or [Console]::IsOutputRedirected) {
    while ($true) {
        $answer = Read-Host 'Choose 1, 2, 3, or 4'
        if ($answer -match '^[1-4]$') {
            Exit-WithChoice ([int]$answer - 1)
        }
    }
}

$selected = 0
$top = [Console]::CursorTop

function Draw-Options {
    [Console]::SetCursorPosition(0, $top)
    for ($index = 0; $index -lt $options.Count; $index++) {
        $prefix = if ($index -eq $selected) { '>' } else { ' ' }
        $line = " $prefix $($index + 1). $($options[$index])"
        if ($line.Length -lt [Console]::WindowWidth) {
            $line = $line.PadRight([Console]::WindowWidth - 1)
        }
        if ($index -eq $selected) {
            Write-Host $line -ForegroundColor Cyan
        } else {
            Write-Host $line
        }
    }
}

Draw-Options
while ($true) {
    $key = [Console]::ReadKey($true)
    switch ($key.Key) {
        'UpArrow' {
            $selected = ($selected + $options.Count - 1) % $options.Count
            Draw-Options
        }
        'DownArrow' {
            $selected = ($selected + 1) % $options.Count
            Draw-Options
        }
        'D1' { $selected = 0; Draw-Options }
        'NumPad1' { $selected = 0; Draw-Options }
        'D2' { $selected = 1; Draw-Options }
        'NumPad2' { $selected = 1; Draw-Options }
        'D3' { $selected = 2; Draw-Options }
        'NumPad3' { $selected = 2; Draw-Options }
        'D4' { $selected = 3; Draw-Options }
        'NumPad4' { $selected = 3; Draw-Options }
        'Enter' { Exit-WithChoice $selected }
    }
}
