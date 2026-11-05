#requires -Version 7.4
param([string]$Directory)

$ErrorActionPreference = 'Stop'
if (-not $Directory) {
    $stateRoot = $env:LOCALAPPDATA ?? $env:XDG_STATE_HOME ?? $env:APPDATA ?? (Join-Path ([Environment]::GetFolderPath('UserProfile')) '.local/state')
    $Directory = Join-Path $stateRoot 'Codex Command Center/relay-security'
}
$destination = [IO.Path]::GetFullPath($Directory)
$parent = [IO.Path]::GetDirectoryName($destination)
[IO.Directory]::CreateDirectory($parent) | Out-Null
if ([IO.Directory]::Exists($destination) -or [IO.File]::Exists($destination)) {
    throw 'Relay security is already present. Existing trust material was preserved.'
}

$stage = Join-Path $parent ('.relay-security-' + [Guid]::NewGuid().ToString('N'))
if ($IsWindows) {
    [IO.Directory]::CreateDirectory($stage) | Out-Null
    # Apply the current account's ACL before any key material is written.
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $acl = [Security.AccessControl.DirectorySecurity]::new()
    $acl.SetAccessRuleProtection($true, $false)
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
        $identity, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
    Set-Acl -LiteralPath $stage -AclObject $acl
} else {
    [IO.Directory]::CreateDirectory($stage, 'UserRead,UserWrite,UserExecute') | Out-Null
}

$rootKey = [Security.Cryptography.RSA]::Create(3072)
$leafKey = [Security.Cryptography.RSA]::Create(3072)
try {
    $sha = [Security.Cryptography.HashAlgorithmName]::SHA256
    $padding = [Security.Cryptography.RSASignaturePadding]::Pkcs1
    $rootRequest = [Security.Cryptography.X509Certificates.CertificateRequest]::new(
        'CN=Codex Command Center Local Relay CA', $rootKey, $sha, $padding)
    $rootRequest.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($true, $true, 0, $true))
    $rootRequest.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new('KeyCertSign', $true))
    $start = [DateTimeOffset]::UtcNow.AddMinutes(-5)
    $root = $rootRequest.CreateSelfSigned($start, $start.AddYears(3))

    $leafRequest = [Security.Cryptography.X509Certificates.CertificateRequest]::new(
        'CN=127.0.0.1', $leafKey, $sha, $padding)
    $names = [Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new()
    $names.AddIpAddress([Net.IPAddress]::Loopback)
    $leafRequest.CertificateExtensions.Add($names.Build())
    $leafRequest.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($false, $false, 0, $true))
    $leafRequest.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new('DigitalSignature,KeyEncipherment', $true))
    $usage = [Security.Cryptography.OidCollection]::new()
    $usage.Add([Security.Cryptography.Oid]::new('1.3.6.1.5.5.7.3.1')) | Out-Null
    $leafRequest.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]::new($usage, $true))
    $serial = [Security.Cryptography.RandomNumberGenerator]::GetBytes(16)
    $leaf = $leafRequest.Create($root, $start, $start.AddYears(2), $serial)

    [IO.File]::WriteAllText((Join-Path $stage 'relay-ca.pem'), $root.ExportCertificatePem())
    [IO.File]::WriteAllBytes((Join-Path $stage 'relay-ca.cer'), $root.RawData)
    [IO.File]::WriteAllText((Join-Path $stage 'relay-cert.pem'), $leaf.ExportCertificatePem())
    [IO.File]::WriteAllText((Join-Path $stage 'relay-key.pem'), $leafKey.ExportPkcs8PrivateKeyPem())
    foreach ($role in 'exporter', 'overlay', 'browser') {
        $token = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant()
        [IO.File]::WriteAllText((Join-Path $stage "$role.token"), $token)
    }
    [IO.Directory]::Move($stage, $destination)
    Write-Output "Created local relay trust material at $destination."
} finally {
    if ($leaf) { $leaf.Dispose() }
    if ($root) { $root.Dispose() }
    $leafKey.Dispose()
    $rootKey.Dispose()
    if ([IO.Directory]::Exists($stage)) {
        # The staging directory is private and contains only files created above.
        Get-ChildItem -LiteralPath $stage -File | Remove-Item -Force
        Remove-Item -LiteralPath $stage
    }
}
