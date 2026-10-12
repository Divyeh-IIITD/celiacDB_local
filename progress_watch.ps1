# Usage: .\progress_watch.ps1
$root = Join-Path $PWD 'run_dq2_peptide_ens'
$steps = @('0_topoaa','1_rigidbody','2_flexref','3_emref','4_clustfcc','5_seletopclusts')
while ($true) {
    if (Test-Path $root) {
        $counts = @()
        foreach ($step in $steps) {
            $dir = Join-Path $root $step
            $count = if (Test-Path $dir) { (Get-ChildItem -Path $dir -Filter *.pdb -File -ErrorAction SilentlyContinue | Measure-Object).Count } else { 0 }
            $counts += "{0}: {1}" -f $step, $count
        }
        $ts = Get-Date -Format 'HH:mm:ss'
        $line = "[{0}] {1}" -f $ts, ($counts -join ' | ')
        Write-Host $line
        if (Test-Path (Join-Path $root '5_seletopclusts')) {
            $final = (Get-ChildItem -Path (Join-Path $root '5_seletopclusts') -Filter *.pdb -File -ErrorAction SilentlyContinue | Measure-Object).Count
            if ($final -ge 1) {
                Write-Host "`nFinal summary:"
                foreach ($step in $steps) {
                    $dir = Join-Path $root $step
                    $count = if (Test-Path $dir) { (Get-ChildItem -Path $dir -Filter *.pdb -File -ErrorAction SilentlyContinue | Measure-Object).Count } else { 0 }
                    Write-Host ("{0}: {1} pdb files" -f $step, $count)
                }
                exit
            }
        }
    } else {
        Write-Host ("[{0}] waiting for run_dq2_peptide_ens/ to appear..." -f (Get-Date -Format 'HH:mm:ss'))
    }
    Start-Sleep -Seconds 5
}
