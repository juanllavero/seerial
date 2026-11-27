use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use libmpv2::{Mpv, mpv_node::MpvNode};
use serde::Serialize;
use tauri::{AppHandle, State, Window};
use raw_window_handle::{HasWindowHandle};

// ─── Enums ───────────────────────────────────────────────────────────────────

#[derive(serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub enum SubtitleColor {
    White, Yellow, Black, Cyan, Blue, Green, Magenta, Red, Gray,
    Orange, Gold, Pink,
}

#[derive(serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub enum SubtitleSize {
    Tiny, Small, Normal, Large, Huge,
}

#[derive(serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub enum SubtitlePosition {
    BottomLeft, BottomCenter, BottomRight,
    TopLeft, TopCenter, TopRight,
}

/// Hardware decoders to try, in order; mpv falls back to software if none works.
/// `d3d11va` covers the common formats on any GPU, `nvdec-copy` adds what only NVIDIA
/// can decode (e.g. 10-bit H.264 on RTX 50). Vulkan is left out on purpose: it returns
/// grey frames for 10-bit H.264, which `auto` would pick without reporting an error.
#[cfg(target_os = "windows")]
const HWDEC_APIS: &str = "d3d11va,nvdec-copy";
#[cfg(not(target_os = "windows"))]
const HWDEC_APIS: &str = "auto";

fn get_window_id<W: HasWindowHandle>(window: &W) -> Option<i64> {
    let window_handle = window.window_handle().ok()?;
    let raw_handle = window_handle.as_raw();

    #[cfg(target_os = "windows")]
    {
        if let raw_window_handle::RawWindowHandle::Win32(handle) = raw_handle {
            return Some(handle.hwnd.get() as i64);
        }
    }

    #[cfg(target_os = "linux")]
    {
        if let raw_window_handle::RawWindowHandle::Xlib(handle) = raw_handle {
            return Some(handle.window as i64);
        }
    }

    None
}

#[cfg(not(target_os = "macos"))]
pub fn bind_mpv_to_window<W: HasWindowHandle>(window: &W, state: &MpvState) -> Result<(), String> {
    let Some(wid) = get_window_id(window) else {
        return Ok(());
    };

    *state.window_id.lock().map_err(|e| e.to_string())? = Some(wid);

    state.with_mpv(|mpv| {
        mpv.set_property("wid", wid)?;
        mpv.set_property("force-window", "yes")
    })
}

fn map_ff_index_to_mpv_track_id(mpv: &Mpv, track_type: &str, ff_index: i64) -> Result<i64, libmpv2::Error> {
    let track_list: MpvNode = mpv.get_property("track-list")?;

    let Some(track_items) = track_list.array() else {
        return Ok(ff_index);
    };

    for track in track_items {
        let Some(fields) = track.map() else {
            continue;
        };

        let mut current_type: Option<String> = None;
        let mut current_ff_index: Option<i64> = None;
        let mut current_id: Option<i64> = None;

        for (key, value) in fields {
            match key.as_str() {
                "type" => {
                    current_type = value.str().map(ToOwned::to_owned);
                }
                "ff-index" => {
                    current_ff_index = value.i64();
                }
                "id" => {
                    current_id = value.i64();
                }
                _ => {}
            }
        }

        if current_type.as_deref() == Some(track_type) && current_ff_index == Some(ff_index) {
            if let Some(id) = current_id {
                return Ok(id);
            }
        }
    }

    Ok(ff_index)
}

/// Titles written in the file for its tracks, by ffprobe stream index.
#[cfg_attr(not(target_os = "macos"), tauri::command)]
#[cfg_attr(target_os = "macos", tauri::command(async))]
pub fn get_track_titles(state: State<MpvState>) -> Result<HashMap<i64, String>, String> {
    state.with_mpv(|mpv| {
        let track_list: MpvNode = mpv.get_property("track-list")?;
        let mut titles = HashMap::new();

        for track in track_list.array().into_iter().flatten() {
            let Some(fields) = track.map() else {
                continue;
            };
            let mut ff_index = None;
            let mut title = None;

            for (key, value) in fields {
                match key.as_str() {
                    "ff-index" => ff_index = value.i64(),
                    "title" => title = value.str().map(ToOwned::to_owned),
                    _ => {}
                }
            }

            if let (Some(index), Some(title)) = (ff_index, title) {
                titles.insert(index, title);
            }
        }

        Ok(titles)
    })
}

// NOTE on the `tauri::command(async)` pairs below (macOS only):
// plain `fn` commands run on the *main* thread, but on macOS mpv creates and
// destroys its window with DispatchQueue.main.sync from its own threads. Any
// mpv call made from the main thread while that happens deadlocks the whole app
// (black screen + beachball). `command(async)` runs them on a worker thread.
// Windows keeps the original `#[tauri::command]` behaviour.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackStatus {
    pub position: Option<f64>,
    pub duration: Option<f64>,
    pub paused_for_cache: bool,
    pub seeking: bool,
    pub idle_active: bool,
    pub eof_reached: bool,
}

#[derive(serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub enum VideoQuality {
    Low,
    Normal,
    High,
    Ultra,
    Maximum,
}

#[cfg_attr(not(target_os = "macos"), tauri::command)]
#[cfg_attr(target_os = "macos", tauri::command(async))]
pub fn set_video_quality(state: State<MpvState>, quality: VideoQuality) -> Result<(), String> {
    state.with_mpv(|mpv| {
        match quality {
            VideoQuality::Low => {
                mpv.command("apply-profile", &["fast"])?;
            }
            VideoQuality::Normal => {
                mpv.set_property("scale", "spline36")?;
                mpv.set_property("cscale", "spline36")?;
                mpv.set_property("dscale", "mitchell")?;
                mpv.set_property("deband", false)?;
            }
            VideoQuality::High => {
                mpv.command("apply-profile", &["high-quality"])?;
                mpv.set_property("deband-iterations", 2i64)?;
            }
            VideoQuality::Ultra => {
                mpv.command("apply-profile", &["high-quality"])?;
                mpv.set_property("scale", "ewa_lanczos4sharpest")?;
                mpv.set_property("deband-iterations", 4i64)?;
                mpv.set_property("deband-threshold", 48i64)?;
            }
            VideoQuality::Maximum => {
                mpv.command("apply-profile", &["high-quality"])?;
                mpv.set_property("scale", "ewa_lanczos4sharpest")?;
                mpv.set_property("cscale", "ewa_lanczos4sharpest")?;
                mpv.set_property("dscale", "ewa_lanczos4sharpest")?;
                mpv.set_property("scale-antiring", 1.0f64)?;
                mpv.set_property("deband-iterations", 4i64)?;
                mpv.set_property("deband-threshold", 64i64)?;
            }
        }
        Ok(())
    })
}

/// macOS: pointers (as usize) of the app window and of mpv's own window.
#[cfg(target_os = "macos")]
#[derive(Default)]
pub struct MacVideo {
    pub app: Option<AppHandle>,
    pub parent: usize,
    pub child: usize,
}

pub struct MpvState {
    pub mpv: Arc<Mutex<Option<Mpv>>>,
    pub window_id: Arc<Mutex<Option<i64>>>,
    /// Audio passthrough preference. `stop` recreates the mpv instance, so it has to be
    /// remembered here and re-applied to every new instance.
    pub exclusive_audio: Arc<AtomicBool>,
    #[cfg(target_os = "macos")]
    pub mac: Arc<Mutex<MacVideo>>,
}

impl MpvState {
    pub fn new() -> Self {
        let mpv = Self::create_mpv_instance();
        MpvState { 
            mpv: Arc::new(Mutex::new(Some(mpv))),
            window_id: Arc::new(Mutex::new(None)),
            exclusive_audio: Arc::new(AtomicBool::new(false)),
            #[cfg(target_os = "macos")]
            mac: Arc::new(Mutex::new(MacVideo::default())),
        }
    }

    /// Remembers the app window (call once, main thread).
    #[cfg(target_os = "macos")]
    pub fn macos_bind(&self, app: AppHandle, ns_window: *mut std::ffi::c_void) {
        unsafe { crate::macos_video::prepare_parent(ns_window) };
        if let Ok(mut mac) = self.mac.lock() {
            mac.app = Some(app);
            mac.parent = ns_window as usize;
        }
    }

    /// After a load, waits for mpv to create its window and glues it under the
    /// app window. Never touches the mpv instance (see `find_mpv_window`).
    #[cfg(target_os = "macos")]
    pub fn macos_watch(&self) {
        let mac = self.mac.clone();
        std::thread::spawn(move || {
            for _ in 0..200 {
                std::thread::sleep(std::time::Duration::from_millis(50));
                let (app, parent, current) = match mac.lock() {
                    Ok(m) => (m.app.clone(), m.parent, m.child),
                    Err(_) => return,
                };
                if current != 0 {
                    return; // already attached to this mpv instance
                }
                let Some(app) = app else { return };

                let (tx, rx) = std::sync::mpsc::channel::<bool>();
                let mac2 = mac.clone();
                let queued = app.run_on_main_thread(move || {
                    let found = unsafe {
                        crate::macos_video::find_mpv_window(parent as *mut _).map(|w| {
                            crate::macos_video::attach_child(parent as *mut _, w);
                            w as usize
                        })
                    };
                    if let Some(w) = found {
                        if let Ok(mut m) = mac2.lock() {
                            m.child = w;
                        }
                    }
                    let _ = tx.send(found.is_some());
                });
                if queued.is_err() {
                    return;
                }
                if rx.recv_timeout(std::time::Duration::from_secs(2)).unwrap_or(false) {
                    return;
                }
            }
        });
    }

    /// Keeps mpv's window under the app window (main thread).
    #[cfg(target_os = "macos")]
    pub fn macos_sync(&self) {
        if let Ok(m) = self.mac.lock() {
            unsafe { crate::macos_video::sync_frame(m.parent as *mut _, m.child as *mut _) };
        }
    }

    /// Releases the app window from mpv's window before that one is destroyed
    /// (called from a worker thread; waits for the main thread to do it).
    #[cfg(target_os = "macos")]
    fn macos_detach(&self) {
        let (app, parent, child) = match self.mac.lock() {
            Ok(mut m) => {
                let child = std::mem::take(&mut m.child);
                (m.app.clone(), m.parent, child)
            }
            Err(_) => return,
        };
        let Some(app) = app else { return };
        if child == 0 {
            return;
        }
        let (tx, rx) = std::sync::mpsc::channel::<()>();
        if app
            .run_on_main_thread(move || {
                unsafe { crate::macos_video::detach_child(parent as *mut _, child as *mut _) };
                let _ = tx.send(());
            })
            .is_ok()
        {
            let _ = rx.recv_timeout(std::time::Duration::from_secs(2));
        }
    }

    fn create_mpv_instance() -> Mpv {
        Mpv::with_initializer(|init| {
            #[cfg(not(target_os = "macos"))]
            {
                init.set_property("vo", "gpu-next")?;
                init.set_property("gpu-api", "d3d11")?;
                init.set_property("hwdec", HWDEC_APIS)?;

                init.set_property("d3d11-exclusive-fs", "yes")?;

                init.set_property("target-colorspace-hint", "yes")?;
                init.set_property("icc-profile-auto", false)?;

                init.set_property("video-output-levels", "auto")?;

                // init.set_property("profile", "high-quality")?;

                init.set_property("fullscreen", "yes")?;
            }

            // macOS: mpv renders in its own window (Vulkan via Metal => real
            // HDR/EDR). macos_video.rs glues it under the transparent app window.
            #[cfg(target_os = "macos")]
            {
                init.set_property("vo", "gpu-next")?;
                init.set_property("gpu-api", "vulkan")?;
                init.set_property("gpu-context", "macvk")?;
                init.set_property("hwdec", "videotoolbox")?;
                init.set_property("target-colorspace-hint", "yes")?;
                // The hint defaults to the display's colorspace, which MoltenVK does not report:
                // mpv then stays in SDR. Passing the source one (PQ/HLG) through enables EDR.
                // Ignored if this libmpv does not know the option.
                let _ = init.set_property("target-colorspace-hint-mode", "source");
                init.set_property("icc-profile-auto", false)?;
                init.set_property("video-output-levels", "auto")?;

                // The window is only a background: no chrome, no input, no focus.
                init.set_property("border", false)?;
                init.set_property("title-bar", false)?;
                init.set_property("focus-on", "never")?;
                init.set_property("input-cursor", false)?;
                init.set_property("input-default-bindings", false)?;
                init.set_property("input-vo-keyboard", false)?;
                init.set_property("osc", false)?;
                init.set_property("window-dragging", false)?;
                init.set_property("auto-window-resize", false)?;
                init.set_property("keepaspect-window", false)?;
                init.set_property("macos-menu-shortcuts", false)?;
                init.set_property("audio-display", "no")?;
                init.set_property("force-window", "no")?;
            }

            init.set_property("idle", "once")?;
            init.set_property("keep-open", "always")?;
            init.set_property("cursor-autohide", "100")?;
            init.set_property("msg-level", "all=debug")?;
            #[cfg(not(target_os = "macos"))]
            init.set_property("log-file", "./logs/mpv_log.txt")?;
            // macOS: every `stop` recreates mpv, which truncated the log of the video just played
            #[cfg(target_os = "macos")]
            {
                let started = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_millis())
                    .unwrap_or_default();
                init.set_property("log-file", format!("./logs/mpv_log_{started}.txt"))?;
            }
            #[cfg(not(target_os = "macos"))]
            {
                init.set_property("force-window", "no")?;   // yes to open new window for MPV
                init.set_property("wid", 0i64)?;
            }
            Ok(())
        }).expect("Failed to initialize MPV")
    }

    fn recreate_mpv_instance(&self) -> Result<(), String> {
        #[cfg(target_os = "macos")]
        self.macos_detach();

        let mut mpv_guard = self.mpv.lock().map_err(|e| e.to_string())?;
        let window_id_guard = self.window_id.lock().map_err(|e| e.to_string())?;
        
        // Create a new instance
        let new_mpv = Self::create_mpv_instance();
        
        // If we have a saved window_id, apply it to the new instance
        if let Some(wid) = *window_id_guard {
            let _ = new_mpv.set_property("wid", wid);
            let _ = new_mpv.set_property("force-window", "yes");
        }

        // A fresh instance knows nothing about the user's audio passthrough preference
        if self.exclusive_audio.load(Ordering::SeqCst) {
            let _ = apply_audio_passthrough(&new_mpv, true);
        }

        let old_mpv = mpv_guard.replace(new_mpv);

        // Dropping an Mpv waits for its VO thread to tear down; on macOS that
        // needs the main thread, so it must happen with no lock held.
        drop(mpv_guard);
        drop(window_id_guard);
        drop(old_mpv);

        Ok(())
    }

    fn with_mpv<F, R>(&self, f: F) -> Result<R, String> 
    where
        F: FnOnce(&Mpv) -> Result<R, libmpv2::Error>
    {
        let mpv_guard = self.mpv.lock().map_err(|e| e.to_string())?;
        if let Some(ref mpv) = *mpv_guard {
            f(mpv).map_err(|e| e.to_string())
        } else {
            Err("MPV instance not available".to_string())
        }
    }
}

#[cfg_attr(not(target_os = "macos"), tauri::command)]
#[cfg_attr(target_os = "macos", tauri::command(async))]
pub fn embed_mpv(window: Window, state: State<MpvState>) -> Result<(), String> {
    #[cfg(not(target_os = "macos"))]
    {
        bind_mpv_to_window(&window, &state)
    }
    // On macOS the surface is created once at startup (main thread).
    #[cfg(target_os = "macos")]
    {
        let _ = (&window, &state);
        Ok(())
    }
}

#[cfg_attr(not(target_os = "macos"), tauri::command)]
#[cfg_attr(target_os = "macos", tauri::command(async))]
pub fn play(state: State<MpvState>) -> Result<(), String> {
    state.with_mpv(|mpv| mpv.set_property("pause", false))
}

#[cfg_attr(not(target_os = "macos"), tauri::command)]
#[cfg_attr(target_os = "macos", tauri::command(async))]
pub fn pause(state: State<MpvState>) -> Result<(), String> {
    state.with_mpv(|mpv| mpv.set_property("pause", true))
}

#[cfg_attr(not(target_os = "macos"), tauri::command)]
#[cfg_attr(target_os = "macos", tauri::command(async))]
pub fn toggle_play_pause(state: State<MpvState>) -> Result<(), String> {
    state.with_mpv(|mpv| {
        let is_paused: bool = mpv.get_property("pause")?;
        mpv.set_property("pause", !is_paused)
    })
}

#[cfg_attr(not(target_os = "macos"), tauri::command)]
#[cfg_attr(target_os = "macos", tauri::command(async))]
pub fn stop(state: State<MpvState>) -> Result<(), String> {
    // Stop current playback first.
    let _ = state.with_mpv(|mpv| mpv.command("stop", &[]));
    
    // Recreate the MPV instance to release resources.
    state.recreate_mpv_instance()?;
    
    Ok(())
}

#[cfg_attr(not(target_os = "macos"), tauri::command)]
#[cfg_attr(target_os = "macos", tauri::command(async))]
pub fn exit_app(app: AppHandle, state: State<MpvState>) -> Result<(), String> {
    let _ = state.with_mpv(|mpv| mpv.command("quit", &[]));

    app.exit(0);

    Ok(())
}

#[cfg_attr(not(target_os = "macos"), tauri::command)]
#[cfg_attr(target_os = "macos", tauri::command(async))]
pub fn loadfile(state: State<MpvState>, file: String) -> Result<(), String> {
    use std::path::PathBuf;

    let pathbuf = PathBuf::from(&file);
    if !pathbuf.exists() {
        return Err(format!("File does not exist: {}", file));
    }

    let path_str = pathbuf.to_str().ok_or("Invalid path string")?.replace('\\', "/");
    let escaped_path = format!("\"{}\"", path_str);

    let result = state.with_mpv(|mpv| {
        mpv.command("loadfile", &[escaped_path.as_str(), "replace"])
    });
    #[cfg(target_os = "macos")]
    state.macos_watch();
    result
}

#[cfg_attr(not(target_os = "macos"), tauri::command)]
#[cfg_attr(target_os = "macos", tauri::command(async))]
pub fn load_url(state: State<MpvState>, url: String) -> Result<(), String> {
    // Basic URL validation
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("Invalid URL: must start with http:// or https://".to_string());
    }

    let result = state.with_mpv(|mpv| {
        mpv.command("loadfile", &[url.as_str(), "replace"])
    });
    #[cfg(target_os = "macos")]
    state.macos_watch();
    result
}

#[cfg_attr(not(target_os = "macos"), tauri::command)]
#[cfg_attr(target_os = "macos", tauri::command(async))]
pub fn get_position(state: State<MpvState>) -> Result<f64, String> {
    state.with_mpv(|mpv| mpv.get_property("time-pos"))
}

#[cfg_attr(not(target_os = "macos"), tauri::command)]
#[cfg_attr(target_os = "macos", tauri::command(async))]
pub fn set_position(state: State<MpvState>, position: f64) -> Result<(), String> {
    state.with_mpv(|mpv| mpv.set_property("time-pos", position))
}

/// Seeks to the keyframe nearest to `position`. Used to resume: an exact seek has to download
/// and decode everything from the previous keyframe up to the position (seconds on a 4K stream).
#[cfg_attr(not(target_os = "macos"), tauri::command)]
#[cfg_attr(target_os = "macos", tauri::command(async))]
pub fn seek_keyframe(state: State<MpvState>, position: f64) -> Result<(), String> {
    let target = position.to_string();
    state.with_mpv(|mpv| mpv.command("seek", &[target.as_str(), "absolute+keyframes"]))
}

#[cfg_attr(not(target_os = "macos"), tauri::command)]
#[cfg_attr(target_os = "macos", tauri::command(async))]
pub fn get_duration(state: State<MpvState>) -> Result<f64, String> {
    state.with_mpv(|mpv| mpv.get_property("duration"))
}

#[cfg_attr(not(target_os = "macos"), tauri::command)]
#[cfg_attr(target_os = "macos", tauri::command(async))]
pub fn get_playback_status(state: State<MpvState>) -> Result<PlaybackStatus, String> {
    state.with_mpv(|mpv| {
        Ok(PlaybackStatus {
            position: mpv.get_property("time-pos").ok(),
            duration: mpv.get_property("duration").ok(),
            paused_for_cache: mpv.get_property("paused-for-cache").unwrap_or(false),
            seeking: mpv.get_property("seeking").unwrap_or(false),
            idle_active: mpv.get_property("idle-active").unwrap_or(false),
            eof_reached: mpv.get_property("eof-reached").unwrap_or(false),
        })
    })
}

#[cfg_attr(not(target_os = "macos"), tauri::command)]
#[cfg_attr(target_os = "macos", tauri::command(async))]
pub fn set_volume(state: State<MpvState>, volume: f64) -> Result<(), String> {
    state.with_mpv(|mpv| mpv.set_property("volume", volume))
}

#[cfg_attr(not(target_os = "macos"), tauri::command)]
#[cfg_attr(target_os = "macos", tauri::command(async))]
pub fn get_volume(state: State<MpvState>) -> Result<f64, String> {
    state.with_mpv(|mpv| mpv.get_property("volume"))
}

/// Set audio track. Incoming track_id is an ffprobe stream index.
/// We map it to mpv `track-list/N/id` through `track-list/N/ff-index`.
#[cfg_attr(not(target_os = "macos"), tauri::command)]
#[cfg_attr(target_os = "macos", tauri::command(async))]
pub fn set_audio_track(state: State<MpvState>, track_id: i64) -> Result<(), String> {
    state.with_mpv(|mpv| {
        let resolved_track_id = if track_id <= 0 {
            track_id
        } else {
            map_ff_index_to_mpv_track_id(mpv, "audio", track_id)?
        };

        mpv.set_property("aid", resolved_track_id)
    })
}

/// Set subtitle track. Incoming track_id is an ffprobe stream index.
/// We map it to mpv `track-list/N/id` through `track-list/N/ff-index`.
#[cfg_attr(not(target_os = "macos"), tauri::command)]
#[cfg_attr(target_os = "macos", tauri::command(async))]
pub fn set_subtitle_track(state: State<MpvState>, track_id: i64) -> Result<(), String> {
    state.with_mpv(|mpv| {
        let resolved_track_id = if track_id <= 0 {
            track_id
        } else {
            map_ff_index_to_mpv_track_id(mpv, "sub", track_id)?
        };

        mpv.set_property("sid", resolved_track_id)
    })
}

/// Set zoom level. 0 = no zoom, positive values zoom in, negative values zoom out.
#[cfg_attr(not(target_os = "macos"), tauri::command)]
#[cfg_attr(target_os = "macos", tauri::command(async))]
pub fn set_zoom(state: State<MpvState>, zoom_level: f64) -> Result<(), String> {
    state.with_mpv(|mpv| mpv.set_property("video-zoom", zoom_level))
}

#[cfg_attr(not(target_os = "macos"), tauri::command)]
#[cfg_attr(target_os = "macos", tauri::command(async))]
pub fn set_audio_delay(state: State<MpvState>, delay: f64) -> Result<(), String> {
    state.with_mpv(|mpv| mpv.set_property("audio-delay", delay))
}

#[cfg_attr(not(target_os = "macos"), tauri::command)]
#[cfg_attr(target_os = "macos", tauri::command(async))]
pub fn set_subtitle_delay(state: State<MpvState>, delay: f64) -> Result<(), String> {
    state.with_mpv(|mpv| mpv.set_property("sub-delay", delay))
}

#[cfg_attr(not(target_os = "macos"), tauri::command)]
#[cfg_attr(target_os = "macos", tauri::command(async))]
pub fn set_subtitle_font_size(state: State<MpvState>, size: f64) -> Result<(), String> {
    state.with_mpv(|mpv| mpv.set_property("sub-font-size", size))
}

#[cfg_attr(not(target_os = "macos"), tauri::command)]
#[cfg_attr(target_os = "macos", tauri::command(async))]
pub fn set_subtitle_color(state: State<MpvState>, color: String) -> Result<(), String> {
    state.with_mpv(|mpv| mpv.set_property("sub-color", color.as_str()))
}

#[cfg_attr(not(target_os = "macos"), tauri::command)]
#[cfg_attr(target_os = "macos", tauri::command(async))]
pub fn set_subtitle_border_size(state: State<MpvState>, size: f64) -> Result<(), String> {
    state.with_mpv(|mpv| mpv.set_property("sub-border-size", size))
}

#[cfg_attr(not(target_os = "macos"), tauri::command)]
#[cfg_attr(target_os = "macos", tauri::command(async))]
pub fn set_subtitle_shadow_offset(state: State<MpvState>, offset: f64) -> Result<(), String> {
    state.with_mpv(|mpv| mpv.set_property("sub-shadow-offset", offset))
}

#[cfg_attr(not(target_os = "macos"), tauri::command)]
#[cfg_attr(target_os = "macos", tauri::command(async))]
pub fn set_subtitle_position(state: State<MpvState>, position: i64) -> Result<(), String> {
    state.with_mpv(|mpv| mpv.set_property("sub-pos", position))
}

// ─── Video ───────────────────────────────────────────────────────────────────

/// Toggles hardware-accelerated decoding. When enabled, uses `HWDEC_APIS`.
#[cfg_attr(not(target_os = "macos"), tauri::command)]
#[cfg_attr(target_os = "macos", tauri::command(async))]
pub fn set_hwdec(state: State<MpvState>, enabled: bool) -> Result<(), String> {
    state.with_mpv(|mpv| {
        mpv.set_property("hwdec", if enabled { HWDEC_APIS } else { "no" })
    })
}

// ─── Audio ───────────────────────────────────────────────────────────────────

/// Normalizes multichannel audio when downmixing to stereo,
/// preventing volume spikes on surround content.
#[cfg_attr(not(target_os = "macos"), tauri::command)]
#[cfg_attr(target_os = "macos", tauri::command(async))]
pub fn set_audio_normalize(state: State<MpvState>, enabled: bool) -> Result<(), String> {
    state.with_mpv(|mpv| {
        mpv.set_property("audio-normalize-downmix", enabled)
    })
}

/// Enables S/PDIF passthrough for lossless and lossy surround formats
/// (AC3, DTS, E-AC3, DTS-HD MA, TrueHD). When disabled, MPV decodes internally.
#[cfg_attr(not(target_os = "macos"), tauri::command)]
#[cfg_attr(target_os = "macos", tauri::command(async))]
pub fn set_audio_exclusive(state: State<MpvState>, enabled: bool) -> Result<(), String> {
    state.exclusive_audio.store(enabled, Ordering::SeqCst);
    state.with_mpv(|mpv| apply_audio_passthrough(mpv, enabled))
}

/// Codecs sent bit-for-bit to the receiver. TrueHD carries Dolby Atmos (MAT), E-AC-3 carries
/// Dolby Digital Plus/Atmos (JOC) and DTS-HD also covers DTS:X. `dts-hd` implies the DTS core.
const PASSTHROUGH_CODECS: &str = "ac3,eac3,dts,dts-hd,truehd";

fn apply_audio_passthrough(mpv: &Mpv, enabled: bool) -> Result<(), libmpv2::Error> {
    // Passthrough needs exclusive access to the device (WASAPI exclusive / CoreAudio hog mode),
    // and must not be combined with audio filters that would force a decode.
    mpv.set_property("audio-exclusive", enabled)?;
    mpv.set_property("audio-spdif", if enabled { PASSTHROUGH_CODECS } else { "" })?;
    if enabled {
        mpv.set_property("af", "")?;
    }
    Ok(())
}

// ─── Subtitles ───────────────────────────────────────────────────────────────

/// Sets subtitle text color using a predefined palette.
/// Colors are expressed as RGBA hex strings (`#RRGGBBAA`).
#[cfg_attr(not(target_os = "macos"), tauri::command)]
#[cfg_attr(target_os = "macos", tauri::command(async))]
pub fn set_subtitle_color_preset(state: State<MpvState>, color: SubtitleColor) -> Result<(), String> {
    let hex = match color {
        SubtitleColor::White   => "#FFFFFFFF",
        SubtitleColor::Yellow  => "#FFFF00FF",
        SubtitleColor::Black   => "#000000FF",
        SubtitleColor::Cyan    => "#00FFFFFF",
        SubtitleColor::Blue    => "#0000FFFF",
        SubtitleColor::Green   => "#00FF00FF",
        SubtitleColor::Magenta => "#FF00FFFF",
        SubtitleColor::Red     => "#FF0000FF",
        SubtitleColor::Gray    => "#808080FF",
        SubtitleColor::Orange  => "#FF8000FF",
        SubtitleColor::Gold    => "#FFD700FF",
        SubtitleColor::Pink    => "#FF69B4FF",
    };
    state.with_mpv(|mpv| mpv.set_property("sub-color", hex))
}

/// Maps a named size preset to a concrete `sub-font-size` value.
/// Values are tuned for a typical 1080p/4K living-room viewing distance.
#[cfg_attr(not(target_os = "macos"), tauri::command)]
#[cfg_attr(target_os = "macos", tauri::command(async))]
pub fn set_subtitle_size_preset(state: State<MpvState>, size: SubtitleSize) -> Result<(), String> {
    let value: f64 = match size {
        SubtitleSize::Tiny   => 18.0,
        SubtitleSize::Small  => 28.0,
        SubtitleSize::Normal => 40.0,
        SubtitleSize::Large  => 55.0,
        SubtitleSize::Huge   => 72.0,
    };
    state.with_mpv(|mpv| mpv.set_property("sub-font-size", value))
}

/// Positions subtitles using a combination of `sub-pos` (vertical %, 0 = top),
/// `sub-align-x` (horizontal alignment), and `sub-align-y` (vertical anchor).
#[cfg_attr(not(target_os = "macos"), tauri::command)]
#[cfg_attr(target_os = "macos", tauri::command(async))]
pub fn set_subtitle_position_preset(state: State<MpvState>, position: SubtitlePosition) -> Result<(), String> {
    state.with_mpv(|mpv| {
        let (pos, align_x, align_y) = match position {
            SubtitlePosition::BottomLeft   => (95i64, "left",   "bottom"),
            SubtitlePosition::BottomCenter => (95i64, "center", "bottom"),
            SubtitlePosition::BottomRight  => (95i64, "right",  "bottom"),
            SubtitlePosition::TopLeft      => (5i64,  "left",   "top"),
            SubtitlePosition::TopCenter    => (5i64,  "center", "top"),
            SubtitlePosition::TopRight     => (5i64,  "right",  "top"),
        };
        mpv.set_property("sub-pos", pos)?;
        mpv.set_property("sub-align-x", align_x)?;
        mpv.set_property("sub-align-y", align_y)
    })
}
