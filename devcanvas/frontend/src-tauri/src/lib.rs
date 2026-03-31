use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};

struct BackendSidecar(Mutex<Option<CommandChild>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(BackendSidecar(Mutex::new(None)))
        .setup(|app| {
            let sidecar_cmd = app
                .shell()
                .sidecar("devcanvas-backend")
                .expect("devcanvas-backend sidecar not found — run `npm run build:sidecar` first");

            let (mut rx, child) = sidecar_cmd
                .spawn()
                .expect("failed to spawn devcanvas-backend sidecar");

            // Keep the child alive by storing it in app state
            *app.state::<BackendSidecar>().0.lock().unwrap() = Some(child);

            // Forward backend stdout/stderr to the Tauri console
            tauri::async_runtime::spawn(async move {
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(data) => {
                            print!("{}", String::from_utf8_lossy(&data));
                        }
                        CommandEvent::Stderr(data) => {
                            eprint!("{}", String::from_utf8_lossy(&data));
                        }
                        CommandEvent::Terminated(status) => {
                            eprintln!("[devcanvas-backend] process exited: {:?}", status);
                            break;
                        }
                        _ => {}
                    }
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                // Kill sidecar cleanly on app exit
                let state = app_handle.state::<BackendSidecar>();
                if let Some(child) = state.0.lock().unwrap().take() {
                    let _ = child.kill();
                };
            }
        });
}
