use serde::de::DeserializeOwned;
use serde::Serialize;
use std::io::{self, Read, Write};
const MAX_CHUNK: usize = 1024 * 1024;
const LENGTH_MASK: u32 = (1 << 30) - 1;

pub fn read<T: DeserializeOwned>(input: &mut impl Read) -> io::Result<Option<T>> {
    let mut record = Vec::new();
    let mut continuing = false;
    loop {
        let mut header = [0u8; 4];
        if input.read(&mut header[..1])? == 0 {
            return if continuing {
                Err(io::Error::new(
                    io::ErrorKind::UnexpectedEof,
                    "unfinished record",
                ))
            } else {
                Ok(None)
            };
        }
        input.read_exact(&mut header[1..])?;
        let header = u32::from_le_bytes(header);
        let kind = header >> 30;
        let length = (header & LENGTH_MASK) as usize;
        if length == 0
            || length > MAX_CHUNK
            || (!continuing && kind > 1)
            || (continuing && kind < 2)
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "invalid protocol chunk",
            ));
        }
        let start = record.len();
        record.try_reserve(length).map_err(io::Error::other)?;
        record.resize(start + length, 0);
        input.read_exact(&mut record[start..])?;
        if kind == 0 || kind == 3 {
            return serde_json::from_slice(&record)
                .map(Some)
                .map_err(io::Error::other);
        }
        continuing = true;
    }
}
pub fn write(output: &mut impl Write, value: &impl Serialize) -> io::Result<()> {
    let bytes = serde_json::to_vec(value).map_err(io::Error::other)?;
    let count = bytes.len().div_ceil(MAX_CHUNK);
    for (index, chunk) in bytes.chunks(MAX_CHUNK).enumerate() {
        let kind = if count == 1 {
            0
        } else if index == 0 {
            1
        } else if index + 1 == count {
            3
        } else {
            2
        };
        output.write_all(&((kind << 30) | chunk.len() as u32).to_le_bytes())?;
        output.write_all(chunk)?;
    }
    output.flush()
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn framing_accepts_chunked_settings_and_rejects_invalid_order() {
        let value = serde_json::json!({"data":"x".repeat(MAX_CHUNK+10)});
        let mut output = Vec::new();
        write(&mut output, &value).unwrap();
        assert_eq!(
            read::<serde_json::Value>(&mut output.as_slice()).unwrap(),
            Some(value)
        );
        let bad = [(2u32 << 30 | 2).to_le_bytes().as_slice(), b"{}"].concat();
        assert!(read::<serde_json::Value>(&mut bad.as_slice()).is_err());
    }
    #[test]
    fn framing_rejects_truncated_records_and_oversized_physical_chunks() {
        assert!(read::<serde_json::Value>(&mut [5u8, 0, 0, 0, b'{'].as_slice()).is_err());
        assert!(
            read::<serde_json::Value>(&mut ((MAX_CHUNK + 1) as u32).to_le_bytes().as_slice())
                .is_err()
        );
    }
}
