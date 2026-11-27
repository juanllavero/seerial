mod video;
mod audio;
#[cfg(target_os = "macos")]
mod macos_video;

use tauri::{Manager, window::Color};

#[cfg(not(target_os = "macos"))]
use video::bind_mpv_to_window;
use video::{
    exit_app,
    MpvState,
    // Playback
    embed_mpv, play, pause, stop, toggle_play_pause, loadfile, load_url, seek_keyframe,
    get_position, set_position, get_duration, get_playback_status,
    // Video
    set_volume, get_volume, set_zoom, set_video_quality,
    set_hwdec,
    // Audio (MPV)
    set_audio_track, set_audio_delay, get_track_titles,
    set_audio_normalize, set_audio_exclusive,
    // Subtitles
    set_subtitle_track, set_subtitle_delay,
    set_subtitle_font_size, set_subtitle_color,
    set_subtitle_border_size, set_subtitle_shadow_offset, set_subtitle_position,
    set_subtitle_color_preset, set_subtitle_size_preset, set_subtitle_position_preset,
};

use audio::{
    KaraokeState,
    get_karaoke_preload_status,
    get_karaoke_preload_status_for_urls,
    preload_karaoke,
    reset_karaoke_preload,
    start_karaoke, 
    set_karaoke_mix, 
    pause_karaoke,
    resume_karaoke,
    seek_karaoke,
    stop_karaoke,
    get_karaoke_status,
};

/// macOS: mpv renders with Vulkan through MoltenVK. The Vulkan loader finds MoltenVK through an
/// ICD manifest shipped with the app (see scripts/bundle-libmpv-macos.mjs); point it there so the
/// app does not depend on a Homebrew install.
#[cfg(target_os = "macos")]
fn use_bundled_vulkan_driver() {
    if std::env::var_os("VK_DRIVER_FILES").is_some() || std::env::var_os("VK_ICD_FILENAMES").is_some() {
        return;
    }
    let Some(exe_dir) = std::env::current_exe().ok().and_then(|p| p.parent().map(|d| d.to_path_buf())) else {
        return;
    };
    let rel = std::path::Path::new("vulkan/icd.d/MoltenVK_icd.json");
    // Bundle: Contents/MacOS/<exe> -> Contents/Resources. Dev: target/<profile>/<exe> -> target/<profile>.
    let candidates = [exe_dir.join("../Resources").join(rel), exe_dir.join(rel)];
    if let Some(icd) = candidates.iter().find(|p| p.exists()) {
        std::env::set_var("VK_DRIVER_FILES", icd);
        std::env::set_var("VK_ICD_FILENAMES", icd);
    }
}

#[tokio::main]
async fn main() {
    #[cfg(target_os = "macos")]
    use_bundled_vulkan_driver();

    // Initialize MPV state
    let mpv_state = MpvState::new();
    
    // Initialize Karaoke engine state (Rodio)
    let karaoke_state = KaraokeState::new();

    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(mpv_state)
        .manage(karaoke_state)
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let state = app.state::<MpvState>();
                #[cfg(not(target_os = "macos"))]
                if let Err(error) = bind_mpv_to_window(&window, &state) {
                    eprintln!("Failed to bind MPV to window: {error}");
                }

                #[cfg(target_os = "macos")]
                if let Ok(ns_window) = window.ns_window() {
                    state.macos_bind(app.handle().clone(), ns_window);
                }
            }

            let main_window = app.get_webview_window("main")
                .ok_or_else(|| "Failed to find the main window")?;

            // macOS: the webview must not paint an opaque background so the
            // video view underneath (see macos_video.rs) shows through.
            #[cfg(target_os = "macos")]
            {
                let _ = main_window.with_webview(|wv| unsafe {
                    use objc2::runtime::{AnyClass, AnyObject, Bool};
                    use objc2::msg_send;
                    use objc2_foundation::NSString;
                    let wk = wv.inner() as *mut AnyObject;
                    let num: *mut AnyObject = msg_send![AnyClass::get(c"NSNumber").unwrap(), numberWithBool: Bool::NO];
                    let key = NSString::from_str("drawsBackground");
                    let _: () = msg_send![wk, setValue: num, forKey: &*key];
                });
            }

            // Windows-specific
            #[cfg(target_os = "windows")]
            {
                // Webview transparency to allow MPV's own rendering to show through
                let _ = main_window.set_background_color(Some(Color(0, 0, 0, 0)));
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            #[cfg(target_os = "macos")]
            if matches!(event, tauri::WindowEvent::Resized(_) | tauri::WindowEvent::Moved(_)) {
                window.state::<MpvState>().macos_sync();
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (window, event);
        })
        .invoke_handler(tauri::generate_handler![
            // --- MPV Commands (Video and Normal Playback) ---
            embed_mpv,
            play,
            pause,
            stop,
            exit_app,
            toggle_play_pause,
            loadfile,
            load_url,
            seek_keyframe,
            get_position,
            set_position,
            get_duration,
            get_playback_status,
            set_volume,
            get_volume,
            set_zoom,
            set_video_quality,
            set_hwdec,
            set_audio_track,
            get_track_titles,
            set_audio_delay,
            set_audio_normalize,
            set_audio_exclusive,
            set_subtitle_track,
            set_subtitle_delay,
            set_subtitle_font_size,
            set_subtitle_color,
            set_subtitle_border_size,
            set_subtitle_shadow_offset,
            set_subtitle_position,
            set_subtitle_color_preset,
            set_subtitle_size_preset,
            set_subtitle_position_preset,
            
            // --- Rodio Commands (Karaoke Mode) ---
            get_karaoke_preload_status,
            get_karaoke_preload_status_for_urls,
            preload_karaoke,
            reset_karaoke_preload,
            start_karaoke,
            set_karaoke_mix,
            pause_karaoke,
            resume_karaoke,
            seek_karaoke,
            stop_karaoke,
            get_karaoke_status
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri app");
}