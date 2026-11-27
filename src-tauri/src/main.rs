// Auris PDF — backend (Tauri 2)
// Arquivos em disco, integração com o Windows (abrir com, menu de contexto,
// app padrão) e assinatura com certificados do repositório do Windows (A1/A3).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod print;

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

/// Interpreta a linha de comando: `AurisPDF.exe [--comprimir|--juntar|--imprimir] arquivo.pdf ...`
fn parse_args(args: &[String], cwd: Option<&str>) -> Option<Launch> {
    let mut action = "abrir".to_string();
    let mut paths = vec![];
    for a in args.iter().skip(1) {
        match a.as_str() {
            "--comprimir" => action = "comprimir".into(),
            "--juntar" => action = "juntar".into(),
            "--imprimir" => action = "imprimir".into(),
            "--imagens" => action = "imagens".into(),
            s if s.starts_with("--") || s.starts_with("-psn") => {}
            s => {
                let mut p = PathBuf::from(s);
                if p.is_relative() {
                    if let Some(c) = cwd {
                        p = Path::new(c).join(p);
                    }
                }
                let ext = p.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
                let ok = if action == "imagens" {
                    matches!(ext.as_str(), "jpg" | "jpeg" | "png" | "webp" | "gif" | "bmp")
                } else {
                    ext == "pdf"
                };
                if ok && p.is_file() {
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

/// Abre um documento gerado pelo app (.docx/.pdf) no programa padrão do Windows.
#[tauri::command]
fn open_path(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    let ok = p.is_file() && p.extension().map(|e| e.eq_ignore_ascii_case("docx") || e.eq_ignore_ascii_case("pdf")).unwrap_or(false);
    if !ok {
        return Err("Arquivo não permitido".into());
    }
    #[cfg(windows)]
    {
        hidden(std::process::Command::new("cmd").args(["/C", "start", "", &path]))
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
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

// ------------------------------------------------------------------ OCR e PDF → Word (motor PyMuPDF)
#[derive(Clone, Serialize)]
struct EngineProgress {
    job: String,
    page: u32,
    total: u32,
}

/// Roda `auris-compress.exe <modo> <entrada> <saída> <args...>`, repassando as linhas
/// "PROGRESSO feitas total" como evento `engine-progress`. Retorna o JSON final e o arquivo gerado.
fn run_engine(app: &tauri::AppHandle, job: &str, mode: &str, bytes: &[u8], out_ext: &str, args: &[std::ffi::OsString]) -> Result<(serde_json::Value, Vec<u8>), String> {
    use std::io::{BufRead, BufReader};
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let engine = exe.with_file_name(if cfg!(windows) { "auris-compress.exe" } else { "auris-compress" });
    if !engine.is_file() {
        return Err("Motor de PDF não encontrado. Reinstale o Auris PDF.".into());
    }
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
    let dir = std::env::temp_dir();
    let input = dir.join(format!("auris-{mode}-{nanos}-in.pdf"));
    let output = dir.join(format!("auris-{mode}-{nanos}-out.{out_ext}"));
    std::fs::write(&input, bytes).map_err(|e| e.to_string())?;
    let mut cmd = std::process::Command::new(&engine);
    cmd.arg(mode).arg(&input).arg(&output).args(args).stdout(std::process::Stdio::piped());
    #[cfg(windows)]
    hidden(&mut cmd);
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            let _ = std::fs::remove_file(&input);
            return Err(format!("Falha ao iniciar o motor de PDF: {e}"));
        }
    };
    let mut last = String::new();
    if let Some(out) = child.stdout.take() {
        for line in BufReader::new(out).lines().map_while(Result::ok) {
            if let Some(rest) = line.strip_prefix("PROGRESSO ") {
                let mut it = rest.split_whitespace().filter_map(|n| n.parse::<u32>().ok());
                if let (Some(page), Some(total)) = (it.next(), it.next()) {
                    let _ = app.emit("engine-progress", EngineProgress { job: job.to_string(), page, total });
                }
            } else if !line.trim().is_empty() {
                last = line;
            }
        }
    }
    let status = child.wait().map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(&input);
    let info: serde_json::Value = serde_json::from_str(&last).unwrap_or(serde_json::Value::Null);
    if !status.success() {
        let _ = std::fs::remove_file(&output);
        let msg = info.get("erro").and_then(|v| v.as_str()).unwrap_or("Falha ao processar o PDF.");
        return Err(if msg.contains("senha") { "PDF protegido por senha.".into() } else { msg.to_string() });
    }
    let data = std::fs::read(&output).map_err(|e| e.to_string());
    let _ = std::fs::remove_file(&output);
    Ok((info, data?))
}

/// Remove o prefixo `\\?\` que o Windows/Tauri põe em caminhos "verbatim".
/// O Tesseract não entende esse prefixo e falha com "language initialisation failed".
fn plain_path(p: std::path::PathBuf) -> std::path::PathBuf {
    let s = p.to_string_lossy();
    if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
        return std::path::PathBuf::from(format!(r"\\{rest}"));
    }
    if let Some(rest) = s.strip_prefix(r"\\?\") {
        return std::path::PathBuf::from(rest);
    }
    p
}

fn tessdata_dir(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    app.path().resource_dir().map(|d| plain_path(d.join("tessdata"))).ok().filter(|p| p.is_dir())
}

/// OCR: acrescenta uma camada de texto invisível às páginas escaneadas.
/// Corpo: bytes do PDF. Cabeçalhos: `job` e `force` (1 = refazer também páginas que já têm texto).
/// Resposta: 2 bytes (u16 BE) com quantas páginas foram reconhecidas + PDF pesquisável.
#[tauri::command]
async fn ocr_pdf(app: tauri::AppHandle, request: Request<'_>) -> Result<Response, String> {
    let header = |k: &str| request.headers().get(k).and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    let job = header("job");
    let force = if header("force") == "1" { "1" } else { "0" };
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("Conteúdo inválido".into());
    };
    let bytes = bytes.clone();
    let tessdata = tessdata_dir(&app).ok_or("Arquivos de idioma do OCR não encontrados. Reinstale o Auris PDF.")?;
    tauri::async_runtime::spawn_blocking(move || -> Result<Response, String> {
        let (info, pdf) = run_engine(&app, &job, "ocr", &bytes, "pdf", &[tessdata.into_os_string(), force.into()])?;
        let n = info.get("reconhecidas").and_then(|v| v.as_u64()).unwrap_or(0).min(u16::MAX as u64) as u16;
        let mut res = n.to_be_bytes().to_vec();
        res.extend_from_slice(&pdf);
        Ok(Response::new(res))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// PDF → Word (.docx). Páginas escaneadas passam pelo OCR antes.
/// Corpo: bytes do PDF. Cabeçalho: `job`. Resposta: 2 bytes (u16 BE) com o nº de páginas escaneadas + .docx.
#[tauri::command]
async fn pdf_to_word(app: tauri::AppHandle, request: Request<'_>) -> Result<Response, String> {
    let job = request.headers().get("job").and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("Conteúdo inválido".into());
    };
    let bytes = bytes.clone();
    let tessdata = tessdata_dir(&app).map(|p| p.into_os_string()).unwrap_or_default();
    tauri::async_runtime::spawn_blocking(move || -> Result<Response, String> {
        let (info, docx) = run_engine(&app, &job, "word", &bytes, "docx", &[tessdata])?;
        let n = info.get("escaneadas").and_then(|v| v.as_u64()).unwrap_or(0).min(u16::MAX as u64) as u16;
        let mut res = n.to_be_bytes().to_vec();
        res.extend_from_slice(&docx);
        Ok(Response::new(res))
    })
    .await
    .map_err(|e| e.to_string())?
}

// ------------------------------------------------------------------ edição de texto (motor em modo servidor)
// O motor fica aberto enquanto o usuário edita: cada edição leva ~0,2 s em vez de ~3 s.
struct EngineProc {
    child: std::process::Child,
    stdin: std::process::ChildStdin,
    stdout: std::io::BufReader<std::process::ChildStdout>,
}
static ENGINE: std::sync::OnceLock<Mutex<Option<EngineProc>>> = std::sync::OnceLock::new();

fn engine_spawn() -> Result<EngineProc, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let engine = exe.with_file_name(if cfg!(windows) { "auris-compress.exe" } else { "auris-compress" });
    if !engine.is_file() {
        return Err("Motor de PDF não encontrado. Reinstale o Auris PDF.".into());
    }
    let mut cmd = std::process::Command::new(&engine);
    cmd.arg("serve").stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::piped());
    #[cfg(windows)]
    hidden(&mut cmd);
    let mut child = cmd.spawn().map_err(|e| format!("Falha ao iniciar o motor de PDF: {e}"))?;
    let stdin = child.stdin.take().ok_or("sem stdin")?;
    let stdout = std::io::BufReader::new(child.stdout.take().ok_or("sem stdout")?);
    Ok(EngineProc { child, stdin, stdout })
}

/// Envia uma requisição JSON ao motor (abrindo-o se preciso) e devolve a resposta.
fn engine_request(req: &serde_json::Value) -> Result<serde_json::Value, String> {
    use std::io::{BufRead, Write};
    let mut guard = ENGINE.get_or_init(|| Mutex::new(None)).lock().map_err(|_| "Motor ocupado".to_string())?;
    for _ in 0..2 {
        if guard.is_none() {
            *guard = Some(engine_spawn()?);
        }
        let p = guard.as_mut().unwrap();
        let mut line = String::new();
        let ok = writeln!(p.stdin, "{req}").is_ok() && p.stdin.flush().is_ok() && p.stdout.read_line(&mut line).map(|n| n > 0).unwrap_or(false);
        if ok {
            let v: serde_json::Value = serde_json::from_str(line.trim()).map_err(|e| format!("Resposta inválida do motor: {e}"))?;
            if let Some(e) = v.get("erro").and_then(|e| e.as_str()) {
                return Err(if e.contains("senha") { "PDF protegido por senha.".into() } else { e.to_string() });
            }
            return Ok(v);
        }
        // o motor caiu: descarta e tenta de novo uma vez
        if let Some(mut dead) = guard.take() {
            let _ = dead.child.kill();
        }
    }
    Err("O motor de PDF parou de responder.".into())
}

fn temp_pdf(tag: &str) -> std::path::PathBuf {
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
    std::env::temp_dir().join(format!("auris-{tag}-{nanos}.pdf"))
}

/// Abre o motor antes da primeira edição (chamado ao escolher a ferramenta).
#[tauri::command]
async fn engine_warmup() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| engine_request(&serde_json::json!({ "cmd": "ping" })).map(|_| ()))
        .await
        .map_err(|e| e.to_string())?
}

/// Linhas editáveis de uma página (texto, caixa, tamanho, negrito, família, cor, `scanned`).
/// Página escaneada: usa a camada de OCR ou faz o OCR na hora. Cabeçalho `page`.
#[tauri::command]
async fn text_lines(app: tauri::AppHandle, request: Request<'_>) -> Result<serde_json::Value, String> {
    let page: u32 = request.headers().get("page").and_then(|v| v.to_str().ok()).and_then(|v| v.parse().ok()).unwrap_or(0);
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("Conteúdo inválido".into());
    };
    let bytes = bytes.clone();
    let tessdata = tessdata_dir(&app).map(|p| p.to_string_lossy().to_string());
    tauri::async_runtime::spawn_blocking(move || {
        let input = temp_pdf("lines");
        std::fs::write(&input, &bytes).map_err(|e| e.to_string())?;
        let r = engine_request(&serde_json::json!({ "cmd": "lines", "in": input, "page": page, "tessdata": tessdata }));
        let _ = std::fs::remove_file(&input);
        r.map(|v| v.get("lines").cloned().unwrap_or(serde_json::Value::Null))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Aplica edições de texto. Corpo: PDF. Cabeçalho `edits`: JSON url-encoded
/// `[{page, rect:[x0,y0,x1,y1], text, size?, bold?}]`. Resposta: PDF editado.
#[tauri::command]
async fn edit_text(request: Request<'_>) -> Result<Response, String> {
    let raw = request.headers().get("edits").and_then(|v| v.to_str().ok()).ok_or("Edições ausentes")?;
    let edits: serde_json::Value = serde_json::from_str(&urlencoding::decode(raw).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("Conteúdo inválido".into());
    };
    let bytes = bytes.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (input, output) = (temp_pdf("edit-in"), temp_pdf("edit-out"));
        std::fs::write(&input, &bytes).map_err(|e| e.to_string())?;
        let r = engine_request(&serde_json::json!({ "cmd": "edit", "in": input, "out": output, "edits": edits }));
        let _ = std::fs::remove_file(&input);
        let pdf = r.and_then(|_| std::fs::read(&output).map_err(|e| e.to_string()));
        let _ = std::fs::remove_file(&output);
        pdf.map(Response::new)
    })
    .await
    .map_err(|e| e.to_string())?
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

// ------------------------------------------------------------------ impressão nativa (PDFium)
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PrintEvent {
    job: String,
    page: u32,
    total: u32,
    message: Option<String>,
}

#[tauri::command]
async fn list_printers() -> Result<Vec<print::PrinterInfo>, String> {
    #[cfg(windows)]
    return tauri::async_runtime::spawn_blocking(print::list_printers).await.map_err(|e| e.to_string())?;
    #[cfg(not(windows))]
    Err("Impressão nativa disponível apenas no Windows.".into())
}

#[tauri::command]
async fn printer_caps(name: String, port: String, devmode: Option<String>) -> Result<print::PrinterCaps, String> {
    #[cfg(windows)]
    return tauri::async_runtime::spawn_blocking(move || print::printer_caps(&name, &port, devmode))
        .await
        .map_err(|e| e.to_string())?;
    #[cfg(not(windows))]
    {
        let _ = (name, port, devmode);
        Err("Impressão nativa disponível apenas no Windows.".into())
    }
}

/// Abre o diálogo de preferências do driver. Retorna None se o usuário cancelar.
#[tauri::command]
async fn printer_preferences(window: tauri::WebviewWindow, name: String, devmode: Option<String>) -> Result<Option<print::Prefs>, String> {
    #[cfg(windows)]
    {
        let hwnd = window.hwnd().map(|h| h.0 as isize).unwrap_or(0);
        return tauri::async_runtime::spawn_blocking(move || print::printer_preferences(&name, devmode, hwnd))
            .await
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(windows))]
    {
        let _ = (window, name, devmode);
        Err("Impressão nativa disponível apenas no Windows.".into())
    }
}

/// Corpo: bytes do PDF. Cabeçalhos: `job`, `printer` e `options` (JSON), todos url-encoded.
/// Responde na hora; o trabalho roda em segundo plano e emite `print-progress`, `print-done` e `print-error`.
#[tauri::command]
fn print_pdf(app: tauri::AppHandle, request: Request) -> Result<(), String> {
    let header = |k: &str| -> Result<String, String> {
        let raw = request.headers().get(k).and_then(|v| v.to_str().ok()).ok_or(format!("Cabeçalho {k} ausente"))?;
        Ok(urlencoding::decode(raw).map_err(|e| e.to_string())?.into_owned())
    };
    let job = header("job")?;
    let printer = header("printer")?;
    let opts: print::PrintOptions = serde_json::from_str(&header("options")?).map_err(|e| format!("Opções inválidas: {e}"))?;
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("Conteúdo inválido".into());
    };
    let bytes = bytes.clone();
    let dll = app
        .path()
        .resource_dir()
        .map(|d| d.join("pdfium.dll"))
        .ok()
        .filter(|p| p.is_file())
        .or_else(|| std::env::current_exe().ok().map(|e| e.with_file_name("pdfium.dll")))
        .unwrap_or_default();
    let cancel = print::register_job(&job);
    tauri::async_runtime::spawn_blocking(move || {
        let ev = |page, total, message: Option<String>| PrintEvent { job: job.clone(), page, total, message };
        #[cfg(windows)]
        let res = print::print_pdf(&dll, &bytes, &printer, &opts, &cancel, &|p, t| {
            let _ = app.emit("print-progress", ev(p, t, None));
        });
        #[cfg(not(windows))]
        let res: Result<(), String> = {
            let _ = (&dll, &bytes, &printer, &opts, &cancel);
            Err("Impressão nativa disponível apenas no Windows.".into())
        };
        print::finish_job(&job);
        match res {
            Ok(()) => {
                let _ = app.emit("print-done", ev(0, 0, None));
            }
            Err(m) => {
                let _ = app.emit("print-error", ev(0, 0, Some(m)));
            }
        }
    });
    Ok(())
}

#[tauri::command]
fn cancel_print(job: String) -> bool {
    print::cancel_job(&job)
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
  # vários arquivos no mesmo processo: o token pede o PIN uma vez só
  foreach ($f in ($env:AURIS_IN -split '\|')) {
    $data = [System.IO.File]::ReadAllBytes($f)
    $ci = New-Object System.Security.Cryptography.Pkcs.ContentInfo -ArgumentList @(,$data)
    $cms = New-Object System.Security.Cryptography.Pkcs.SignedCms -ArgumentList $ci, $true
    $cms.ComputeSignature($signer, $false)
    [Console]::Out.WriteLine([Convert]::ToBase64String($cms.Encode()))
  }
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
    let mut v = sign_many(thumbprint, vec![data], ess_attr).await?;
    v.pop().ok_or_else(|| "O certificado não retornou assinatura.".into())
}

/** Assina vários conteúdos com o mesmo certificado num só processo (PIN do token uma vez só). */
#[tauri::command]
async fn sign_many_with_certificate(thumbprint: String, items: Vec<String>, ess_attr: String) -> Result<Vec<String>, String> {
    sign_many(thumbprint, items, ess_attr).await
}

async fn sign_many(thumbprint: String, items: Vec<String>, ess_attr: String) -> Result<Vec<String>, String> {
    #[cfg(windows)]
    {
        use base64::Engine;
        if !thumbprint.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err("Certificado inválido".into());
        }
        if items.is_empty() {
            return Ok(vec![]);
        }
        let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let mut files = Vec::new();
        let cleanup = |files: &Vec<std::path::PathBuf>| files.iter().for_each(|f| { let _ = std::fs::remove_file(f); });
        for (i, d) in items.iter().enumerate() {
            let bytes = match base64::engine::general_purpose::STANDARD.decode(d) {
                Ok(b) => b,
                Err(e) => { cleanup(&files); return Err(e.to_string()); }
            };
            let tmp = std::env::temp_dir().join(format!("auris-sign-{nanos}-{i}.bin"));
            if let Err(e) = std::fs::write(&tmp, bytes) { cleanup(&files); return Err(e.to_string()); }
            files.push(tmp);
        }
        let list = files.iter().map(|f| f.to_string_lossy().to_string()).collect::<Vec<_>>().join("|");
        let res = tauri::async_runtime::spawn_blocking(move || {
            powershell(SIGN_PS, &[("AURIS_TP", thumbprint), ("AURIS_IN", list), ("AURIS_ESS", ess_attr)])
        })
        .await
        .map_err(|e| e.to_string());
        cleanup(&files);
        let out = res??;
        let sigs: Vec<String> = out.lines().map(|l| l.trim()).filter(|l| !l.is_empty()).map(String::from).collect();
        if sigs.len() < items.len() {
            return Err("O certificado não retornou todas as assinaturas.".into());
        }
        Ok(sigs[sigs.len() - items.len()..].to_vec())
    }
    #[cfg(not(windows))]
    {
        let _ = (thumbprint, items, ess_attr);
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
        // a janela nasce invisível e só aparece com a tela de abertura já desenhada (sem flash preto/branco)
        .on_page_load(|webview, payload| {
            if payload.event() == tauri::webview::PageLoadEvent::Finished {
                let _ = webview.window().show();
            }
        })
        .manage(Pending(Mutex::new(initial)))
        .invoke_handler(tauri::generate_handler![
            take_launch,
            read_file,
            write_file,
            open_default_apps,
            open_url,
            open_path,
            compress_pdf,
            ocr_pdf,
            pdf_to_word,
            engine_warmup,
            text_lines,
            edit_text,
            list_printers,
            printer_caps,
            printer_preferences,
            print_pdf,
            cancel_print,
            list_certificates,
            sign_with_certificate,
            sign_many_with_certificate
        ])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o Auris PDF");
}

#[cfg(test)]
mod tests {
    use super::plain_path;
    use std::path::PathBuf;

    #[test]
    fn remove_prefixo_verbatim() {
        assert_eq!(plain_path(PathBuf::from(r"\\?\C:\Users\x\AppData\Local\Auris PDF\tessdata")), PathBuf::from(r"C:\Users\x\AppData\Local\Auris PDF\tessdata"));
        assert_eq!(plain_path(PathBuf::from(r"\\?\UNC\servidor\pasta")), PathBuf::from(r"\\servidor\pasta"));
        assert_eq!(plain_path(PathBuf::from(r"C:\normal")), PathBuf::from(r"C:\normal"));
    }
}
