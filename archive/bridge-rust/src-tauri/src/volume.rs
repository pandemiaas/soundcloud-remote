//! Системная громкость Windows (IAudioEndpointVolume).
//! На не-Windows — безопасные заглушки (мост ориентирован на Windows).

#[cfg(windows)]
pub fn get_percent() -> f64 {
    with_endpoint_volume(|ep| ep.GetMasterVolumeLevelScalar())
        .map(|f| (f as f64) * 100.0)
        .unwrap_or(0.0)
}

#[cfg(windows)]
pub fn set_percent(value: f64) -> bool {
    let v = (value / 100.0).clamp(0.0, 1.0) as f32;
    with_endpoint_volume(|ep| {
        ep.SetMasterVolumeLevelScalar(v, None)?;
        Ok(())
    })
    .is_ok()
}

/// Инициализирует COM на текущем потоке, берёт дефолтное устройство вывода
/// и применяет замыкание к IAudioEndpointVolume.
#[cfg(windows)]
fn with_endpoint_volume<T>(
    f: impl FnOnce(&windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume) -> windows::core::Result<T>,
) -> windows::core::Result<T> {
    use windows::core::Error;
    use windows::Win32::Foundation::RPC_E_CHANGED_MODE;
    use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
    use windows::Win32::Media::Audio::{
        eConsole, eRender, CLSID_MMDeviceEnumerator, IMMDeviceEnumerator,
    };
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED,
    };

    unsafe {
        // COM инициализируется на поток; вызовы приходят из разных тасок tokio.
        let hr = CoInitializeEx(None, COINIT_MULTITHREADED);
        if hr.is_err() && hr != RPC_E_CHANGED_MODE {
            return Err(Error::from_hresult(hr));
        }

        let result = (|| {
            let enumerator: IMMDeviceEnumerator =
                CoCreateInstance(&CLSID_MMDeviceEnumerator, None, CLSCTX_ALL)?;
            let device = enumerator.GetDefaultAudioEndpoint(eRender, eConsole)?;
            let endpoint: IAudioEndpointVolume = device.Activate(CLSCTX_ALL, None)?;
            f(&endpoint)
        })();

        // S_OK/S_FALSE требуют парного CoUninitialize; CHANGED_MODE — не наш вызов.
        if hr.is_ok() {
            windows::Win32::System::Com::CoUninitialize();
        }
        result
    }
}

#[cfg(not(windows))]
pub fn get_percent() -> f64 {
    0.0
}

#[cfg(not(windows))]
pub fn set_percent(_value: f64) -> bool {
    false
}
