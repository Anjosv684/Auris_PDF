// Auris PDF — backend (Tauri 2)
// Arquivos em disco, integração com o Windows (abrir com, menu de contexto,
// app padrão) e assinatura com certificados do repositório do Windows (A1/A3).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{Emitter, Manager, State};

#[derive(Clone, Serialize)]
struct Launch {
    action: String,
    paths: Vec<String>,
}

struct Pending(Mutex<Vec<Launch>>);

/// Interpreta a linha de comando: `AurisPDF.exe [--comprimir|--juntar] arquivo.pdf ...`
fn parse_args(args: &[String], cwd: Option<&str>) -> Option<Launch> {
    let mut action = "abrir".to_string();
    let mut paths = vec![];
    for a in args.iter().skip(1) {
        match a.as_str() {
            "--comprimir" => action = "comprimir".into(),
            "--juntar" => action = "juntar".into(),
            s if s.starts_with("--") || s.starts_with("-psn") => {}
            s => {
                let mut p = PathBuf::from(s);
                if p.is_relative() {
                    if let Some(c) = cwd {
                        p = Path::new(c).join(p);
                    }
                }
                let is_pdf = p.extension().map(|e| e.eq_ignore_ascii_case("pdf")).unwrap_or(false);
                if is_pdf && p.is_file() {
                    paths.push(p.to_string_lossy().to_string());
                }
            }
        }
    }
    if paths.is_empty() {
        None
    } else {
        Some(Launch { action, paths })
    }
}

#[tauri::command]
fn take_launch(state: State<Pending>) -> Vec<Launch> {
    std::mem::take(&mut *state.0.lock().unwrap())
}

#[tauri::command]
fn read_file(path: String) -> Result<Response, String> {
    std::fs::read(&path)
        .map(Response::new)
        .map_err(|e| format!("Não foi possível ler o arquivo: {e}"))
}

#[tauri::command]
fn write_file(request: Request) -> Result<(), String> {
    let raw = request
        .headers()
        .get("path")
        .and_then(|v| v.to_str().ok())
        .ok_or("Caminho não informado")?;
    let path = urlencoding::decode(raw).map_err(|e| e.to_string())?.into_owned();
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("Conteúdo inválido".into());
    };
    // grava num temporário e troca: nunca deixa o arquivo pela metade
    let tmp = format!("{path}.auris-tmp");
    std::fs::write(&tmp, bytes).map_err(|e| format!("Não foi possível salvar: {e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("Não foi possível salvar (o arquivo está aberto em outro programa?): {e}")
    })
}

#[cfg(windows)]
fn hidden(cmd: &mut std::process::Command) -> &mut std::process::Command {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(0x0800_0000) // CREATE_NO_WINDOW
}

#[tauri::command]
fn open_default_apps() -> Result<(), String> {
    #[cfg(windows)]
    {
        hidden(std::process::Command::new("cmd").args(["/C", "start", "", "ms-settings:defaultapps"]))
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(windows))]
    Err("Disponível apenas no Windows".into())
}

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    if !url.starts_with("https://") {
        return Err("Endereço não permitido".into());
    }
    #[cfg(windows)]
    {
        hidden(std::process::Command::new("cmd").args(["/C", "start", "", &url]))
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    std::process::Command::new("open").arg(&url).spawn().map_err(|e| e.to_string())?;
    #[cfg(all(unix, not(target_os = "macos")))]
    std::process::Command::new("xdg-open").arg(&url).spawn().map_err(|e| e.to_string())?;
    Ok(())
}

// ------------------------------------------------------------------ compressão (motor PyMuPDF)
/// Roda o motor `auris-compress.exe` (sidecar instalado ao lado do app).
/// Corpo: bytes do PDF. Cabeçalhos: `level` (leve|media|forte) e `gray` (0|1).
/// Resposta: 1 byte com o modo (0 normal, 1 páginas viraram imagem, 2 original mantido) + PDF.
#[tauri::command]
async fn compress_pdf(request: Request<'_>) -> Result<Response, String> {
    let header = |k: &str| request.headers().get(k).and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    let level = header("level");
    if !matches!(level.as_str(), "leve" | "media" | "forte") {
        return Err("Nível de compressão inválido".into());
    }
    let gray = if header("gray") == "1" { "1" } else { "0" };
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("Conteúdo inválido".into());
    };
    let bytes = bytes.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<Response, String> {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let engine = exe.with_file_name(if cfg!(windows) { "auris-compress.exe" } else { "auris-compress" });
        if !engine.is_file() {
            return Err("Motor de compressão não encontrado. Reinstale o Auris PDF.".into());
        }
        let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let dir = std::env::temp_dir();
        let input = dir.join(format!("auris-cmp-{nanos}-in.pdf"));
        let output = dir.join(format!("auris-cmp-{nanos}-out.pdf"));
        std::fs::write(&input, &bytes).map_err(|e| e.to_string())?;
        let mut cmd = std::process::Command::new(&engine);
        cmd.arg(&input).arg(&output).arg(&level).arg(gray);
        #[cfg(windows)]
        hidden(&mut cmd);
        let run = cmd.output();
        let _ = std::fs::remove_file(&input);
        let out = run.map_err(|e| format!("Falha ao iniciar o motor de compressão: {e}"))?;
        let line = String::from_utf8_lossy(&out.stdout).lines().last().unwrap_or("").to_string();
        let info: serde_json::Value = serde_json::from_str(&line).unwrap_or(serde_json::Value::Null);
        if !out.status.success() {
            let _ = std::fs::remove_file(&output);
            let msg = info.get("erro").and_then(|v| v.as_str()).unwrap_or("Falha ao comprimir o PDF.");
            return Err(if msg.contains("senha") { "PDF protegido por senha.".into() } else { msg.to_string() });
        }
        let pdf = std::fs::read(&output).map_err(|e| e.to_string());
        let _ = std::fs::remove_file(&output);
        let mode: u8 = match info.get("modo").and_then(|v| v.as_str()) {
            Some("imagem") => 1,
            Some("original") => 2,
            _ => 0,
        };
        let mut res = Vec::with_capacity(pdf.as_ref().map(|p| p.len()).unwrap_or(0) + 1);
        res.push(mode);
        res.extend_from_slice(&pdf?);
        Ok(Response::new(res))
    })
    .await
    .map_err(|e| e.to_string())?
}

// ------------------------------------------------------------------ certificados
#[cfg(windows)]
fn powershell(script: &str, envs: &[(&str, String)]) -> Result<String, String> {
    use base64::Engine;
    // -EncodedCommand (UTF-16LE) evita problemas de acentuação e aspas
    let utf16: Vec<u8> = script.encode_utf16().flat_map(|c| c.to_le_bytes()).collect();
    let encoded = base64::engine::general_purpose::STANDARD.encode(utf16);
    let mut cmd = std::process::Command::new("powershell.exe");
    cmd.args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", &encoded]);
    for (k, v) in envs {
        cmd.env(k, v);
    }
    let out = hidden(&mut cmd).output().map_err(|e| format!("Falha ao iniciar o PowerShell: {e}"))?;
    let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Err(if err.is_empty() { "Falha ao acessar o certificado.".into() } else { err });
    }
    Ok(stdout)
}

#[cfg(windows)]
const LIST_PS: &str = r#"
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$list = @(Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.HasPrivateKey -and $_.PublicKey.Oid.Value -eq '1.2.840.113549.1.1.1' } | ForEach-Object {
  [pscustomobject]@{
    subject    = $_.Subject
    issuer     = $_.Issuer
    thumbprint = $_.Thumbprint
    notAfter   = $_.NotAfter.ToUniversalTime().ToString('o')
    der        = [Convert]::ToBase64String($_.RawData)
  }
})
ConvertTo-Json -InputObject $list -Compress -Depth 3
"#;

#[cfg(windows)]
const SIGN_PS: &str = r#"
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
try {
  Add-Type -AssemblyName System.Security
  $cert = Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.Thumbprint -eq $env:AURIS_TP } | Select-Object -First 1
  if (-not $cert) { throw 'Certificado não encontrado. Verifique se o token está conectado.' }
  $data = [System.IO.File]::ReadAllBytes($env:AURIS_IN)
  $ci = New-Object System.Security.Cryptography.Pkcs.ContentInfo -ArgumentList @(,$data)
  $cms = New-Object System.Security.Cryptography.Pkcs.SignedCms -ArgumentList $ci, $true
  $signer = New-Object System.Security.Cryptography.Pkcs.CmsSigner -ArgumentList $cert
  $signer.DigestAlgorithm = New-Object System.Security.Cryptography.Oid -ArgumentList '2.16.840.1.101.3.4.2.1'
  $chain = New-Object System.Security.Cryptography.X509Certificates.X509Chain
  $chain.ChainPolicy.RevocationMode = 'NoCheck'
  if ($chain.Build($cert)) {
    $signer.IncludeOption = [System.Security.Cryptography.X509Certificates.X509IncludeOption]::ExcludeRoot
  } else {
    $signer.IncludeOption = [System.Security.Cryptography.X509Certificates.X509IncludeOption]::EndCertOnly
  }
  if ($env:AURIS_ESS) {
    $ess = [Convert]::FromBase64String($env:AURIS_ESS)
    $attr = New-Object System.Security.Cryptography.AsnEncodedData -ArgumentList '1.2.840.113549.1.9.16.2.47', $ess
    [void]$signer.SignedAttributes.Add($attr)
  }
  $cms.ComputeSignature($signer, $false)
  [Convert]::ToBase64String($cms.Encode())
} catch {
  $m = $_.Exception.Message
  if ($_.Exception.InnerException) { $m = $_.Exception.InnerException.Message }
  if ($m -match 'cancel') { $m = 'Operação cancelada pelo usuário.' }
  [Console]::Error.WriteLine($m)
  exit 1
}
"#;

#[derive(Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct CertInfo {
    subject: String,
    issuer: String,
    thumbprint: String,
    not_after: String,
    der: String,
}

#[tauri::command]
async fn list_certificates() -> Result<Vec<CertInfo>, String> {
    #[cfg(windows)]
    {
        let out = tauri::async_runtime::spawn_blocking(|| powershell(LIST_PS, &[]))
            .await
            .map_err(|e| e.to_string())??;
        if out.is_empty() {
            return Ok(vec![]);
        }
        serde_json::from_str::<Vec<CertInfo>>(&out).map_err(|e| format!("Resposta inesperada: {e}"))
    }
    #[cfg(not(windows))]
    Err("Certificados instalados só estão disponíveis no Windows.".into())
}

#[tauri::command]
async fn sign_with_certificate(thumbprint: String, data: String, ess_attr: String) -> Result<String, String> {
    #[cfg(windows)]
    {
        use base64::Engine;
        if !thumbprint.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err("Certificado inválido".into());
        }
        let bytes = base64::engine::general_purpose::STANDARD.decode(data).map_err(|e| e.to_string())?;
        let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let tmp = std::env::temp_dir().join(format!("auris-sign-{nanos}.bin"));
        std::fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
        let tmp_s = tmp.to_string_lossy().to_string();
        let res = tauri::async_runtime::spawn_blocking(move || {
            powershell(SIGN_PS, &[("AURIS_TP", thumbprint), ("AURIS_IN", tmp_s), ("AURIS_ESS", ess_attr)])
        })
        .await
        .map_err(|e| e.to_string())?;
        let _ = std::fs::remove_file(&tmp);
        let b64 = res?;
        if b64.is_empty() {
            return Err("O certificado não retornou assinatura.".into());
        }
        Ok(b64.lines().last().unwrap_or_default().trim().to_string())
    }
    #[cfg(not(windows))]
    {
        let _ = (thumbprint, data, ess_attr);
        Err("Certificados instalados só estão disponíveis no Windows.".into())
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let cwd = std::env::current_dir().ok().map(|p| p.to_string_lossy().to_string());
    let initial = parse_args(&args, cwd.as_deref()).into_iter().collect::<Vec<_>>();

    tauri::Builder::default()
        // precisa ser o primeiro plugin: um 2º clique em PDF abre numa aba da janela já aberta
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            if let Some(l) = parse_args(&argv, Some(&cwd)) {
                let _ = app.emit("launch", l);
            }
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(Pending(Mutex::new(initial)))
        .invoke_handler(tauri::generate_handler![
            take_launch,
            read_file,
            write_file,
            open_default_apps,
            open_url,
            compress_pdf,
            list_certificates,
            sign_with_certificate
        ])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o Auris PDF");
}
