use std::io::{Cursor, Read, Write};

use crypto::Format::Buffer;
use crypto::{KeyPair, ShardusCrypto};

use crate::BUFFER_SIZE_LIMIT_IN_BYTES;
use log::error;
#[derive(Debug)]
pub struct Message {
    pub header_version: u8,
    pub header: Vec<u8>,
    pub data: Vec<u8>,
    pub sign: Sign,
}

#[derive(Debug)]
pub struct Sign {
    pub owner: Vec<u8>,
    pub sig: Vec<u8>,
}

impl Message {
    pub fn new(header_version: u8, header: Vec<u8>, data: Vec<u8>, sign: Sign) -> Message {
        Message { header_version, header, data, sign }
    }

    pub fn new_unsigned(header_version: u8, header: Vec<u8>, data: Vec<u8>) -> Message {
        Message {
            header_version,
            header,
            data,
            sign: Sign::new(vec![], vec![]),
        }
    }

    pub fn sign(&mut self, crypto: &ShardusCrypto, key_pair: &KeyPair) {
        let unsigned = self.serialize_unsigned();
        let hash = crypto.hash(&unsigned, Buffer);
        let signature = crypto.sign(hash, &key_pair.secret_key);
        if signature.is_err() {
            panic!("Failed to sign message");
        }
        let signature = signature.unwrap();
        self.sign = Sign::new(key_pair.public_key.0.to_vec(), signature);
    }

    pub fn verify(&self, crypto: &ShardusCrypto) -> bool {
        let unsigned = self.serialize_unsigned();
        let hash = crypto.hash(&unsigned, Buffer);
        let owner = self.sign.owner.clone();
        crypto.verify(&hash, &self.sign.sig, &crypto.get_pk(&crypto::HexStringOrBuffer::Buffer(owner)))
    }

    pub fn serialize_unsigned(&self) -> Vec<u8> {
        let mut buffer = Vec::new();

        // Serialize header_version (1 byte)
        buffer.write_all(&self.header_version.to_le_bytes()).unwrap();

        // Serialize header length and header
        let header_len = self.header.len() as u32;
        let header_bytes = self.header.clone();
        buffer.write_all(&header_len.to_le_bytes()).unwrap();
        buffer.write_all(&header_bytes).unwrap();

        // Serialize data length and data
        let data_len = self.data.len() as u32;
        let data_bytes = self.data.clone();
        buffer.write_all(&data_len.to_le_bytes()).unwrap();
        buffer.write_all(&data_bytes).unwrap();

        buffer
    }

    pub fn serialize(&self) -> Vec<u8> {
        let mut buffer = Vec::new();

        // Serialize unsigned message
        buffer.append(&mut self.serialize_unsigned());

        // Serialize sign
        let sign_bytes = self.sign.serialize();
        buffer.write_all(&sign_bytes).unwrap();

        buffer
    }

    pub fn deserialize(cursor: &mut Cursor<Vec<u8>>) -> Option<Message> {
        // Deserialize header_version
        let mut header_version_bytes = [0u8; 1];
        cursor.read_exact(&mut header_version_bytes).ok()?;
        let header_version = u8::from_le_bytes(header_version_bytes);

        // Deserialize header
        let mut header_len_bytes = [0u8; 4];
        cursor.read_exact(&mut header_len_bytes).ok()?;
        let header_len = u32::from_le_bytes(header_len_bytes);
        if header_len > BUFFER_SIZE_LIMIT_IN_BYTES {
            error!("Header exceeds the limit of {} bytes", BUFFER_SIZE_LIMIT_IN_BYTES);
            return None;
        }
        let mut header_bytes = vec![0u8; header_len as usize];
        cursor.read_exact(&mut header_bytes).ok()?;
        let header = header_bytes;

        // Deserialize data
        let mut data_len_bytes = [0u8; 4];
        cursor.read_exact(&mut data_len_bytes).ok()?;
        let data_len = u32::from_le_bytes(data_len_bytes);
        if data_len > BUFFER_SIZE_LIMIT_IN_BYTES {
            error!("Data length exceeds the limit of {} bytes", BUFFER_SIZE_LIMIT_IN_BYTES);
            return None;
        }
        let mut data_bytes = vec![0u8; data_len as usize];
        cursor.read_exact(&mut data_bytes).ok()?;
        let data = data_bytes;

        // Deserialize sign
        let sign = Sign::deserialize(cursor)?;

        Some(Message::new(header_version, header, data, sign))
    }
}

impl Sign {
    pub fn new(owner: Vec<u8>, signature: Vec<u8>) -> Sign {
        Sign { owner, sig: signature }
    }

    pub fn serialize(&self) -> Vec<u8> {
        let mut buffer = Vec::new();

        // Serialize owner length and owner
        let owner_len = self.owner.len() as u32;
        let owner_bytes = self.owner.clone();
        buffer.write_all(&owner_len.to_le_bytes()).unwrap();
        buffer.write_all(&owner_bytes).unwrap();

        // Serialize signature length and signature
        let signature_len = self.sig.len() as u32;
        let signature_bytes = self.sig.clone();
        buffer.write_all(&signature_len.to_le_bytes()).unwrap();
        buffer.write_all(&signature_bytes).unwrap();

        buffer
    }

    pub fn deserialize(cursor: &mut Cursor<Vec<u8>>) -> Option<Sign> {
        // Deserialize owner
        let mut owner_len_bytes = [0u8; 4];
        cursor.read_exact(&mut owner_len_bytes).ok()?;
        let owner_len = u32::from_le_bytes(owner_len_bytes);
        if owner_len > BUFFER_SIZE_LIMIT_IN_BYTES {
            error!("Owner length exceeds the limit of {} bytes", BUFFER_SIZE_LIMIT_IN_BYTES);
            return None;
        }
        let mut owner_bytes = vec![0u8; owner_len as usize];
        cursor.read_exact(&mut owner_bytes).ok()?;
        let owner = owner_bytes;

        // Deserialize signature
        let mut signature_len_bytes = [0u8; 4];
        cursor.read_exact(&mut signature_len_bytes).ok()?;
        let signature_len = u32::from_le_bytes(signature_len_bytes);
        if signature_len > BUFFER_SIZE_LIMIT_IN_BYTES {
            error!("Signature length exceeds the limit of {} bytes", BUFFER_SIZE_LIMIT_IN_BYTES);
            return None;
        }
        let mut signature_bytes = vec![0u8; signature_len as usize];
        cursor.read_exact(&mut signature_bytes).ok()?;
        let signature = signature_bytes;

        Some(Sign::new(owner, signature))
    }

    pub fn to_json_string(&self) -> String {
        let owner_hex = self.owner.iter().map(|byte| format!("{:02x}", byte)).collect::<Vec<String>>().join("");
        let signature_hex = self.sig.iter().map(|byte| format!("{:02x}", byte)).collect::<Vec<String>>().join("");

        format!("{{\"owner\": \"{}\", \"sig\": \"{}\"}}", owner_hex, signature_hex)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_to_json_string() {
        let sign = Sign {
            owner: vec![0x12, 0x34, 0x56, 0x78],
            sig: vec![0x9a, 0xbc, 0xde, 0xf0],
        };

        let expected_json_string = "{\"owner\": \"12345678\", \"sig\": \"9abcdef0\"}";

        assert_eq!(sign.to_json_string(), expected_json_string);
    }
}
