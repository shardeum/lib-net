use std::io::Cursor;

use crate::header::header_types::Header;
use crate::header::header_v1::HeaderV1;
use crate::NetConfig;

pub fn wrap_serialized_message(mut serialized_message: Vec<u8>) -> Vec<u8> {
    let mut buffer = Vec::new();
    buffer.push(1); // indicate that the header system is in use
    buffer.append(&mut serialized_message);
    buffer
}

pub fn header_deserialize_factory(version: u8, serialized_header_cursor: &mut Cursor<Vec<u8>>, net_config: &NetConfig) -> Option<Header> {
    match version {
        1 => {
            let deserialized = HeaderV1::deserialize(serialized_header_cursor, net_config)?;
            Some(Header::V1(deserialized))
        }
        _ => None,
    }
}

pub fn header_serialize_factory(header_version: u8, header: Header) -> Option<Vec<u8>> {
    match header_version {
        1 => match header {
            Header::V1(header_v1) => Some(header_v1.serialize()),
        },
        _ => None,
    }
}

pub fn header_from_json_string(json_str: &str, version: &u8) -> Option<Header> {
    match version {
        1 => HeaderV1::from_json_string(json_str).map(Header::V1),
        _ => None,
    }
}
