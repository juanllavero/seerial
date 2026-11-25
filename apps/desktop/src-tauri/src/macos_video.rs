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


/// Finds the window mpv created, without asking mpv (reading `window-id` goes
/// through mpv's VO thread, which itself waits on the main thread -> deadlock).
/// It is the only visible, normal-level window that is not the app window nor
/// one of its helper children. Main thread only.
pub unsafe fn find_mpv_window(parent: *mut c_void) -> Option<*mut c_void> {
    let parent = parent as *mut AnyObject;
    let app: *mut AnyObject = msg_send![AnyClass::get(c"NSApplication").unwrap(), sharedApplication];
    let windows: *mut AnyObject = msg_send![app, windows];
    let count: usize = msg_send![windows, count];
    for i in 0..count {
        let w: *mut AnyObject = msg_send![windows, objectAtIndex: i];
        if w == parent {
            continue;
        }
        let visible: Bool = msg_send![w, isVisible];
        let level: isize = msg_send![w, level];
        let its_parent: *mut AnyObject = msg_send![w, parentWindow];
        if visible.as_bool() && level == 0 && its_parent != parent {
            return Some(w as *mut c_void);
        }
    }
    None
}

/// Detaches the app window from mpv's window and brings it back to the front.
/// Must run *before* mpv's window is destroyed: closing a parent window also
/// orders out its child windows, which would leave the app invisible and
/// unresponsive. Main thread only.
pub unsafe fn detach_child(parent: *mut c_void, child: *mut c_void) {
    let parent = parent as *mut AnyObject;
    let child = child as *mut AnyObject;
    if parent.is_null() || child.is_null() {
        return;
    }
    let _: () = msg_send![child, removeChildWindow: parent];
    let _: () = msg_send![parent, makeKeyAndOrderFront: std::ptr::null_mut::<AnyObject>()];
}
