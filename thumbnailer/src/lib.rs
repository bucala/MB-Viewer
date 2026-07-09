//! MB Viewer Explorer thumbnail provider (Windows COM in-process server).
//!
//! Implements `IThumbnailProvider` + `IInitializeWithStream` so Windows
//! Explorer can render real 3D previews for the mesh formats MB Viewer owns
//! (STL, OBJ). The COM vtables are hand-rolled with raw pointers to stay
//! independent of the fast-moving `windows`-crate macro API; only GDI's
//! `CreateDIBSection` is called through FFI.
//!
//! The app (`src-tauri`) registers this DLL's CLSID and wires it onto each
//! associated ProgID; `regsvr32` is not required.

#![cfg(windows)]

mod mesh;
mod render;

use core::ffi::c_void;
use core::mem::{offset_of, size_of, zeroed};
use core::ptr::null_mut;
use core::sync::atomic::{AtomicI32, AtomicU32, Ordering};

// ---------------------------------------------------------------------------
// COM/HRESULT primitives
// ---------------------------------------------------------------------------

type Hr = i32;
const S_OK: Hr = 0;
const S_FALSE: Hr = 1;
const E_POINTER: Hr = 0x8000_4003u32 as i32;
const E_NOINTERFACE: Hr = 0x8000_4002u32 as i32;
const E_INVALIDARG: Hr = 0x8007_0057u32 as i32;
const E_FAIL: Hr = 0x8000_4005u32 as i32;
const CLASS_E_NOAGGREGATION: Hr = 0x8004_0110u32 as i32;
const CLASS_E_CLASSNOTAVAILABLE: Hr = 0x8004_0111u32 as i32;

/// WTS_ALPHATYPE::WTSAT_ARGB — the returned bitmap has a valid alpha channel.
const WTSAT_ARGB: i32 = 2;

#[repr(C)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct Guid {
    d1: u32,
    d2: u16,
    d3: u16,
    d4: [u8; 8],
}

const fn guid(d1: u32, d2: u16, d3: u16, d4: [u8; 8]) -> Guid {
    Guid { d1, d2, d3, d4 }
}

const IID_IUNKNOWN: Guid = guid(0, 0, 0, [0xC0, 0, 0, 0, 0, 0, 0, 0x46]);
const IID_ICLASSFACTORY: Guid = guid(1, 0, 0, [0xC0, 0, 0, 0, 0, 0, 0, 0x46]);
const IID_IINITIALIZE_WITH_STREAM: Guid = guid(
    0xb824b49d, 0x22ac, 0x4161, [0xac, 0x8a, 0x99, 0x16, 0xe8, 0xfa, 0x3f, 0x7f],
);
const IID_ITHUMBNAIL_PROVIDER: Guid = guid(
    0xe357fccd, 0xa995, 0x4576, [0xb0, 0x1f, 0x23, 0x46, 0x30, 0x15, 0x4e, 0x96],
);
/// MB Viewer thumbnail provider CLSID (must match `associations.rs`).
const CLSID_MB_THUMB: Guid = guid(
    0x2b6e9c7a, 0x1f4d, 0x4a9e, [0xb3, 0xc2, 0x7a, 0x1e, 0x9d, 0x0c, 0x5f, 0x42],
);

/// Live objects + server locks; the DLL may unload only when this hits zero.
static OUTSTANDING: AtomicI32 = AtomicI32::new(0);

// ---------------------------------------------------------------------------
// Vtable layouts (IUnknown-prefixed)
// ---------------------------------------------------------------------------

type QueryInterfaceFn = unsafe extern "system" fn(*mut c_void, *const Guid, *mut *mut c_void) -> Hr;
type AddRefFn = unsafe extern "system" fn(*mut c_void) -> u32;
type ReleaseFn = unsafe extern "system" fn(*mut c_void) -> u32;

#[repr(C)]
struct IThumbnailProviderVtbl {
    query_interface: QueryInterfaceFn,
    add_ref: AddRefFn,
    release: ReleaseFn,
    get_thumbnail: unsafe extern "system" fn(*mut c_void, u32, *mut *mut c_void, *mut i32) -> Hr,
}

#[repr(C)]
struct IInitializeWithStreamVtbl {
    query_interface: QueryInterfaceFn,
    add_ref: AddRefFn,
    release: ReleaseFn,
    initialize: unsafe extern "system" fn(*mut c_void, *mut c_void, u32) -> Hr,
}

#[repr(C)]
struct IClassFactoryVtbl {
    query_interface: QueryInterfaceFn,
    add_ref: AddRefFn,
    release: ReleaseFn,
    create_instance: unsafe extern "system" fn(*mut c_void, *mut c_void, *const Guid, *mut *mut c_void) -> Hr,
    lock_server: unsafe extern "system" fn(*mut c_void, i32) -> Hr,
}

/// Just enough of IStream to pull the bytes out (methods 0..=5).
#[repr(C)]
struct IStreamVtbl {
    query_interface: QueryInterfaceFn,
    add_ref: AddRefFn,
    release: ReleaseFn,
    read: unsafe extern "system" fn(*mut c_void, *mut c_void, u32, *mut u32) -> Hr,
    write: unsafe extern "system" fn(*mut c_void, *const c_void, u32, *mut u32) -> Hr,
    seek: unsafe extern "system" fn(*mut c_void, i64, u32, *mut u64) -> Hr,
}

// ---------------------------------------------------------------------------
// Provider object: exposes IThumbnailProvider (offset 0) + IInitializeWithStream
// ---------------------------------------------------------------------------

#[repr(C)]
struct Provider {
    thumb_vtbl: *const IThumbnailProviderVtbl,
    init_vtbl: *const IInitializeWithStreamVtbl,
    refs: AtomicU32,
    stream: *mut c_void,
}

static THUMB_VTBL: IThumbnailProviderVtbl = IThumbnailProviderVtbl {
    query_interface: thumb_query_interface,
    add_ref: thumb_add_ref,
    release: thumb_release,
    get_thumbnail: thumb_get_thumbnail,
};

static INIT_VTBL: IInitializeWithStreamVtbl = IInitializeWithStreamVtbl {
    query_interface: init_query_interface,
    add_ref: init_add_ref,
    release: init_release,
    initialize: init_initialize,
};

/// Recover the Provider base from an IInitializeWithStream interface pointer.
unsafe fn base_from_init(this: *mut c_void) -> *mut Provider {
    (this as *mut u8).sub(offset_of!(Provider, init_vtbl)) as *mut Provider
}

unsafe fn provider_qi(base: *mut Provider, riid: *const Guid, ppv: *mut *mut c_void) -> Hr {
    if ppv.is_null() {
        return E_POINTER;
    }
    *ppv = null_mut();
    let iid = *riid;
    if iid == IID_IUNKNOWN || iid == IID_ITHUMBNAIL_PROVIDER {
        *ppv = &mut (*base).thumb_vtbl as *mut _ as *mut c_void;
    } else if iid == IID_IINITIALIZE_WITH_STREAM {
        *ppv = &mut (*base).init_vtbl as *mut _ as *mut c_void;
    } else {
        return E_NOINTERFACE;
    }
    (*base).refs.fetch_add(1, Ordering::AcqRel);
    S_OK
}

unsafe fn provider_add_ref(base: *mut Provider) -> u32 {
    (*base).refs.fetch_add(1, Ordering::AcqRel) + 1
}

unsafe fn provider_release(base: *mut Provider) -> u32 {
    let remaining = (*base).refs.fetch_sub(1, Ordering::AcqRel) - 1;
    if remaining == 0 {
        if !(*base).stream.is_null() {
            istream_release((*base).stream);
        }
        drop(Box::from_raw(base));
        OUTSTANDING.fetch_sub(1, Ordering::AcqRel);
    }
    remaining
}

unsafe extern "system" fn thumb_query_interface(this: *mut c_void, riid: *const Guid, ppv: *mut *mut c_void) -> Hr {
    provider_qi(this as *mut Provider, riid, ppv)
}
unsafe extern "system" fn thumb_add_ref(this: *mut c_void) -> u32 {
    provider_add_ref(this as *mut Provider)
}
unsafe extern "system" fn thumb_release(this: *mut c_void) -> u32 {
    provider_release(this as *mut Provider)
}

unsafe extern "system" fn init_query_interface(this: *mut c_void, riid: *const Guid, ppv: *mut *mut c_void) -> Hr {
    provider_qi(base_from_init(this), riid, ppv)
}
unsafe extern "system" fn init_add_ref(this: *mut c_void) -> u32 {
    provider_add_ref(base_from_init(this))
}
unsafe extern "system" fn init_release(this: *mut c_void) -> u32 {
    provider_release(base_from_init(this))
}

unsafe extern "system" fn init_initialize(this: *mut c_void, pstream: *mut c_void, _grfmode: u32) -> Hr {
    if pstream.is_null() {
        return E_INVALIDARG;
    }
    let base = base_from_init(this);
    if !(*base).stream.is_null() {
        istream_release((*base).stream);
    }
    istream_add_ref(pstream);
    (*base).stream = pstream;
    S_OK
}

unsafe extern "system" fn thumb_get_thumbnail(this: *mut c_void, cx: u32, phbmp: *mut *mut c_void, pdw: *mut i32) -> Hr {
    if phbmp.is_null() || pdw.is_null() {
        return E_POINTER;
    }
    *phbmp = null_mut();
    *pdw = 0;
    let base = this as *mut Provider;
    let stream = (*base).stream;
    if stream.is_null() {
        return E_FAIL;
    }
    let bytes = match read_stream(stream) {
        Some(b) => b,
        None => return E_FAIL,
    };
    let model = match mesh::parse_auto(&bytes) {
        Some(m) => m,
        None => return E_FAIL,
    };
    let size = cx.clamp(16, 1024);
    let pixels = render::render(&model, size);
    let hbmp = create_dib(size, &pixels);
    if hbmp.is_null() {
        return E_FAIL;
    }
    *phbmp = hbmp;
    *pdw = WTSAT_ARGB;
    S_OK
}

// ---------------------------------------------------------------------------
// IStream helpers
// ---------------------------------------------------------------------------

unsafe fn istream_vtbl(s: *mut c_void) -> *const IStreamVtbl {
    *(s as *const *const IStreamVtbl)
}
unsafe fn istream_add_ref(s: *mut c_void) {
    ((*istream_vtbl(s)).add_ref)(s);
}
unsafe fn istream_release(s: *mut c_void) {
    ((*istream_vtbl(s)).release)(s);
}

unsafe fn read_stream(s: *mut c_void) -> Option<Vec<u8>> {
    // Rewind to the start; ignore failures (many streams start at 0 already).
    let mut pos: u64 = 0;
    ((*istream_vtbl(s)).seek)(s, 0, 0 /* STREAM_SEEK_SET */, &mut pos);

    let mut out = Vec::new();
    let mut chunk = vec![0u8; 64 * 1024];
    loop {
        let mut got: u32 = 0;
        let hr = ((*istream_vtbl(s)).read)(s, chunk.as_mut_ptr() as *mut c_void, chunk.len() as u32, &mut got);
        if hr < 0 {
            return None;
        }
        if got == 0 {
            break;
        }
        out.extend_from_slice(&chunk[..got as usize]);
        if out.len() > 256 * 1024 * 1024 {
            break;
        }
    }
    if out.is_empty() {
        None
    } else {
        Some(out)
    }
}

// ---------------------------------------------------------------------------
// GDI DIB creation (32-bit top-down BGRA)
// ---------------------------------------------------------------------------

#[repr(C)]
struct BitmapInfoHeader {
    bi_size: u32,
    bi_width: i32,
    bi_height: i32,
    bi_planes: u16,
    bi_bit_count: u16,
    bi_compression: u32,
    bi_size_image: u32,
    bi_x_pels_per_meter: i32,
    bi_y_pels_per_meter: i32,
    bi_clr_used: u32,
    bi_clr_important: u32,
}

#[repr(C)]
struct BitmapInfo {
    header: BitmapInfoHeader,
    colors: [u32; 1],
}

#[link(name = "gdi32")]
extern "system" {
    fn CreateDIBSection(
        hdc: *mut c_void,
        pbmi: *const BitmapInfo,
        usage: u32,
        ppv_bits: *mut *mut c_void,
        h_section: *mut c_void,
        offset: u32,
    ) -> *mut c_void;
    fn DeleteObject(ho: *mut c_void) -> i32;
}

unsafe fn create_dib(size: u32, pixels: &[u32]) -> *mut c_void {
    let mut bmi: BitmapInfo = zeroed();
    bmi.header.bi_size = size_of::<BitmapInfoHeader>() as u32;
    bmi.header.bi_width = size as i32;
    bmi.header.bi_height = -(size as i32); // top-down
    bmi.header.bi_planes = 1;
    bmi.header.bi_bit_count = 32;
    bmi.header.bi_compression = 0; // BI_RGB

    let mut bits: *mut c_void = null_mut();
    let hbmp = CreateDIBSection(null_mut(), &bmi, 0 /* DIB_RGB_COLORS */, &mut bits, null_mut(), 0);
    if hbmp.is_null() || bits.is_null() {
        if !hbmp.is_null() {
            DeleteObject(hbmp);
        }
        return null_mut();
    }
    let count = (size as usize) * (size as usize);
    let n = count.min(pixels.len());
    core::ptr::copy_nonoverlapping(pixels.as_ptr(), bits as *mut u32, n);
    hbmp
}

// ---------------------------------------------------------------------------
// Class factory (static singleton)
// ---------------------------------------------------------------------------

#[repr(C)]
struct Factory {
    vtbl: *const IClassFactoryVtbl,
}

struct FactoryHolder(Factory);
unsafe impl Sync for FactoryHolder {}

static FACTORY_VTBL: IClassFactoryVtbl = IClassFactoryVtbl {
    query_interface: factory_query_interface,
    add_ref: factory_add_ref,
    release: factory_release,
    create_instance: factory_create_instance,
    lock_server: factory_lock_server,
};

static FACTORY: FactoryHolder = FactoryHolder(Factory {
    vtbl: &FACTORY_VTBL as *const IClassFactoryVtbl,
});

unsafe extern "system" fn factory_query_interface(this: *mut c_void, riid: *const Guid, ppv: *mut *mut c_void) -> Hr {
    if ppv.is_null() {
        return E_POINTER;
    }
    *ppv = null_mut();
    let iid = *riid;
    if iid == IID_IUNKNOWN || iid == IID_ICLASSFACTORY {
        *ppv = this;
        S_OK
    } else {
        E_NOINTERFACE
    }
}

unsafe extern "system" fn factory_add_ref(_this: *mut c_void) -> u32 {
    // The factory is a static singleton; keep it alive for the module's life.
    2
}

unsafe extern "system" fn factory_release(_this: *mut c_void) -> u32 {
    1
}

unsafe extern "system" fn factory_create_instance(
    _this: *mut c_void,
    punk_outer: *mut c_void,
    riid: *const Guid,
    ppv: *mut *mut c_void,
) -> Hr {
    if ppv.is_null() {
        return E_POINTER;
    }
    *ppv = null_mut();
    if !punk_outer.is_null() {
        return CLASS_E_NOAGGREGATION;
    }
    let provider = Box::into_raw(Box::new(Provider {
        thumb_vtbl: &THUMB_VTBL as *const IThumbnailProviderVtbl,
        init_vtbl: &INIT_VTBL as *const IInitializeWithStreamVtbl,
        refs: AtomicU32::new(1),
        stream: null_mut(),
    }));
    OUTSTANDING.fetch_add(1, Ordering::AcqRel);
    let hr = provider_qi(provider, riid, ppv);
    provider_release(provider);
    hr
}

unsafe extern "system" fn factory_lock_server(_this: *mut c_void, flock: i32) -> Hr {
    if flock != 0 {
        OUTSTANDING.fetch_add(1, Ordering::AcqRel);
    } else {
        OUTSTANDING.fetch_sub(1, Ordering::AcqRel);
    }
    S_OK
}

// ---------------------------------------------------------------------------
// DLL exports
// ---------------------------------------------------------------------------

#[no_mangle]
pub unsafe extern "system" fn DllGetClassObject(rclsid: *const Guid, riid: *const Guid, ppv: *mut *mut c_void) -> Hr {
    if ppv.is_null() {
        return E_POINTER;
    }
    *ppv = null_mut();
    if rclsid.is_null() || *rclsid != CLSID_MB_THUMB {
        return CLASS_E_CLASSNOTAVAILABLE;
    }
    let factory = &FACTORY.0 as *const Factory as *mut c_void;
    factory_query_interface(factory, riid, ppv)
}

#[no_mangle]
pub extern "system" fn DllCanUnloadNow() -> Hr {
    if OUTSTANDING.load(Ordering::Acquire) == 0 {
        S_OK
    } else {
        S_FALSE
    }
}

/// Registration is performed by the MB Viewer app (per-user HKCU), so the
/// self-registration entry points are intentionally no-ops.
#[no_mangle]
pub extern "system" fn DllRegisterServer() -> Hr {
    S_OK
}

#[no_mangle]
pub extern "system" fn DllUnregisterServer() -> Hr {
    S_OK
}
