use std::io::{Cursor, Read, Write};
use uuid::Uuid;
extern crate serde;
extern crate serde_json;

use serde::Deserialize;

#[derive(Deserialize)]
pub struct HeaderV1 {
    pub uuid: Uuid,
    pub message_type: u32,
    #[serde(default)]
    pub message_length: u32,
    pub sender_address: String,
}

impl HeaderV1 {
    // Serialize the struct into a Vec<u8>
    pub fn serialize(&self) -> Vec<u8> {
        let mut buffer = Vec::new();

        // Serialize uuid (16 bytes)
        buffer.write_all(self.uuid.as_bytes()).unwrap();

        // Serialize message_type (4 bytes)
        buffer.write_all(&self.message_type.to_le_bytes()).unwrap();

        // Serialize message_length (4 bytes)
        buffer.write_all(&self.message_length.to_le_bytes()).unwrap();

        // Serialize sender_address as bytes and then its length (4 bytes)
        let sender_address_bytes = self.sender_address.as_bytes();
        let sender_address_len = sender_address_bytes.len() as u32;
        buffer.write_all(&sender_address_len.to_le_bytes()).unwrap();
        buffer.write_all(sender_address_bytes).unwrap();

        buffer
    }

    // Deserialize a Vec<u8> cursor into a HeaderV1 struct
    pub fn deserialize(cursor: &mut Cursor<Vec<u8>>) -> Option<Self> {
        // Deserialize uuid
        let mut uuid_bytes = [0u8; 16];
        cursor.read_exact(&mut uuid_bytes).ok()?;
        let uuid = Uuid::from_bytes(uuid_bytes);

        // Deserialize message_type
        let mut message_type_bytes = [0u8; 4];
        cursor.read_exact(&mut message_type_bytes).ok()?;
        let message_type = u32::from_le_bytes(message_type_bytes);

        // Deserialize message_length
        let mut message_length_bytes = [0u8; 4];
        cursor.read_exact(&mut message_length_bytes).ok()?;
        let message_length = u32::from_le_bytes(message_length_bytes);

        // Deserialize sender_address
        let mut sender_address_len_bytes = [0u8; 4];
        cursor.read_exact(&mut sender_address_len_bytes).ok()?;
        let sender_address_len = u32::from_le_bytes(sender_address_len_bytes);

        let mut sender_address_bytes = vec![0u8; sender_address_len as usize];
        cursor.read_exact(&mut sender_address_bytes).ok()?;
        let sender_address = String::from_utf8(sender_address_bytes).ok()?;

        Some(Self {
            uuid,
            message_type,
            message_length,
            sender_address,
        })
    }

    pub fn from_json_string(json_str: &str) -> Option<Self> {
        serde_json::from_str(json_str).ok()
    }

    pub fn to_json_string(&self) -> Option<String> {
        Some(format!(
            r#"{{"uuid": "{}", "message_type": {}, "message_length": {}, "sender_address": "{}"}}"#,
            self.uuid, self.message_type, self.message_length, self.sender_address
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn test_serialize_and_deserialize() {
        let header = HeaderV1 {
            uuid: Uuid::new_v4(),
            message_type: 1,
            message_length: 42,
            sender_address: "127.0.0.1".to_string(),
        };

        let serialized = header.serialize();
        let mut cursor = Cursor::new(serialized);
        let deserialized = HeaderV1::deserialize(&mut cursor).unwrap();

        assert_eq!(header.uuid, deserialized.uuid);
        assert_eq!(header.message_type, deserialized.message_type);
        assert_eq!(header.message_length, deserialized.message_length);
        assert_eq!(header.sender_address, deserialized.sender_address);
    }

    #[test]
    fn test_from_json_string() {
        let json_str = r#"{
            "uuid": "550e8400-e29b-41d4-a716-446655440000",
            "message_type": 1,
            "message_length": 42,
            "sender_address": "127.0.0.1"
        }"#;

        let header = HeaderV1::from_json_string(json_str).unwrap();
        assert_eq!(header.uuid, Uuid::parse_str("550e8400-e29b-41d4-a716-446655440000").unwrap());
        assert_eq!(header.message_type, 1);
        assert_eq!(header.message_length, 42);
        assert_eq!(header.sender_address, "127.0.0.1");
    }

    #[test]
    fn test_to_json_string() {
        let header = HeaderV1 {
            uuid: Uuid::parse_str("550e8400-e29b-41d4-a716-446655440000").unwrap(),
            message_type: 1,
            message_length: 42,
            sender_address: "127.0.0.1".to_string(),
        };

        let json_str = header.to_json_string().unwrap();
        assert_eq!(
            json_str,
            r#"{"uuid": "550e8400-e29b-41d4-a716-446655440000", "message_type": 1, "message_length": 42, "sender_address": "127.0.0.1"}"#
        );
    }
}
