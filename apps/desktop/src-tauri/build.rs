use std::path::PathBuf;

fn main() {
    // Obtener el directorio del proyecto
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
    let lib_dir = PathBuf::from(&manifest_dir).join("lib");
    
    #[cfg(target_os = "windows")]
    {
        // Verificar que mpv.lib existe en el directorio lib/
        let mpv_lib_path = lib_dir.join("mpv.lib");
        
        if mpv_lib_path.exists() {
            println!("cargo:rustc-link-search=native={}", lib_dir.display());
            println!("cargo:rustc-link-lib=mpv");
            println!("cargo:rerun-if-changed=lib/mpv.lib");
            
            // Copiar la DLL al directorio de salida para que esté disponible en tiempo de ejecución
            let dll_src = lib_dir.join("mpv.dll");
            if dll_src.exists() {
                let out_dir = std::env::var("OUT_DIR").unwrap();
                let target_dir = PathBuf::from(&out_dir)
                    .ancestors()
                    .nth(3)
                    .unwrap()
                    .join("deps");
                
                let dll_dst = target_dir.join("mpv.dll");
                
                if let Err(e) = std::fs::copy(&dll_src, &dll_dst) {
                    println!("cargo:warning=Failed to copy mpv.dll: {}", e);
                } else {
                    println!("cargo:warning=mpv.dll copied to target directory");
                }
            }
        } else {
            println!("cargo:warning=mpv.lib not found in lib/ directory");
            println!("cargo:warning=Please place mpv.lib and mpv.dll in src-tauri/lib/");
            println!("cargo:warning=Run scripts/fetch-libmpv-windows.ps1 to download them");
        }
    }

    // macOS: link against the libmpv bundled by scripts/bundle-libmpv-macos.mjs (shipped in
    // Contents/Frameworks). Without it, fall back to whatever LIBRARY_PATH provides (Homebrew).
    #[cfg(target_os = "macos")]
    {
        let mac_dir = lib_dir.join("macos");
        println!("cargo:rerun-if-changed=lib/macos/libmpv.2.dylib");
        if mac_dir.join("libmpv.dylib").exists() {
            println!("cargo:rustc-link-search=native={}", mac_dir.display());
        } else {
            println!("cargo:warning=lib/macos not found: run `node scripts/bundle-libmpv-macos.mjs` to bundle libmpv");
        }
    }

    // Configuración de Tauri
    tauri_build::build()
}