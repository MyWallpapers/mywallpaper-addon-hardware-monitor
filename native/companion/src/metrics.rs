use serde_json::{json, Value};
use std::collections::HashMap;
use std::mem::{align_of, size_of};
use std::time::{SystemTime, UNIX_EPOCH};
use windows::core::{w, PCWSTR};
use windows::Win32::Foundation::FILETIME;
use windows::Win32::Graphics::Dxgi::{
    CreateDXGIFactory1, IDXGIFactory1, DXGI_ADAPTER_FLAG_SOFTWARE,
};
use windows::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
use windows::Win32::System::Performance::{
    PdhAddEnglishCounterW, PdhCloseQuery, PdhCollectQueryData, PdhGetFormattedCounterArrayW,
    PdhOpenQueryW, PDH_CSTATUS_NEW_DATA, PDH_CSTATUS_VALID_DATA, PDH_FMT_COUNTERVALUE_ITEM_W,
    PDH_FMT_DOUBLE, PDH_HCOUNTER, PDH_HQUERY, PDH_MORE_DATA,
};
use windows::Win32::System::Power::{
    CallNtPowerInformation, ProcessorInformation, PROCESSOR_POWER_INFORMATION,
};
use windows::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
use windows::Win32::System::Threading::{GetActiveProcessorCount, GetSystemTimes};

#[derive(Clone, Copy)]
struct CpuTime {
    idle: u64,
    total: u64,
}
struct Adapter {
    name: String,
    memory: u64,
    high: u32,
    low: u32,
}
struct GpuCounter {
    query: PDH_HQUERY,
    counter: PDH_HCOUNTER,
    buffer: Vec<usize>,
}
pub struct Sampler {
    previous: Option<CpuTime>,
    adapter: Option<Adapter>,
    gpu: Option<GpuCounter>,
    cores: u32,
}
impl Sampler {
    pub fn new() -> Self {
        let adapter = discover_adapter();
        let gpu = adapter.as_ref().and_then(|_| GpuCounter::new());
        let cores = unsafe { GetActiveProcessorCount(0xffff) }.clamp(1, 4096);
        Self {
            previous: None,
            adapter,
            gpu,
            cores,
        }
    }
    pub fn sample(&mut self, sequence: u64, drive: &str) -> Result<Value, String> {
        let current = cpu_time()?;
        let usage = self.previous.map(|old| cpu_usage(old, current));
        self.previous = Some(current);
        let mut memory = MEMORYSTATUSEX {
            dwLength: size_of::<MEMORYSTATUSEX>() as u32,
            ..Default::default()
        };
        unsafe { GlobalMemoryStatusEx(&mut memory) }
            .map_err(|_| "Physical memory is unavailable")?;
        let gpu_usage = match (&mut self.gpu, &self.adapter) {
            (Some(counter), Some(adapter)) => counter.sample(adapter),
            _ => None,
        };
        let gpu=self.adapter.as_ref().map(|adapter|json!({"name":adapter.name,"usagePercent":gpu_usage,"dedicatedTotalBytes":adapter.memory}));
        let frequency = frequency(self.cores);
        let storage = storage(drive);
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| "Invalid system clock")?
            .as_millis() as u64;
        Ok(
            json!({"kind":"hardware.sample","schemaVersion":1,"sequence":sequence,"capturedAtUnixMs":timestamp,
            "cpu":{"usagePercent":usage,"frequencyMHz":frequency,"logicalProcessors":self.cores},
            "gpu":gpu,"memory":{"usedBytes":memory.ullTotalPhys.saturating_sub(memory.ullAvailPhys),"totalBytes":memory.ullTotalPhys},"storage":storage}),
        )
    }
}
fn time(value: FILETIME) -> u64 {
    ((value.dwHighDateTime as u64) << 32) | value.dwLowDateTime as u64
}
fn cpu_time() -> Result<CpuTime, String> {
    let (mut idle, mut kernel, mut user) = (
        FILETIME::default(),
        FILETIME::default(),
        FILETIME::default(),
    );
    unsafe { GetSystemTimes(Some(&mut idle), Some(&mut kernel), Some(&mut user)) }
        .map_err(|_| "CPU counters are unavailable")?;
    Ok(CpuTime {
        idle: time(idle),
        total: time(kernel).saturating_add(time(user)),
    })
}
fn cpu_usage(old: CpuTime, new: CpuTime) -> f64 {
    let total = new.total.saturating_sub(old.total);
    if total == 0 {
        return 0.0;
    }
    let idle = new.idle.saturating_sub(old.idle);
    (total.saturating_sub(idle) as f64 / total as f64 * 100.0).clamp(0.0, 100.0)
}
fn frequency(cores: u32) -> Option<f64> {
    let mut info = vec![PROCESSOR_POWER_INFORMATION::default(); cores as usize];
    let result = unsafe {
        CallNtPowerInformation(
            ProcessorInformation,
            None,
            0,
            Some(info.as_mut_ptr().cast()),
            (info.len() * size_of::<PROCESSOR_POWER_INFORMATION>()) as u32,
        )
    };
    if result.0 != 0 {
        return None;
    }
    let reported: Vec<_> = info.iter().filter(|cpu| cpu.CurrentMhz > 0).collect();
    if reported.is_empty() {
        None
    } else {
        Some(
            reported
                .iter()
                .map(|cpu| cpu.CurrentMhz as f64)
                .sum::<f64>()
                / reported.len() as f64,
        )
    }
}
fn storage(drive: &str) -> Option<Value> {
    let root: Vec<u16> = format!("{drive}\\").encode_utf16().chain(Some(0)).collect();
    let (mut available, mut total) = (0u64, 0u64);
    unsafe {
        GetDiskFreeSpaceExW(
            PCWSTR(root.as_ptr()),
            Some(&mut available),
            Some(&mut total),
            None,
        )
    }
    .ok()?;
    if total == 0 {
        return None;
    }
    Some(json!({"drive":drive,"usedBytes":total.saturating_sub(available),"totalBytes":total}))
}
fn discover_adapter() -> Option<Adapter> {
    let factory: IDXGIFactory1 = unsafe { CreateDXGIFactory1() }.ok()?;
    let mut chosen: Option<Adapter> = None;
    for index in 0..32 {
        let Ok(adapter) = (unsafe { factory.EnumAdapters1(index) }) else {
            break;
        };
        let Ok(description) = (unsafe { adapter.GetDesc1() }) else {
            continue;
        };
        if description.Flags & DXGI_ADAPTER_FLAG_SOFTWARE.0 as u32 != 0 {
            continue;
        }
        let end = description
            .Description
            .iter()
            .position(|&c| c == 0)
            .unwrap_or(description.Description.len());
        let candidate = Adapter {
            name: String::from_utf16_lossy(&description.Description[..end]),
            memory: description.DedicatedVideoMemory as u64,
            high: description.AdapterLuid.HighPart as u32,
            low: description.AdapterLuid.LowPart,
        };
        if chosen
            .as_ref()
            .is_none_or(|old| candidate.memory > old.memory)
        {
            chosen = Some(candidate)
        }
    }
    chosen
}
impl GpuCounter {
    fn new() -> Option<Self> {
        let mut query = PDH_HQUERY::default();
        if unsafe { PdhOpenQueryW(PCWSTR::null(), 0, &mut query) } != 0 {
            return None;
        }
        let mut result = Self {
            query,
            counter: PDH_HCOUNTER::default(),
            buffer: Vec::new(),
        };
        if unsafe {
            PdhAddEnglishCounterW(
                query,
                w!(r"\GPU Engine(*)\Utilization Percentage"),
                0,
                &mut result.counter,
            )
        } != 0
        {
            return None;
        }
        if unsafe { PdhCollectQueryData(query) } != 0 {
            return None;
        }
        Some(result)
    }
    fn sample(&mut self, adapter: &Adapter) -> Option<f64> {
        if unsafe { PdhCollectQueryData(self.query) } != 0 {
            return None;
        }
        let (mut bytes, mut count) = (0u32, 0u32);
        if unsafe {
            PdhGetFormattedCounterArrayW(self.counter, PDH_FMT_DOUBLE, &mut bytes, &mut count, None)
        } != PDH_MORE_DATA
            || bytes == 0
            || bytes > 8 * 1024 * 1024
        {
            return None;
        }
        let capacity = bytes;
        self.buffer
            .resize((bytes as usize).div_ceil(align_of::<usize>()), 0);
        let ptr = self
            .buffer
            .as_mut_ptr()
            .cast::<PDH_FMT_COUNTERVALUE_ITEM_W>();
        if unsafe {
            PdhGetFormattedCounterArrayW(
                self.counter,
                PDH_FMT_DOUBLE,
                &mut bytes,
                &mut count,
                Some(ptr),
            )
        } != 0
            || bytes > capacity
            || count as usize > capacity as usize / size_of::<PDH_FMT_COUNTERVALUE_ITEM_W>()
        {
            return None;
        }
        let mut engines = HashMap::<String, f64>::new();
        let start = self.buffer.as_ptr() as usize;
        let end = start + capacity as usize;
        for item in unsafe { std::slice::from_raw_parts(ptr, count as usize) } {
            if item.FmtValue.CStatus != PDH_CSTATUS_VALID_DATA
                && item.FmtValue.CStatus != PDH_CSTATUS_NEW_DATA
            {
                continue;
            }
            let value = unsafe { item.FmtValue.Anonymous.doubleValue };
            if !value.is_finite() || value < 0.0 {
                continue;
            }
            let name_ptr = item.szName.0 as usize;
            if name_ptr < start || name_ptr >= end || name_ptr % 2 != 0 {
                continue;
            }
            let wide = unsafe { std::slice::from_raw_parts(item.szName.0, (end - name_ptr) / 2) };
            let Some(length) = wide.iter().take(1024).position(|&c| c == 0) else {
                continue;
            };
            let name = String::from_utf16_lossy(&wide[..length]);
            if let Some(engine) = engine_key(&name, adapter.high, adapter.low) {
                *engines.entry(engine).or_default() += value
            }
        }
        engines
            .into_values()
            .reduce(f64::max)
            .map(|value| value.clamp(0.0, 100.0))
    }
}
impl Drop for GpuCounter {
    fn drop(&mut self) {
        unsafe { PdhCloseQuery(self.query) };
    }
}
fn engine_key(name: &str, high: u32, low: u32) -> Option<String> {
    let lower = name.to_ascii_lowercase();
    let start = lower.find("_luid_")?;
    let suffix = &lower[start + 6..];
    let mut parts = suffix.split('_');
    let reported_high = u32::from_str_radix(parts.next()?.strip_prefix("0x")?, 16).ok()?;
    let reported_low = u32::from_str_radix(parts.next()?.strip_prefix("0x")?, 16).ok()?;
    if reported_high != high || reported_low != low {
        return None;
    }
    Some(parts.collect::<Vec<_>>().join("_"))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn gpu_aggregation_keeps_adapters_and_engines_separate() {
        assert_eq!(
            engine_key(
                "pid_55_luid_0x00000000_0x0000AB12_phys_0_eng_1_engtype_3D",
                0,
                0xab12
            ),
            Some("phys_0_eng_1_engtype_3d".into())
        );
        assert!(engine_key(
            "pid_55_luid_0x00000000_0x0000AB13_phys_0_eng_1_engtype_3D",
            0,
            0xab12
        )
        .is_none());
    }
    #[test]
    fn cpu_uses_counter_deltas_and_handles_resets() {
        assert_eq!(
            cpu_usage(
                CpuTime {
                    idle: 100,
                    total: 200
                },
                CpuTime {
                    idle: 120,
                    total: 300
                }
            ),
            80.0
        );
        assert_eq!(
            cpu_usage(
                CpuTime {
                    idle: 100,
                    total: 200
                },
                CpuTime { idle: 0, total: 0 }
            ),
            0.0
        );
    }
}
