//! macOS video window glue.
//!
//! mpv dropped support for embedding into a foreign NSView through `--wid`, so
//! on macOS mpv renders into its *own* borderless NSWindow (Vulkan via Metal,
//! `gpu-context=macvk`), which is what gives real HDR/EDR output. We then glue
//! that window *below* the app window as a child window, make the app window
//! and its webview transparent, and keep both frames in sync. The result looks
//! like a single window: video underneath, the web UI on top.
//!
//! Windows keeps using `wid` (see `video.rs`); nothing here is compiled there.

use std::ffi::c_void;

use objc2::msg_send;
use objc2::runtime::{AnyClass, AnyObject, Bool};
use objc2_foundation::NSRect;

const NS_WINDOW_ABOVE: isize = 1;
const NS_WINDOW_COLLECTION_FULLSCREEN_AUXILIARY: usize = 1 << 8;

/// Makes the app window transparent so the video window underneath shows
/// through the (also transparent) webview. Main thread only.
pub unsafe fn prepare_parent(ns_window: *mut c_void) {
    let win = ns_window as *mut AnyObject;
    let clear: *mut AnyObject = msg_send![AnyClass::get(c"NSColor").unwrap(), clearColor];
    let _: () = msg_send![win, setOpaque: Bool::NO];
    let _: () = msg_send![win, setBackgroundColor: clear];
    let _: () = msg_send![win, setHasShadow: Bool::NO];
}

/// Attaches mpv's window below the app window and matches its frame.
/// Main thread only.
pub unsafe fn attach_child(parent: *mut c_void, child: *mut c_void) {
    let parent = parent as *mut AnyObject;
    let child = child as *mut AnyObject;
    if parent.is_null() || child.is_null() {
        return;
    }

    let _: () = msg_send![child, setIgnoresMouseEvents: Bool::YES];
    let _: () = msg_send![child, setHasShadow: Bool::NO];
    let behavior: usize = msg_send![child, collectionBehavior];
    let _: () = msg_send![child, setCollectionBehavior: behavior | NS_WINDOW_COLLECTION_FULLSCREEN_AUXILIARY];

    let frame: NSRect = msg_send![parent, frame];
    let _: () = msg_send![child, setFrame: frame, display: Bool::YES];
    // The *app* window becomes a child of mpv's window, ordered above it. (The
    // other way round, mpv orders itself to the front when it first shows.)
    let _: () = msg_send![child, addChildWindow: parent, ordered: NS_WINDOW_ABOVE];
    let _: () = msg_send![parent, makeKeyAndOrderFront: std::ptr::null_mut::<AnyObject>()];
}

/// Keeps the video window exactly under the app window. Main thread only.
pub unsafe fn sync_frame(parent: *mut c_void, child: *mut c_void) {
    let parent = parent as *mut AnyObject;
    let child = child as *mut AnyObject;
    if parent.is_null() || child.is_null() {
        return;
    }
    let frame: NSRect = msg_send![parent, frame];
    let _: () = msg_send![child, setFrame: frame, display: Bool::YES];
}

