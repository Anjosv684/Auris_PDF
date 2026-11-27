// Impressão nativa: PDFium desenha cada página (vetorial, via GDI/EMF) direto no DC da
// impressora do Windows. Sem passar pela janela de impressão do WebView2.
//
// A DLL do PDFium (BSD/Apache) é empacotada como resource (resources/pdfium.dll) e
// carregada em runtime com libloading. Só as funções necessárias são declaradas.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PrinterInfo {
    pub name: String,
    pub port: String,
    pub is_default: bool,
    /// "Pronta", "Offline", "Pausada", "Erro", "Sem papel", "Papel atolado"...
    pub status: String,
    pub ready: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrinterCaps {
    pub duplex: bool,
    pub color: bool,
    /// papel em retrato, em pontos (1/72")
    pub paper_w: f64,
    pub paper_h: f64,
    /// margens não imprimíveis (retrato), em pontos
    pub margin_l: f64,
    pub margin_t: f64,
    pub margin_r: f64,
    pub margin_b: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Prefs {
    pub devmode: String,
    pub duplex: String,
    pub gray: bool,
    pub orientation: String,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PrintOptions {
    /// índices 0-based; vazio/ausente = todas
    pub pages: Option<Vec<u32>>,
    pub copies: u32,
    pub collate: bool,
    /// "none" | "long" | "short"
    pub duplex: String,
    pub gray: bool,
    /// "auto" | "portrait" | "landscape"
    pub orientation: String,
    /// "fit" | "actual" | "shrink" | "custom"
    pub scaling: String,
    /// porcentagem para "custom"
    pub scale: f64,
    pub devmode: Option<String>,
    pub job_name: String,
    pub password: Option<String>,
    /// imprimir em arquivo (ex.: "Microsoft Print to PDF" sem perguntar onde salvar)
    #[serde(default)]
    pub output: Option<String>,
}

// ------------------------------------------------------------------ cancelamento
static JOBS: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
fn jobs() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    JOBS.get_or_init(Default::default)
}
pub fn register_job(id: &str) -> Arc<AtomicBool> {
    let flag = Arc::new(AtomicBool::new(false));
    jobs().lock().unwrap().insert(id.to_string(), flag.clone());
    flag
}
pub fn finish_job(id: &str) {
    jobs().lock().unwrap().remove(id);
}
pub fn cancel_job(id: &str) -> bool {
    match jobs().lock().unwrap().get(id) {
        Some(f) => {
            f.store(true, Ordering::SeqCst);
            true
        }
        None => false,
    }
}

// ------------------------------------------------------------------ Windows
#[cfg(windows)]
pub use win::*;

#[cfg(windows)]
mod win {
    use super::*;
    use base64::Engine;
    use libloading::Library;
    use std::ffi::{c_char, c_int, c_void, CString};
    use std::path::Path;
    use std::ptr::{null, null_mut};
    use windows_sys::Win32::Graphics::Gdi::{
        CreateDCW, CreateICW, DeleteDC, GetDeviceCaps, ResetDCW, DEVMODEW, HDC,
    };
    use windows_sys::Win32::Graphics::Printing::{
        ClosePrinter, DocumentPropertiesW, EnumPrintersW, GetDefaultPrinterW, OpenPrinterW, PRINTER_HANDLE,
        PRINTER_INFO_2W,
    };
    use windows_sys::Win32::Storage::Xps::{AbortDoc, DeviceCapabilitiesW, EndDoc, EndPage, StartDocW, StartPage, DOCINFOW};

    // constantes Win32 (valores fixos da API, declarados aqui para não depender de features extras)
    const PRINTER_ENUM_LOCAL: u32 = 2;
    const PRINTER_ENUM_CONNECTIONS: u32 = 4;
    const DM_OUT_BUFFER: u32 = 2;
    const DM_IN_PROMPT: u32 = 4;
    const DM_IN_BUFFER: u32 = 8;
    const IDOK: i32 = 1;
    const DM_ORIENTATION: u32 = 0x1;
    const DM_COPIES: u32 = 0x100;
    const DM_COLOR: u32 = 0x800;
    const DM_DUPLEX: u32 = 0x1000;
    const DM_COLLATE: u32 = 0x8000;
    const DMORIENT_PORTRAIT: i16 = 1;
    const DMORIENT_LANDSCAPE: i16 = 2;
    const DMCOLOR_MONOCHROME: i16 = 1;
    const DMCOLOR_COLOR: i16 = 2;
    const DMDUP_SIMPLEX: i16 = 1;
    const DMDUP_VERTICAL: i16 = 2; // borda longa
    const DMDUP_HORIZONTAL: i16 = 3; // borda curta
    const DC_DUPLEX: u16 = 7;
    const DC_COLORDEVICE: u16 = 32;
    const HORZRES: i32 = 8;
    const VERTRES: i32 = 10;
    const LOGPIXELSX: i32 = 88;
    const LOGPIXELSY: i32 = 90;
    const PHYSICALWIDTH: i32 = 110;
    const PHYSICALHEIGHT: i32 = 111;
    const PHYSICALOFFSETX: i32 = 112;
    const PHYSICALOFFSETY: i32 = 113;
    const ERROR_CANCELLED: i32 = 1223;

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }
    unsafe fn from_wide(p: *const u16) -> String {
        if p.is_null() {
            return String::new();
        }
        let mut n = 0;
        while *p.add(n) != 0 {
            n += 1;
        }
        String::from_utf16_lossy(std::slice::from_raw_parts(p, n))
    }

    // -------------------------------------------------------------- PDFium (FFI)
    type Doc = *mut c_void;
    type Page = *mut c_void;
    const FPDF_ANNOT: c_int = 0x01;
    const FPDF_GRAYSCALE: c_int = 0x08;
    const FPDF_PRINTING: c_int = 0x800;
    const FPDF_ERR_PASSWORD: u32 = 4;
    const FPDF_PRINTMODE_EMF: c_int = 0;

    struct Pdfium {
        _lib: Library,
        load_mem: unsafe extern "system" fn(*const c_void, usize, *const c_char) -> Doc,
        last_error: unsafe extern "system" fn() -> u32,
        page_count: unsafe extern "system" fn(Doc) -> c_int,
        load_page: unsafe extern "system" fn(Doc, c_int) -> Page,
        page_w: unsafe extern "system" fn(Page) -> f32,
        page_h: unsafe extern "system" fn(Page) -> f32,
        render: unsafe extern "system" fn(HDC, Page, c_int, c_int, c_int, c_int, c_int, c_int),
        close_page: unsafe extern "system" fn(Page),
        close_doc: unsafe extern "system" fn(Doc),
    }
    // o PDFium não é thread-safe: todo uso passa por este Mutex (os trabalhos ficam em fila)
    unsafe impl Send for Pdfium {}
    static PDFIUM: OnceLock<Result<Mutex<Pdfium>, String>> = OnceLock::new();

    fn pdfium(dll: &Path) -> Result<&'static Mutex<Pdfium>, String> {
        PDFIUM
            .get_or_init(|| unsafe {
                let lib = Library::new(dll).map_err(|e| format!("Não foi possível carregar o motor de impressão (pdfium.dll): {e}"))?;
                macro_rules! sym {
                    ($n:literal) => {
                        *lib.get($n).map_err(|e| format!("pdfium.dll incompatível: {e}"))?
                    };
                }
                let init: unsafe extern "system" fn() = sym!(b"FPDF_InitLibrary\0");
                let set_mode: unsafe extern "system" fn(c_int) -> c_int = sym!(b"FPDF_SetPrintMode\0");
                let p = Pdfium {
                    load_mem: sym!(b"FPDF_LoadMemDocument64\0"),
                    last_error: sym!(b"FPDF_GetLastError\0"),
                    page_count: sym!(b"FPDF_GetPageCount\0"),
                    load_page: sym!(b"FPDF_LoadPage\0"),
                    page_w: sym!(b"FPDF_GetPageWidthF\0"),
                    page_h: sym!(b"FPDF_GetPageHeightF\0"),
                    render: sym!(b"FPDF_RenderPage\0"),
                    close_page: sym!(b"FPDF_ClosePage\0"),
                    close_doc: sym!(b"FPDF_CloseDocument\0"),
                    _lib: lib,
                };
                init();
                set_mode(FPDF_PRINTMODE_EMF); // saída vetorial (EMF)
                Ok(Mutex::new(p))
            })
            .as_ref()
            .map_err(|e| e.clone())
    }

    // -------------------------------------------------------------- impressoras
    fn default_printer() -> String {
        unsafe {
            let mut n = 0u32;
            GetDefaultPrinterW(null_mut(), &mut n);
            if n == 0 {
                return String::new();
            }
            let mut buf = vec![0u16; n as usize];
            if GetDefaultPrinterW(buf.as_mut_ptr(), &mut n) == 0 {
                return String::new();
            }
            from_wide(buf.as_ptr())
        }
    }

    fn status_text(status: u32, attrs: u32) -> (String, bool) {
        let s = |t: &str| (t.to_string(), false);
        if attrs & 0x400 != 0 || status & 0x80 != 0 || status & 0x1000 != 0 {
            return s("Offline");
        }
        if status & 0x1 != 0 {
            return s("Pausada");
        }
        if status & 0x8 != 0 {
            return s("Papel atolado");
        }
        if status & 0x10 != 0 || status & 0x40 != 0 {
            return s("Sem papel");
        }
        if status & 0x40000 != 0 {
            return s("Pouco toner");
        }
        if status & 0x2 != 0 {
            return s("Erro");
        }
        ("Pronta".into(), true)
    }

    pub fn list_printers() -> Result<Vec<PrinterInfo>, String> {
        unsafe {
            let flags = PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS;
            let (mut needed, mut count) = (0u32, 0u32);
            EnumPrintersW(flags, null(), 2, null_mut(), 0, &mut needed, &mut count);
            if needed == 0 {
                return Ok(vec![]);
            }
            // u64 para garantir alinhamento das estruturas
            let mut buf = vec![0u64; (needed as usize).div_ceil(8)];
            if EnumPrintersW(flags, null(), 2, buf.as_mut_ptr() as *mut u8, needed, &mut needed, &mut count) == 0 {
                return Err("Não foi possível listar as impressoras.".into());
            }
            let def = default_printer();
            let items = std::slice::from_raw_parts(buf.as_ptr() as *const PRINTER_INFO_2W, count as usize);
            let mut out: Vec<PrinterInfo> = items
                .iter()
                .map(|p| {
                    let name = from_wide(p.pPrinterName);
                    let (status, ready) = status_text(p.Status, p.Attributes);
                    PrinterInfo { is_default: name == def, port: from_wide(p.pPortName), name, status, ready }
                })
                .collect();
            out.sort_by(|a, b| b.is_default.cmp(&a.is_default).then(a.name.to_lowercase().cmp(&b.name.to_lowercase())));
            Ok(out)
        }
    }

    struct Printer(PRINTER_HANDLE);
    impl Drop for Printer {
        fn drop(&mut self) {
            unsafe { ClosePrinter(self.0) };
        }
    }
    fn open_printer(name: &[u16]) -> Result<Printer, String> {
        let mut h: PRINTER_HANDLE = unsafe { std::mem::zeroed() };
        if unsafe { OpenPrinterW(name.as_ptr(), &mut h, null()) } == 0 {
            return Err("Impressora não encontrada ou sem acesso.".into());
        }
        Ok(Printer(h))
    }

    /// DEVMODE completo (com a parte privada do driver). `input` = DEVMODE salvo antes (base64).
    /// `hwnd` != 0 mostra o diálogo de preferências do driver.
    fn devmode(name: &[u16], input: Option<&str>, hwnd: isize) -> Result<Option<Vec<u8>>, String> {
        let pr = open_printer(name)?;
        unsafe {
            let size = DocumentPropertiesW(null_mut(), pr.0, name.as_ptr(), null_mut(), null(), 0);
            if size <= 0 {
                return Err("O driver da impressora não respondeu.".into());
            }
            let inbuf = input
                .and_then(|b| base64::engine::general_purpose::STANDARD.decode(b).ok())
                .filter(|b| b.len() >= std::mem::size_of::<DEVMODEW>() && &b[..64] == as_bytes(name, 64).as_slice());
            let mut out = vec![0u64; (size as usize).div_ceil(8) + 1];
            let mut mode = DM_OUT_BUFFER;
            let mut inptr: *const DEVMODEW = null();
            let inaligned: Vec<u64>;
            if let Some(b) = &inbuf {
                let mut v = vec![0u64; b.len().div_ceil(8)];
                std::ptr::copy_nonoverlapping(b.as_ptr(), v.as_mut_ptr() as *mut u8, b.len());
                inaligned = v;
                inptr = inaligned.as_ptr() as *const DEVMODEW;
                mode |= DM_IN_BUFFER;
            }
            if hwnd != 0 {
                mode |= DM_IN_PROMPT;
            }
            let r = DocumentPropertiesW(hwnd as _, pr.0, name.as_ptr(), out.as_mut_ptr() as *mut DEVMODEW, inptr, mode);
            if r < 0 {
                return Err("O driver da impressora recusou as configurações.".into());
            }
            if hwnd != 0 && r != IDOK {
                return Ok(None); // usuário cancelou o diálogo
            }
            let dm = &*(out.as_ptr() as *const DEVMODEW);
            let total = dm.dmSize as usize + dm.dmDriverExtra as usize;
            let bytes = std::slice::from_raw_parts(out.as_ptr() as *const u8, total.min(size as usize)).to_vec();
            Ok(Some(bytes))
        }
    }

    // compara o nome do dispositivo gravado no DEVMODE (evita aplicar DEVMODE de outra impressora)
    fn as_bytes(name: &[u16], n: usize) -> Vec<u8> {
        let mut v = vec![0u8; n];
        for (i, c) in name.iter().take(31).enumerate() {
            if *c == 0 {
                break;
            }
            v[i * 2..i * 2 + 2].copy_from_slice(&c.to_le_bytes());
        }
        v
    }

    fn aligned(dm: &[u8]) -> Vec<u64> {
        let mut v = vec![0u64; dm.len().div_ceil(8)];
        unsafe { std::ptr::copy_nonoverlapping(dm.as_ptr(), v.as_mut_ptr() as *mut u8, dm.len()) };
        v
    }
    fn dm_mut(v: &mut [u64]) -> &mut DEVMODEW {
        unsafe { &mut *(v.as_mut_ptr() as *mut DEVMODEW) }
    }

    pub fn printer_preferences(name: &str, input: Option<String>, hwnd: isize) -> Result<Option<Prefs>, String> {
        let n = wide(name);
        let Some(bytes) = devmode(&n, input.as_deref(), hwnd)? else { return Ok(None) };
        let mut v = aligned(&bytes);
        let dm = dm_mut(&mut v);
        let (orient, duplex) = unsafe { (dm.Anonymous1.Anonymous1.dmOrientation, dm.dmDuplex) };
        Ok(Some(Prefs {
            devmode: base64::engine::general_purpose::STANDARD.encode(&bytes),
            duplex: if dm.dmFields & DM_DUPLEX == 0 {
                "keep".into()
            } else {
                match duplex {
                    DMDUP_VERTICAL => "long",
                    DMDUP_HORIZONTAL => "short",
                    _ => "none",
                }
                .into()
            },
            gray: dm.dmFields & DM_COLOR != 0 && dm.dmColor == DMCOLOR_MONOCHROME,
            orientation: if dm.dmFields & DM_ORIENTATION != 0 && orient == DMORIENT_LANDSCAPE { "landscape" } else { "keep" }.into(),
        }))
    }

    struct Caps {
        phys_w: f64,
        phys_h: f64,
        off_x: f64,
        off_y: f64,
        horz: f64,
        vert: f64,
        dpi_x: f64,
        dpi_y: f64,
    }
    fn caps(hdc: HDC) -> Caps {
        let g = |i| unsafe { GetDeviceCaps(hdc, i) } as f64;
        Caps {
            phys_w: g(PHYSICALWIDTH),
            phys_h: g(PHYSICALHEIGHT),
            off_x: g(PHYSICALOFFSETX),
            off_y: g(PHYSICALOFFSETY),
            horz: g(HORZRES),
            vert: g(VERTRES),
            dpi_x: g(LOGPIXELSX).max(1.0),
            dpi_y: g(LOGPIXELSY).max(1.0),
        }
    }

    pub fn printer_caps(name: &str, port: &str, input: Option<String>) -> Result<PrinterCaps, String> {
        let n = wide(name);
        let p = wide(port);
        let bytes = devmode(&n, input.as_deref(), 0)?.ok_or("Sem configuração")?;
        let mut v = aligned(&bytes);
        {
            let dm = dm_mut(&mut v);
            dm.dmFields |= DM_ORIENTATION;
            dm.Anonymous1.Anonymous1.dmOrientation = DMORIENT_PORTRAIT;
        }
        unsafe {
            let dmp = v.as_ptr() as *const DEVMODEW;
            let port_ptr = if port.is_empty() { null() } else { p.as_ptr() };
            let duplex = DeviceCapabilitiesW(n.as_ptr(), port_ptr, DC_DUPLEX, null_mut(), dmp) == 1;
            let color = DeviceCapabilitiesW(n.as_ptr(), port_ptr, DC_COLORDEVICE, null_mut(), dmp) == 1;
            let ic = CreateICW(null(), n.as_ptr(), null(), dmp);
            if ic.is_null() {
                return Err("Não foi possível consultar a impressora.".into());
            }
            let c = caps(ic);
            DeleteDC(ic);
            let pt_x = |d: f64| d / c.dpi_x * 72.0;
            let pt_y = |d: f64| d / c.dpi_y * 72.0;
            Ok(PrinterCaps {
                duplex,
                color,
                paper_w: pt_x(c.phys_w),
                paper_h: pt_y(c.phys_h),
                margin_l: pt_x(c.off_x),
                margin_t: pt_y(c.off_y),
                margin_r: pt_x((c.phys_w - c.horz - c.off_x).max(0.0)),
                margin_b: pt_y((c.phys_h - c.vert - c.off_y).max(0.0)),
            })
        }
    }

    // -------------------------------------------------------------- impressão
    struct Dc(HDC);
    impl Drop for Dc {
        fn drop(&mut self) {
            unsafe { DeleteDC(self.0) };
        }
    }

    /// Posição e tamanho da página no DC (unidades do dispositivo, origem = canto da área imprimível).
    fn place(c: &Caps, w_pt: f64, h_pt: f64, o: &PrintOptions) -> (i32, i32, i32, i32) {
        let pw = w_pt / 72.0 * c.dpi_x;
        let ph = h_pt / 72.0 * c.dpi_y;
        let fit = (c.horz / pw).min(c.vert / ph);
        let (s, in_area) = match o.scaling.as_str() {
            "actual" => (1.0, false),
            "shrink" => {
                if fit < 1.0 {
                    (fit, true)
                } else {
                    (1.0, false)
                }
            }
            "custom" => ((o.scale / 100.0).clamp(0.05, 10.0), false),
            _ => (fit, true),
        };
        let (dw, dh) = (pw * s, ph * s);
        let (x, y) = if in_area {
            ((c.horz - dw) / 2.0, (c.vert - dh) / 2.0)
        } else {
            ((c.phys_w - dw) / 2.0 - c.off_x, (c.phys_h - dh) / 2.0 - c.off_y)
        };
        (x.round() as i32, y.round() as i32, dw.round() as i32, dh.round() as i32)
    }

    pub fn print_pdf(
        dll: &Path,
        bytes: &[u8],
        printer: &str,
        o: &PrintOptions,
        cancel: &AtomicBool,
        progress: &dyn Fn(u32, u32),
    ) -> Result<(), String> {
        let lib = pdfium(dll)?.lock().map_err(|_| "Motor de impressão indisponível.".to_string())?;
        let pwd = CString::new(o.password.clone().unwrap_or_default()).unwrap_or_default();
        let doc = unsafe { (lib.load_mem)(bytes.as_ptr() as *const c_void, bytes.len(), pwd.as_ptr()) };
        if doc.is_null() {
            let e = unsafe { (lib.last_error)() };
            return Err(if e == FPDF_ERR_PASSWORD { "PDF protegido por senha.".into() } else { "Não foi possível ler o PDF para impressão.".into() });
        }
        struct DocGuard<'a>(&'a Pdfium, Doc);
        impl Drop for DocGuard<'_> {
            fn drop(&mut self) {
                unsafe { (self.0.close_doc)(self.1) };
            }
        }
        let _g = DocGuard(&lib, doc);

        let count = unsafe { (lib.page_count)(doc) }.max(0) as u32;
        let pages: Vec<u32> = match &o.pages {
            Some(p) if !p.is_empty() => p.iter().copied().filter(|&i| i < count).collect(),
            _ => (0..count).collect(),
        };
        if pages.is_empty() {
            return Err("Nenhuma página para imprimir.".into());
        }
        // cópias feitas aqui (não pelo driver): funciona igual em qualquer impressora,
        // permite progresso/cancelamento e frente e verso correto com cópias agrupadas
        let copies = o.copies.clamp(1, 999);
        let duplex = o.duplex != "none" && o.duplex != "keep";
        let mut seq: Vec<Option<u32>> = vec![];
        if o.collate {
            for c in 0..copies {
                seq.extend(pages.iter().map(|&p| Some(p)));
                if duplex && pages.len() % 2 == 1 && c + 1 < copies {
                    seq.push(None); // verso em branco: a próxima cópia começa numa folha nova
                }
            }
        } else {
            for &p in &pages {
                seq.extend(std::iter::repeat(Some(p)).take(copies as usize));
            }
        }

        // DEVMODE: preferências salvas + opções do diálogo
        let n = wide(printer);
        let base = devmode(&n, o.devmode.as_deref(), 0)?.ok_or("Sem configuração")?;
        let mut dmv = aligned(&base);
        {
            let dm = dm_mut(&mut dmv);
            dm.dmFields |= DM_COPIES | DM_COLLATE;
            dm.Anonymous1.Anonymous1.dmCopies = 1;
            dm.dmCollate = 0;
            if o.duplex != "keep" {
                dm.dmFields |= DM_DUPLEX;
                dm.dmDuplex = match o.duplex.as_str() {
                    "long" => DMDUP_VERTICAL,
                    "short" => DMDUP_HORIZONTAL,
                    _ => DMDUP_SIMPLEX,
                };
            }
            dm.dmFields |= DM_COLOR;
            dm.dmColor = if o.gray { DMCOLOR_MONOCHROME } else { DMCOLOR_COLOR };
        }
        let fixed = match o.orientation.as_str() {
            "portrait" => Some(DMORIENT_PORTRAIT),
            "landscape" => Some(DMORIENT_LANDSCAPE),
            _ => None,
        };
        let page_size = |i: u32| unsafe {
            let p = (lib.load_page)(doc, i as c_int);
            if p.is_null() {
                return (595.0, 842.0);
            }
            let s = ((lib.page_w)(p) as f64, (lib.page_h)(p) as f64);
            (lib.close_page)(p);
            s
        };
        let orient_for = |i: u32| fixed.unwrap_or_else(|| {
            let (w, h) = page_size(i);
            if w > h { DMORIENT_LANDSCAPE } else { DMORIENT_PORTRAIT }
        });
        let mut cur = orient_for(pages[0]);
        {
            let dm = dm_mut(&mut dmv);
            dm.dmFields |= DM_ORIENTATION;
            dm.Anonymous1.Anonymous1.dmOrientation = cur;
        }

        let hdc = unsafe { CreateDCW(null(), n.as_ptr(), null(), dmv.as_ptr() as *const DEVMODEW) };
        if hdc.is_null() {
            return Err("Não foi possível abrir a impressora.".into());
        }
        let dc = Dc(hdc);
        let title = wide(if o.job_name.is_empty() { "Auris PDF" } else { &o.job_name });
        let output = o.output.as_deref().map(wide);
        let di = DOCINFOW {
            cbSize: std::mem::size_of::<DOCINFOW>() as i32,
            lpszDocName: title.as_ptr(),
            lpszOutput: output.as_ref().map(|v| v.as_ptr()).unwrap_or(null()),
            lpszDatatype: null(),
            fwType: 0,
        };
        if unsafe { StartDocW(dc.0, &di) } <= 0 {
            let err = std::io::Error::last_os_error().raw_os_error().unwrap_or(0);
            return Err(if err == ERROR_CANCELLED { "Impressão cancelada.".into() } else { "A impressora recusou o trabalho.".into() });
        }
        let mut c = caps(dc.0);
        let flags = FPDF_ANNOT | FPDF_PRINTING | if o.gray { FPDF_GRAYSCALE } else { 0 };
        let total = seq.len() as u32;
        let abort = |msg: &str| -> Result<(), String> {
            unsafe { AbortDoc(dc.0) };
            Err(msg.to_string())
        };

        for (k, item) in seq.iter().enumerate() {
            if cancel.load(Ordering::SeqCst) {
                return abort("Impressão cancelada.");
            }
            if let Some(i) = *item {
                let want = orient_for(i);
                if want != cur {
                    // troca a orientação só entre páginas (ResetDC é permitido aqui)
                    let dm = dm_mut(&mut dmv);
                    dm.Anonymous1.Anonymous1.dmOrientation = want;
                    if unsafe { ResetDCW(dc.0, dmv.as_ptr() as *const DEVMODEW) }.is_null() {
                        return abort("A impressora não aceitou mudar a orientação.");
                    }
                    cur = want;
                    c = caps(dc.0);
                }
            }
            if unsafe { StartPage(dc.0) } <= 0 {
                return abort("Falha ao enviar a página para a impressora.");
            }
            if let Some(i) = *item {
                unsafe {
                    let p = (lib.load_page)(doc, i as c_int);
                    if !p.is_null() {
                        let (w, h) = ((lib.page_w)(p) as f64, (lib.page_h)(p) as f64);
                        let (x, y, dw, dh) = place(&c, w, h, o);
                        (lib.render)(dc.0, p, x, y, dw, dh, 0, flags);
                        (lib.close_page)(p);
                    }
                }
            }
            if unsafe { EndPage(dc.0) } <= 0 {
                return abort("Falha ao enviar a página para a impressora.");
            }
            progress(k as u32 + 1, total);
        }
        if unsafe { EndDoc(dc.0) } <= 0 {
            return Err("A impressora não concluiu o trabalho.".into());
        }
        Ok(())
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    /// Imprime tests/teste-impressao.pdf na "Microsoft Print to PDF" (gerar com AURIS_TEST_PDF).
    #[test]
    fn imprime_no_print_to_pdf() {
        let Ok(src) = std::env::var("AURIS_TEST_PDF") else { return };
        let out = std::env::var("AURIS_TEST_OUT").unwrap();
        let printers = list_printers().unwrap();
        println!("impressoras: {:?}", printers.iter().map(|p| format!("{} [{}]{}", p.name, p.status, if p.is_default { " *" } else { "" })).collect::<Vec<_>>());
        let pr = printers.iter().find(|p| p.name == "Microsoft Print to PDF").expect("Microsoft Print to PDF");
        let caps = printer_caps(&pr.name, &pr.port, None).unwrap();
        println!("caps: duplex={} cor={} papel={:.0}x{:.0}pt margens={:.1},{:.1},{:.1},{:.1}", caps.duplex, caps.color, caps.paper_w, caps.paper_h, caps.margin_l, caps.margin_t, caps.margin_r, caps.margin_b);
        let bytes = std::fs::read(src).unwrap();
        let o = PrintOptions {
            pages: Some(vec![0, 1, 2]), copies: 2, collate: true, duplex: "none".into(), gray: false,
            orientation: "auto".into(), scaling: "fit".into(), scale: 100.0, devmode: None,
            job_name: "teste".into(), password: None, output: Some(out),
        };
        let dll = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/pdfium.dll");
        let t = std::time::Instant::now();
        print_pdf(&dll, &bytes, &pr.name, &o, &AtomicBool::new(false), &|p, t| println!("pagina {p}/{t}")).unwrap();
        println!("tempo: {:?}", t.elapsed());
    }
}
